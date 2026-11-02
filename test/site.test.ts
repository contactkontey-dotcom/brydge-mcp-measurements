import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { markdownToHtml, escapeHtml } from "../site/md.ts";
import { readConfig, packageOf, match, toMarkdown, splitSpec, totals, cardSvg, uncountedLine, humanMs } from "../site/paste-client.js";
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
    startup: null,
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
    /* An email a person can answer, and the issue tracker beside it. A page
     * whose finding is wrong is worth nothing if the only way to say so is to
     * hold a GitHub account. */
    assert.match(html, /mailto:contact@brydge-ai\.com/, `${f}: no email to report a mistake to`);
    assert.match(html, /issues\/new\?title=/, `${f}: no issue route to report a mistake`);
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
    /* `url` may be null in the type — that is what blocks the build rather than
     * letting a page say it. Nothing recorded today is missing one, and this
     * fails the moment somebody adds a response without the thread behind it. */
    assert.match(entry.url ?? "", /^https:\/\/github\.com\/.+\/issues\/\d+$/, `${slug}: no link to the thread`);
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

/*
 * ═══════════════════════════════════════════════════════════════════════════
 * THE PASTE PAGE HOLDS SOMEBODY'S CREDENTIALS FOR A MOMENT. THESE ARE THE
 * TESTS THAT SAY IT NEVER HOLDS THEM FOR TWO.
 * ═══════════════════════════════════════════════════════════════════════════
 */
const CONFIG = JSON.stringify({
  mcpServers: {
    memory: { command: "npx", args: ["-y", "@modelcontextprotocol/server-memory@2.0.1"], env: { GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_thisIsTheSecret", DATABASE_URL: "postgres://user:hunter2@db/x" } },
    figma: { command: "figma-developer-mcp" },
    py: { command: "uvx", args: ["mcp-server-fetch"] },
    remote: { type: "http", url: "https://mcp.example.com/x" },
    docker: { command: "docker", args: ["run", "-i", "ghcr.io/x/y"] },
    dlx: { command: "pnpm", args: ["dlx", "wikipedia-mcp"] },
  },
});

test("an env value does not survive being read, anywhere", () => {
  const parsed = readConfig(CONFIG);
  assert.equal(parsed.ok, true);
  const dumped = JSON.stringify(parsed);
  for (const secret of ["ghp_thisIsTheSecret", "hunter2", "postgres://"]) {
    assert.ok(!dumped.includes(secret), `"${secret}" survived the parse`);
  }
  /* The key NAMES are kept: which credentials a server asks for is the point. */
  assert.deepEqual(parsed.servers[0].envKeys, ["GITHUB_PERSONAL_ACCESS_TOKEN", "DATABASE_URL"]);

  /* And the summary somebody copies into a ticket carries neither. */
  const rows = parsed.servers.map((s) => ({ server: s, result: match(s, {}) }));
  const md = toMarkdown(rows, "https://example.test");
  for (const secret of ["ghp_thisIsTheSecret", "hunter2"]) assert.ok(!md.includes(secret), `"${secret}" reached the clipboard`);
});

test("the shapes a config comes in are read, and the ones we cannot measure say so", () => {
  const servers = readConfig(CONFIG).servers;
  const by = Object.fromEntries(servers.map((s) => [s.label, s.found]));
  assert.deepEqual(by.memory, { kind: "npm", name: "@modelcontextprotocol/server-memory", version: "2.0.1" });
  assert.deepEqual(by.dlx, { kind: "npm", name: "wikipedia-mcp", version: null });
  assert.equal(by.figma.kind, "binary");
  assert.equal(by.py.kind, "other");
  assert.equal(by.py.detail, "Python");
  assert.equal(by.remote.kind, "remote");
  assert.equal(by.docker.detail, "Docker");

  /* `servers:` and `mcp.servers:` are the other two shapes in the wild. */
  assert.equal(readConfig(JSON.stringify({ servers: { a: { command: "npx", args: ["x"] } } })).servers.length, 1);
  assert.equal(readConfig(JSON.stringify({ mcp: { servers: { a: { command: "npx", args: ["x"] } } } })).servers.length, 1);
  /* Nonsense is reported, not thrown. */
  assert.equal(readConfig("{not json").ok, false);
  assert.equal(readConfig(JSON.stringify({ hello: 1 })).ok, false);
});

test("a version split keeps a scope intact", () => {
  assert.deepEqual(splitSpec("@scope/name@1.2.3"), { name: "@scope/name", version: "1.2.3" });
  assert.deepEqual(splitSpec("@scope/name"), { name: "@scope/name", version: null });
  assert.deepEqual(splitSpec("plain@0.1.0"), { name: "plain", version: "0.1.0" });
});

test("a match reports a version that is not the one measured, rather than hiding it", () => {
  const index = { "a-mcp": { name: "a-mcp", slug: "a-mcp", version: "2.0.0", measuredAt: "2026-10-31", offered: 3, undocumentedTools: 0, undeclaredHosts: 0, websites: 0, startupMs: 800 } };
  const one = readConfig(JSON.stringify({ mcpServers: { a: { command: "npx", args: ["-y", "a-mcp@1.0.0"] } } })).servers[0];
  assert.equal(match(one, index).state, "measured-other-version");
  const same = readConfig(JSON.stringify({ mcpServers: { a: { command: "npx", args: ["-y", "a-mcp@2.0.0"] } } })).servers[0];
  assert.equal(match(same, index).state, "measured");
  const none = readConfig(JSON.stringify({ mcpServers: { a: { command: "npx", args: ["-y", "unheard-of"] } } })).servers[0];
  assert.equal(match(none, index).state, "unmeasured");
});

test("the built paste page cannot send anything, and carries its index with it", { skip: !built }, () => {
  const html = page("paste.html");
  /* The rule the browser keeps, whatever the code does. */
  assert.match(html, /connect-src 'none'/, "no CSP forbidding connections");
  assert.match(html, /form-action 'none'/, "a form could still post");

  /* No call that could leave the page — in CODE. The file's own comment names
   * these APIs to say it does not use them, so comments are stripped first. */
  const code = html.slice(html.indexOf("<script type=\"module\">")).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const api of ["fetch(", "XMLHttpRequest", "sendBeacon", "WebSocket", "EventSource", "localStorage", "sessionStorage", "indexedDB", "document.cookie"]) {
    assert.ok(!code.includes(api), `the page's code uses ${api}`);
  }
  /* Inlined, so the page fetches nothing after it loads. */
  assert.match(html, /"slug":/, "the measurement index is not inlined");
  assert.ok(!/src="[^"]*paste-client/.test(html), "the parser is loaded over the network instead of inlined");

  /* A withheld measurement reads the same as one that was never made. Saying
   * "not measured" about something we measured would be false; saying
   * "withheld" would announce the finding before its maintainer heard it. */
  assert.ok(!html.includes("Not measured."), "the page calls a withheld measurement unmeasured");
  assert.match(html, /No page for this yet/, "no wording for a package without a page");

  /* Withheld measurements are not in the index either. */
  const withheld = publishable(
    readdirSync(join(import.meta.dirname, "..", "level1", "evidence"))
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(readFileSync(join(import.meta.dirname, "..", "level1", "evidence", f), "utf8")) as Level1Evidence),
  ).withheld;
  for (const e of withheld) assert.ok(!html.includes(`"${e.package.name}"`), `${e.slug} leaked into the paste index`);
});

/*
 * ═══════════════════════════════════════════════════════════════════════════
 * THE TOTAL, AND THE CARD BUILT TO BE POSTED SOMEWHERE PUBLIC.
 *
 * A total is the most quotable thing on the page, and the card is the one part
 * designed to leave the browser and land in a thread. Two things therefore
 * have to hold: no credential, name or path can reach either, and neither may
 * state a figure as complete when it is not.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** The index as `site/build.ts` inlines it, for two of the six servers. */
const INDEX = {
  "@modelcontextprotocol/server-memory": {
    name: "@modelcontextprotocol/server-memory", slug: "modelcontextprotocol--server-memory", version: "2.0.1",
    measuredAt: "2026-10-31", offered: 9, undocumentedTools: 0, undeclaredHosts: 0, websites: 0, startupMs: 1325,
  },
  "wikipedia-mcp": {
    name: "wikipedia-mcp", slug: "wikipedia-mcp", version: "1.0.0",
    measuredAt: "2026-10-31", offered: 4, undocumentedTools: 1, undeclaredHosts: 0, websites: 1, startupMs: null,
  },
};

const rowsOf = (cfg: string, index: Record<string, unknown> = INDEX as never) =>
  readConfig(cfg).servers.map((s) => ({ server: s, result: match(s, index as never) }));

test("the total counts what it can and tallies what it cannot, in separate buckets", () => {
  const t = totals(rowsOf(CONFIG));
  assert.equal(t.servers, 6);
  assert.equal(t.counted, 2, "memory by name and wikipedia-mcp via pnpm dlx");
  assert.equal(t.tools, 13, "9 + 4");
  assert.equal(t.startupMs, 1325, "only memory has a timing");
  assert.equal(t.startupUnknown, 1, "wikipedia-mcp is counted for tools and has no timing");
  assert.equal(t.hosted, 1, "the http server");
  assert.equal(t.nonNpm, 2, "uvx and docker");
  assert.equal(t.noPage, 1, "the bare figma binary");
  assert.equal(t.servers, t.counted + t.hosted + t.nonNpm + t.noPage + t.unreadable);
});

test("a missing timing is never counted as zero", () => {
  /* Treating null as 0 would make a server with no figure look instant and
   * make the sum look complete. Both at once, which is the worst pairing. */
  const t = totals(rowsOf(CONFIG));
  assert.ok(t.startupUnknown > 0);
  assert.equal(t.startupMs, 1325);
});

test("the uncounted line names every bucket it has, and says the total is low", () => {
  const line = uncountedLine(totals(rowsOf(CONFIG)));
  assert.match(line, /covers 2 of your 6 servers/);
  assert.match(line, /does NOT count 4/);
  assert.match(line, /no page here/);
  assert.match(line, /hosted remotely/);
  assert.match(line, /not an npm package/);
  assert.match(line, /higher than the figures above/, "it must say which way the error runs");
  /* And it must not reveal which of "never measured" and "withheld" applies. */
  assert.match(line, /this page cannot tell you which/);
});

test("when nothing is missing the line says so rather than inventing a caveat", () => {
  const only = JSON.stringify({ mcpServers: { m: { command: "npx", args: ["-y", "@modelcontextprotocol/server-memory@2.0.1"] } } });
  const line = uncountedLine(totals(rowsOf(only)));
  assert.match(line, /Every server in this config has a page here/);
  assert.ok(!/does NOT count/.test(line));
});

test("the card carries no credential, no package name and no path", () => {
  const svg = cardSvg(totals(rowsOf(CONFIG)), "https://mcp.brydge-ai.com", "2026-11-02");
  for (const leak of [
    "ghp_thisIsTheSecret", "hunter2", "postgres://",
    "GITHUB_PERSONAL_ACCESS_TOKEN", "DATABASE_URL",
    "@modelcontextprotocol/server-memory", "wikipedia-mcp", "figma-developer-mcp",
    "mcp.example.com", "ghcr.io", "memory", "figma", "docker",
  ]) {
    assert.ok(!svg.includes(leak), `the card leaked "${leak}"`);
  }
});

test("the card states the figures and the shortfall together", () => {
  const svg = cardSvg(totals(rowsOf(CONFIG)), "https://mcp.brydge-ai.com", "2026-11-02");
  assert.match(svg, /2 of 6 servers measured/);
  assert.match(svg, />13</, "the tool count");
  assert.match(svg, /covers 2 of your 6 servers/, "the shortfall travels with the numbers");
  assert.match(svg, /not calibration-backed/);
  assert.match(svg, /not a ranking/);
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg, /<\/svg>$/);
});

test("the card escapes what it draws", () => {
  const svg = cardSvg(totals(rowsOf(CONFIG)), 'https://x.test/"><script>alert(1)</script>', "2026-11-02");
  assert.ok(!svg.includes("<script>"), "a hostile origin reached the card as markup");
});

test("the paste page's own duration rule matches the server pages'", () => {
  assert.equal(humanMs(940), "940 ms");
  assert.equal(humanMs(1240), "1.2 s");
  assert.equal(humanMs(12400), "12 s");
});

test("the card grows to fit its paragraph instead of printing over its own footer", () => {
  /* At a fixed height the fourth wrapped line sat on top of the footer — the
   * one line carrying "not calibration-backed", which is the caveat least able
   * to afford being illegible. */
  const long = { servers: 40, counted: 3, tools: 99, startupMs: 4000, startupUnknown: 2, otherVersion: 1, noPage: 20, hosted: 9, nonNpm: 7, unreadable: 1 };
  const short = { servers: 1, counted: 1, tools: 9, startupMs: 1000, startupUnknown: 0, otherVersion: 0, noPage: 0, hosted: 0, nonNpm: 0, unreadable: 0 };
  for (const t of [long, short]) {
    const svg = cardSvg(t, "https://mcp.brydge-ai.com", "2026-11-02");
    const height = Number(/height="(\d+)"/.exec(svg)![1]);
    const ys = [...svg.matchAll(/<text[^>]*y="(\d+)"/g)].map((m) => Number(m[1]));
    const footer = Math.max(...ys);
    const lastBody = Math.max(...ys.filter((y) => y < footer));
    assert.ok(footer - lastBody >= 24, `only ${footer - lastBody}px between the last line and the footer`);
    assert.ok(height - footer >= 12, `the footer sits ${height - footer}px from the bottom edge`);
    assert.ok(ys.every((y) => y < height), "a line is drawn outside the card");
  }
  /* And the taller card is the one with more to say. */
  assert.ok(
    Number(/height="(\d+)"/.exec(cardSvg(long, "https://x.test", "2026-11-02"))![1]) >=
      Number(/height="(\d+)"/.exec(cardSvg(short, "https://x.test", "2026-11-02"))![1]),
  );
});
