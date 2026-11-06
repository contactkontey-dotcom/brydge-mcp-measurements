/*
 * ═══════════════════════════════════════════════════════════════════════════
 * ONE FOLDER PER MEASURED VERSION, BESIDE level1/evidence/ AND NEVER IN IT.
 *
 * `level1/evidence/` holds one file per PACKAGE — the latest measurement, which
 * is what the site publishes. Measuring a second version there would overwrite
 * the first, so there would be nothing to diff and a published page would
 * silently change. This store is separate and keyed by package AND version.
 *
 * Each folder holds two runs of the same version, because a field is compared
 * across versions only where that version's own two runs agree.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { slugOf } from "../level1/run.ts";
import { shapeOf, type Shape } from "./fields.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const RUNS = join(ROOT, "watch", "runs");

/** `@scope/name` + version → a folder name that is one package and one version. */
export function keyOf(name: string, version: string): string {
  return `${slugOf(name)}@${version}`;
}

export function folderOf(name: string, version: string): string {
  return join(RUNS, keyOf(name, version));
}

/**
 * Store one run. `n` is 1 or 2.
 *
 * The package name and version are checked against the evidence being written,
 * not taken on trust: a folder named for one package holding another's
 * measurement is how a diff ends up reporting one maintainer's change under
 * somebody else's name.
 */
export function putRun(name: string, version: string, n: 1 | 2, evidence: Record<string, any>): string {
  const got = `${evidence.package?.name}@${evidence.package?.version}`;
  const want = `${name}@${version}`;
  if (got !== want) throw new Error(`refusing to store ${got} under ${want}`);
  const dir = folderOf(name, version);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `run-${n}.json`);
  writeFileSync(path, JSON.stringify(evidence, null, 2));
  return path;
}

/** Both runs of a version as shapes, or null when fewer than two are stored. */
export function getRuns(name: string, version: string): [Shape, Shape] | null {
  const dir = folderOf(name, version);
  const a = join(dir, "run-1.json");
  const b = join(dir, "run-2.json");
  if (!existsSync(a) || !existsSync(b)) return null;
  return [shapeOf(JSON.parse(readFileSync(a, "utf8"))), shapeOf(JSON.parse(readFileSync(b, "utf8")))];
}

/** Every version stored for a package, in the order they were stored. */
export function versionsOf(name: string): string[] {
  if (!existsSync(RUNS)) return [];
  const prefix = `${slugOf(name)}@`;
  return readdirSync(RUNS)
    .filter((d) => d.startsWith(prefix))
    .map((d) => d.slice(prefix.length))
    .sort();
}
