/*
 * ═══════════════════════════════════════════════════════════════════════════
 * PHRASES NO FILE HERE MAY USE, AND A SEARCH A LINE BREAK CANNOT DEFEAT.
 *
 * Not a `.test.ts` file: `node --test test/*.test.ts` does not pick it up,
 * so importing it does not register another file's tests a second time.
 *
 * ── THE BUG THIS EXISTS BECAUSE OF ───────────────────────────────────────
 *
 * There were two copies of this check, each reading a file and asking
 * whether it contained "build artifact". site/diff-client.js said exactly
 * that and passed both, because the sentence wrapped: "one build" ended one
 * comment line and "artifact, which is what it is" began the next, so the
 * contiguous string was never in the file. A test that reports a file clean
 * while the file says the thing is worse than no test, because it is
 * believed. Running the flattened version found two more occurrences.
 *
 * One copy, flattened, is the whole of the fix.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * One text with the gaps closed: comment leaders dropped, every run of
 * whitespace collapsed to a single space, lowercased.
 *
 * A banned phrase therefore cannot hide in a line break, an indent, or the
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

/**
 * Phrases that characterise a difference instead of reporting it.
 *
 * Each says what somebody else's change WAS FOR or HOW MUCH IT MATTERED,
 * and no run here opens the key, calls the tool or asks the maintainer, so
 * none of it is measured. "cache-busting" is on the list for that reason:
 * it named the purpose of a string in another project's `_meta`.
 */
export const CHARACTERISING = [
  "build artifact",
  "build noise",
  "cache-busting",
  "cache-bust",
  "cosmetic",
  "harmless",
];

/**
 * Words that would claim this stops something.
 *
 * Nothing here is a gate. A tool absent from an approved list is absent
 * from it; a decision to hold is a decision not to add it. Neither prevents
 * anything from running, and saying otherwise would be the one claim this
 * project cannot support.
 */
export const GATEKEEPING = ["denied", "prevented", "blocks", "blocked", "forbidden", "not allowed", "refuses to run"];

/**
 * Words that would say the gate contains the server.
 *
 * It does not. The server it sits in front of is a child process with the
 * user's own privileges: its filesystem, its network, its environment. A
 * proxy filters a view of a tool list; it is not a sandbox, and a word that
 * suggests otherwise is the one claim this cannot support.
 */
export const CONTAINMENT = ["safe", "verified", "protected", "secure", "contained", "sandboxed", "trusted"];

/** Every file whose prose is checked. */
export const CHECKED = [
  "site/diff-client.js",
  "site/build.ts",
  "watch/tools.ts",
  "watch/alert.ts",
  "watch/log.ts",
  "watch/words.ts",
  "watch/schemadiff.ts",
  "watch/decisions.ts",
  "watch/review.ts",
  "watch/page.ts",
  "watch/review-client.js",
  "watch/gate/transport.ts",
  "watch/gate/router.ts",
  "watch/gate/run.ts",
  "watch/gate/pin.ts",
  "watch/gate/report.ts",
  "watch/gate/stale.ts",
  "watch/gate/approve.ts",
  "watch/gate/enforce.ts",
  "watch/gate/history.ts",
  "watch/gate/spawning.ts",
  "watch/gate/relist.ts",
  "watch/gate/verify.ts",
  "watch/gate/fixtures/demo-server.mjs",
];
