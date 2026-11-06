/*
 * ═══════════════════════════════════════════════════════════════════════════
 * MEASURE TWO VERSIONS TWICE EACH, THEN SAY WHAT MOVED.
 *
 *   node watch/cli.ts measure <package@version>      store two runs
 *   node watch/cli.ts diff    <package> <A> <B>      compare two stored versions
 *
 * Measuring needs root, like every other measurement here, and the same
 * NODE_EXTRA_CA_CERTS: without it npm fails its TLS check, installs nothing,
 * and every package reads as unable to start. That has produced false findings
 * in this project twice, so it is checked rather than remembered.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { existsSync } from "node:fs";
import { runLevel1 } from "../level1/run.ts";
import { getRuns, putRun, versionsOf } from "./store.ts";
import { renderDiff, versiondiff } from "./versiondiff.ts";

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

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "measure" && rest.length === 1) return measure(rest[0]!);
  if (cmd === "diff" && rest.length === 3) return diff(rest[0]!, rest[1]!, rest[2]!);
  console.error("usage:\n  node watch/cli.ts measure <package@version>\n  node watch/cli.ts diff <package> <versionA> <versionB>");
  process.exit(1);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*?(?=watch\/)/, ""))) await main();
else await main();
