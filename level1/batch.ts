/*
 * ═══════════════════════════════════════════════════════════════════════════
 * RUN A LIST, SURVIVE ITS FAILURES, AND NEVER LOSE A FINISHED MEASUREMENT.
 *
 * One package per child process. A server that hangs, crashes the sandbox or
 * exhausts the disk takes its own run down and nothing else: the parent records
 * the exit code and moves on. Each evidence file is written by the child as it
 * finishes, so stopping the batch at any point loses only the run in flight.
 *
 * Resumable by the evidence on disk rather than by a progress file, because a
 * progress file can disagree with the evidence and then the batch lies about
 * what it measured. A package is done when its evidence file exists AND records
 * the version being asked for; anything else is run again.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { slugOf } from "./run.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIRS = [join(ROOT, "level1", "evidence"), join(ROOT, "level1", "held")];
const LOG = join(ROOT, "level1", "batch.log");

/** `name@version` → the two parts, scope-safe. */
function split(ref: string): { name: string; version: string | null } {
  const at = ref.lastIndexOf("@");
  if (at <= 0) return { name: ref, version: null };
  return { name: ref.slice(0, at), version: ref.slice(at + 1) };
}

function alreadyDone(ref: string): string | null {
  const { name, version } = split(ref);
  const slug = slugOf(name);
  for (const dir of DIRS) {
    const path = join(dir, `${slug}.json`);
    if (!existsSync(path)) continue;
    try {
      const e = JSON.parse(readFileSync(path, "utf8")) as { package?: { name?: string; version?: string } };
      if (e.package?.name !== name) continue; /* a different package under that slug: not done, and run.ts will refuse */
      if (version && e.package?.version !== version) return null; /* re-measure a moved version */
      return path;
    } catch {
      return null; /* unreadable: measure it again */
    }
  }
  return null;
}

function main(): void {
  const listPath = process.argv[2];
  if (!listPath) {
    console.error("usage: node level1/batch.ts <list-file>   # one package[@version] per line, # comments allowed");
    process.exit(1);
  }
  const refs = readFileSync(listPath, "utf8")
    .split(/\r?\n/)
    .map((l) => l.replace(/#.*$/, "").trim())
    .filter(Boolean);
  for (const d of DIRS) mkdirSync(d, { recursive: true });

  const started = new Date().toISOString();
  appendFileSync(LOG, `\n=== batch ${started} — ${refs.length} package(s) from ${listPath}\n`);
  const tally = { done: 0, skipped: 0, failed: [] as Array<{ ref: string; code: number }> };

  refs.forEach((ref, i) => {
    const head = `[${i + 1}/${refs.length}] ${ref}`;
    const done = alreadyDone(ref);
    if (done) {
      tally.skipped++;
      console.error(`${head} — already measured, skipping`);
      appendFileSync(LOG, `SKIP  ${ref}\n`);
      return;
    }
    console.error(`${head} — measuring`);
    const t0 = Date.now();
    const r = spawnSync(process.execPath, [join(ROOT, "level1", "run.ts"), ref], {
      cwd: ROOT,
      stdio: ["ignore", "inherit", "inherit"],
      timeout: 20 * 60_000,
    });
    const secs = Math.round((Date.now() - t0) / 1000);
    const code = r.status ?? -1;
    if (code === 0) {
      tally.done++;
      appendFileSync(LOG, `OK    ${ref} (${secs}s)\n`);
    } else {
      tally.failed.push({ ref, code });
      appendFileSync(LOG, `FAIL  ${ref} exit=${code}${r.signal ? ` signal=${r.signal}` : ""} (${secs}s)\n`);
      console.error(`${head} — FAILED, exit ${code}; continuing`);
    }
  });

  const summary = { started, finished: new Date().toISOString(), ...tally, list: listPath };
  writeFileSync(join(ROOT, "level1", "batch-summary.json"), JSON.stringify(summary, null, 2));
  appendFileSync(LOG, `=== measured ${tally.done}, skipped ${tally.skipped}, failed ${tally.failed.length}\n`);
  console.error(`\nbatch: measured ${tally.done}, skipped ${tally.skipped}, failed ${tally.failed.length}`);
  for (const f of tally.failed) console.error(`  failed: ${f.ref} (exit ${f.code})`);
  console.error(`evidence now on disk: ${DIRS.map((d) => `${readdirSync(d).filter((f) => f.endsWith(".json")).length} in ${d.replace(ROOT + "/", "")}`).join(", ")}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
