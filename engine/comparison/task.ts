/*
 * ═══════════════════════════════════════════════════════════════════════════
 * A TASK WITH AN UNAMBIGUOUS END STATE, AND THE ORACLE THAT GOES AND LOOKS.
 *
 * A comparison gives an agent platform a published instruction and then reads
 * a THIRD system to find out whether the thing happened. The whole design rests
 * on one sentence:
 *
 *   THE PLATFORM MUST NOT BE THE SYSTEM OF RECORD FOR ITS OWN RESULT.
 *
 * If the agent's work lands inside the vendor's own product, then "we read the
 * records" means "we read the vendor's database through the vendor's API" —
 * the vendor supplying both the work and the evidence, which is the exact
 * arrangement `engagement_parties_differ` refuses on the paid side. It would
 * be a self-report with extra steps.
 *
 * So `system` names a third party, `Oracle` is the thing that reads it, and
 * `recordsFrom` on the run is published so a reader can see which system was
 * trusted for the verdict.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE CONDITIONS ARE DATA, NOT CODE, BECAUSE THE TASK SET IS PUBLISHED.
 *
 * "Reproducible by anyone" means somebody who does not run this code can read
 * what was required and argue with it. A predicate written as a function is a
 * thing only a programmer can audit and only this repository can run; a list of
 * declared conditions is a thing that prints on the report.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** One published, machine-checkable requirement. `says` is what the report
 *  prints; the rest is what the judge evaluates. */
export type Condition =
  /** The named field is present and not empty. */
  | { id: string; says: string; kind: "PRESENT"; field: string }
  | { id: string; says: string; kind: "EQUALS"; field: string; value: string | number | boolean }
  | { id: string; says: string; kind: "INCLUDES"; field: string; value: string }
  | { id: string; says: string; kind: "EXCLUDES"; field: string; value: string }
  | { id: string; says: string; kind: "AT_MOST"; field: string; value: number }
  | { id: string; says: string; kind: "AT_LEAST"; field: string; value: number };

export interface TaskSpec {
  /** Stable across runs, so the same task can be followed over time. */
  key: string;
  /** The instruction handed to the platform, VERBATIM. Published, because a
   *  low score against a badly written instruction measures the instruction. */
  asked: string;
  /** The third-party system the end state has to appear in. */
  system: string;
  /** Prose for a reader who will never open the code. */
  expected: string;
  /** All must hold. Any failing one is named in the report. */
  must: Condition[];
  /**
   * Where in that system to look, in the oracle's own terms — for GitHub,
   * `{ repo: "owner/name", issue: 4 }`.
   *
   * PUBLISHED WITH THE TASK, deliberately, because it is the address a reader
   * opens to check the working. A locator held privately would make the report
   * a thing you either believe or do not.
   */
  where?: Record<string, string | number>;

  /**
   * ═════════════════════════════════════════════════════════════════════════
   * THE RESTRAINT TASK. THE ONE THAT CATCHES AN AGENT THAT ALWAYS WRITES CODE.
   *
   * Some issues are correct as they stand and the right answer is to change
   * nothing. A task set made only of things to do measures eagerness as
   * competence, and every agent scores well on it.
   *
   * Set this and the end state INVERTS: nothing matching may exist. It mirrors
   * the meter's `VERIFIED / NOT_EXECUTED` exactly — "it was required not to
   * happen, and the records confirm it did not" — and it is reported under the
   * same name, so the two surfaces cannot end up with two vocabularies for one
   * idea.
   * ═════════════════════════════════════════════════════════════════════════
   */
  mustNotExist?: true;
}

/**
 * What an oracle found in the third system.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * `exhaustive` IS THE FIELD THAT KEEPS THE HARNESS HONEST.
 *
 * "We looked and found nothing" is two completely different results depending
 * on how you looked. Enumerate every pull request opened on the repository in
 * the window and find none matching, and you have ESTABLISHED that the work did
 * not happen. Look up one key and get a 404, and you have established that you
 * looked in one place.
 *
 * Reporting the second as the first is how a benchmark quietly turns its own
 * blind spots into somebody else's failures. So the oracle has to say which it
 * did, and the judge returns UNKNOWN rather than MISMATCH when it did not
 * enumerate.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export interface Observation {
  /** Did the oracle reach the third system at all? */
  reachable: boolean;
  /** If not: why. Printed on the report. */
  problem?: "UNREACHABLE" | "MALFORMED";
  /** Did the oracle enumerate the namespace, or look up a key? See above. */
  exhaustive: boolean;
  /** A record matching the task was found. */
  found: boolean;
  /** Still in flight in the third system — a CI run not finished, a job queued. */
  inFlight?: boolean;
  /** Flat fields the conditions are evaluated against. */
  fields: Record<string, string | number | boolean | null>;
  /** The record in the third system, so a reader can go and look. */
  externalRef: string | null;
  /** Verbatim, whatever the third system returned. Published. */
  raw: unknown;
}

/**
 * Something that can read one third-party system of record.
 *
 * An interface rather than a function so the harness is not GitHub-shaped by
 * construction — the first oracle reads GitHub because that is the category
 * where the end state genuinely lives somewhere neither party controls, and a
 * second one for a different system must not require rewriting the runner.
 */
export interface Oracle {
  /** The system of record, as it is printed on the report. */
  readonly system: string;
  observe(task: TaskSpec, window: { from: Date; to: Date }): Promise<Observation>;
}
