import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { fingerprint } from "../harness/fingerprint.ts";
import { SERVERS } from "../servers/index.ts";

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

type Published = {
  slug: string;
  offered: string[];
  results: Array<{ key: string; tool: string; claim: string; reading: string }>;
  notChecked: Array<{ tool: string; reason: string }>;
  readmeCommand: string;
  note?: string;
  declared: unknown;
};

function published(): Published[] {
  const dir = join(ROOT, "results");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json") && !f.endsWith(".raw.json"))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as Published);
}

/*
 * A page says, for each tool the server offered, either what we called and what
 * happened, or that we did not call it and why. So every offered tool must be
 * in exactly one of those two places, and the "not probed" list must not name a
 * tool the server does not even offer: the first measurements shipped naming
 * git_init (documented, never offered) and search_files (another server's tool)
 * as tools "we did not probe", and get_file_info twice.
 */
test("each offered tool is either probed or listed once as not probed, and nothing else is listed", () => {
  for (const r of published()) {
    const offered = new Set(r.offered);
    const probed = new Set(r.results.map((x) => x.tool));
    const unchecked = r.notChecked.map((n) => n.tool);
    const twice = unchecked.filter((t, i) => unchecked.indexOf(t) !== i);
    assert.deepEqual(twice, [], `${r.slug}: listed more than once as not probed`);
    assert.deepEqual(unchecked.filter((t) => !offered.has(t)), [], `${r.slug}: "not probed" names tools it does not offer`);
    assert.deepEqual(unchecked.filter((t) => probed.has(t)), [], `${r.slug}: listed as not probed, but probed`);
    assert.deepEqual([...probed].filter((t) => !offered.has(t)), [], `${r.slug}: probed a tool it does not offer`);
    assert.deepEqual([...offered].filter((t) => !probed.has(t) && !unchecked.includes(t)), [], `${r.slug}: offered, but neither probed nor listed as not probed`);
  }
});

/*
 * What a result quotes from servers/index.ts — the claims, the readings, the
 * reasons a tool went unprobed, the note, the declarations — is copied at
 * measurement time. Correct the spec without measuring again and the published
 * page would still say the old thing; this makes that a failure.
 */
test("every published result quotes servers/index.ts as it stands, so it was measured after the last edit", () => {
  for (const r of published()) {
    const spec = SERVERS.find((s) => s.slug === r.slug);
    assert.ok(spec, `${r.slug} is published but not defined in servers/index.ts`);
    const again = `${r.slug}: servers/index.ts changed since this was measured; run \`node measure.ts ${r.slug}\``;
    assert.deepEqual(r.notChecked, spec.notChecked, again);
    assert.equal(r.readmeCommand, spec.readmeCommand, again);
    assert.equal(r.note, spec.note, again);
    assert.deepEqual(r.declared, JSON.parse(JSON.stringify(spec.declared)), again);
    assert.deepEqual(
      r.results.map(({ key, tool, claim, reading }) => ({ key, tool, claim, reading })),
      spec.probes.map(({ key, tool, claim, reading }) => ({ key, tool, claim, reading })),
      again,
    );
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
