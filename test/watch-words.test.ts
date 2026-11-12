/*
 * The word diff and the visible markers.
 *
 * EVERY FIXTURE HERE IS PLANTED. Not one assertion reads a stored capture, a
 * run file or any text a server sent. That is deliberate and it is checked:
 * a test that pinned the wording of somebody's real description would make
 * this suite fail the next time they edited it, and a test that printed one
 * would publish it. The module under test cannot read a file either, and the
 * last test in this file asserts that too.
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { flatten, GATEKEEPING } from "./banned.ts";
import type { Run } from "../watch/words.ts";
import {
  CELL_CAP,
  CLOSE,
  OPEN,
  categoryOf,
  codeOf,
  legendFor,
  markedIn,
  markOf,
  markup,
  MARKER_KEY,
  renderWordDiff,
  tokenise,
  unvisible,
  visible,
  wordDiff,
} from "../watch/words.ts";

const ROOT = join(import.meta.dirname, "..");

/* ── Tokens ─────────────────────────────────────────────────────────────── */

test("a word is a run of letters and digits; everything else is one token each", () => {
  assert.deepEqual(tokenise("Fetch a page2."), ["Fetch", " ", "a", " ", "page2", "."]);
  assert.deepEqual(tokenise("a  b"), ["a", " ", " ", "b"], "two spaces are two tokens, so losing one is a difference");
  assert.deepEqual(tokenise(""), []);
});

test("a character that gets marked is its own token, never swallowed into a word", () => {
  assert.deepEqual(tokenise("ab\u200Bcd"), ["ab", "\u200B", "cd"]);
  assert.deepEqual(tokenise("x\u00ADy"), ["x", "\u00AD", "y"]);
});

/* ── Which words moved ──────────────────────────────────────────────────── */

test("one substituted word is one removal and one arrival, in that order", () => {
  const d = wordDiff("Fetch a page and return its text.", "Fetch a page and return its content.");
  assert.deepEqual(d.runs, [
    { op: "same", text: "Fetch a page and return its " },
    { op: "removed", text: "text" },
    { op: "added", text: "content" },
    { op: "same", text: "." },
  ]);
  assert.equal(d.wordsRemoved, 1);
  assert.equal(d.wordsAdded, 1);
  assert.equal(d.capped, false);
  assert.equal(markup(d.runs), `Fetch a page and return its ${OPEN}-text-${CLOSE}${OPEN}+content+${CLOSE}.`);
});

test("an appended sentence is one arrival, not a rewrite of the whole text", () => {
  const before = "Reads a file. Returns its bytes.";
  const d = wordDiff(before, before + " Call it twice if you like.");
  assert.deepEqual(d.runs, [
    { op: "same", text: before },
    { op: "added", text: " Call it twice if you like." },
  ]);
  assert.equal(d.wordsRemoved, 0);
  assert.equal(d.wordsAdded, 6);
});

test("punctuation and spaces are not counted as words", () => {
  const d = wordDiff("a, b", "a; b");
  assert.equal(d.wordsRemoved, 0);
  assert.equal(d.wordsAdded, 0);
  assert.deepEqual(d.runs.filter((r) => r.op !== "same").map((r) => r.text), [",", ";"]);
});

test("no description and an empty one are different facts", () => {
  const arrived = wordDiff(null, "Now it says something.");
  assert.equal(arrived.before.present, false);
  assert.equal(arrived.after.present, true);
  assert.equal(arrived.before.characters, 0);

  const emptied = wordDiff("Something.", "");
  assert.equal(emptied.before.present, true);
  assert.equal(emptied.after.present, true, "an empty description is a description");
  assert.match(renderWordDiff(arrived), /^description: none -> 22 characters$/m);
  assert.match(renderWordDiff(emptied), /^description: 10 characters -> 0 characters$/m);
});

test("the same string reports as the same string and nothing else", () => {
  const d = wordDiff("identical", "identical");
  assert.equal(d.identical, true);
  assert.equal(d.wordsAdded, 0);
  assert.equal(d.wordsRemoved, 0);
  assert.match(renderWordDiff(d), /The two texts are the same string\./);
});

test("past the cell limit the middle is reported whole, and says it was not aligned", () => {
  const a = Array.from({ length: 1600 }, (_v, i) => `alpha${i}`).join(" ");
  const b = Array.from({ length: 1600 }, (_v, i) => `bravo${i}`).join(" ");
  const d = wordDiff(a, b);
  assert.equal(d.capped, true);
  assert.deepEqual(d.runs.map((r) => r.op), ["removed", "added"]);
  assert.match(d.cappedWhy!, new RegExp(`${CELL_CAP.toLocaleString("en-US")}-cell limit`));
  assert.match(renderWordDiff(d), /Not aligned word by word:/);
  /* Nothing is lost by capping: both texts are still there in full. */
  assert.equal(d.runs.find((r) => r.op === "removed")!.text, a);
  assert.equal(d.runs.find((r) => r.op === "added")!.text, b);
});

/* ── Characters that cannot be seen ─────────────────────────────────────── */

test("each category is recognised, and line feed is left alone", () => {
  const cases: Array<[number, string]> = [
    [0x200b, "zero-width"],
    [0xfeff, "zero-width"],
    [0x202e, "bidi control"],
    [0x2069, "bidi control"],
    [0xe0041, "tag character"],
    [0xe0001, "tag character"],
    [0x00ad, "soft hyphen"],
    [0x00a0, "exotic space"],
    [0x3000, "exotic space"],
    [0x0009, "control character"],
    [0x000d, "control character"],
    [0x0000, "control character"],
    [0xfe0f, "variation selector"],
    [0x27e6, "marker glyph"],
    [0x27e7, "marker glyph"],
  ];
  for (const [cp, category] of cases) assert.equal(categoryOf(cp), category, codeOf(cp));
  for (const cp of [0x000a, 0x0041, 0x0020, 0x00e9, 0x4e2d]) {
    assert.equal(categoryOf(cp), null, `${codeOf(cp)} should not be marked`);
  }
});

test("a zero-width space that arrived is visible, and is the whole difference", () => {
  const d = wordDiff("send now", "send\u200B now");
  assert.equal(d.identical, false);
  const out = markup(d.runs);
  assert.ok(out.includes(`${OPEN}+${OPEN}U+200B${CLOSE}+${CLOSE}`), out);
  assert.ok(!out.includes("\u200B"), "the zero-width space survived into the output as itself");
});

test("an astral tag character is one marker, not two halves", () => {
  const s = "flag\u{E0041}end";
  assert.equal(visible(s), `flag${OPEN}U+E0041${CLOSE}end`);
  assert.equal(unvisible(visible(s)), s);
  assert.deepEqual(markedIn(s), [0xe0041]);
});

test("making visible loses nothing and invents nothing", () => {
  const planted = [
    "plain words",
    "zero\u200Bwidth",
    "bidi\u202Eoverride\u202C",
    "soft\u00ADhyphen",
    "exotic\u00A0space\u3000here",
    "control\u0000char\u000D",
    "emoji\uFE0Fselector",
    `delimiter ${OPEN} and ${CLOSE}`,
    "tag\u{E0020}char",
  ];
  for (const s of planted) {
    assert.equal(unvisible(visible(s)), s, s);
    for (const ch of visible(s)) {
      const cp = ch.codePointAt(0)!;
      if (cp === 0x27e6 || cp === 0x27e7) continue;
      assert.equal(categoryOf(cp), null, `${codeOf(cp)} is still in the visible form of ${JSON.stringify(s)}`);
    }
  }
});

/* ── The adversarial description ────────────────────────────────────────── */

/*
 * PLANTED, and written to be as awkward as a description can be: markup a
 * careless renderer would run, a character a reader cannot see, and the
 * module's own delimiter, which is the one character that could forge the
 * module's output.
 */
const NASTY_BEFORE = `Runs <script>alert(1)</script> & returns ${OPEN}U+200B${CLOSE} as text.`;
const NASTY_AFTER = `Runs <script>alert(2)</script> & returns\u200B ${OPEN}U+200B${CLOSE} as text.`;

test("a literal delimiter in the text cannot forge a marker", () => {
  const out = markup(wordDiff(NASTY_BEFORE, NASTY_AFTER).runs);
  /* The text's own ⟦ and ⟧ come out as their code points ... */
  assert.ok(out.includes(`${OPEN}U+27E6${CLOSE}`), "the literal opening delimiter was not escaped");
  assert.ok(out.includes(`${OPEN}U+27E7${CLOSE}`), "the literal closing delimiter was not escaped");
  /* ... so every bare delimiter left in the output is one the module put
   * there, and a reader can tell a marker from text that looks like one. */
  for (let i = 0; i < out.length; i++) {
    if (out[i] !== OPEN) continue;
    const next = out.slice(i + 1, i + 3);
    assert.ok(
      next.startsWith("U+") || next.startsWith("-") || next.startsWith("+"),
      `a bare ${OPEN} at ${i} opens neither a marker nor a difference: ${out.slice(i, i + 12)}`,
    );
  }
  /* The zero-width space that arrived is shown, and the one spelled out in
   * the text is not confused with it: the text's is six ordinary
   * characters, the real one is a marker the module wrote. */
  assert.ok(out.includes(`${OPEN}+${OPEN}U+200B${CLOSE}+${CLOSE}`), out);
});

/*
 * Both texts, rebuilt from the runs.
 *
 * The first version of this test asserted the output CONTAINED
 * "<script>alert(1)</script>", and it did not — rightly: the two versions
 * differ only at the digit, so the runs read `<script>alert(`, then the two
 * digits, then `)</script>`, and the contiguous string is nowhere in the
 * output. Asserting a substring of text a diff interleaves is the same
 * mistake that let a wrapped phrase through the check in site-diff.test.ts.
 * The property worth pinning is stronger anyway: keep the same runs and one
 * side's runs and you have that side's text back, exactly.
 */
const sideOf = (runs: Run[], which: "removed" | "added") =>
  runs.filter((r) => r.op === "same" || r.op === which).map((r) => r.text).join("");

test("the runs rebuild both texts exactly: nothing altered, nothing lost", () => {
  for (const [a, b] of [
    [NASTY_BEFORE, NASTY_AFTER],
    ["Fetch a page and return its text.", "Fetch a page and return its content."],
    ["send now", "send\u200B now"],
    ["", "something"],
    ["gone", ""],
    ["a\u202Eb", "a\u202Db"],
  ] as const) {
    const d = wordDiff(a, b);
    assert.equal(sideOf(d.runs, "removed"), a, `the first text did not come back: ${JSON.stringify(a)}`);
    assert.equal(sideOf(d.runs, "added"), b, `the second text did not come back: ${JSON.stringify(b)}`);
  }
});

test("markup is text: no tag is made, and none is escaped away", () => {
  const d = wordDiff(NASTY_BEFORE, NASTY_AFTER);
  const out = renderWordDiff(d);
  /* The description's markup passes through as the characters it is. This
   * module does not escape — a caller rendering into a document escapes
   * there, where it can be checked against that document. */
  for (const e of ["&lt;", "&gt;", "&amp;", "&quot;", "&#"]) {
    assert.ok(!out.includes(e), `the module half-escaped its output: ${e}`);
  }
  /* And it adds no markup of its own: strip the marked-up text and what is
   * left is the module's own words, which carry no angle bracket at all. */
  const mine = out.replace(markup(d.runs), "");
  assert.ok(mine.includes("word removed"), "the wrong part was stripped");
  /* The module's own words carry exactly one angle bracket, and it is the
   * "->" of the size line, which the rest of this project writes the same
   * way. Every other one in the output came out of the fixture. The first
   * version of this assertion banned both brackets outright and failed on
   * that arrow, which is the check working. */
  assert.ok(!mine.includes("<"), `the module wrote an opening angle bracket: ${mine}`);
  assert.ok(!/[^-]>/.test(mine), `the module wrote a closing angle bracket that is not the arrow: ${mine}`);
  assert.equal((mine.match(/->/g) ?? []).length, 1);
});

/* ── The legend ─────────────────────────────────────────────────────────── */

test("the legend names only the characters the text carries", () => {
  const legend = legendFor("one\u200Btwo\u00A0three");
  assert.equal(legend.length, 2);
  /* Code point order, not order of appearance: one text always gives one
   * legend, whichever end a reader starts from. */
  assert.ok(legend[0]!.startsWith(markOf(0x00a0)), legend[0]);
  assert.ok(legend[0]!.includes("NO-BREAK SPACE"), legend[0]);
  assert.ok(legend[0]!.includes("exotic space"), legend[0]);
  assert.ok(legend[1]!.startsWith(markOf(0x200b)), legend[1]);
  assert.ok(legend[1]!.includes("ZERO WIDTH SPACE"), legend[1]);
  assert.ok(legend[1]!.includes("zero-width"), legend[1]);
  assert.deepEqual(legendFor("nothing hidden here"), []);
});

test("a marked character with no name still prints its category", () => {
  const legend = legendFor("x\u{E0041}y");
  assert.equal(legend.length, 1);
  assert.ok(legend[0]!.includes("tag character"), legend[0]);
});

test("the render carries the legend when there is one, and the key always", () => {
  const hidden = renderWordDiff(wordDiff("send now", "send\u200B now"));
  assert.match(hidden, /^Characters shown by code point above:$/m);
  assert.ok(hidden.includes("ZERO WIDTH SPACE"));
  for (const k of MARKER_KEY) assert.ok(hidden.includes(k), k);

  const plain = renderWordDiff(wordDiff("a cat", "a dog"));
  assert.ok(!plain.includes("Characters shown by code point"), "a legend with nothing in it was printed");
  for (const k of MARKER_KEY) assert.ok(plain.includes(k), k);
});

/* ── What it may not say, and may not do ────────────────────────────────── */

test("nothing printed here claims to stop anything", () => {
  const texts = [
    renderWordDiff(wordDiff("a cat sat", "a dog sat\u200B")),
    renderWordDiff(wordDiff(null, "arrived")),
    renderWordDiff(wordDiff("same", "same")),
    ...MARKER_KEY,
    ...legendFor("\u200B\u202E\u00AD\u00A0\u0000\uFE0F\u{E0041}"),
  ].join("\n");
  const flat = flatten(texts);
  for (const w of GATEKEEPING) assert.ok(!flat.includes(w), `the output says "${w}"`);
  for (const w of ["suspicious", "malicious", "attack", "sneaky", "hidden instruction", "injection", "safe", "unsafe"]) {
    assert.ok(!flat.includes(w), `the output characterises what it found: "${w}"`);
  }
});

test("the module cannot read a description: it has no way to open a file", () => {
  /* Comments stripped first. The module's header says, in prose, that it has
   * no `node:fs` import — and a search over the prose finds that sentence
   * and calls it the import. The same trap as a page that lists the calls it
   * does not make; site-diff.test.ts strips comments for the same reason. */
  const src = flatten(
    readFileSync(join(ROOT, "watch", "words.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, ""),
  );
  for (const w of ["node:fs", "readfilesync", "createrequire", "require(", "import(", "fetch("]) {
    assert.ok(!src.includes(w), `watch/words.ts reaches for "${w}"`);
  }
});

/* ── Counts that cannot read as "nothing happened" ──────────────────────── */

test("a difference made only of non-word characters says so, instead of printing two zeroes", () => {
  /* A plain space became an ideographic one and two direction overrides
   * arrived: no word changed, and the text is not the same text. */
  const d = wordDiff("Lists the open items.", "Lists　the ‮open‬ items.");
  assert.equal(d.identical, false);
  assert.equal(d.wordsRemoved, 0);
  assert.equal(d.wordsAdded, 0);
  assert.equal(d.charactersRemoved, 1);
  assert.equal(d.charactersAdded, 3);
  const out = renderWordDiff(d);
  assert.match(out, /0 words removed, 0 words added; 1 character removed, 3 characters added\./);
  assert.match(out, /No word changed: every character that moved is one that is not part of a word\./);
});

test("the counts line carries words and characters together", () => {
  const d = wordDiff("a cat", "a dog");
  assert.match(renderWordDiff(d), /1 word removed, 1 word added; 3 characters removed, 3 characters added\./);
  assert.ok(!renderWordDiff(d).includes("No word changed"), "a word did change");
});

test("the capped reason is said once, not twice", () => {
  const a = Array.from({ length: 1600 }, (_v, i) => `alpha${i}`).join(" ");
  const b = Array.from({ length: 1600 }, (_v, i) => `bravo${i}`).join(" ");
  const line = renderWordDiff(wordDiff(a, b)).split("\n").find((l) => l.startsWith("Not aligned"))!;
  assert.equal((line.match(/not aligned word by word/gi) ?? []).length, 1, line);
});
