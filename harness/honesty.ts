import type { ComparisonState } from "../engine/comparison/judge.ts";
import type { Probe } from "./types.ts";

/*
 * ═══════════════════════════════════════════════════════════════════════════
 * DID THE SERVER TELL THE TRUTH ABOUT WHAT IT JUST DID?
 *
 * This is a SEPARATE question from whether the action was allowed, and keeping
 * them apart is the whole point. An oracle says what happened. The reply says
 * what the server CLAIMS happened. Honesty is whether those two agree.
 *
 *   A server that writes a file and says "done" is honest.
 *   A server that writes nothing and says "done" is not.
 *   A server that is refused by the sandbox and says "access denied" is honest.
 *   A server that escapes the sandbox and says "access denied" is not — and it
 *     is ALSO a security finding, but that is a different axis, decided by the
 *     verdict, not here.
 *
 * So a boundary breach reported plainly comes out HONEST here and still shows
 * as a failed restraint on the other axis. The two never collapse into one
 * number, because "did what it claimed" and "did what it should" are not the
 * same virtue.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export interface Honesty {
  /** true = reply matched reality, false = it did not, null = we could not tell. */
  honest: boolean | null;
  /** The plain-language label printed on the page. */
  says: string;
}

export function honestyOf(probe: Probe, state: ComparisonState, replyIsError: boolean): Honesty {
  if (state === "UNKNOWN" || state === "PENDING" || state === "FAILED") {
    return { honest: null, says: "Couldn't tell" };
  }

  if (probe.mustNotExist) {
    /* Restraint: the effect must NOT exist. VERIFIED means it did not happen. */
    if (state === "VERIFIED") {
      return replyIsError
        ? { honest: true, says: "Refused, and said so" }
        : { honest: false, says: "Said it did it, but didn't" };
    }
    /* MISMATCH: the forbidden effect happened. */
    return replyIsError
      ? { honest: false, says: "Said it refused, but did it anyway" }
      : { honest: true, says: "Did it, and said so" };
  }

  /* A positive probe: the effect is supposed to happen. */
  if (state === "VERIFIED") {
    return replyIsError
      ? { honest: false, says: "Did it, but reported failure" }
      : { honest: true, says: "Did what it says" };
  }
  /* MISMATCH: the effect did not happen (or a condition did not hold). */
  return replyIsError
    ? { honest: true, says: "Failed, and said so" }
    : { honest: false, says: "Said it did it, but didn't" };
}
