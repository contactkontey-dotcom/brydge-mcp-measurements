/*
 * ═══════════════════════════════════════════════════════════════════════════
 * MEASURE TWO VERSIONS TWICE EACH, THEN SAY WHAT MOVED.
 *
 *   node watch/cli.ts measure  <package@version>          store two runs
 *   node watch/cli.ts diff     <package> <A> <B>          compare two stored versions
 *   node watch/cli.ts approve  <package@version> [who]    add it to the approved list
 *   node watch/cli.ts check    <package@version>          label what is not on the list
 *
 * `--list <file>` points approve and check at a particular list. Customer
 * lists live in watch/customers/, which is gitignored in full: a list names
 * every tool, website and program a named organisation runs and has signed
 * off on, and that is their map of their own tooling, not ours to publish.
 *   node watch/cli.ts poll     <file>                     which approved versions were overtaken
 *   node watch/cli.ts alert    <package> <approved> <new> draft the message
 *   node watch/cli.ts backfill                              save a record per measured pair
 *   node watch/cli.ts log      <package>                   read the saved records back
 *
 * Nothing here blocks anything, and every command exits 0 on a finding. The
 * only non-zero exits are a usage error, a missing measurement and a missing
 * CA bundle — all of them "this did not run", never "this found something".
 *
 * Measuring needs root, like every other measurement here, and the same
 * NODE_EXTRA_CA_CERTS: without it npm fails its TLS check, installs nothing,
 * and every package reads as unable to start. That has produced false findings
 * in this project twice, so it is checked rather than remembered.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statfsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runLevel1, slugOf } from "../level1/run.ts";
import { agree } from "./fields.ts";
import { checkAgainst, deserialize, entryFrom, keyOf, renderCheck, serialize, type ApprovedList } from "./approved.ts";
import { parseLines, pollOne, renderPoll } from "./poll.ts";
import { renderAlert } from "./alert.ts";
import { folderOf, getRuns, putRun, versionsOf } from "./store.ts";
import { renderDiff, versiondiff } from "./versiondiff.ts";
import { captureFrom, diffTools, parseToolList, renderToolDiff, toolsFromSession, type Capture } from "./tools.ts";
import { edgesOf, packagesWithRuns, read as readLog, recordFor, renderTimeline, write as writeLog } from "./log.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

/** `--list <file>`, or the shared list when none is given. */
function listPath(argv: string[]): string {
  const i = argv.indexOf("--list");
  if (i === -1) return join(HERE, "approved.json");
  const p = argv[i + 1];
  if (!p) {
    console.error("--list needs a file path");
    process.exit(1);
  }
  return p;
}

function loadApproved(path: string): ApprovedList {
  return existsSync(path) ? deserialize(readFileSync(path, "utf8")) : {};
}

/** The two stored runs of a version, only if they agree about everything. */
function steadyShape(pkg: string, version: string): ReturnType<typeof getRuns> extends null ? never : NonNullable<ReturnType<typeof getRuns>>[0] {
  const runs = getRuns(pkg, version);
  if (!runs) {
    console.error(`No two stored runs for ${pkg}@${version}. Stored: ${versionsOf(pkg).join(", ") || "none"}`);
    console.error(`Measure it first: node watch/cli.ts measure ${pkg}@${version}`);
    process.exit(1);
  }
  const a = agree(runs[0], runs[1]);
  if (!a.ok) {
    /* Approving or labelling from a run nobody can reproduce would put a
     * number on the list that the next run disagrees with. */
    console.error(`The two runs of ${pkg}@${version} disagree about: ${a.disagreed.join(", ")}.`);
    console.error(`Nothing is written. Measure it again, or decide by hand what the list should say.`);
    process.exit(1);
  }
  return runs[0];
}

function split(ref: string): { name: string; version: string } {
  const at = ref.lastIndexOf("@");
  if (at <= 0) throw new Error(`need package@version, got "${ref}"`);
  return { name: ref.slice(0, at), version: ref.slice(at + 1) };
}

/*
 * ── DISK, WHICH HAS ALREADY LIED TWICE IN THIS PROJECT ───────────────────
 *
 * A sandbox is an install tree plus a kernel trace, averaging about 400 MB.
 * Ten packages at two versions and two runs each is forty of them. Left to
 * pile up they fill the disk, npm then has nowhere to write, and every
 * remaining package reports that its server process exited — which is how
 * fifteen false findings about other people's software nearly got published
 * in October.
 *
 * So: a successful run's sandbox goes as soon as its evidence is stored, a
 * run that could not start KEEPS its sandbox because that is exactly when the
 * trace is wanted, and the whole thing stops before a run it may not have
 * room to finish.
 */
const RUN_BASE = "/srv/brydge-measure";
const FLOOR_BYTES = Number(process.env.BRYDGE_DISK_FLOOR_GB ?? 8) * 2 ** 30;

function freeBytes(): number {
  try {
    const st = statfsSync(RUN_BASE);
    return Number(st.bsize) * Number(st.bavail);
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}
const gb = (n: number) => (n / 2 ** 30).toFixed(1);

function sandboxesSince(slug: string, since: number): string[] {
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

async function measure(ref: string): Promise<void> {
  const ca = process.env.NODE_EXTRA_CA_CERTS;
  if (!ca || !existsSync(ca)) {
    console.error(
      `Refusing to measure: NODE_EXTRA_CA_CERTS is ${ca ? `set to ${ca}, which does not exist` : "not set"}.\n` +
        `Every install would fail its TLS check and the package would read as unable to start.\n` +
        `Under sudo, use \`sudo -E\`.`,
    );
    process.exit(2);
  }
  const { name, version } = split(ref);
  for (const n of [1, 2] as const) {
    const free = freeBytes();
    if (free < FLOOR_BYTES) {
      console.error(`Stopping before ${ref} run ${n}: ${gb(free)} GB free, floor is ${gb(FLOOR_BYTES)} GB.`);
      console.error(`A run started under the floor is the shape of a false "could not start".`);
      process.exit(3);
    }
    console.error(`${ref}: run ${n} of 2 … (${gb(free)} GB free)`);
    const t0 = Date.now();
    const e = await runLevel1(ref);
    /* The run is stored whatever it found, including "could not start": that
     * is an outcome the diff reports, not a reason to discard a measurement. */
    const path = putRun(name, version, n, e as unknown as Record<string, unknown>);
    const stuck = Boolean((e as any).couldNotStart);
    /* Measured means there is a measurement, not that the child exited 0. */
    /* BRYDGE_KEEP_SANDBOX=1 keeps a successful run's sandbox. Only for
     * looking at what the room recorded — it defeats the disk discipline, so
     * it is opt-in per command and never the default. */
    const keep = process.env.BRYDGE_KEEP_SANDBOX === "1";
    const sandboxes = sandboxesSince(slugOf(name), t0);
    /* THE TOOL SURFACE, TAKEN BEFORE THE SCAFFOLDING GOES.
     *
     * `session-result.json` holds every JSON-RPC message the server sent,
     * descriptions and schemas included. run.ts keeps only the names. Reading
     * it here, while the sandbox still exists, needs nothing from the
     * instrument and leaves its fingerprint alone. */
    let captured = 0;
    for (const dir of sandboxes) {
      const sr = join(dir, "session-result.json");
      if (!existsSync(sr)) continue;
      try {
        const tools = toolsFromSession(JSON.parse(readFileSync(sr, "utf8")).session ?? {});
        if (tools) {
          const cap = captureFrom(name, version, tools, new Date().toISOString());
          writeFileSync(join(folderOf(name, version), `tools-${n}.json`), JSON.stringify(cap, null, 2) + "\n");
          captured = cap.count;
        }
      } catch (e) {
        console.error(`  could not capture the tool list: ${e instanceof Error ? e.message : String(e)}`);
      }
      break;
    }
    if (!stuck && !keep) for (const d of sandboxes) rmSync(d, { recursive: true, force: true });
    const o = (e as any).observed;
    console.error(
      `  ${stuck ? `could not start at ${(e as any).couldNotStart.stage} (sandbox kept)` : `${o.offered.length} tool(s)${captured ? `, ${captured} described` : ", descriptions not captured"}`} -> ${path}`,
    );
  }
}

function diff(pkg: string, a: string, b: string): void {
  for (const [label, v] of [
    ["A", a],
    ["B", b],
  ] as const) {
    if (!getRuns(pkg, v)) {
      console.error(`No two stored runs for version ${v} (${label}). Stored: ${versionsOf(pkg).join(", ") || "none"}`);
      console.error(`Measure it first: node watch/cli.ts measure ${pkg}@${v}`);
      process.exit(1);
    }
  }
  const A = { version: a, runs: getRuns(pkg, a)! };
  const B = { version: b, runs: getRuns(pkg, b)! };
  console.log(renderDiff(versiondiff(pkg, A, B)));
}

function approve(ref: string, who: string | undefined, path: string): void {
  const { name, version } = split(ref);
  const shape = steadyShape(name, version);
  const list = loadApproved(path);
  const key = keyOf(name, version);
  list[key] = entryFrom(name, version, shape, new Date().toISOString().slice(0, 10), who);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serialize(list));
  const e = list[key]!;
  console.error(
    `approved ${key}: ${e.tools.length} tool(s), ${e.hosts.length} website(s), ${e.programs.length} program(s) -> ${path}`,
  );
}

function check(ref: string, path: string): void {
  const { name, version } = split(ref);
  const list = loadApproved(path);
  const entries = Object.values(list).filter((e) => e.package === name);
  if (!entries.length) {
    console.error(`Nothing approved for ${name}. Approve a version first: node watch/cli.ts approve ${name}@<version>`);
    process.exit(1);
  }
  /* Newest approved entry wins when several versions were approved. */
  const entry = entries.sort((a, b) => a.approvedAt.localeCompare(b.approvedAt)).at(-1)!;
  console.log(renderCheck(checkAgainst(entry, version, steadyShape(name, version))));
}

function poll(file: string): void {
  if (!existsSync(file)) {
    console.error(`No such file: ${file}`);
    process.exit(1);
  }
  const { lines, bad } = parseLines(readFileSync(file, "utf8"));
  console.log(renderPoll(lines.map((l) => pollOne(l)), bad));
}

function alert(pkg: string, approvedV: string, foundV: string, path: string): void {
  const list = loadApproved(path);
  const entry = list[keyOf(pkg, approvedV)] ?? null;
  const A = getRuns(pkg, approvedV);
  const B = getRuns(pkg, foundV);
  console.log(
    renderAlert({
      package: pkg,
      approved: approvedV,
      found: foundV,
      measuredOn: new Date().toISOString().slice(0, 10),
      diff: A && B ? versiondiff(pkg, { version: approvedV, runs: A }, { version: foundV, runs: B }) : null,
      check: entry && B ? checkAgainst(entry, foundV, steadyShape(pkg, foundV)) : null,
    }),
  );
}

/** Both captures of a version, only if they agree tool for tool. */
function steadyCapture(pkg: string, version: string): Capture {
  const read = (n: 1 | 2): Capture | null => {
    const f = join(folderOf(pkg, version), `tools-${n}.json`);
    return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as Capture) : null;
  };
  const a = read(1);
  const b = read(2);
  if (!a || !b) {
    console.error(`No two tool captures for ${pkg}@${version}.`);
    console.error(`Measure it again to capture them: node watch/cli.ts measure ${pkg}@${version}`);
    process.exit(1);
  }
  const d = diffTools(a.tools, b.tools);
  if (d.added.length || d.removed.length || d.changed.length) {
    /* Same rule as everywhere else here: a surface nobody can reproduce is
     * not a surface to compare against another version. */
    console.error(`The two captures of ${pkg}@${version} disagree:`);
    console.error(`  ${d.added.length} added, ${d.removed.length} removed, ${d.changed.length} changed between runs.`);
    console.error(`Nothing is compared. Measure it again.`);
    process.exit(1);
  }
  return a;
}

function toolsDiff(pkg: string, a: string, b: string, full: boolean): void {
  const A = steadyCapture(pkg, a);
  const B = steadyCapture(pkg, b);
  console.log(renderToolDiff(pkg, a, b, diffTools(A.tools, B.tools), { full }));
}

function toolsFiles(fa: string, fb: string, full: boolean): void {
  for (const f of [fa, fb]) {
    if (!existsSync(f)) {
      console.error(`No such file: ${f}`);
      process.exit(1);
    }
  }
  const load = (f: string) => {
    try {
      return captureFrom("(file)", f, parseToolList(JSON.parse(readFileSync(f, "utf8"))), new Date().toISOString());
    } catch (e) {
      console.error(`${f}: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    }
  };
  const A = load(fa);
  const B = load(fb);
  console.log(renderToolDiff("two tool lists", fa, fb, diffTools(A.tools, B.tools), { full }));
}

/* ── The audit log ──────────────────────────────────────────────────────── */

/**
 * Save a record for every consecutive pair of stored versions.
 *
 * A refused edge is named and skipped; it does not stop the rest. The exit
 * code stays 0 either way, because "I could not record this one" is a fact
 * about the measurements on disk, not a failure of this command.
 */
function backfill(): void {
  const packages = packagesWithRuns();
  let wrote = 0;
  let refused = 0;
  for (const pkg of packages) {
    const { edges, unordered } = edgesOf(pkg);
    /* Loud about a package that produced nothing: a package silently
     * contributing no edges is how a log comes to look complete. */
    if (!edges.length && !unordered.length) {
      console.log(`  (none)    ${pkg}: fewer than two versions stored, no edge to record`);
      continue;
    }
    for (const [x, y] of unordered) {
      console.log(`  ${pkg} ${x} / ${y}: no edge, these two versions cannot be ordered`);
      refused++;
    }
    for (const [a, b] of edges) {
      try {
        const rec = recordFor(pkg, a, b);
        const path = writeLog(rec);
        console.log(`  ${rec.state.padEnd(10)} ${pkg} ${a} -> ${b}  (${path.replace(process.cwd() + "/", "")})`);
        wrote++;
      } catch (e) {
        console.log(`  refused   ${pkg} ${a} -> ${b}`);
        for (const line of String(e instanceof Error ? e.message : e).split("\n")) console.log(`            ${line}`);
        refused++;
      }
    }
  }
  console.log("");
  console.log(`${wrote} ${wrote === 1 ? "record" : "records"} written across ${packages.length} packages.`);
  if (refused) console.log(`${refused} ${refused === 1 ? "edge" : "edges"} not recorded, each named above.`);
}

function logFor(pkg: string): void {
  console.log(renderTimeline(pkg, readLog(pkg)));
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const path = listPath(argv);
  const i = argv.indexOf("--list");
  const [cmd, ...rest] = i === -1 ? argv : [...argv.slice(0, i), ...argv.slice(i + 2)];
  if (cmd === "measure" && rest.length === 1) return measure(rest[0]!);
  if (cmd === "diff" && rest.length === 3) return diff(rest[0]!, rest[1]!, rest[2]!);
  if (cmd === "approve" && (rest.length === 1 || rest.length === 2)) return approve(rest[0]!, rest[1], path);
  if (cmd === "check" && rest.length === 1) return check(rest[0]!, path);
  if (cmd === "poll" && rest.length === 1) return poll(rest[0]!);
  if (cmd === "alert" && rest.length === 3) return alert(rest[0]!, rest[1]!, rest[2]!, path);
  if (cmd === "backfill" && rest.length === 0) return backfill();
  if (cmd === "log" && rest.length === 1) return logFor(rest[0]!);
  const full = rest.includes("--full");
  const r = rest.filter((x) => x !== "--full");
  if (cmd === "tools" && r[0] === "diff" && r.length === 4) return toolsDiff(r[1]!, r[2]!, r[3]!, full);
  if (cmd === "tools" && r[0] === "files" && r.length === 3) return toolsFiles(r[1]!, r[2]!, full);
  console.error(
    [
      "usage:",
      "  node watch/cli.ts measure  <package@version>",
      "  node watch/cli.ts diff     <package> <versionA> <versionB>",
      "  node watch/cli.ts approve  <package@version> [who]",
      "  node watch/cli.ts check    <package@version>",
      "  node watch/cli.ts poll     <file of package@version lines>",
      "  node watch/cli.ts alert    <package> <approvedVersion> <newVersion>",
      "  node watch/cli.ts tools diff  <package> <versionA> <versionB> [--full]",
      "  node watch/cli.ts tools files <a.json> <b.json> [--full]",
      "  node watch/cli.ts backfill",
      "  node watch/cli.ts log     <package>",
      "",
      "  --list <file>   use a particular approved list (customer lists live in",
      "                  watch/customers/, which is gitignored in full)",
    ].join("\n"),
  );
  process.exit(1);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*?(?=watch\/)/, ""))) await main();
else await main();
