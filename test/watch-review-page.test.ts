/*
 * The review page: generated here, driven in a real browser.
 *
 * EVERY FIXTURE IS PLANTED, including a description written to break out of
 * the script element it is embedded in. Nothing reads a capture.
 *
 * The no-network check does not read the code — the static check below does
 * that, and a call spelled differently walks past it. This one loads the page
 * from disk, uses it the way a reviewer would, and fails on ANY request,
 * before load or after: unlike the published pages, this one has no font, no
 * image and no stylesheet of its own, so the honest number is zero.
 */
/// <reference lib="dom" />
import { strict as assert } from "node:assert";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { flatten, GATEKEEPING } from "./banned.ts";
import { CSP, embed, parametersOf, prepare, reviewPage } from "../watch/page.ts";
import { visible } from "../watch/words.ts";
import { apply, parseExport, queueFor } from "../watch/review.ts";
import { itemHashOf } from "../watch/decisions.ts";
import { recordOf, type ToolRecord } from "../watch/tools.ts";

const ROOT = join(import.meta.dirname, "..");
const CLIENT = readFileSync(join(ROOT, "watch", "review-client.js"), "utf8");

/* ── Planted fixtures ───────────────────────────────────────────────────── */

/*
 * A description that tries to end the script element it travels in, carries
 * markup, a zero-width space and the word diff's own delimiter. If any of
 * those works, the page breaks or lies.
 */
const NASTY = 'FIXTURE: </script><img src=x onerror="alert(1)"> and <b>bold</b> & a hidden\u200B space \u27E6U+200B\u27E7.';
const PLAIN_A = "FIXTURE A: reads the planted file and returns its planted bytes.";
const PLAIN_B = "FIXTURE B: reads the planted file, and says what happens when it is missing.";

const tool = (over: Record<string, unknown>): ToolRecord => recordOf({ name: "t", ...over });

const left = [
  tool({ name: "reworded", description: PLAIN_A }),
  tool({ name: "reshaped", inputSchema: { type: "object", properties: { path: { type: "string" } } } }),
  tool({ name: "nasty", description: PLAIN_A }),
];
const right = [
  tool({ name: "reworded", description: PLAIN_B }),
  tool({ name: "reshaped", inputSchema: { type: "object", properties: { path: { type: "string" }, mode: { type: "string" } }, required: ["path"] } }),
  tool({ name: "nasty", description: NASTY }),
  tool({ name: "arrived", description: PLAIN_B, inputSchema: { type: "object", properties: { who: { type: "string" } }, required: ["who"] } }),
];

const queue = () => queueFor("fixture-mcp", "1.0.0", "1.1.0", left, right);
const page = () => reviewPage(prepare(queue(), "2026-11-12"), CLIENT);

/* ── Generation ─────────────────────────────────────────────────────────── */

test("the page is one file with nothing to fetch", () => {
  const html = page();
  /*
   * The embedded data is dropped before this looks for anything, because a
   * DESCRIPTION may contain the text `src=` — the fixture's does — and the
   * first version of this assertion read the escaped fixture and reported
   * that the page loads something. What matters is the page's own markup.
   */
  const markup = html.replace(/<script type="application\/json"[^>]*>[\s\S]*?<\/script>/, "");
  assert.ok(markup.includes("application/json"), "the data block was not the thing that got stripped");
  assert.ok(!/<link\b/i.test(markup), "the page links to something");
  assert.ok(!/<img\b/i.test(markup), "the page carries an image element");
  assert.ok(!/<form\b/i.test(markup), "the page carries a form");
  assert.ok(!/\bsrc=/i.test(markup), "the page loads something by src");
  assert.ok(!/https?:\/\//.test(markup), "the page carries a URL");
  assert.ok(html.includes("default-src &#39;none&#39;") || html.includes("default-src 'none'"), "the policy is not on the page");
  for (const rule of ["default-src 'none'", "connect-src 'none'", "form-action 'none'", "font-src 'none'", "img-src 'none'"]) {
    assert.ok(CSP.includes(rule), `the policy does not say ${rule}`);
  }
});

test("a description cannot end the script element it travels in", () => {
  const html = page();
  /* The only </script> in the file closes the two scripts the page has. */
  assert.equal((html.match(/<\/script>/g) ?? []).length, 2, "a description's text ended a script element");
  assert.ok(html.includes("\\u003c/script\\u003e"), "the dangerous text was not escaped on the way in");
  /* And nothing from the fixture became markup. */
  assert.ok(!html.includes("<img src=x"), "a description's markup is in the document as markup");
  assert.ok(!html.includes("<b>bold</b>"), "a description's markup is in the document as markup");
});

test("embed escapes what a script element cannot hold, and nothing else", () => {
  assert.equal(embed("a<b>c&d"), '"a\\u003cb\\u003ec\\u0026d"');
  assert.equal(embed("plain"), '"plain"');
  /* The two line separators are newlines to a JSON parser and not to a
   * JavaScript one. Built from code points, because escapes in that source
   * turned into the characters themselves once already. */
  assert.equal(embed(String.fromCharCode(0x2028)), '"\\u2028"');
  assert.equal(embed(String.fromCharCode(0x2029)), '"\\u2029"');
  assert.deepEqual(JSON.parse(embed({ a: [1, "<"] })), { a: [1, "<"] });
});

test("every item carries the hash of the item it is about", () => {
  const q = queue();
  const p = prepare(q, "2026-11-12");
  assert.equal(p.items.length, q.items.length);
  for (const item of q.items) {
    const prepared = p.items.find((i) => i.kind === item.kind && i.tool === item.tool)!;
    assert.equal(prepared.itemHash, itemHashOf(item), `${item.kind}:${item.tool}`);
  }
});

test("a new tool gets the same visible markers as an edited one, and its parameters", () => {
  const p = prepare(queue(), "2026-11-12");
  const arrived = p.items.find((i) => i.kind === "new tool")!;
  assert.ok(arrived.words, "a new tool's description was not prepared for showing");
  assert.equal(arrived.words!.before.present, false);
  assert.deepEqual(arrived.parameters, [{ parameter: "who", pointer: "/properties/who", type: "string", required: true }]);
  assert.deepEqual(parametersOf(null), []);
});

test("the prepared data carries no judgement and claims to stop nothing", () => {
  const flat = flatten(JSON.stringify(prepare(queue(), "2026-11-12")) + CLIENT);
  for (const w of GATEKEEPING) assert.ok(!flat.includes(w), `the page says "${w}"`);
  for (const w of ["suspicious", "malicious", "dangerous", "unsafe", "reject", "quarantine"]) {
    assert.ok(!flat.includes(w), `the page judges what it found: "${w}"`);
  }
});

/* ── The client, read statically ────────────────────────────────────────── */

const clientCode = CLIENT.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("the client never puts a string into the document as markup", () => {
  for (const call of ["innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "createContextualFragment", "eval(", "new Function"]) {
    assert.ok(!clientCode.includes(call), `the client uses ${call}`);
  }
  /* Comments mention two of those by name to say they are unused, so a
   * check that did not strip comments would pass on a client that used
   * them and fail on this one. */
  assert.ok(CLIENT.includes("innerHTML"), "the comment that says innerHTML is unused has gone");
});

test("the client reaches for nothing that could leave the page, and remembers nothing", () => {
  for (const call of [
    "fetch(", "XMLHttpRequest", "sendBeacon", "WebSocket", "EventSource", "importScripts",
    "localStorage", "sessionStorage", "indexedDB", "document.cookie", "navigator.sendBeacon",
  ]) {
    assert.ok(!clientCode.includes(call), `the client uses ${call}`);
  }
  assert.ok(clientCode.includes("createObjectURL"), "the download is gone");
});

test("the client parses, inlined, exactly as it is shipped", () => {
  /* A stray apostrophe or a backtick in the generated page has killed an
   * inlined script in this project before, and the only symptom was a
   * browser test timing out. */
  const html = page();
  const at = html.lastIndexOf("<script>");
  const code = html.slice(at + "<script>".length, html.lastIndexOf("</script>"));
  assert.doesNotThrow(() => new Function(code), "the inlined client does not parse");
  assert.equal(code, CLIENT, "the page ships something other than the client file");
});

/* ── In a browser ───────────────────────────────────────────────────────── */

let chromium: any = null;
try {
  chromium = createRequire(import.meta.url)("playwright").chromium;
} catch {
  chromium = null;
}

test("the browser check can actually run", () => {
  assert.ok(chromium !== null, "Playwright did not load, so the no-network and text-only checks never ran");
});

const written = () => {
  const dir = mkdtempSync(join(tmpdir(), "brydge-review-"));
  const file = join(dir, "review.html");
  writeFileSync(file, page());
  return file;
};

test("the page requests nothing, ever, not even before load", { skip: chromium === null }, async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    const asked: string[] = [];
    const errors: string[] = [];
    context.on("request", (r: any) => {
      if (!r.url().startsWith("file://")) asked.push(r.method() + " " + r.url());
    });
    const pageObj = await context.newPage();
    pageObj.on("pageerror", (e: Error) => errors.push(String(e)));
    await pageObj.goto("file://" + written(), { waitUntil: "load" });
    /* Use it the way a reviewer would. */
    await pageObj.fill("#by", "example-approver");
    await pageObj.click(".item .a");
    await pageObj.click(".item:nth-of-type(1) .h");
    await pageObj.click("#copy");
    await pageObj.waitForTimeout(400);
    assert.deepEqual(asked, [], "the page made a request");
    assert.deepEqual(errors, [], "the page threw");
  } finally {
    await browser.close();
  }
});

test("a description's markup is text in the document, not markup", { skip: chromium === null }, async () => {
  const browser = await chromium.launch();
  try {
    const pageObj = await browser.newPage();
    const errors: string[] = [];
    pageObj.on("pageerror", (e: Error) => errors.push(String(e)));
    await pageObj.goto("file://" + written(), { waitUntil: "load" });
    assert.deepEqual(errors, []);

    /* The fixture's elements never became elements. */
    assert.equal(await pageObj.locator("img").count(), 0, "a description's <img> is in the document");
    assert.equal(await pageObj.locator("b").count(), 0, "a description's <b> is in the document");

    /*
     * BOTH TEXTS, REBUILT OUT OF THE DOM.
     *
     * The first version of this asserted the box CONTAINED "<img src=x",
     * and it does not: the word diff interleaves the two descriptions, so
     * that run reads `</script><img`, then a removed run, then `src=x`.
     * Asserting a contiguous substring of interleaved text is the same
     * mistake as the wrapped phrase in Stage 0 and the script tag in Stage
     * 1. The property worth checking is the one that matters anyway: skip
     * the removed spans and the box reads as the second version's text,
     * exactly, every character of it shown.
     */
    const rebuilt: { after: string; before: string } = await pageObj.evaluate(() => {
      const box = document.querySelector('[data-key="description:nasty"] .text')!;
      const take = (skip: string) => {
        let out = "";
        box.childNodes.forEach((node) => {
          if (node.nodeType === 1 && (node as Element).classList.contains(skip)) return;
          out += node.textContent ?? "";
        });
        return out;
      };
      return { after: take("gone"), before: take("came") };
    });
    assert.equal(rebuilt.after, visible(NASTY), "the second version's text is not what the page shows");
    assert.equal(rebuilt.before, visible(PLAIN_A), "the first version's text is not what the page shows");

    /* Which means, among other things, that these are on the page as text:
     * the markup, the hidden character shown by code point, and the
     * fixture's own delimiter shown as ITS code point, so a reader can tell
     * the module's marker from text that imitates one. */
    assert.ok(rebuilt.after.includes("onerror=\"alert(1)\">"), "the markup a reviewer has to read is not there");
    assert.ok(rebuilt.after.includes("\u27E6U+200B\u27E7"), "the zero-width space is not shown");
    assert.ok(rebuilt.after.includes("\u27E6U+27E6\u27E7"), "the fixture's own delimiter was not escaped");
    assert.ok(!rebuilt.after.includes("\u200B"), "the zero-width space reached the page as itself");
  } finally {
    await browser.close();
  }
});

test("the decisions a reviewer makes come back out, and apply cleanly", { skip: chromium === null }, async () => {
  const browser = await chromium.launch();
  try {
    const pageObj = await browser.newPage();
    await pageObj.goto("file://" + written(), { waitUntil: "load" });

    /* Nothing decided, and nothing claimed. The name is asked for first, so
     * it goes in before this can be the thing being checked. */
    await pageObj.fill("#by", "example-approver");
    await pageObj.click("#copy");
    assert.match(await pageObj.locator("#said").innerText(), /Nothing is decided yet\./);

    await pageObj.click('[data-key="description:nasty"] .a');
    await pageObj.click('[data-key="description:reworded"] .h');
    assert.match(await pageObj.locator("#progress").innerText(), /1 approved, 1 held, 2 not yet decided\./);
    /* Held says what held means, where the reviewer is looking. */
    assert.match(
      await pageObj.locator('[data-key="description:reworded"] .state').innerText(),
      /held — looked at, not added to the list, not in the allow rules/,
    );

    /* A name is required: a decision has to say who made it. */
    await pageObj.fill("#by", "   ");
    await pageObj.click("#copy");
    assert.match(await pageObj.locator("#said").innerText(), /Put your name in the box/);
    await pageObj.fill("#by", "example-approver");
    await pageObj.fill("#at", "12 November");
    await pageObj.click("#copy");
    assert.match(await pageObj.locator("#said").innerText(), /YYYY-MM-DD/);
    await pageObj.fill("#at", "2026-11-12");

    const text: string = await pageObj.evaluate(() => {
      /* The same path the download takes, without the download. */
      const data = JSON.parse((document.getElementById("data") as HTMLElement).textContent!);
      void data;
      return (document.getElementById("copy") as HTMLElement).getAttribute("data-x") ?? "";
    });
    void text;

    /* Read the export by clicking copy with the clipboard readable. */
    await pageObj.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await pageObj.click("#copy");
    const copied: string = await pageObj.evaluate(() => navigator.clipboard.readText());
    const incoming = parseExport(copied);
    assert.equal(incoming.package, "fixture-mcp");
    assert.equal(incoming.decisions.length, 2);
    assert.deepEqual(
      incoming.decisions.map((d) => `${d.kind}:${d.name}=${d.decision}`).sort(),
      ["description:nasty=approve", "description:reworded=hold"],
    );
    for (const d of incoming.decisions) {
      assert.equal(d.by, "example-approver");
      assert.equal(d.at, "2026-11-12");
    }

    /* And the file the page produced is one `--apply` accepts: every hash
     * matches the item it is about, so nothing is refused. */
    const applied = apply({
      queue: queue(),
      file: {},
      incoming,
      previous: null,
      measured: { tools: right.map((t) => t.name).sort(), hosts: [], programs: [] },
      at: "2026-11-12",
    });
    assert.deepEqual(applied.refused, [], "the page produced decisions apply refused");
    assert.deepEqual(applied.carried.approvedHere, ["nasty"]);
    assert.ok(applied.carried.left.some((l) => l.tool === "reworded" && /its description was held/.test(l.because)));
  } finally {
    await browser.close();
  }
});

test("the download hands over a file, under this page's policy", { skip: chromium === null }, async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ acceptDownloads: true });
    const pageObj = await context.newPage();
    await pageObj.goto("file://" + written(), { waitUntil: "load" });
    await pageObj.fill("#by", "example-approver");
    await pageObj.click('[data-key="new tool:arrived"] .a');
    const [download] = await Promise.all([pageObj.waitForEvent("download", { timeout: 10000 }), pageObj.click("#export")]);
    assert.match(await download.suggestedFilename(), /^decisions-fixture-mcp-1\.1\.0\.json$/);
    const stream = await download.createReadStream();
    let body = "";
    for await (const chunk of stream) body += String(chunk);
    const incoming = parseExport(body);
    assert.deepEqual(incoming.decisions.map((d) => d.name), ["arrived"]);
    assert.match(await pageObj.locator("#said").innerText(), /1 decision downloaded\./);
  } finally {
    await browser.close();
  }
});
