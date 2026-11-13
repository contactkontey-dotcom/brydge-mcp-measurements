/*
 * WHETHER THIS BUILD MAY BE USED.
 *
 * The check has to run in the process the client launched, which is the
 * BUILT gate, so it lives in a module that is itself compiled and can work
 * out where it is: `watch/gate/` when it is source, `watch/gate/built/gate/`
 * when it is not.
 *
 * Running from source needs no check — it is the source. Running from a
 * build whose sources are gone is a shipped build and runs. Running from a
 * build older than sources that are there refuses, because a gate quietly
 * running last week's code is worse than one that will not start: only one
 * of the two is ever noticed.
 */
import { existsSync, statSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/** True when this module is running out of the build rather than the source. */
export const isBuilt = HERE.includes(`${sep}built${sep}`) || HERE.endsWith(`${sep}built`);

/** The repository root, from either place. */
export const ROOT = isBuilt ? join(HERE, "..", "..", "..", "..") : join(HERE, "..", "..");

/** The entry the client launches when it launches the build. */
export const ENTRY = join(ROOT, "watch", "gate", "built", "gate", "run.js");

const SOURCES = [
  ["watch", "tools.ts"],
  ["watch", "fields.ts"],
  ["watch", "approved.ts"],
  ["watch", "versiondiff.ts"],
  ["watch", "words.ts"],
  ["watch", "schemadiff.ts"],
  ["watch", "decisions.ts"],
  ["watch", "review.ts"],
  ["watch", "page.ts"],
  ["watch", "gate", "transport.ts"],
  ["watch", "gate", "router.ts"],
  ["watch", "gate", "pin.ts"],
  ["watch", "gate", "report.ts"],
  ["watch", "gate", "stale.ts"],
  ["watch", "gate", "run.ts"],
].map((parts) => join(ROOT, ...parts));

export interface Staleness {
  checked: boolean;
  ok: boolean;
  because: string | null;
}

export function staleness(): Staleness {
  if (!isBuilt) return { checked: false, ok: true, because: null };
  if (!existsSync(ENTRY)) return { checked: true, ok: false, because: "the gate has not been built" };
  const built = statSync(ENTRY).mtimeMs;
  const newer = SOURCES.filter((f) => existsSync(f) && statSync(f).mtimeMs > built);
  if (!newer.length) return { checked: true, ok: true, because: null };
  const names = newer.map((f) => f.slice(ROOT.length + 1));
  return {
    checked: true,
    ok: false,
    because: `the build is older than ${names.length} of its source(s): ${names.join(", ")}`,
  };
}

/** What to tell somebody whose build will not do. */
export const HOW_TO_BUILD = "node watch/gate/build.mjs";
