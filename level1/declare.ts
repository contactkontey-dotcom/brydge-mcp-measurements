/*
 * ═══════════════════════════════════════════════════════════════════════════
 * READING A README MECHANICALLY — THE ONLY NEW JUDGEMENT IN LEVEL 1.
 *
 * Every curated measurement in `servers/index.ts` has a `declared` block a
 * person wrote: the tool list copied from the documentation, the destinations
 * traced through the source, each with a quote. That reading is the thing a
 * Level 1 run cannot have, because Level 1 is given nothing but a package name.
 *
 * So this derives a declaration from the README's own bytes, by rules stated
 * here in full. There is no model in it and no heuristic about meaning: the
 * same README gives the same declaration, every time, and a reader can check
 * any line of it by looking at the line number cited.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE STANDARD, STATED PLAINLY: LITERALLY NAMED, OR NOT DECLARED.
 *
 * A host counts as declared only if the README CONTAINS THAT HOSTNAME. A
 * README that says "we collect limited, pseudonymous telemetry" without naming
 * the host declares no host by this standard, and the host it contacts will be
 * reported as undeclared.
 *
 * That is deliberately stricter and dumber than a person. The curated Desktop
 * Commander spec counts `telemetry.desktopcommander.app` as declared because
 * somebody read that prose and then traced `dist/utils/capture.js` to the host.
 * Level 1 cannot do either. Rather than invent a rule that guesses which prose
 * covers which host, it applies the only test it can defend — the name is
 * there, or it is not — and says so in the report.
 *
 * MATCHING IS EXACT, SO A SUBDOMAIN IS NOT ITS PARENT. A README that links to
 * `desktopcommander.app` has not named `telemetry.desktopcommander.app`. The
 * alternative — treating any subdomain of a named host as declared — would let
 * one link to a marketing site cover every host under the domain.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHERE THESE RULES ARE WRONG, THEY ARE WRONG IN ONE DIRECTION.
 *
 * The host pattern is loose: it matches a dotted name whose last label is two
 * or more letters, so `capture.js` in a sentence about source files reads as a
 * host. The effect is to make the declared set BIGGER, which can only suppress
 * a finding, never invent one. The same choice the tariff makes when a verb is
 * unclassified: incomplete should cost the measurer, not the measured.
 *
 * It is stated rather than hidden because it is the one way a Level 1 run can
 * quietly under-report: a server whose README happens to mention a filename
 * that matches a host it contacts.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { createHash } from "node:crypto";

/** Where something was found: a 1-based line number and that line, verbatim. */
export interface Mention {
  line: number;
  text: string;
}

export interface Declaration {
  /** sha256 of the README bytes this reading is of, so a run can be repeated. */
  digest: string;
  lines: number;
  bytes: number;
  /** Hostnames the README literally names, each with where. */
  hosts: Array<{ host: string; at: Mention }>;
  /**
   * Backticked snake_case tokens — the only thing Level 1 treats as "the
   * README lists this tool BY NAME".
   *
   * Tight on purpose, and tighter than the host rule. This set is what decides
   * "documents a tool it did not offer", where a loose rule would invent
   * findings rather than suppress them: every prose word with an underscore
   * would become a tool the server failed to provide. Backticks are how a
   * README marks an identifier, so that is what is read as one.
   */
  identifiers: Array<{ name: string; at: Mention }>;
}

/** A token shaped like an MCP tool name: lower snake_case, at least one `_`. */
const TOOL_SHAPED = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/;

/* A URL's host part. Stops at the first character that cannot be in a host. */
const URL_HOST = /https?:\/\/([^\s/?#)"'`\]>,]+)/gi;

/* A bare dotted name: `foo.bar`, `a.b.co.uk`. The last label must be letters
 * only, two or more — which is what keeps `1.2.3.4` and `v0.2.51` out. */
const BARE_HOST = /\b((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,})\b/gi;

/* Tokens inside single or triple backticks. */
const BACKTICKED = /`{1,3}([^`\n]+)`{1,3}/g;

/*
 * A CITATION HAS TO SHOW THE THING IT CITES.
 *
 * One line of a Markdown table in a real README runs past a thousand
 * characters. Quoting its first 240 put a sentence about shell configuration
 * under a finding about the word "telemetry", which was on the same line, 400
 * characters along: a citation that reads as simply wrong, even though the
 * match was real and the line number right. A reader who cannot check a
 * citation by reading it has no reason to trust the next one.
 *
 * So the quote is a window around the match, cut on both sides with an ellipsis
 * where it was cut. Short lines are unaffected and still quoted whole.
 */
const SPAN = 200;

function excerpt(line: string, index: number): string {
  const text = line.trim();
  if (text.length <= SPAN) return text;
  const i = Math.max(0, index - (line.length - line.trimStart().length));
  let end = Math.min(text.length, Math.max(i + Math.ceil(SPAN / 2), SPAN));
  const start = Math.max(0, end - SPAN);
  end = Math.min(text.length, start + SPAN);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

/** Strip a port, credentials and a trailing dot; lower-case. */
function hostOf(raw: string): string | null {
  let h = raw.trim().toLowerCase();
  const at = h.lastIndexOf("@");
  if (at !== -1) h = h.slice(at + 1);
  h = h.replace(/:\d+$/, "").replace(/\.$/, "");
  if (!h.includes(".")) return null;
  if (!/^[a-z0-9.-]+$/.test(h)) return null;
  if (!/[a-z]{2,}$/.test(h)) return null;
  return h;
}

/**
 * Read a README into a declaration.
 *
 * Line-by-line, so every entry carries the line it came from. The first
 * mention of a host or identifier wins; later ones are not recorded, because
 * the citation only has to prove the name is there.
 */
export function readDeclaration(readme: string): Declaration {
  const lines = readme.split(/\r?\n/);
  const hosts = new Map<string, Mention>();
  const identifiers = new Map<string, Mention>();

  lines.forEach((text, i) => {
    /* Per match, not per line, so the quote shows the match and not whatever
     * happened to be at the start of a very long line. */
    const at = (index: number): Mention => ({ line: i + 1, text: excerpt(text, index) });

    for (const m of text.matchAll(URL_HOST)) {
      const h = hostOf(m[1]);
      if (h && !hosts.has(h)) hosts.set(h, at(m.index));
    }
    for (const m of text.matchAll(BARE_HOST)) {
      const h = hostOf(m[1]);
      if (h && !hosts.has(h)) hosts.set(h, at(m.index));
    }
    for (const m of text.matchAll(BACKTICKED)) {
      /*
       * A backticked run can hold several tokens: `read_file, write_file`.
       *
       * Matched as written, NOT lower-cased first. Lower-casing turned every
       * backticked environment variable into a tool name: Playwright's README
       * documents `PLAYWRIGHT_MCP_CDP_ENDPOINT` and forty of its siblings, and
       * the page then listed them all as names the README lists but the server
       * did not offer. An MCP tool name is lower-case by convention, a shouted
       * name is a variable, and telling them apart costs nothing but a case
       * test. This narrows the weakest of the three lists only — the tool
       * comparison asks `whereNamed`, which is case-insensitive — so it cannot
       * hide a tool the README fails to document.
       */
      for (const token of m[1].split(/[^A-Za-z0-9_]+/)) {
        if (TOOL_SHAPED.test(token) && !identifiers.has(token)) identifiers.set(token, at(m.index));
      }
    }
  });

  return {
    digest: createHash("sha256").update(readme).digest("hex"),
    lines: lines.length,
    bytes: Buffer.byteLength(readme),
    hosts: [...hosts.entries()].map(([host, at]) => ({ host, at })).sort((a, b) => a.host.localeCompare(b.host)),
    identifiers: [...identifiers.entries()].map(([name, at]) => ({ name, at })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/**
 * WORDS THE README USES THAT A READER WILL WANT TO KNOW ARE THERE.
 *
 * A README that names no host still often discusses the subject — "we collect
 * limited, pseudonymous telemetry". The curated Desktop Commander spec treated
 * that sentence as a declaration, after a person traced the source to the
 * hosts. Level 1 cannot do the tracing, so it cannot treat prose as a
 * declaration; see the header.
 *
 * What it can do is say, without deciding anything, that the word is in the
 * document and where. A reader who wants to weigh that sentence against the
 * hosts can then go and read it. This function finds the word; it does not
 * interpret it, and nothing downstream is allowed to either.
 *
 * Whole-word and case-insensitive, so "Telemetry" in a heading counts and
 * "telemetryEnabled" in a code sample does not.
 */
export const NOTED_WORDS = ["telemetry", "analytics"] as const;

export function notedWords(readme: string): Array<{ word: string; at: Mention }> {
  const found: Array<{ word: string; at: Mention }> = [];
  const lines = readme.split(/\r?\n/);
  for (const word of NOTED_WORDS) {
    const re = new RegExp(`\\b${word}\\b`, "i");
    lines.forEach((text, i) => {
      const m = re.exec(text);
      if (m) found.push({ word, at: { line: i + 1, text: excerpt(text, m.index) } });
    });
  }
  return found;
}

/**
 * Is this exact token anywhere in the README, as a whole word? Where?
 *
 * THIS IS THE NON-CIRCULAR HALF, and it is the half the tool comparison rests
 * on. Asking "is `get_prompts` in the README" is a lookup for one name; it does
 * not derive the documented set FROM the offered set. Deriving it the other way
 * — treating whatever the server offered and the README mentions as the
 * documented list — would make "offered but undocumented" impossible to find,
 * which is the one thing this comparison exists to find.
 *
 * A whole word, so `read_file` is not found inside `read_file_chunk`.
 */
export function whereNamed(readme: string, token: string): Mention | null {
  const needle = token.toLowerCase();
  const lines = readme.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    for (const m of lines[i].matchAll(/[A-Za-z0-9_.-]+/g)) {
      if (m[0].toLowerCase() === needle) {
        return { line: i + 1, text: excerpt(lines[i], m.index) };
      }
    }
  }
  return null;
}
