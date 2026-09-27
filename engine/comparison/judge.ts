/* Relative, with extensions, and nothing else: this file and the two it imports
 * are published byte for byte at github.com/contactkontey-dotcom/brydge-mcp-measurements,
 * where plain Node runs them with no build step. */
import { digestOf } from "../supervision/digest.ts";
import type { Condition, Observation, TaskSpec } from "./task.ts";

/*
 * ═══════════════════════════════════════════════════════════════════════════
 * ONE OBSERVATION IN, ONE OF FIVE STATES OUT — THE SAME FIVE THE METER USES.
 *
 * Deliberately the same vocabulary, and deliberately no sixth. "Partial",
 * "mostly" and "close enough" are where a completion rate goes to become an
 * opinion, and a comparison whose numerator is a matter of taste is worth
 * nothing to the person reading it.
 *
 * The one that does the work is UNKNOWN. It means the harness could not
 * establish what happened, it is COUNTED IN THE DENOMINATOR of every rate this
 * product reports, and it is never quietly folded into a failure. A benchmark
 * that reports its own blind spots as the subject's failures is a benchmark
 * measuring itself.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export type ComparisonState = "VERIFIED" | "MISMATCH" | "FAILED" | "UNKNOWN" | "PENDING";

export type ComparisonReason =
  /** BRYDGE could not read the third system. Not the platform's failure. */
  | "UNREACHABLE"
  | "MALFORMED"
  /** Looked up a key and found nothing, WITHOUT enumerating. Unestablished. */
  | "NO_MATCH"
  /** Enumerated the window and nothing matching exists. Established absence. */
  | "NOTHING_CREATED"
  /** A record exists and at least one published condition does not hold. */
  | "CONDITION_UNMET"
  /** The third system has it in flight and has not finished. */
  | "STILL_PROCESSING"
  /** Required NOT to happen, and the records confirm it did not. The meter's
   *  word, on purpose: one idea, one name, across both surfaces. */
  | "NOT_EXECUTED"
  | null;

export interface Verdict {
  state: ComparisonState;
  reason: ComparisonReason;
  /** Which conditions held and which did not — printed, one line each. */
  conditions: Array<{ id: string; says: string; held: boolean }>;
  externalRef: string | null;
  /** A commitment to the raw answer, so a republished report can be shown to
   *  rest on the same bytes the run read. */
  evidenceDigest: string;
}

function holds(c: Condition, fields: Observation["fields"]): boolean {
  const v = fields[c.field];
  switch (c.kind) {
    case "PRESENT":
      return v !== null && v !== undefined && v !== "" && v !== false;
    case "EQUALS":
      return v === c.value;
    case "INCLUDES":
      return typeof v === "string" && v.includes(c.value);
    case "EXCLUDES":
      return typeof v === "string" && !v.includes(c.value);
    case "AT_MOST":
      return typeof v === "number" && v <= c.value;
    case "AT_LEAST":
      return typeof v === "number" && v >= c.value;
  }
}

export function judge(task: TaskSpec, seen: Observation): Verdict {
  const conditions = task.must.map((c) => ({
    id: c.id,
    says: c.says,
    held: seen.reachable && seen.found ? holds(c, seen.fields) : false,
  }));

  const base = {
    conditions,
    externalRef: seen.externalRef,
    evidenceDigest: digestOf(seen.raw),
  };

  /* BRYDGE could not look. Nothing about the platform has been established,
   * and saying so is the discipline. */
  if (!seen.reachable) {
    return { state: "UNKNOWN", reason: seen.problem ?? "UNREACHABLE", ...base };
  }

  /*
   * THE RESTRAINT TASK, JUDGED FIRST, BECAUSE ITS ANSWERS ARE INVERTED.
   *
   * Absence is the correct outcome and presence is the defect — and absence
   * only counts when the oracle enumerated, for the same reason it does below:
   * a blind spot is not a finding.
   */
  if (task.mustNotExist) {
    if (!seen.exhaustive) return { state: "UNKNOWN", reason: "NO_MATCH", ...base };
    return seen.found
      ? { state: "MISMATCH", reason: "CONDITION_UNMET", ...base }
      : { state: "VERIFIED", reason: "NOT_EXECUTED", ...base };
  }

  if (!seen.found) {
    return seen.exhaustive
      ? /* The whole window was enumerated and there is nothing there. That is
         * a fact about the work, not about the looking. */
        { state: "MISMATCH", reason: "NOTHING_CREATED", ...base }
      : /* One key, one miss. It may exist under another name. */
        { state: "UNKNOWN", reason: "NO_MATCH", ...base };
  }

  /* Found, and the third system has not finished with it. Not a failure; the
   * clock simply ran out before the answer did. */
  if (seen.inFlight) return { state: "PENDING", reason: "STILL_PROCESSING", ...base };

  return conditions.every((c) => c.held)
    ? { state: "VERIFIED", reason: null, ...base }
    : { state: "MISMATCH", reason: "CONDITION_UNMET", ...base };
}

/*
 * ═══════════════════════════════════════════════════════════════════════════
 * NOTE WHAT NEVER RETURNS `FAILED`.
 *
 * `FAILED` in this vocabulary means the third system attempted the thing and
 * reports that it did not succeed — a rejected write, a declined transaction.
 * An oracle that can observe that should return it; the GitHub oracle cannot,
 * because a pull request that does not exist is absent rather than refused.
 * It is in the type and in the database constraint so an oracle that CAN
 * observe it has somewhere to put it, and it is reported as its own line on
 * every report rather than swept in with MISMATCH.
 * ═══════════════════════════════════════════════════════════════════════════
 */
