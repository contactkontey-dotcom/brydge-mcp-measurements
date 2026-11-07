/*
 * The comparison page: the logic, and the promise that it sends nothing.
 *
 * The no-network claim is checked twice over. Once statically, the way the
 * paste page is checked — the CSP, and the absence of any call that could
 * leave the page. Once in a real browser, driving the page as a reader would
 * and failing on any request it makes after load. The static check can be
 * fooled by a call spelled differently; the browser cannot.
 */
import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { canonical, carriesDetail, diffTools, firstDifference, noChangeBlock, parseToolList, readList, recordOf, summaryOf } from "../site/diff-client.js";

const ROOT = join(import.meta.dirname, "..");
const PAGE = join(ROOT, "site", "dist", "diff.html");
const built = existsSync(PAGE);
const html = built ? readFileSync(PAGE, "utf8") : "";

const recs = (xs: Array<Record<string, unknown>>) => xs.map(recordOf);

/* ── The comparison ────────────────────────────────────────────────────── */

test("key order is not a change", () => {
  const a = recs([{ name: "t", inputSchema: { type: "object", properties: { b: 1, a: 2 } } }]);
  const b = recs([{ name: "t", inputSchema: { properties: { a: 2, b: 1 }, type: "object" } }]);
  assert.equal(canonical({ b: 1, a: 2 }), canonical({ a: 2, b: 1 }));
  assert.equal(diffTools(a, b).schemaChanged.length, 0);
  assert.equal(diffTools(a, b).unchanged, 1);
});

test("added, removed, description and schema are four separate answers", () => {
  const a = recs([
    { name: "keep", description: "same", inputSchema: { type: "object" } },
    { name: "gone", description: "x" },
    { name: "reworded", description: "before" },
    { name: "reshaped", inputSchema: { type: "string" } },
  ]);
  const b = recs([
    { name: "keep", description: "same", inputSchema: { type: "object" } },
    { name: "fresh", description: "y" },
    { name: "reworded", description: "after" },
    { name: "reshaped", inputSchema: { type: "number" } },
  ]);
  const d = diffTools(a, b);
  assert.deepEqual(d.added, ["fresh"]);
  assert.deepEqual(d.removed, ["gone"]);
  assert.deepEqual(d.descriptionChanged.map((c) => c.name), ["reworded"]);
  assert.deepEqual(d.schemaChanged.map((c) => c.name), ["reshaped"]);
  assert.equal(d.unchanged, 1);
});

test("a tool moving in both is counted in both, and once as a tool", () => {
  const a = recs([{ name: "t", description: "a", inputSchema: { type: "object" } }]);
  const b = recs([{ name: "t", description: "b", inputSchema: { type: "string" } }]);
  const d = diffTools(a, b);
  assert.equal(d.descriptionChanged.length, 1);
  assert.equal(d.schemaChanged.length, 1);
  assert.equal(d.unchanged, 0);
  const distinct = new Set([...d.descriptionChanged, ...d.schemaChanged].map((c) => c.name));
  assert.equal(distinct.size, 1);
});

test("a field that is neither description nor schema is named, not lumped", () => {
  const a = recs([{ name: "t", _meta: { ui: { resourceUri: "one" } } }]);
  const b = recs([{ name: "t", _meta: { ui: { resourceUri: "two" } } }]);
  const d = diffTools(a, b);
  /* The pointer, not just the top-level field: a dotted path cannot tell a
   * nested ui.resourceUri from a literal key named "ui/resourceUri". */
  assert.deepEqual(d.otherChanged, [
    { name: "t", fields: ["/_meta/ui/resourceUri"], pointers: [{ pointer: "/_meta/ui/resourceUri", atCap: false }] },
  ]);
  assert.equal(d.descriptionChanged.length, 0);
  assert.equal(d.schemaChanged.length, 0);
});

test("a names-only list is a valid list, and is known to carry no detail", () => {
  const names = recs(parseToolList(["b", "a"]));
  assert.deepEqual(names.map((t) => t.name), ["b", "a"]);
  assert.equal(carriesDetail(names), false);
  assert.equal(carriesDetail(recs([{ name: "t", description: "d" }])), true);
  const d = diffTools(recs(parseToolList(["a"])), recs(parseToolList(["a", "b"])));
  assert.deepEqual(d.added, ["b"]);
  assert.equal(d.descriptionChanged.length, 0);
});

test("a names-only comparison does not report zero changed descriptions as a finding", () => {
  const d = diffTools(recs(parseToolList(["a"])), recs(parseToolList(["a", "b"])));
  const said = summaryOf(d, false)!;
  assert.match(said, /added/);
  assert.ok(!/description/.test(said), "a names-only summary must not mention descriptions");
});

test("the shapes a tool list arrives in", () => {
  const one = [{ name: "t" }];
  assert.deepEqual(parseToolList(one), one);
  assert.deepEqual(parseToolList({ tools: one }), one);
  assert.deepEqual(parseToolList({ result: { tools: one } }), one);
  assert.deepEqual(parseToolList({ message: { result: { tools: one } } }), one);
  assert.deepEqual(parseToolList([]), []); /* a server offering nothing */
  assert.throws(() => parseToolList({ nope: 1 }), /no tool list found/);
});

test("bad input gets a reason, not a crash", () => {
  assert.equal(readList("").ok, false);
  const notJson = readList("tools/list");
  assert.equal(notJson.ok, false);
  assert.match((notJson as { because: string }).because, /not JSON/);
  const wrong = readList('{"a":1}');
  assert.equal(wrong.ok, false);
  assert.match((wrong as { because: string }).because, /no tool list found/);
});

test("a reworded description is shown by its first differing line", () => {
  assert.equal(firstDifference("same", "same"), null);
  const f = firstDifference("one\ntwo", "one\nTWO");
  assert.deepEqual(f, { at: 2, before: "two", after: "TWO" });
});

/* ── The demo answers what the note page claims ────────────────────────── */

test("the demo pair gives the 33 added and none removed that the note reports", () => {
  const f = join(ROOT, "site", "notes", "demo-kolbo--mcp-names.json");
  assert.ok(existsSync(f), "the demo extract is missing");
  const demo = JSON.parse(readFileSync(f, "utf8"));
  const d = diffTools(recs(parseToolList(demo.a.names)), recs(parseToolList(demo.b.names)));
  assert.equal(d.counts.a, 278);
  assert.equal(d.counts.b, 311);
  assert.equal(d.added.length, 33);
  assert.equal(d.removed.length, 0);

  const note = JSON.parse(readFileSync(join(ROOT, "site", "notes", "kolbo--mcp-1.128.0-1.131.2.json"), "utf8"));
  assert.deepEqual(d.added, note.added, "the demo and the note disagree about what was added");
});

/* ── The built page ────────────────────────────────────────────────────── */

test("the built page cannot send anything", { skip: !built }, () => {
  assert.match(html, /connect-src 'none'/, "no CSP forbidding connections");
  assert.match(html, /form-action 'none'/, "a form could still post");
  assert.match(html, /default-src 'self'/);
  const code = html.slice(html.indexOf('<script type="module">')).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const api of ["fetch(", "XMLHttpRequest", "sendBeacon", "WebSocket", "EventSource", "localStorage", "sessionStorage", "indexedDB", "document.cookie", "import("]) {
    assert.ok(!code.includes(api), `the page's code uses ${api}`);
  }
  assert.ok(!/src="[^"]*diff-client/.test(html), "the comparison is loaded over the network instead of inlined");
  assert.ok(!/<form\b/.test(html.slice(html.indexOf("<main"))), "a form element could navigate away");
});

test("the built page carries its demo and links the note", { skip: !built }, () => {
  assert.match(html, /Load the demo/);
  assert.match(html, /cancel_social_post/, "the demo names are not inlined");
  assert.match(html, /\/notes\/kolbo--mcp-1\.128\.0-1\.131\.2\.html/, "the page does not link the note");
});

test("the note page links the comparison page", { skip: !existsSync(join(ROOT, "site", "dist", "notes", "kolbo--mcp-1.128.0-1.131.2.html")) }, () => {
  const note = readFileSync(join(ROOT, "site", "dist", "notes", "kolbo--mcp-1.128.0-1.131.2.html"), "utf8");
  assert.match(note, /href="\/diff\.html"/, "the note does not link the comparison page");
});

test("the built page carries no judging word", { skip: !built }, () => {
  const prose = html.replace(/<[^>]+>/g, " ").toLowerCase();
  for (const w of [
    "safe", "unsafe", "suspicious", "malicious", "dangerous", "risky", "harmless",
    "legitimate", "sketchy", "concerning", "alarming", "benign", "trustworthy", "warning",
  ]) {
    assert.ok(!new RegExp(`\\b${w}\\b`).test(prose), `the page says "${w}"`);
  }
});

/* ── The no-network claim must match what the page actually does ───────── */

test("neither page claims it makes no request at all", { skip: !built }, () => {
  /*
   * Both pages used to say so. It was false: each fetches a stylesheet from
   * fonts.googleapis.com and the font files it names from fonts.gstatic.com,
   * four requests in Chromium, all at load. The true claim is narrower and
   * is the one a reader cares about — nothing is sent while they paste.
   *
   * The CSP backs the narrow claim and not the wide one: connect-src 'none'
   * stops fetch, form posts and sockets; style-src and font-src name those
   * two hosts and let them through.
   */
  const paste = join(ROOT, "site", "dist", "paste.html");
  for (const [name, text] of [["diff.html", html], ["paste.html", existsSync(paste) ? readFileSync(paste, "utf8") : ""]] as const) {
    if (!text) continue;
    const prose = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    for (const overclaim of [
      "no connection at all",
      "no request can be made from it at all",
      "makes no requests",
      "sends nothing at all",
      "The one request it makes",
    ]) {
      assert.ok(!prose.includes(overclaim), `${name} still says "${overclaim}"`);
    }
    /* And it names the hosts it does reach, so the reader can check. */
    assert.ok(prose.includes("fonts.googleapis.com"), `${name} does not name the stylesheet host it fetches`);
    assert.ok(prose.includes("fonts.gstatic.com"), `${name} does not name the font host it fetches`);
    assert.match(prose, /connect-src 'none'/, `${name} does not state the rule that holds`);
  }
});

/* ── What a tool says about itself comes first ─────────────────────────── */

test("the summary names descriptions and schemas before added and removed", () => {
  const a = recs([{ name: "keep", description: "a" }, { name: "gone", description: "x" }]);
  const b = recs([{ name: "keep", description: "b" }, { name: "fresh", description: "y" }]);
  const said = summaryOf(diffTools(a, b), true)!;
  assert.ok(
    said.indexOf("changed description") < said.indexOf("added"),
    `the summary puts added before descriptions: "${said}"`,
  );
});

test("a tool whose description and schema both changed is reported under the description", { skip: !built }, () => {
  /* The partition, read off the rendered page rather than the source. */
  const script = html.slice(html.indexOf('<script type="module">'));
  assert.match(script, /describedNames\.indexOf\(c\.name\) === -1/, "the schema section does not exclude described tools");
  assert.match(script, /The input schema also changed/, "a both-changed tool does not say its schema moved");
});

test("the page says 'the description changed' and never 'behaviour changed'", { skip: !built }, () => {
  const prose = html.replace(/<[^>]+>/g, " ").toLowerCase();
  for (const phrase of [
    "behaviour changed", "behavior changed", "behaviour", "now does", "can now",
    "no longer able", "gained the ability", "expanded its", "more capable",
  ]) {
    assert.ok(!prose.includes(phrase), `the page says "${phrase}"`);
  }
  const script = html.slice(html.indexOf('<script type="module">'));
  assert.match(script, /the description changed/);
  assert.match(script, /the input schema changed/);
});

test("every list the results emit is closed", { skip: !built }, () => {
  /*
   * ul.tools is a flex container. An unclosed <ul> adopts every heading and
   * list that follows as a flex item and lays the rest of the results out in
   * a row — which is what a dropped </ul> in the schema section did, while
   * the DOM order stayed correct and every text assertion still passed.
   */
  /*
   * The script only, comments stripped. The prose after the script has its
   * own lists from markdown, and a comment inside the script mentions the
   * closing tag by name to explain why it is not optional. Neither emits a
   * list. (A literal </ul> inside a script is inert — only </script ends the
   * element — so the mention is safe; it just must not be counted.)
   */
  const from = html.indexOf('<script type="module">');
  const script = html
    .slice(from, html.indexOf("</script>", from))
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  /* Every <ul the results emit, not just the tool lists: the no-change
   * block adds <ul class="named"> and an unclosed one breaks the same way. */
  const opens = (script.match(/<ul\b/g) ?? []).length;
  const closes = (script.match(/<\/ul>/g) ?? []).length;
  assert.equal(opens, closes, `${opens} <ul opened, ${closes} </ul> closed`);
});

/* ── The no-change caveat is one string, not two ───────────────────────── */

test("the page's caveat is byte-for-byte the one in watch/versiondiff.ts", { skip: !built }, async () => {
  /*
   * site/diff-client.js cannot import the Node module, so build.ts injects
   * NO_CHANGE_CAVEAT into the page. That is the seam where two copies would
   * quietly diverge, so it is checked rather than trusted: the literal in
   * the built page must equal the exported constant exactly.
   */
  const { NO_CHANGE_CAVEAT } = await import("../watch/versiondiff.ts");
  const m = /const NO_CHANGE_CAVEAT = ("(?:[^"\\]|\\.)*");/.exec(html);
  assert.ok(m, "the page does not carry an injected NO_CHANGE_CAVEAT");
  assert.equal(JSON.parse(m[1]!), NO_CHANGE_CAVEAT, "the page's caveat has drifted from the module's");
  const a = /const ALWAYS_NOT_COMPARED = (\[[^\n]*?\]);/.exec(html);
  assert.ok(a, "the page does not carry an injected ALWAYS_NOT_COMPARED");
  const { ALWAYS_NOT_COMPARED } = await import("../watch/versiondiff.ts");
  assert.deepEqual(JSON.parse(a[1]!), ALWAYS_NOT_COMPARED, "the page's always-not-compared list has drifted");
  /* and nothing hand-wrote a second copy of the sentence into the client */
  const client = readFileSync(join(ROOT, "site", "diff-client.js"), "utf8");
  assert.ok(!client.includes("does not test what any tool does"), "diff-client.js keeps its own copy of the caveat");
});

test("the page's no-change is two named lists, and a finding is not", { skip: !built }, async () => {
  const { ALWAYS_NOT_COMPARED, NO_CHANGE_CAVEAT } = await import("../watch/versiondiff.ts");
  const same = recs([{ name: "a", description: "d", inputSchema: { type: "object" } }]);
  assert.equal(summaryOf(diffTools(same, same), true), null, "a no-change still produced a one-line summary");

  const withDetail = noChangeBlock(diffTools(same, same), true, ALWAYS_NOT_COMPARED, NO_CHANGE_CAVEAT);
  assert.ok(withDetail.compared.some((x) => x.startsWith("tool names: 1 in both, 0 added, 0 removed")));
  assert.ok(withDetail.compared.some((x) => x.startsWith("tool descriptions: none changed")));
  assert.ok(withDetail.compared.some((x) => x.startsWith("tool input schemas: none changed")));
  assert.equal(withDetail.caveat, NO_CHANGE_CAVEAT);

  const names = recs(parseToolList(["a", "b"]));
  const namesOnly = noChangeBlock(diffTools(names, names), false, ALWAYS_NOT_COMPARED, NO_CHANGE_CAVEAT);
  assert.ok(namesOnly.notCompared.some((x) => x.startsWith("tool descriptions")), "descriptions are not named as uncompared");
  assert.ok(namesOnly.notCompared.some((x) => x.startsWith("tool input schemas")), "schemas are not named as uncompared");
  assert.ok(!namesOnly.compared.some((x) => x.includes("description")), "descriptions were claimed as compared");

  /* Both permanent entries, in every shape. */
  for (const block of [withDetail, namesOnly]) {
    for (const always of ALWAYS_NOT_COMPARED) assert.ok(block.notCompared.includes(always), `missing: ${always}`);
    assert.ok(
      block.notCompared.some((x) => x.startsWith("what either version did at startup")),
      "the page claims nothing about startup, and must say so",
    );
  }

  /* A finding is a sentence and carries neither list nor caveat. */
  const moved = diffTools(recs([{ name: "a" }]), recs([{ name: "a" }, { name: "b" }]));
  const found = summaryOf(moved, false);
  assert.ok(found && !found.includes(NO_CHANGE_CAVEAT));
});

/* ── Nothing characterises a change ───────────────────────────────────── */

/*
 * One text, flattened so a phrase cannot hide in the gaps.
 *
 * The check this replaces read each file and asked whether it contained
 * "build artifact". site/diff-client.js said exactly that — and passed,
 * because the sentence wrapped: "one build" ended one comment line and
 * "artifact, which is what it is" began the next, so the contiguous string
 * was never in the file. A test that reports a file clean while the file
 * says the thing is worse than no test, because it is believed.
 *
 * Comment leaders are dropped and every run of whitespace becomes one
 * space, so a banned phrase cannot hide in a line break, an indent, or the
 * " * " column of a block comment.
 */
export function flatten(s: string): string {
  return s
    .split("\n")
    .map((l) => l.replace(/^\s*\*\s?/, " "))
    .join(" ")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

test("the flattened search catches a phrase broken across lines", () => {
  const wrapped = ["/*", " *     and named it reads as one build", " *     artifact, which is what it is.", " */"].join("\n");
  assert.ok(!wrapped.toLowerCase().includes("build artifact"), "the raw text was not actually wrapped");
  assert.ok(flatten(wrapped).includes("build artifact"), "flattening does not close the gap a line break opens");
});

test("no source file characterises a change as a build artifact or noise", () => {
  for (const f of ["site/diff-client.js", "site/build.ts", "watch/tools.ts", "watch/alert.ts", "watch/log.ts"]) {
    const text = flatten(readFileSync(join(ROOT, f), "utf8"));
    /* "cache-busting" went the same way: it named what somebody else's
     * `_meta` string was for, which no run here measured. */
    for (const w of ["build artifact", "build noise", "cache-busting", "cache-bust", "cosmetic", "harmless"]) {
      assert.ok(!text.includes(w), `${f} says "${w}"`);
    }
  }
});
