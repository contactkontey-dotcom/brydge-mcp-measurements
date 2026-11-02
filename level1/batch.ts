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
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statfsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { slugOf } from "./run.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIRS = [join(ROOT, "level1", "evidence"), join(ROOT, "level1", "held")];
const LOG = join(ROOT, "level1", "batch.log");

/*
 * ── DISK, WHICH HAS ALREADY LIED ONCE IN THIS PROJECT ─────────────────────
 *
 * A sandbox is an install tree plus a kernel trace, and they averaged about
 * 400 MB each. Left to accumulate, eighty-three of them filled the disk, and
 * fifteen packages then reported "the server process exited" when the truth
 * was that npm had had nowhere to write. Fifteen false findings about other
 * people's software, one `df` away from being published.
 *
 * So two rules, in the runner rather than in somebody's memory:
 *
 *   1. A SUCCESSFUL run's sandbox is deleted as soon as its evidence is on
 *      disk. The evidence file is the result; the sandbox is scaffolding.
 *   2. A FAILED run's sandbox is KEPT. That is precisely when the trace is
 *      needed, it is what let the fifteen be diagnosed instead of published,
 *      and failures are few enough to afford.
 *
 * And the batch stops before starting a package it may not have room to
 * finish, rather than discovering the floor half-way through an install.
 */
const RUN_BASE = "/srv/brydge-measure";
/** Stop before the next package if free space is under this. */
const FLOOR_BYTES = Number(process.env.BRYDGE_DISK_FLOOR_GB ?? 8) * 2 ** 30;

function freeBytes(path: string): number {
  try {
    const s = statfsSync(path);
    return Number(s.bsize) * Number(s.bavail);
  } catch {
    return Number.POSITIVE_INFINITY; /* cannot tell: do not invent a floor breach */
  }
}

const gb = (n: number) => (n / 2 ** 30).toFixed(1);

/** The sandboxes this run of this slug created, newest last. */
function sandboxesFor(slug: string, since: number): string[] {
  try {
    return readdirSync(RUN_BASE)
      .filter((d) => {
        const m = /^(.*)-(\d{13})$/.exec(d);
        return m && m[1] === slug && Number(m[2]) >= since;
      })
      .map((d) => join(RUN_BASE, d));
  } catch {
    return [];
  }
}

/** `name@version` → the two parts, scope-safe. */
function split(ref: string): { name: string; version: string | null } {
  const at = ref.lastIndexOf("@");
  if (at <= 0) return { name: ref, version: null };
  return { name: ref.slice(0, at), version: ref.slice(at + 1) };
}

/** Did the run record that the package could not start? */
function recordedFailure(ref: string): boolean {
  const slug = slugOf(split(ref).name);
  for (const dir of DIRS) {
    const path = join(dir, `${slug}.json`);
    if (!existsSync(path)) continue;
    try {
      return Boolean((JSON.parse(readFileSync(path, "utf8")) as { couldNotStart?: unknown }).couldNotStart);
    } catch {
      return true; /* unreadable evidence is not a measurement either */
    }
  }
  return true; /* no evidence written at all */
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
  /* `--limit N`: measure at most N packages this invocation and stop. The
   * batch resumes from the evidence on disk, so a long list is run in batches
   * by invoking it again — no second list file, no bookkeeping to go stale. */
  /* `--force`: measure even where evidence already exists. Used when the
   * runner itself has changed — a new field in the evidence is not a reason to
   * believe the old file, and `alreadyDone` would skip all 67 of them. The
   * previous evidence is in git, which is what makes this safe to offer. */
  const force = process.argv.includes("--force");
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.slice("--limit=".length)) : Infinity;
  if (Number.isNaN(limit) || limit <= 0) {
    console.error(`--limit must be a positive number`);
    process.exit(1);
  }

  const refs = readFileSync(listPath, "utf8")
    .split(/\r?\n/)
    .map((l) => l.replace(/#.*$/, "").trim())
    .filter(Boolean);
  for (const d of DIRS) mkdirSync(d, { recursive: true });

  /*
   * ── THE ONE VARIABLE WHOSE ABSENCE LOOKS LIKE 67 BROKEN PACKAGES ────────
   *
   * Outbound HTTPS here goes through a proxy with its own CA, named by
   * NODE_EXTRA_CA_CERTS. `sudo` without `-E` strips it. npm then fails every
   * registry fetch with SELF_SIGNED_CERT_IN_CHAIN, installs nothing, and the
   * sandbox dutifully starts a binary that does not exist — reporting, for
   * every package in the list, that the server process exited.
   *
   * That is not a measurement. It is the harness measuring its own invocation
   * and putting somebody else's package name on the result. Checked once here,
   * before the first install, rather than discovered afterwards in a trace.
   */
  const ca = process.env.NODE_EXTRA_CA_CERTS;
  if (!ca || !existsSync(ca)) {
    console.error(
      `Refusing to measure: NODE_EXTRA_CA_CERTS is ${ca ? `set to ${ca}, which does not exist` : "not set"}.\n` +
        `Every install would fail its TLS check and every package would be reported as unable to start.\n` +
        `If this is running under sudo, use \`sudo -E\` so the variable survives.`,
    );
    process.exit(2);
  }

  const started = new Date().toISOString();
  appendFileSync(LOG, `\n=== batch ${started} — ${refs.length} package(s) from ${listPath}\n`);
  const tally = { done: 0, skipped: 0, failed: [] as Array<{ ref: string; code: number }>, freedGb: 0, stopped: null as string | null };

  refs.forEach((ref, i) => {
    if (tally.stopped) return;
    const head = `[${i + 1}/${refs.length}] ${ref}`;
    const done = force ? null : alreadyDone(ref);
    if (done) {
      tally.skipped++;
      console.error(`${head} — already measured, skipping`);
      appendFileSync(LOG, `SKIP  ${ref}\n`);
      return;
    }
    if (tally.done + tally.failed.length >= limit) {
      tally.stopped = `limit of ${limit} reached; run again to continue`;
      console.error(`${head} — ${tally.stopped}`);
      appendFileSync(LOG, `STOP  ${tally.stopped}\n`);
      return;
    }
    /* Checked before the install, not after: a package stopped half-way
     * through npm is the exact shape of the false "could not start". */
    const free = freeBytes(RUN_BASE);
    if (free < FLOOR_BYTES) {
      tally.stopped = `disk floor: ${gb(free)} GB free, floor is ${gb(FLOOR_BYTES)} GB`;
      console.error(`${head} — STOPPING. ${tally.stopped}`);
      appendFileSync(LOG, `STOP  ${tally.stopped}\n`);
      return;
    }
    console.error(`${head} — measuring (${gb(free)} GB free)`);
    const t0 = Date.now();
    const r = spawnSync(process.execPath, [join(ROOT, "level1", "run.ts"), ref], {
      cwd: ROOT,
      stdio: ["ignore", "inherit", "inherit"],
      timeout: 20 * 60_000,
    });
    const secs = Math.round((Date.now() - t0) / 1000);
    const code = r.status ?? -1;
    /*
     * "EXITED 0" IS NOT "MEASURED". `run.ts` exits 0 when a package could not
     * start, because that is a result and not a crash. The first sweep under
     * this rule therefore deleted the one sandbox worth keeping: npm hit its
     * own arborist bug on a single package, the evidence recorded
     * `couldNotStart`, and the trace that would have shown it went with the
     * scaffolding. The question is not how the child exited; it is whether
     * there is a measurement on disk.
     */
    const measured = code === 0 && !recordedFailure(ref);
    if (code === 0) {
      tally.done++;
      const before = freeBytes(RUN_BASE);
      for (const dir of measured ? sandboxesFor(slugOf(split(ref).name), t0) : []) {
        try {
          rmSync(dir, { recursive: true, force: true });
        } catch (e) {
          console.error(`  could not remove ${dir}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      const freed = freeBytes(RUN_BASE) - before;
      if (freed > 0) tally.freedGb += freed / 2 ** 30;
      appendFileSync(
        LOG,
        measured
          ? `OK    ${ref} (${secs}s, freed ${gb(Math.max(0, freed))} GB)\n`
          : `OK*   ${ref} (${secs}s, could not start — sandbox kept)\n`,
      );
      if (!measured) console.error(`${head} — recorded as unable to start; sandbox kept for diagnosis`);
    } else {
      tally.failed.push({ ref, code });
      appendFileSync(LOG, `FAIL  ${ref} exit=${code}${r.signal ? ` signal=${r.signal}` : ""} (${secs}s, sandbox kept)\n`);
      console.error(`${head} — FAILED, exit ${code}; sandbox kept for diagnosis; continuing`);
    }
  });

  const summary = { started, finished: new Date().toISOString(), ...tally, list: listPath };
  writeFileSync(join(ROOT, "level1", "batch-summary.json"), JSON.stringify(summary, null, 2));
  appendFileSync(LOG, `=== measured ${tally.done}, skipped ${tally.skipped}, failed ${tally.failed.length}\n`);
  console.error(
    `\nbatch: measured ${tally.done}, skipped ${tally.skipped}, failed ${tally.failed.length}` +
      `, freed ${tally.freedGb.toFixed(1)} GB, ${gb(freeBytes(RUN_BASE))} GB free`,
  );
  if (tally.stopped) console.error(`stopped early — ${tally.stopped}`);
  for (const f of tally.failed) console.error(`  failed: ${f.ref} (exit ${f.code})`);
  console.error(`evidence now on disk: ${DIRS.map((d) => `${readdirSync(d).filter((f) => f.endsWith(".json")).length} in ${d.replace(ROOT + "/", "")}`).join(", ")}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
