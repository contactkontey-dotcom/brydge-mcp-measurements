/*
 * The staleness list is complete, and a test keeps it so.
 *
 * watch/gate/stale.ts refuses to run a build that is older than any of its
 * sources — a gate quietly running last week's code is worse than one that
 * will not start. That only holds for sources on its list, and the list was
 * kept by hand: six runtime modules were missing from it for several
 * stages. This reads the directory instead, so the next module added
 * cannot be left off without this test saying so.
 */
import { strict as assert } from "node:assert";
import { existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { test } from "node:test";
import { SOURCES } from "../watch/gate/stale.ts";
import { SOURCES as BUILD_ROOTS } from "../watch/gate/build.mjs";

const ROOT = join(import.meta.dirname, "..");
const GATE = join(ROOT, "watch", "gate");

/** Every TypeScript module directly under watch/gate: the runtime. */
const runtime = readdirSync(GATE)
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts"))
  .sort();

test("every runtime module under watch/gate is on the staleness list", () => {
  const listed = new Set(SOURCES.map((f) => basename(f)));
  const missing = runtime.filter((f) => !listed.has(f));
  assert.deepEqual(missing, [], `on disk and not on the staleness list: ${missing.join(", ")}`);
  assert.ok(runtime.length >= 13, `only ${runtime.length} modules found, so this test is not reading the directory`);
});

test("the six that were missing are the ones now listed", () => {
  /* Named, so a reader of this file knows what the fix was. */
  const listed = new Set(SOURCES.map((f) => basename(f)));
  for (const f of ["enforce.ts", "relist.ts", "verify.ts", "history.ts", "approve.ts", "spawning.ts"]) {
    assert.ok(listed.has(f), `${f} is not on the staleness list`);
  }
});

test("nothing on the staleness list is a file that does not exist", () => {
  /* A stale entry is the other way a hand-kept list drifts. */
  const gone = SOURCES.filter((f) => !existsSync(f));
  assert.deepEqual(gone, [], `on the list and not on disk: ${gone.map((f) => basename(f)).join(", ")}`);
});

test("the build's root list is a subset of the staleness list", () => {
  /*
   * build.mjs hands tsc a list of roots and tsc follows imports from there,
   * so that list need not be complete. The staleness list must be: anything
   * the build compiles is something a stale build could be older than.
   */
  const stale = new Set(SOURCES.map((f) => basename(f)));
  const notWatched = (BUILD_ROOTS as string[]).map((f) => basename(f)).filter((f) => !stale.has(f));
  assert.deepEqual(notWatched, [], `built but not watched for staleness: ${notWatched.join(", ")}`);
});
