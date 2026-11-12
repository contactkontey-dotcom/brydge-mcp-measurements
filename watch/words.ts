/*
 * ═══════════════════════════════════════════════════════════════════════════
 * WHICH WORDS MOVED, AND EVERY CHARACTER THAT CANNOT BE SEEN.
 *
 * `firstDifference` in watch/tools.ts answers "line 3 differs", which for a
 * 1,600-character paragraph is barely an answer. This answers which words
 * went and which arrived, and makes visible every character that a reader
 * would otherwise not know was there.
 *
 * ── THIS MODULE NEVER READS ANYTHING ──────────────────────────────────────
 *
 * Every function here takes its text as an argument. There is no `node:fs`
 * import, no path, no capture, no transcript. A description is somebody
 * else's prose that arrived from the network, and the one safe thing to do
 * with it is compare it mechanically and show the result to a person. This
 * module does not summarise one, does not follow one, and has no way to go
 * and find one. A test asserts the absence of the import, because the
 * absence is the point and a later edit could add it absent-mindedly.
 *
 * ── WHY THE DELIMITER IS ESCAPED TOO ─────────────────────────────────────
 *
 * Marking an invisible character means printing something visible in its
 * place, and the moment there is such a form, text containing that form can
 * forge it: a description holding a literal ⟦U+200B⟧ would read exactly like
 * a zero-width space this module found. So ⟦ and ⟧ are themselves in the
 * marked set. A literal ⟦ in the text comes out as ⟦U+27E6⟧, and therefore
 * every bare ⟦ in the output is one this module put there. The mapping is
 * injective and `unvisible` inverts it; a test round-trips both.
 *
 * That same guarantee is what lets the word diff use the same two
 * characters as its own delimiters. ⟦-gone-⟧ and ⟦+new+⟧ cannot be forged
 * by the text inside them, because by the time they are wrapped the text no
 * longer contains a bare delimiter.
 *
 * ── TEXT, NEVER MARKUP ───────────────────────────────────────────────────
 *
 * Nothing here emits a tag, an entity or an attribute. `<script>` in a
 * description passes through as the eight characters it is. A caller
 * rendering to HTML escapes it there, where the escaping can be checked
 * against the document it goes into; a module that half-escaped on the way
 * out would leave a caller unable to tell what it was holding.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/* ── The characters that are shown by code point ────────────────────────── */

/*
 * Six categories, and one for the delimiter.
 *
 * The categories are kept apart rather than lumped into "invisible" because
 * they arrive for different reasons and a reader is entitled to know which:
 * a no-break space is ordinary typography, a right-to-left override is not
 * typography at all, and a tag character is invisible to every renderer
 * there is.
 */
export type Category =
  | "zero-width"
  | "bidi control"
  | "tag character"
  | "soft hyphen"
  | "exotic space"
  | "control character"
  | "variation selector"
  | "marker glyph";

/** U+27E6 MATHEMATICAL LEFT WHITE SQUARE BRACKET. */
export const OPEN = "⟦";
/** U+27E7, its pair. */
export const CLOSE = "⟧";

const inRange = (cp: number, lo: number, hi: number) => cp >= lo && cp <= hi;

/**
 * The category of one code point, or null when it needs no marking.
 *
 * LINE FEED and nothing else is left alone among the controls: it is the one
 * whose effect a reader can see. A TAB and a lone CARRIAGE RETURN are
 * marked, which is noisier than leaving them, and the noise is the honest
 * side — "two spaces became a tab" is otherwise a difference a reader is
 * shown and cannot read.
 */
export function categoryOf(cp: number): Category | null {
  if (cp === 0x27e6 || cp === 0x27e7) return "marker glyph";
  if (cp === 0x00ad) return "soft hyphen";
  if (cp === 0x200b || cp === 0x200c || cp === 0x200d || cp === 0x2060 || cp === 0xfeff || cp === 0x180e) return "zero-width";
  if (cp === 0x200e || cp === 0x200f || inRange(cp, 0x202a, 0x202e) || inRange(cp, 0x2066, 0x2069)) return "bidi control";
  if (cp === 0xe0001 || inRange(cp, 0xe0020, 0xe007f)) return "tag character";
  if (cp === 0x00a0 || cp === 0x1680 || inRange(cp, 0x2000, 0x200a) || cp === 0x202f || cp === 0x205f || cp === 0x3000) return "exotic space";
  if (inRange(cp, 0xfe00, 0xfe0f) || inRange(cp, 0xe0100, 0xe01ef)) return "variation selector";
  if (cp === 0x0a) return null;
  if (cp <= 0x1f || cp === 0x7f || inRange(cp, 0x80, 0x9f)) return "control character";
  return null;
}

/*
 * Names for the ones a reader is most likely to meet. Not a copy of the
 * Unicode names file: a code point with no name here prints its category,
 * which is the part that matters, and a wrong name would be worse than none.
 */
const NAMES: Record<number, string> = {
  0x0009: "TAB",
  0x000d: "CARRIAGE RETURN",
  0x00a0: "NO-BREAK SPACE",
  0x00ad: "SOFT HYPHEN",
  0x180e: "MONGOLIAN VOWEL SEPARATOR",
  0x2000: "EN QUAD",
  0x2002: "EN SPACE",
  0x2003: "EM SPACE",
  0x2007: "FIGURE SPACE",
  0x2009: "THIN SPACE",
  0x200b: "ZERO WIDTH SPACE",
  0x200c: "ZERO WIDTH NON-JOINER",
  0x200d: "ZERO WIDTH JOINER",
  0x200e: "LEFT-TO-RIGHT MARK",
  0x200f: "RIGHT-TO-LEFT MARK",
  0x202a: "LEFT-TO-RIGHT EMBEDDING",
  0x202b: "RIGHT-TO-LEFT EMBEDDING",
  0x202c: "POP DIRECTIONAL FORMATTING",
  0x202d: "LEFT-TO-RIGHT OVERRIDE",
  0x202e: "RIGHT-TO-LEFT OVERRIDE",
  0x202f: "NARROW NO-BREAK SPACE",
  0x2060: "WORD JOINER",
  0x2066: "LEFT-TO-RIGHT ISOLATE",
  0x2067: "RIGHT-TO-LEFT ISOLATE",
  0x2068: "FIRST STRONG ISOLATE",
  0x2069: "POP DIRECTIONAL ISOLATE",
  0x27e6: "MATHEMATICAL LEFT WHITE SQUARE BRACKET",
  0x27e7: "MATHEMATICAL RIGHT WHITE SQUARE BRACKET",
  0x3000: "IDEOGRAPHIC SPACE",
  0xe0001: "LANGUAGE TAG",
  0xfeff: "ZERO WIDTH NO-BREAK SPACE",
};

/** `U+200B` for 0x200b: four digits at least, more when it needs them. */
export function codeOf(cp: number): string {
  return "U+" + cp.toString(16).toUpperCase().padStart(4, "0");
}

/** One character as the visible form that stands in for it. */
export function markOf(cp: number): string {
  return OPEN + codeOf(cp) + CLOSE;
}

/**
 * The text with every marked character replaced by its code point.
 *
 * Iterates by code point, not by UTF-16 unit: a tag character is astral, and
 * walking the string by index would see two halves of one character and mark
 * neither.
 */
export function visible(text: string): string {
  let out = "";
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    out += categoryOf(cp) === null ? ch : markOf(cp);
  }
  return out;
}

/** The inverse. Exists so a test can prove nothing is lost or invented. */
export function unvisible(text: string): string {
  return text.replace(new RegExp(OPEN + "U\\+([0-9A-F]{4,6})" + CLOSE, "g"), (_m, hex) =>
    String.fromCodePoint(parseInt(hex, 16)),
  );
}

/** Every marked code point in the text, once each, in code point order. */
export function markedIn(text: string): number[] {
  const seen = new Set<number>();
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (categoryOf(cp) !== null) seen.add(cp);
  }
  return [...seen].sort((a, b) => a - b);
}

/** What the forms mean. Always printed where any of them appears. */
export const MARKER_KEY = [
  OPEN + "-text-" + CLOSE + " was in the first version and is not in the second.",
  OPEN + "+text+" + CLOSE + " is in the second version and was not in the first.",
  OPEN + "U+XXXX" + CLOSE + " is one character, shown by code point, that has no visible form of its own.",
];

/**
 * A legend for the characters this text actually carries, and nothing else.
 *
 * A fixed table of every category would list seven lines under a text that
 * holds one of them, and a reader would stop reading it.
 */
export function legendFor(text: string): string[] {
  return markedIn(text).map((cp) => {
    const name = NAMES[cp];
    return `${markOf(cp)}  ${name ? `${name} — ` : ""}${categoryOf(cp)}`;
  });
}

/*
 * NOT MARKED, ON PURPOSE:
 *
 *   LINE FEED            Its effect is visible; marking it would mark every
 *                        line of every multi-line description.
 *   combining marks      They change the letter they sit on, which is a
 *                        visible effect, and marking them would turn every
 *                        accented word into code points.
 *   regional indicators  A flag is two of them and reads as a flag.
 *
 * A character outside the marked set and outside this list is one nobody
 * thought about, which is the gap to close by adding it above.
 */

/* ── Which words moved ──────────────────────────────────────────────────── */

export type Op = "same" | "removed" | "added";
export interface Run {
  op: Op;
  text: string;
}

const WORDISH = /[\p{L}\p{N}_]/u;

/**
 * Text into the units a diff aligns.
 *
 * A word is a run of letters, digits and underscores. Everything else is one
 * token per character, which is what makes "two spaces became one" and "a
 * zero-width space arrived" differences the diff can report at all: grouped
 * into runs they would hide inside a token that merely "changed".
 */
export function tokenise(text: string): string[] {
  const out: string[] = [];
  let word = "";
  const flush = () => {
    if (word) {
      out.push(word);
      word = "";
    }
  };
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (categoryOf(cp) === null && WORDISH.test(ch)) {
      word += ch;
      continue;
    }
    flush();
    out.push(ch);
  }
  flush();
  return out;
}

/**
 * The most cells the alignment will fill.
 *
 * The table is one Uint32 per cell, so two million cells is eight megabytes.
 * Past it the middle is reported as one removal and one insertion and the
 * result says so — a diff that quietly degraded would be a diff a reader
 * trusts for something it did not do.
 */
export const CELL_CAP = 2_000_000;

export interface WordDiff {
  runs: Run[];
  /** Words, not tokens: punctuation and spaces are not counted as words. */
  wordsRemoved: number;
  wordsAdded: number;
  /*
   * Characters too, counted by code point.
   *
   * Without these the counts line reads "0 words removed, 0 words added"
   * over a difference that is plainly there — a space that became an
   * ideographic space, a direction override that arrived — because none of
   * it is a word. Two numbers that say nothing moved, above a diff showing
   * what moved, is the sentence this project exists not to write.
   */
  charactersRemoved: number;
  charactersAdded: number;
  /** True when the middle was too large to align and was not aligned. */
  capped: boolean;
  cappedWhy: string | null;
  before: { present: boolean; characters: number };
  after: { present: boolean; characters: number };
  /** True when the two texts are the same string. */
  identical: boolean;
}

const push = (runs: Run[], op: Op, text: string) => {
  const last = runs[runs.length - 1];
  if (last && last.op === op) last.text += text;
  else runs.push({ op, text });
};

/** The alignment itself. Tokens in, runs out, adjacent runs merged. */
function align(a: string[], b: string[]): Run[] {
  const n = a.length;
  const m = b.length;
  const w = m + 1;
  const L = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      L[i * w + j] =
        a[i] === b[j] ? L[(i + 1) * w + j + 1] + 1 : Math.max(L[(i + 1) * w + j], L[i * w + j + 1]);
    }
  }
  const runs: Run[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push(runs, "same", a[i]!);
      i++;
      j++;
    } else if (L[(i + 1) * w + j]! >= L[i * w + j + 1]!) {
      /* Removal before insertion at the same place: the version that was
       * there first is printed first. */
      push(runs, "removed", a[i]!);
      i++;
    } else {
      push(runs, "added", b[j]!);
      j++;
    }
  }
  while (i < n) push(runs, "removed", a[i++]!);
  while (j < m) push(runs, "added", b[j++]!);
  return runs;
}

const words = (runs: Run[], op: Op) =>
  runs.filter((r) => r.op === op).reduce((n, r) => n + tokenise(r.text).filter((t) => WORDISH.test(t)).length, 0);

/** Code points, not UTF-16 units: one tag character is one character. */
const characters = (runs: Run[], op: Op) =>
  runs.filter((r) => r.op === op).reduce((n, r) => n + [...r.text].length, 0);

/**
 * Which words moved between two texts.
 *
 * `null` is a description a tool does not have, and it is not the empty
 * string: one is a tool that says nothing about itself and the other is a
 * tool whose description is empty. Both are reported, separately.
 *
 * The common head and tail are matched off before aligning. It is an
 * optimisation and it is also the reason an appended paragraph reports as
 * one arrival rather than as a rewrite of the whole text.
 */
export function wordDiff(a: string | null, b: string | null): WordDiff {
  const A = a ?? "";
  const B = b ?? "";
  const shell = {
    wordsRemoved: 0,
    wordsAdded: 0,
    charactersRemoved: 0,
    charactersAdded: 0,
    capped: false,
    cappedWhy: null as string | null,
    before: { present: a !== null, characters: A.length },
    after: { present: b !== null, characters: B.length },
    identical: a === b,
  };
  if (a === b) return { ...shell, runs: A ? [{ op: "same", text: A }] : [] };

  const ta = tokenise(A);
  const tb = tokenise(B);
  let head = 0;
  while (head < ta.length && head < tb.length && ta[head] === tb[head]) head++;
  let tail = 0;
  while (
    tail < ta.length - head &&
    tail < tb.length - head &&
    ta[ta.length - 1 - tail] === tb[tb.length - 1 - tail]
  ) {
    tail++;
  }
  const midA = ta.slice(head, ta.length - tail);
  const midB = tb.slice(head, tb.length - tail);

  const runs: Run[] = [];
  if (head) push(runs, "same", ta.slice(0, head).join(""));
  if ((midA.length + 1) * (midB.length + 1) > CELL_CAP) {
    if (midA.length) push(runs, "removed", midA.join(""));
    if (midB.length) push(runs, "added", midB.join(""));
    shell.capped = true;
    shell.cappedWhy =
      `the part that differs is ${midA.length} tokens against ${midB.length}, past the ${CELL_CAP.toLocaleString("en-US")}-cell limit, ` +
      `so it is reported whole, as one removal and one arrival`;
  } else {
    for (const r of align(midA, midB)) push(runs, r.op, r.text);
  }
  if (tail) push(runs, "same", ta.slice(ta.length - tail).join(""));

  return {
    ...shell,
    runs,
    wordsRemoved: words(runs, "removed"),
    wordsAdded: words(runs, "added"),
    charactersRemoved: characters(runs, "removed"),
    charactersAdded: characters(runs, "added"),
  };
}

/* ── Printing it ────────────────────────────────────────────────────────── */

/**
 * The runs as one string, every marked character visible, differences
 * delimited.
 *
 * `visible` runs first and per run, so the delimiters cannot be forged by
 * the text they wrap.
 */
export function markup(runs: Run[]): string {
  return runs
    .map((r) => {
      const t = visible(r.text);
      if (r.op === "same") return t;
      return r.op === "removed" ? `${OPEN}-${t}-${CLOSE}` : `${OPEN}+${t}+${CLOSE}`;
    })
    .join("");
}

/**
 * One text block: the sizes, the counts, the marked-up text, and a legend.
 *
 * No clipping. A caller that wants less decides what less means; a renderer
 * that clipped by default would be the one deciding which half of somebody's
 * edit a reviewer gets to see.
 */
export function renderWordDiff(d: WordDiff, label = "description"): string {
  const size = (s: { present: boolean; characters: number }) =>
    s.present ? `${s.characters} character${s.characters === 1 ? "" : "s"}` : "none";
  const out: string[] = [];
  out.push(`${label}: ${size(d.before)} -> ${size(d.after)}`);
  if (d.identical) {
    out.push("The two texts are the same string.");
    return out.join("\n");
  }
  const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
  out.push(
    `${plural(d.wordsRemoved, "word")} removed, ${plural(d.wordsAdded, "word")} added; ` +
      `${plural(d.charactersRemoved, "character")} removed, ${plural(d.charactersAdded, "character")} added.`,
  );
  /* Said in words, because two zeroes read as nothing. */
  if (!d.wordsRemoved && !d.wordsAdded) {
    out.push("No word changed: every character that moved is one that is not part of a word.");
  }
  if (d.capped) out.push(`Not aligned word by word: ${d.cappedWhy}.`);
  const text = markup(d.runs);
  out.push("");
  out.push(text);
  const legend = legendFor(d.runs.map((r) => r.text).join(""));
  out.push("");
  if (legend.length) {
    out.push("Characters shown by code point above:");
    for (const l of legend) out.push(`  ${l}`);
  }
  for (const k of MARKER_KEY) out.push(k);
  return out.join("\n");
}
