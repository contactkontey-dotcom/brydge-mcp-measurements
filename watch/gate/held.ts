/*
 * ═══════════════════════════════════════════════════════════════════════════
 * THE CALLS THAT WAITED AND THEN DID NOT GO.
 *
 * `--verify-on-call` is the one place a client's message waits: the gate
 * holds a tools/call while it asks the server for a current tool list. Most
 * of those calls are then forwarded. The ones that are not — the check
 * timed out, the budget was spent, or the list came back and the tool was
 * not in it — are the ones somebody may want to look at afterwards, and the
 * journal records the refusal but not which call it was.
 *
 * This file is that: one line per held call that was not forwarded, with
 * the tool, the time, and a FINGERPRINT of the arguments. Never the
 * arguments. Nothing here keeps them: they arrive, they are hashed, and the
 * hash is what is written.
 *
 * ── A HASH IS NOT PRIVACY, AND THIS IS THE PLACE TO SAY SO ───────────────
 *
 * A sha256 of `{"path":"/etc/passwd"}` is not the arguments, and it cannot
 * be turned back into them. But it is a fingerprint of them, and a
 * fingerprint of a SMALL SET is a label. If a tool is called with one of a
 * dozen paths, or one of five repository names, anybody holding this file
 * and a list of the likely arguments can hash the list and read the
 * answer off. Twelve guesses is not an attack.
 *
 * So what this file honestly offers is: the same call was tried five times;
 * this call is not that call; something was held at 14:02 and did not go.
 * What it does not offer is concealment of a low-entropy argument. A file
 * of these is not a file to hand out on the strength of "it is only
 * hashes" — it is a file to hand to somebody who is allowed to know what
 * the client was doing.
 *
 * ── AND IT IS NOT A WAY TO RUN THE CALL AGAIN ────────────────────────────
 *
 * There is nothing in a record to replay with. The hash cannot reconstruct
 * the call, which is the whole of the point and also the whole of the cost:
 * if a held call should have gone through, somebody asks the client to make
 * it again. Nothing here does it for them.
 *
 * ── ITS OWN FILE, NOT THE JOURNAL ────────────────────────────────────────
 *
 * The journal is "the one file you can send without reading it first":
 * tool names, a fixed set of reasons, counts. An argument fingerprint is a
 * different kind of thing, and rather than widen that sentence, these go
 * somewhere else.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { createHash } from "node:crypto";
import { appendFileSync } from "node:fs";
import { canonical } from "../tools.ts";

/** What the fingerprint says it is, so a reader is not left guessing. */
export const PREFIX = "sha256:";

/**
 * The fingerprint of one call's arguments.
 *
 * Over the canonical form, so a server or client that emits the same
 * arguments with its keys in another order produces the same fingerprint —
 * the question this answers is "the same call again?", and key order is not
 * part of that.
 *
 * A call with no `arguments` member and a call whose arguments are
 * literally `null` fingerprint alike: both canonicalise to `null`. That is
 * a collision between two things that are nearly the same, and naming it
 * here is cheaper than a field nobody reads.
 */
export function fingerprintOf(args: unknown): string {
  return PREFIX + createHash("sha256").update(canonical(args), "utf8").digest("hex");
}

/** One record. Three fields, and there will not be a fourth without a reason. */
export interface Held {
  tool: string;
  /** When the gate decided not to forward it, as an ISO instant. */
  at: string;
  /** The fingerprint. Never the arguments. */
  arguments: string;
}

export function recordOf(tool: string, args: unknown, at: Date): Held {
  return { tool, at: at.toISOString(), arguments: fingerprintOf(args) };
}

/** The line as it goes on disk: one JSON object, one newline. */
export function lineOf(tool: string, args: unknown, at: Date): string {
  return JSON.stringify(recordOf(tool, args, at)) + "\n";
}

/**
 * Append one record.
 *
 * Same rule as the journal: a file that cannot be written is not a reason
 * to drop a client's message. The caller is told nothing, because there is
 * nothing it would do differently.
 */
export function append(file: string, tool: string, args: unknown, at: Date = new Date()): void {
  try {
    appendFileSync(file, lineOf(tool, args, at));
  } catch {
    /* a report that cannot be written is not a reason to stop a session */
  }
}
