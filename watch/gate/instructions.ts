/*
 * ═══════════════════════════════════════════════════════════════════════════
 * THE `instructions` STRING: PINNED THE SAME WAY A TOOL IS.
 *
 * A server's `initialize` result may carry an `instructions` string. It is
 * server-authored prose that a client may put in front of a model, and it
 * was measured reaching one: a planted token placed in it came back out of
 * Claude Code 2.1.325 when the model was asked, with no tool called. So it
 * is a tool description in everything but name — read by a model, able to
 * change with no version bump — and until now nothing here pinned it.
 *
 * This module is the vocabulary: hash it, say which of three states a pin
 * is in about it, and compare. It touches no file and no stream.
 *
 * ── THE TEXT IS NEVER READ ───────────────────────────────────────────────
 *
 * Same rule as a description. Nothing here parses the prose, looks for
 * anything in it, or puts it in a message, a journal line or a stderr line.
 * What leaves this module is a hash, a length and a sentence written here.
 * The text itself goes into the pin, which is gitignored, and from there to
 * a review page a person reads.
 *
 * ── THREE STATES, BECAUSE "NOT COVERED" IS NOT "NONE" ────────────────────
 *
 *   unpinned   nobody has pinned instructions for this server. A pin
 *              written before instructions were pinnable is in this state,
 *              and so the gate compares nothing and says so once. Reading
 *              an old pin must never produce a change nobody made.
 *   absent     somebody pinned that this server sends none. Instructions
 *              turning up later is then a difference.
 *   text       somebody pinned the string.
 *
 * ── AND A NON-STRING IS NEVER THE SAME AS ANYTHING ───────────────────────
 *
 * The field audit found that a description which is not a string gets
 * normalised to null before it is compared, so one malformed description
 * changing for another was invisible. That mistake is not repeated here:
 * only a string can be pinned, and a field that is present and not a
 * string differs from every pinned state there is, including `absent`.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { createHash } from "node:crypto";

/** sha256 over the exact bytes of the string. No trimming, no folding. */
export function sha256Of(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** What a pin stores about instructions, apart from who decided it. */
export interface Hashed {
  hash: string;
  /** In UTF-16 code units, which is what the tool diff already prints. */
  length: number;
  /** The string as it was pinned, so a reviewer can be shown what moved. */
  text: string;
}

export function hashedOf(text: string): Hashed {
  return { hash: sha256Of(text), length: text.length, text };
}

/** What a pin says about instructions. */
export type State =
  | { kind: "unpinned" }
  | { kind: "absent" }
  | { kind: "text"; hash: string; length: number };

/**
 * What a server sent.
 *
 * `other` is the field being present and not a string. It is kept apart
 * rather than folded into `none`, for the reason in the header.
 */
export type Seen = { kind: "none" } | { kind: "text"; text: string } | { kind: "other" };

/** Read what a result carries, without reading what it says. */
export function seenIn(result: unknown): Seen {
  if (result === null || typeof result !== "object" || Array.isArray(result)) return { kind: "none" };
  const o = result as Record<string, unknown>;
  if (!("instructions" in o)) return { kind: "none" };
  const v = o.instructions;
  /* An explicit null is the server saying it has none, which is what
   * `none` means. Anything else that is not a string is `other`. */
  if (v === null || v === undefined) return { kind: "none" };
  if (typeof v === "string") return { kind: "text", text: v };
  return { kind: "other" };
}

export type Verdict =
  | { kind: "unpinned"; because: string }
  | { kind: "same" }
  | { kind: "differs"; because: string };

/* The sentences. Written here, carrying a length and nothing of the prose. */
const NOT_COVERED = "this pin does not cover instructions";
const PIN_NAMES_NONE = "the server sent instructions and the pin names none";
const PIN_NAMES_SOME = "the server sent no instructions and the pin names some";
const NOT_A_STRING = "the server sent an instructions field that is not a string";
const differsBecause = (pinned: number, seen: number) =>
  `the instructions differ from the pin (${pinned} characters pinned, ${seen} seen)`;

export function compare(state: State, seen: Seen): Verdict {
  if (state.kind === "unpinned") return { kind: "unpinned", because: NOT_COVERED };
  if (seen.kind === "other") return { kind: "differs", because: NOT_A_STRING };
  if (state.kind === "absent") {
    if (seen.kind === "none") return { kind: "same" };
    return { kind: "differs", because: PIN_NAMES_NONE };
  }
  if (seen.kind === "none") return { kind: "differs", because: PIN_NAMES_SOME };
  if (sha256Of(seen.text) === state.hash) return { kind: "same" };
  return { kind: "differs", because: differsBecause(state.length, seen.text.length) };
}

/**
 * The one line a gate says about a pin that does not cover instructions.
 *
 * Said once, on stderr, to the operator. It does not claim anything was
 * done, because nothing was: an old pin is read, and what it does not
 * name, it does not name.
 */
export const UNPINNED_LINE =
  "gate: this pin was written before instructions were pinned, so it does not cover them. " +
  "Whatever this server sends in its initialize result is passed to the client as it arrived. " +
  "Take a new pin to cover it.";
