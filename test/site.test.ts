import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { markdownToHtml, escapeHtml } from "../site/md.ts";
import { hasFinding, publishable, upstreamFor } from "../site/build.ts";
import type { Level1Evidence } from "../level1/run.ts";

/*
 * ═══════════════════════════════════════════════════════════════════════════
 * THE GATE, AND THE THREE WORDS, HELD TO BY THE BUILT OUTPUT ITSELF.
 *
 * Two ways this site could break a promise without a wrong number in it:
 * publishing a finding before its maintainer was told, and letting a page call
 * something safe or unsafe. Both are checked against `site/dist` as built, not
 * against the intent of the code, because a gate that is right in theory and
 * bypassed by one forgotten line is not a gate.
 * ═══════════════════════════════════════════════════════════════════════════
 */
const DIST = join(import.meta.dirname, "..", "site", "dist");
const built = existsSync(join(DIST, "index.html"));
const page = (p: string) => readFileSync(join(DIST, p), "utf8");

function ev(slug: string, over: Partial<Level1Evidence> = {}): Level1Evidence {
  return {
    level: 1, notCalibrationBacked: true, asked: `${slug}@1.0.0`, slug,
    package: { name: slug, version: "1.0.0", tarball: "t", integrity: "i", repository: `https://github.com/x/${slug}`, homepage: null },
    measuredAt: "2026-10-31T00:00:00.000Z", instrumentFingerprint: "ca9170df", standard: {},
    readme: { file: "README.md", digest: "a".repeat(64), lines: 10, bytes: 5000 },
    readmeNotes: [], declaration: { hosts: [], identifiers: [] }, couldNotStart: null, serverInfo: null,
    observed: { offered: ["a_tool"], dnsNames: [], tlsHosts: [], connectAttempts: [], programsStarted: [], filesWritten: [], installedDuringRun: [] },
    comparison: {
      tools: { rule: "r", documented: [{ name: "a_tool", at: { line: 1, text: "`a_tool`" } }], undocumented: [] },
      hosts: { rule: "r", declared: [], undeclared: [] },
    },
    findings: [], limits: [], ...over,
  };
}

test("a finding is a finding, and a server that did not start is not one", () => {
  assert.equal(hasFinding(ev("clean")), false);
  assert.equal(hasFinding(ev("tool", { comparison: { tools: { rule: "r", documented: [], undocumented: [{ name: "x", evidence: ["a"] }] }, hosts: { rule: "r", declared: [], undeclared: [] } } })), true);
  assert.equal(hasFinding(ev("host", { comparison: { tools: { rule: "r", documented: [], undocumented: [] }, hosts: { rule: "r", declared: [], undeclared: [{ host: "h", evidence: ["a"] }] } } })), true);
  /* Could-not-start is held out of the site entirely and is never a finding. */
  assert.equal(hasFinding(ev("stuck", { couldNotStart: { stage: "initialize", because: "x" }, comparison: null, observed: null })), false);
});

test("an uncleared finding is withheld; a clean page is not", () => {
  const clean = ev("clean");
  const finding = ev("finding", { comparison: { tools: { rule: "r", documented: [], undocumented: [{ name: "x", evidence: ["a"] }] }, hosts: { rule: "r", declared: [], undeclared: [] } } });
  const { out, withheld } = publishable([clean, finding]);
  assert.deepEqual(out.map((e) => e.slug), ["clean"]);
  assert.deepEqual(withheld.map((e) => e.slug), ["finding"], "nothing is cleared in site/cleared.txt yet");
});

test("markdown is converted, and anything else is escaped rather than trusted", () => {
  assert.equal(markdownToHtml("# Hi"), "<h1>Hi</h1>");
  assert.match(markdownToHtml("a `b_c` d"), /<code>b_c<\/code>/);
  assert.match(markdownToHtml("**x**"), /<strong>x<\/strong>/);
  /* A README quote containing markup must not become markup. */
  assert.ok(!markdownToHtml("- `<img src=x onerror=alert(1)>`").includes("<img"));
  assert.match(markdownToHtml("text <script>bad()</script>"), /&lt;script&gt;/);
  assert.equal(escapeHtml(`<&">`), "&lt;&amp;&quot;&gt;");
  /* Tables and fences, the two shapes the reports lean on. */
  assert.match(markdownToHtml("| a | b |\n| --- | --- |\n| 1 | 2 |"), /<table>.*<th>a<\/th>.*<td>1<\/td>/s);
  /* An address in angle brackets is a thing to click, not an escaped entity. */
  assert.match(markdownToHtml("email <who@example.com> for a quote"), /<a href="mailto:who@example\.com">who@example\.com<\/a>/);
  assert.ok(!markdownToHtml("email <who@example.com>").includes("&lt;who@"));
  /* And a stray angle bracket is still escaped rather than trusted. */
  assert.match(markdownToHtml("a < b and <notanemail>"), /&lt;/);
  assert.match(markdownToHtml("```\nx\n```"), /<pre><code>x<\/code><\/pre>/);
});

test("the built site publishes only what is cleared", { skip: !built }, () => {
  const names = readdirSync(join(DIST, "s"));
  const index = page("index.html");
  const sitemap = page("sitemap.xml");
  const withheld = publishable(
    readdirSync(join(import.meta.dirname, "..", "level1", "evidence"))
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(readFileSync(join(import.meta.dirname, "..", "level1", "evidence", f), "utf8")) as Level1Evidence),
  ).withheld;

  assert.ok(withheld.length > 0, "this test is only meaningful while something is withheld");
  for (const e of withheld) {
    assert.ok(!names.includes(`${e.slug}.html`), `${e.slug} has a page and should not`);
    assert.ok(!index.includes(`/s/${e.slug}.html`), `${e.slug} is linked from the index`);
    assert.ok(!index.includes(escapeHtml(e.package.name)), `${e.slug} is named on the index`);
    assert.ok(!sitemap.includes(e.slug), `${e.slug} is in the sitemap`);
  }
  assert.ok(index.includes(`${withheld.length} pages are not published yet`), "the index states the count it withholds");
});

test("every built page carries the standard, the label, the maker and a way to report a mistake", { skip: !built }, () => {
  for (const f of ["index.html", "method.html", ...readdirSync(join(DIST, "s")).map((n) => `s/${n}`)]) {
    const html = page(f);
    assert.ok(html.includes("A website counts as declared only if the README names it."), `${f}: no standard`);
    assert.match(html, /not calibration-backed/i, `${f}: no label`);
    assert.match(html, /not a ranking/i, `${f}: no ranking disclaimer`);
    assert.match(html, /Report a mistake on this page/, `${f}: no way to report a mistake`);
    assert.match(html, /<title>[^<]+<\/title>/, `${f}: no title`);
    assert.match(html, /name="viewport"/, `${f}: not usable on a phone`);
    if (f.startsWith("s/")) assert.match(html, /Published on npm as/, `${f}: does not name the maker`);
  }
});

test("the site is ink only, and never calls anything safe, unsafe or dangerous in its own words", { skip: !built }, () => {
  const files = ["index.html", "method.html", ...readdirSync(join(DIST, "s")).map((n) => `s/${n}`)];
  for (const f of files) {
    const html = page(f);
    /* BRYDGE's accent means one thing — established under a paid engagement —
     * and a Level 1 measurement is not that. */
    assert.ok(!/#c8a96b|#d7c08a|#b8985c|accent/i.test(html), `${f}: carries BRYDGE's accent`);
    /* The three words, excluding text quoted from somebody's own README. */
    const ownWords = html.replace(/<code>[\s\S]*?<\/code>/g, "").replace(/<pre>[\s\S]*?<\/pre>/g, "");
    const hit = /\b(safe|unsafe|dangerous)\b/i.exec(ownWords);
    assert.equal(hit, null, `${f}: the page's own words use "${hit?.[0]}"`);
  }
});

test("the built site carries search, the two forms, pricing, a badge and a card", { skip: !built }, () => {
  const index = page("index.html");
  assert.match(index, /class="search"/, "no search box");
  assert.match(index, /id="q"/, "no search input");
  /* Every row is in the HTML, so a reader without scripting sees them all. */
  const rows = (index.match(/<tr>/g) ?? []).length - 1;
  assert.equal(rows, readdirSync(join(DIST, "s")).length, "the table is not the published set");

  for (const f of ["request.html", "alerts.html", "pricing.html", "method.html"]) {
    assert.ok(existsSync(join(DIST, f)), `${f} is missing`);
    assert.match(page(f), /og:image/, `${f} has no preview card`);
  }
  /* The forms go somewhere that already keeps a public record. */
  assert.match(page("request.html"), /issues\/new\?title=/, "the request form posts nowhere");
  assert.match(page("alerts.html"), /issues\/new\?title=/, "the alert form posts nowhere");

  /* Pricing leads with the free thing and quotes no figure it has not been given. */
  const pricing = page("pricing.html");
  assert.match(pricing, /Level 1 is free/, "pricing buries the free tier");
  assert.doesNotMatch(pricing, /[$£€]\s?\d/, "pricing quotes a figure nobody set");

  /* A badge and a card per published page, and for nothing else. */
  const slugs = readdirSync(join(DIST, "s")).map((n) => n.replace(/\.html$/, ""));
  for (const slug of slugs) {
    assert.ok(existsSync(join(DIST, "b", `${slug}.svg`)), `${slug}: no badge`);
    assert.ok(existsSync(join(DIST, "p", `${slug}.svg`)), `${slug}: no preview card`);
    const svg = readFileSync(join(DIST, "b", `${slug}.svg`), "utf8");
    assert.match(svg, /measured \d{4}-\d{2}-\d{2}/, `${slug}: the badge states no date`);
    /* A badge is read at a glance; a glance cannot carry limits, so it carries
     * no verdict and no colour that means one. */
    /* Whole words: "measured" is not a verdict, and a substring match says it is. */
    assert.doesNotMatch(svg, /\b(pass(ed)?|fail(ed)?|verified|approved|secure|trusted|green|red)\b/i, `${slug}: the badge reads as a verdict`);
    assert.doesNotMatch(svg, /#(2e[0-9a-f]{4}|0a0|[0-9a-f]{0,2}c8a96b)/i, `${slug}: the badge carries a colour that means something`);
  }
  for (const e of publishable(
    readdirSync(join(import.meta.dirname, "..", "level1", "evidence"))
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(readFileSync(join(import.meta.dirname, "..", "level1", "evidence", f), "utf8")) as Level1Evidence),
  ).withheld) {
    assert.ok(!existsSync(join(DIST, "b", `${e.slug}.svg`)), `${e.slug}: a withheld page has a badge`);
    assert.ok(!existsSync(join(DIST, "p", `${e.slug}.svg`)), `${e.slug}: a withheld page has a card`);
  }
});

test("the upstream record is read, and an entry without a link is visible as such", () => {
  const u = upstreamFor();
  /* Comment keys are notes to a reader of the file, not slugs. */
  assert.ok(!Object.keys(u).some((k) => k.startsWith("_")), "a comment leaked into the data");
  for (const [slug, entry] of Object.entries(u)) {
    assert.match(entry.notifiedAt, /^\d{4}-\d{2}-\d{2}$/, `${slug}: no notification date`);
    assert.ok(entry.outcome.length > 0, `${slug}: no outcome`);
    /* `url` may be null — that is what blocks the build rather than the page. */
    assert.ok(entry.url === null || /^https:\/\//.test(entry.url), `${slug}: url is neither null nor a link`);
  }
});

test("the contact address is the one on the tin, everywhere", { skip: !built }, () => {
  const pages = ["index.html", "method.html", "request.html", "alerts.html", "pricing.html"];
  let seen = 0;
  for (const f of pages) {
    const html = page(f);
    assert.ok(!html.includes("measurements@brydge-ai.com"), `${f}: the old address survives`);
    if (html.includes("contact@brydge-ai.com")) seen++;
  }
  assert.ok(seen >= 3, "the contact address is on fewer pages than expected");
  /* Both routes, side by side, on each form. */
  for (const f of ["request.html", "alerts.html"]) {
    assert.match(page(f), /contact@brydge-ai\.com/, `${f}: no email route`);
    assert.match(page(f), /issues\/new\?title=/, `${f}: no GitHub route`);
  }
  assert.match(page("pricing.html"), /Level 1 is free/, "pricing does not lead with the free tier");
  assert.match(page("pricing.html"), /monthly monitoring/, "pricing does not name what is paid for");
});
