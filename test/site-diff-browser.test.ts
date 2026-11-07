/*
 * The comparison page, driven in a real browser.
 *
 * The static check in site-diff.test.ts looks for calls by name, which a call
 * spelled differently walks straight past. This one does not read the code:
 * it loads the page, uses it the way a reader would, and fails on any request
 * the page makes after load, whatever made it.
 *
 * Requests BEFORE load are the page's own document and its stylesheet from
 * Google Fonts, which every page here carries. The clock starts once the page
 * has loaded; from then on the page is on its own.
 *
 * Skipped where Playwright or the built page is absent, rather than passing
 * silently on a check that never ran.
 */
/// <reference lib="dom" />
import { strict as assert } from "node:assert";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const ROOT = join(import.meta.dirname, "..");
const PAGE = join(ROOT, "site", "dist", "diff.html");

/*
 * Playwright is installed for the machine, not for this package, so an ESM
 * import does not resolve it while require does. createRequire is the bridge.
 * If that ever stops working these tests SKIP, which is a pass that checked
 * nothing — so the first test below fails rather than skips when the page is
 * built and the browser is the only thing missing.
 */
let chromium: any = null;
try {
  chromium = createRequire(import.meta.url)("playwright").chromium;
} catch {
  chromium = null;
}
const can = chromium !== null && existsSync(PAGE);

test("the browser check can actually run", () => {
  if (!existsSync(PAGE)) return; /* nothing built: the site tests skip too */
  assert.ok(chromium !== null, "the page is built but Playwright did not load, so the no-network check never ran");
});

test("the page requests nothing but its own document and its fonts, ever", { skip: !can }, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();

    /*
     * Watch from before the first byte, not from the load event.
     *
     * An earlier version of this attached the listener after `waitUntil:
     * "load"` and asserted nothing came after. It passed on a page with a
     * deliberate leak in it: the stylesheet and three font files delay the
     * load event well past a leak that fires on a 50ms timer, so the request
     * went out before anything was listening. Recording from the start and
     * naming what is allowed catches a leak wherever in the page's life it
     * happens.
     */
    const seen: string[] = [];
    page.on("request", (r: any) => seen.push(r.url()));
    page.on("websocket", (w: any) => seen.push(w.url()));

    /*
     * Report what the page said, not that we waited for it.
     *
     * A duplicate `const` in the inlined script is a SyntaxError that kills
     * every handler, and this test then failed with "Timeout 30000ms
     * exceeded" — thirty seconds spent to learn nothing. One line of
     * listener turns that into the parser's own message.
     */
    const pageErrors: string[] = [];
    page.on("pageerror", (e: any) => pageErrors.push(String(e.message ?? e)));

    await page.goto("file://" + PAGE, { waitUntil: "load" });
    await page.waitForTimeout(200);
    assert.deepEqual(pageErrors, [], `the page's script threw:\n${pageErrors.join("\n")}`);

    /* Use it as a reader would: the demo, then a hand-typed pair. */
    await page.click("#demo");
    await page.waitForFunction(() => (document.querySelector("#out")?.textContent ?? "").includes("311"));
    const demoText = (await page.textContent("#out")) ?? "";
    assert.match(demoText, /278 tools on the left, 311 on the right/);
    assert.match(demoText, /33 added/);
    assert.match(demoText, /cancel_social_post/);
    /* Names only: the page says so instead of reporting none changed. */
    assert.match(demoText, /names only/);
    assert.ok(!/Changed description/.test(demoText), "a names-only comparison claimed a description answer");

    await page.fill("#a", JSON.stringify([{ name: "t", description: "before" }]));
    await page.fill("#b", JSON.stringify([{ name: "t", description: "after" }, { name: "u" }]));
    await page.waitForFunction(() => (document.querySelector("#out")?.textContent ?? "").includes("Changed description"));
    const typed = (await page.textContent("#out")) ?? "";
    assert.match(typed, /Changed description/);
    assert.match(typed, /1 added/);
    assert.match(typed, /before/);
    assert.match(typed, /after/);

    await page.click("#clear");
    await page.waitForFunction(() => (document.querySelector("#out")?.textContent ?? "").includes("Paste a tool list"));

    /* Give anything deferred a chance to fire before calling it quiet. */
    await page.waitForTimeout(800);
    assert.deepEqual(pageErrors, [], `the page's script threw while in use:\n${pageErrors.join("\n")}`);

    /*
     * The only requests allowed: this file, and the webfonts every page here
     * loads. Anything else — any host, any method, at any moment — is the
     * page sending something, and that is what this page promises not to do.
     */
    const allowed = (u: string) =>
      u === "file://" + PAGE ||
      u.startsWith("https://fonts.googleapis.com/") ||
      u.startsWith("https://fonts.gstatic.com/");
    const strays = seen.filter((u) => !allowed(u));
    assert.deepEqual(strays, [], `the page requested ${strays.length} thing(s) it should not:\n${strays.join("\n")}`);
    assert.ok(seen.includes("file://" + PAGE), "the recording missed even the document, so it was not watching");
  } finally {
    await browser.close();
  }
});

test("the browser refuses a connection even if the page tried to open one", { skip: !can }, async () => {
  /*
   * The CSP is the part that holds when the code is wrong. This asks the
   * loaded page to fetch something and checks the browser stops it — so the
   * promise does not rest on the code alone.
   *
   * file:// does not apply a <meta> CSP the way a served page does, so the
   * page's own markup is served over data: here to get the real behaviour.
   */
  const html = readFileSync(PAGE, "utf8");
  const csp = /content="([^"]*connect-src 'none'[^"]*)"/.exec(html);
  assert.ok(csp, "the page carries no CSP with connect-src 'none'");

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.route("**/probe", (r: any) => r.fulfill({ status: 200, body: "reached" }));
    await page.setContent(`<meta http-equiv="Content-Security-Policy" content="${csp[1]}">`, { waitUntil: "load" });
    const blocked = await page.evaluate(async () => {
      try {
        await window.fetch("https://example.invalid/probe");
        return "allowed";
      } catch {
        return "blocked";
      }
    });
    assert.equal(blocked, "blocked", "the CSP let a connection through");
  } finally {
    await browser.close();
  }
});
