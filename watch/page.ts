/*
 * ═══════════════════════════════════════════════════════════════════════════
 * THE REVIEW PAGE: ONE LOCAL FILE, NO NETWORK, DECISIONS OUT AS JSON.
 *
 * ── WHY IT IS NOT PART OF THE SITE ───────────────────────────────────────
 *
 * This page shows the text of somebody's tool descriptions, side by side,
 * with every character made visible. That is the right thing in front of the
 * person deciding whether to approve them and the wrong thing to publish —
 * the same argument watch/tools.ts makes about watch/runs. So it is written
 * to watch/review/, which is gitignored, and never to site/dist, which
 * test/site-no-descriptions.test.ts checks from five directions.
 *
 * It does not use site/build.ts's shell either, and not only for tidiness:
 * that module runs its whole site build on import. A page that reached for
 * it would rebuild the site to render a review.
 *
 * ── THE DIFFING HAPPENS HERE, THE DECIDING HAPPENS THERE ─────────────────
 *
 * The word diff and the schema diff run at generation time, in Node, and
 * the page carries their results. The alternative — shipping the algorithms
 * to the browser — would mean a second copy of each, and site/diff-client.js
 * already demonstrates what that costs: the pointer walk exists twice and is
 * held together by a test that compares the two on the same input.
 *
 * Both halves run on the reviewer's own machine either way. What the browser
 * does is render, collect decisions and hand back a file, and it does all of
 * that with no network: there is no fetch, no form, no font, no image, and a
 * Content-Security-Policy of `default-src 'none'` that the browser enforces
 * whatever this file says.
 *
 * ── TEXT, NEVER MARKUP ───────────────────────────────────────────────────
 *
 * Every piece of a description or a schema reaches the document through
 * `textContent`. The client has no `innerHTML` in it at all, and a test
 * asserts the absence rather than trusting the review that read it. The
 * data is embedded as JSON with `<`, `>` and `&` escaped to their \\u
 * forms, so a description containing `</script>` is a description
 * containing `</script>` and not the end of the script. There is a planted
 * fixture for exactly that.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { itemHashOf, type ItemKind, type ReviewItem } from "./decisions.ts";
import { FORMAT, FORMAT_VERSION, otherFieldLines, type Queue } from "./review.ts";
import { paramsOf, renderSchemaDiff, schemaDiff, type Change } from "./schemadiff.ts";
import { legendFor, markup, visible, wordDiff, MARKER_KEY, type Run } from "./words.ts";

/* ── What the page is given ─────────────────────────────────────────────── */

export interface WordsPart {
  runs: Run[];
  legend: string[];
  wordsRemoved: number;
  wordsAdded: number;
  charactersRemoved: number;
  charactersAdded: number;
  before: { present: boolean; characters: number };
  after: { present: boolean; characters: number };
  capped: string | null;
}

export interface SchemaPart {
  changes: Change[];
  unexplained: number;
  pointers: number;
}

export interface ParamPart {
  parameter: string;
  pointer: string;
  type: string;
  required: boolean;
}

export interface PreparedItem {
  kind: ItemKind;
  tool: string;
  itemHash: string;
  words: WordsPart | null;
  schema: SchemaPart | null;
  /** For a new tool: what it declares it accepts. */
  parameters: ParamPart[] | null;
}

export interface Prepared {
  package: string;
  from: string;
  to: string;
  generatedAt: string;
  items: PreparedItem[];
  notes: string[];
  removed: string[];
  unchanged: number;
  markerKey: string[];
}

const typeOf = (node: Record<string, unknown>): string => {
  const t = node.type;
  if (t === undefined) return "(no type)";
  return Array.isArray(t) ? t.map(String).join(" or ") : String(t);
};

const wordsPart = (a: string | null, b: string | null): WordsPart => {
  const d = wordDiff(a, b);
  /*
   * EVERY RUN IS MADE VISIBLE HERE, and that is not a nicety.
   *
   * The first draft shipped the raw runs and left the client to split out
   * the markers. The client has no way to ADD one, so the page rendered a
   * real zero-width space as a real zero-width space — invisible, in the one
   * view built to show it — and rendered the fixture's own literal
   * `⟦U+200B⟧` as a marker, which is precisely the forgery watch/words.ts
   * escapes the delimiter to prevent. Both failures at once, in the two
   * places Stage 1 exists to cover.
   *
   * `visible` runs per run and before the delimiters go on, so by the time
   * the client sees the text every ⟦ in it is one this project wrote. The
   * legend is taken from the RAW text, because it names the characters that
   * were actually there.
   */
  const legend = legendFor(d.runs.map((r) => r.text).join(""));
  return {
    runs: d.runs.map((r) => ({ op: r.op, text: visible(r.text) })),
    legend,
    wordsRemoved: d.wordsRemoved,
    wordsAdded: d.wordsAdded,
    charactersRemoved: d.charactersRemoved,
    charactersAdded: d.charactersAdded,
    before: d.before,
    after: d.after,
    capped: d.cappedWhy,
  };
};

const schemaPart = (a: unknown, b: unknown): SchemaPart => {
  const d = schemaDiff(a, b);
  return { changes: d.changes, unexplained: d.unexplained, pointers: d.pointers };
};

/** The parameters a schema declares, for a tool nobody has seen before. */
export function parametersOf(schema: unknown): ParamPart[] {
  return [...paramsOf(schema).values()]
    .map((p) => ({ parameter: p.parameter, pointer: p.pointer, type: typeOf(p.node), required: p.required }))
    .sort((x, y) => x.parameter.localeCompare(y.parameter));
}

/**
 * The queue with every item's difference worked out.
 *
 * A description for a tool nobody has seen is diffed against nothing, which
 * is how its text gets the same visible markers as an edited one: a
 * zero-width space in a brand new tool's description is exactly as worth
 * seeing as one that arrived in an old tool's.
 */
export function prepare(q: Queue, generatedAt: string): Prepared {
  const items: PreparedItem[] = q.items.map((item) => {
    const base = { kind: item.kind, tool: item.tool, itemHash: itemHashOf(item) };
    if (item.kind === "description") {
      return { ...base, words: wordsPart(item.before as string | null, item.after as string | null), schema: null, parameters: null };
    }
    if (item.kind === "input schema") {
      return { ...base, words: null, schema: schemaPart(item.before, item.after), parameters: null };
    }
    const definition = (item.after ?? {}) as Record<string, unknown>;
    const description = typeof definition.description === "string" ? definition.description : null;
    return {
      ...base,
      words: wordsPart(null, description),
      schema: null,
      parameters: parametersOf(definition.inputSchema ?? null),
    };
  });
  return {
    package: q.package,
    from: q.from,
    to: q.to,
    generatedAt,
    items,
    notes: otherFieldLines(q),
    removed: q.removed,
    unchanged: q.unchanged,
    markerKey: MARKER_KEY,
  };
}

/* ── The page ───────────────────────────────────────────────────────────── */

/**
 * JSON safe to sit inside a <script> element.
 *
 * `</script>` inside a string would end the element, and the rest of
 * somebody's description would be parsed as markup. The three characters
 * that can start that, plus the two line separators that are newlines to a
 * JSON parser and not to a JavaScript one, go out as \\u escapes.
 */
/*
 * U+2028 and U+2029, built from their code points rather than written.
 *
 * They are newlines to a JSON parser and not to a JavaScript one, so a
 * description containing one would break the embedded object. Writing them
 * as \u escapes in this source is how the first draft of this file failed:
 * the escapes were turned into the characters themselves on the way to disk,
 * which left two unterminated regular expressions and a module that would
 * not parse. Out of the code points, nothing can convert them.
 */
const LINE_SEPARATORS = new RegExp(`[${String.fromCharCode(0x2028, 0x2029)}]`, "g");

export function embed(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(LINE_SEPARATORS, (c) => (c.charCodeAt(0) === 0x2028 ? "\\u2028" : "\\u2029"));
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/*
 * `default-src 'none'`, which is stricter than any published page here.
 *
 * The published pages allow their own origin and Google Fonts. This one is a
 * file on somebody's disk holding other people's prose, so it gets nothing:
 * no font, no image, no connection, no form, no base. The styles and the one
 * script are inline, and the policy says so rather than the file promising
 * it. `blob:` is allowed exactly once, under media-src, for the file the
 * reviewer downloads at the end.
 */
export const CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "script-src 'unsafe-inline'",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "img-src 'none'",
  "font-src 'none'",
].join("; ");

const STYLE = `
:root {
  --ink: #17181a; --paper: #fbfbf9; --quiet: #5c6066; --rule: #dedbd4;
  --gone: #8a2b2b; --gone-bg: #f7e9e9; --came: #1d5c3a; --came-bg: #e6f2ea;
  --mark: #6b4bb0; --mark-bg: #efeafa; --held: #7a5a1e;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --ink: #e8e6e1; --paper: #16171a; --quiet: #9aa0a8; --rule: #33363c;
    --gone: #e49a9a; --gone-bg: #3a2224; --came: #93d0ad; --came-bg: #17301f;
    --mark: #c3b1f0; --mark-bg: #2a2340; --held: #e0bd77;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; padding: 24px 16px 96px; background: var(--paper); color: var(--ink);
  font: 400 16px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
}
.wrap { max-width: 68rem; margin: 0 auto; }
h1 { font-size: 1.5rem; margin: 0 0 .25rem; text-wrap: balance; }
h2 { font-size: 1.05rem; margin: 2.5rem 0 .5rem; }
.sub, .note, .quiet { color: var(--quiet); }
.sub { margin: 0 0 1.5rem; }
.note { border-left: 3px solid var(--rule); padding: .25rem 0 .25rem .75rem; margin: .75rem 0; }
.item { border: 1px solid var(--rule); border-radius: 6px; padding: 14px 16px; margin: 0 0 14px; }
.item header { display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline; }
.tool { font: 400 15px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; font-weight: 500; }
.kind { font-size: .78rem; text-transform: uppercase; letter-spacing: .06em; color: var(--quiet); }
.text {
  font: 400 14px/1.7 ui-monospace, SFMono-Regular, Menlo, monospace;
  white-space: pre-wrap; overflow-wrap: anywhere; margin: .75rem 0;
  padding: 10px 12px; border: 1px solid var(--rule); border-radius: 4px; background: var(--paper);
}
.gone { background: var(--gone-bg); color: var(--gone); text-decoration: line-through; }
.came { background: var(--came-bg); color: var(--came); }
.mk { background: var(--mark-bg); color: var(--mark); border-radius: 2px; padding: 0 2px; }
ul { margin: .4rem 0; padding-left: 1.2rem; }
li { margin: .15rem 0; }
.legend li, .changes li, .params li { font: 400 13px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; }
.counts { font-size: .85rem; color: var(--quiet); margin: .35rem 0 0; }
.decide { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--rule); }
button {
  font: inherit; font-size: .9rem; padding: 5px 12px; border: 1px solid var(--rule);
  border-radius: 4px; background: transparent; color: var(--ink); cursor: pointer;
}
button[aria-pressed="true"] { border-color: currentColor; font-weight: 500; }
.item[data-decision="approve"] button.a { color: var(--came); }
.item[data-decision="hold"] button.h { color: var(--held); }
.state { font-size: .85rem; color: var(--quiet); }
/* The bar floats at the bottom of the window, so whatever is directly
 * above it would sit under it. The items area ends in enough space for the
 * bar to cover, which means the thing it covers is always that space and
 * never the last card: the first draft hid a tool's parameter list. */
#items { padding-bottom: 84px; }
.bar {
  position: sticky; bottom: 8px; margin: 2rem 0 0; padding: 12px 16px;
  border: 1px solid var(--rule); border-radius: 6px; background: var(--paper);
  display: flex; flex-wrap: wrap; gap: 10px; align-items: center;
}
label { font-size: .9rem; display: flex; gap: 6px; align-items: center; }
input { font: inherit; font-size: .9rem; padding: 4px 8px; border: 1px solid var(--rule); border-radius: 4px; background: transparent; color: var(--ink); }
.limits { margin-top: 2.5rem; border-top: 1px solid var(--rule); padding-top: 1rem; font-size: .9rem; color: var(--quiet); }
@media (max-width: 460px) { .decide, .bar { gap: 6px; } }
`;

/** The whole page, as one string. */
export function reviewPage(prepared: Prepared, clientSource: string): string {
  const title = `Review ${prepared.package}, ${prepared.from} to ${prepared.to}`;
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${escapeHtml(CSP)}">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
<body>
<main class="wrap">
  <h1>${escapeHtml(title)}</h1>
  <p class="sub" id="sub"></p>
  <div id="items"></div>
  <div class="bar">
    <label>your name <input id="by" size="18" autocomplete="off" spellcheck="false"></label>
    <label>date <input id="at" size="11" autocomplete="off" spellcheck="false"></label>
    <span class="state" id="progress"></span>
    <button id="export">Download decisions.json</button>
    <button id="copy">Copy as JSON</button>
    <span class="state" id="said"></span>
  </div>
  <div class="limits" id="limits"></div>
</main>
<script type="application/json" id="data">${embed(prepared)}</script>
<script>${clientSource}</script>
</body>
</html>
`;
}

export { FORMAT, FORMAT_VERSION, visible, markup, renderSchemaDiff };
