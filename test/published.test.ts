import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { fingerprint } from "../harness/fingerprint.ts";

/*
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT IS PUBLISHED HERE WAS PRODUCED BY THE CODE THAT IS PUBLISHED HERE.
 *
 * The calibration result and every server result carry the fingerprint of the
 * harness that produced them. This checks, with no sandbox and no network, that
 * the fingerprint of the code in this checkout is the one they carry — so a
 * change to the detector cannot be committed while the results still claim to
 * be its work. Change the harness, and this fails until the calibration and the
 * measurements are run again under it.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const current = fingerprint().digest;

test("the committed calibration passed, under the code in this checkout", () => {
  const cal = JSON.parse(readFileSync(join(ROOT, "calibration", "result.json"), "utf8")) as { pass: boolean; fingerprint: string };
  assert.equal(cal.pass, true, "calibration/result.json records a failed calibration");
  assert.equal(cal.fingerprint, current, "the harness changed since calibration ran; run `node measure.ts calibrate` again");
});

test("every published result was measured under that same harness, and none is held", () => {
  const dir = join(ROOT, "results");
  const files = readdirSync(dir).filter((f) => f.endsWith(".json") && !f.endsWith(".raw.json"));
  assert.ok(files.length > 0, "no published results");
  for (const f of files) {
    const r = JSON.parse(readFileSync(join(dir, f), "utf8")) as { slug: string; fingerprint: string; held: boolean; findings: Array<{ security: boolean }> };
    assert.equal(r.fingerprint, current, `${r.slug} was measured under a different harness; measure it again`);
    assert.equal(r.held, false, `${r.slug} is held and must not be in results/`);
    assert.equal(r.findings.some((x) => x.security), false, `${r.slug} has a security finding and belongs in held/, not results/`);
    assert.ok(existsSync(join(dir, f.replace(/\.json$/, ".raw.json"))), `${r.slug} has no raw record`);
  }
});

test("no held (embargoed) result can be, or is, committed", () => {
  /* held/ may legitimately hold results on the machine that measured them —
   * that is where an embargoed result waits. What must never happen is that one
   * is committed, so the check is on git, not on the directory. */
  const ignore = readFileSync(join(ROOT, ".gitignore"), "utf8").split("\n").map((l) => l.trim());
  assert.ok(ignore.includes("held/"), ".gitignore must exclude held/");
  let tracked = "";
  try {
    tracked = execFileSync("git", ["-C", ROOT, "ls-files", "held"], { encoding: "utf8" }).trim();
  } catch {
    return; /* not a git checkout (e.g. a downloaded archive): the ignore rule is the guarantee */
  }
  assert.equal(tracked, "", `held results are committed: ${tracked}`);
});
