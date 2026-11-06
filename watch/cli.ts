/*
 * ═══════════════════════════════════════════════════════════════════════════
 * MEASURE TWO VERSIONS TWICE EACH, THEN SAY WHAT MOVED.
 *
 *   node watch/cli.ts measure  <package@version>          store two runs
 *   node watch/cli.ts diff     <package> <A> <B>          compare two stored versions
 *   node watch/cli.ts approve  <package@version> [who]    add it to the approved list
 *   node watch/cli.ts check    <package@version>          label what is not on the list
 *   node watch/cli.ts poll     <file>                     which approved versions were overtaken
 *   node watch/cli.ts alert    <package> <approved> <new> draft the message
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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runLevel1 } from "../level1/run.ts";
import { agree } from "./fields.ts";
import { checkAgainst, deserialize, entryFrom, keyOf, renderCheck, serialize, type ApprovedList } from "./approved.ts";
import { parseLines, pollOne, renderPoll } from "./poll.ts";
import { renderAlert } from "./alert.ts";
import { getRuns, putRun, versionsOf } from "./store.ts";
import { renderDiff, versiondiff } from "./versiondiff.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const APPROVED = join(HERE, "approved.json");

function loadApproved(): ApprovedList {
  return existsSync(APPROVED) ? deserialize(readFileSync(APPROVED, "utf8")) : {};
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
    console.error(`${ref}: run ${n} of 2 …`);
    const e = await runLevel1(ref);
    /* The run is stored whatever it found, including "could not start": that
     * is an outcome the diff reports, not a reason to discard a measurement. */
    const path = putRun(name, version, n, e as unknown as Record<string, unknown>);
    const o = (e as any).observed;
    console.error(
      `  ${(e as any).couldNotStart ? `could not start at ${(e as any).couldNotStart.stage}` : `${o.offered.length} tool(s)`} -> ${path}`,
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

function approve(ref: string, who?: string): void {
  const { name, version } = split(ref);
  const shape = steadyShape(name, version);
  const list = loadApproved();
  const key = keyOf(name, version);
  list[key] = entryFrom(name, version, shape, new Date().toISOString().slice(0, 10), who);
  mkdirSync(dirname(APPROVED), { recursive: true });
  writeFileSync(APPROVED, serialize(list));
  const e = list[key]!;
  console.error(
    `approved ${key}: ${e.tools.length} tool(s), ${e.hosts.length} website(s), ${e.programs.length} program(s) -> ${APPROVED}`,
  );
}

function check(ref: string): void {
  const { name, version } = split(ref);
  const list = loadApproved();
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

function alert(pkg: string, approvedV: string, foundV: string): void {
  const list = loadApproved();
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

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "measure" && rest.length === 1) return measure(rest[0]!);
  if (cmd === "diff" && rest.length === 3) return diff(rest[0]!, rest[1]!, rest[2]!);
  if (cmd === "approve" && (rest.length === 1 || rest.length === 2)) return approve(rest[0]!, rest[1]);
  if (cmd === "check" && rest.length === 1) return check(rest[0]!);
  if (cmd === "poll" && rest.length === 1) return poll(rest[0]!);
  if (cmd === "alert" && rest.length === 3) return alert(rest[0]!, rest[1]!, rest[2]!);
  console.error(
    [
      "usage:",
      "  node watch/cli.ts measure  <package@version>",
      "  node watch/cli.ts diff     <package> <versionA> <versionB>",
      "  node watch/cli.ts approve  <package@version> [who]",
      "  node watch/cli.ts check    <package@version>",
      "  node watch/cli.ts poll     <file of package@version lines>",
      "  node watch/cli.ts alert    <package> <approvedVersion> <newVersion>",
    ].join("\n"),
  );
  process.exit(1);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*?(?=watch\/)/, ""))) await main();
else await main();
