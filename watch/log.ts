/*
 * ═══════════════════════════════════════════════════════════════════════════
 * THE AUDIT LOG: ONE SAVED RECORD PER EDGE, READ BACK AS A TIMELINE.
 *
 * `versiondiff` built its answer in memory and printed it. Nothing was kept,
 * so there was no way to ask "what has this package done over six releases"
 * without re-measuring every version. This keeps one record per pair of
 * measured versions, and reads them back in order.
 *
 * ── The thing that would make this log lie ─────────────────────────────────
 *
 * A timeline renders as a continuous story. What is actually here is a sparse
 * sample: the versions this project happened to measure. @kolbo/mcp published
 * 1.129.x and 1.130.x between two versions stored here, and they were never
 * measured. A timeline printing `1.128.0 -> 1.131.1 -> 1.131.2` reads as the
 * package's history when it is this project's measurement schedule.
 *
 * So the gap is a row, not an omission. Counting it needs npm's publish times,
 * which is a network read this does not do yet, so every gap prints
 * `unknown` — never `0`. Zero would be a claim, and it is one nothing here
 * has checked.
 *
 * ── Four states, which never collapse into each other ──────────────────────
 *
 *   changed       named fields differed, with both counts
 *   no change     both versions passed the soundness gate and matched
 *   can't tell    a version's two runs disagreed, or a version never started
 *   not measured  the gap rows: versions that were never looked at
 *
 * "No change" is the most reassuring line this program can print, so it is
 * earned rather than assumed: `versiondiff` only reaches `compared` when both
 * versions showed two agreeing runs, started, and answered a tool list. Any
 * weaker evidence arrives here as `can't tell`, which says what is missing.
 *
 * ── One instrument per record ──────────────────────────────────────────────
 *
 * A record is refused when the four runs behind it do not share one
 * instrument fingerprint. Two fingerprints mean the diff compared two
 * instruments and not two versions, which is the same mistake that produced
 * 15 false findings in October and a false "could not start" last week. The
 * fingerprint is stored so that stays checkable later.
 *
 * Every run stored under watch/runs/ carries `notCalibrationBacked: true`.
 * These measurements did not pass the publication gate and nothing in this
 * log has the standing of the 67 published pages. The renderer says so.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { slugOf } from "../level1/run.ts";
import { shapeOf } from "./fields.ts";
import { compareVersions } from "./poll.ts";
import { folderOf, versionsOf } from "./store.ts";
import { diffTools, type Capture, type ToolRecord } from "./tools.ts";
import { noChangeBlock, versiondiff, wrapTo, type Diff } from "./versiondiff.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const LOG = join(ROOT, "watch", "log");

const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");

/** The four states a reader is allowed to be told. Nothing else. */
export type State = "changed" | "no change" | "can't tell" | "not measured";

/** Tool-level movement, kept separate from the behaviour fields. */
export interface ToolSection {
  added: string[];
  removed: string[];
  descriptionChanged: Array<{ name: string; before: string | null; after: string | null }>;
  schemaChanged: string[];
  otherChanged: Array<{ name: string; fields: string[] }>;
  unchanged: number;
}

export interface LogRecord {
  recordedAt: string;
  package: string;
  a: string;
  b: string;
  /** The state a timeline prints for this edge. */
  state: State;
  /** The npm tarball hashes: which bytes were measured, not just which name. */
  integrity: { a: string | null; b: string | null };
  measuredAt: { a: string[]; b: string[] };
  /*
   * No live registry lookup yet, so these are unknown rather than absent.
   * `gap` stays the string "unknown" on purpose: a number here would be read
   * as a count, and nothing has counted.
   */
  publishedAt: { a: null; b: null };
  gap: "unknown";
  /** Shared by all four runs behind this record, or the record is refused. */
  instrumentFingerprint: string;
  calibrationBacked: boolean;
  /** Repo-relative path -> sha256, so a record can be tied to its inputs. */
  runFiles: Record<string, string>;
  diff: Diff;
  /** Null when the tool captures are missing or disagree; `why` says which. */
  tools: ToolSection | null;
  toolsWhy: string | null;
}

/* ── Reading what is on disk ────────────────────────────────────────────── */

interface LoadedRun {
  path: string;
  hash: string;
  raw: Record<string, any>;
}

function loadRun(pkg: string, version: string, n: 1 | 2): LoadedRun {
  const path = join(folderOf(pkg, version), `run-${n}.json`);
  if (!existsSync(path)) throw new Error(`no run-${n}.json for ${pkg}@${version}`);
  const bytes = readFileSync(path);
  const raw = JSON.parse(bytes.toString("utf8")) as Record<string, any>;
  /*
   * The folder name is not taken on trust on the way out either. store.ts
   * checks it on the way in, but a folder renamed by hand would otherwise
   * report one maintainer's change under another's name.
   */
  const got = `${raw.package?.name}@${raw.package?.version}`;
  if (got !== `${pkg}@${version}`) throw new Error(`${path} holds ${got}, not ${pkg}@${version}`);
  return { path, hash: sha(bytes), raw };
}

function loadCaptures(pkg: string, version: string): { tools: ToolRecord[] } | { why: string } {
  const read = (n: 1 | 2): Capture | null => {
    const f = join(folderOf(pkg, version), `tools-${n}.json`);
    return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as Capture) : null;
  };
  const a = read(1);
  const b = read(2);
  if (!a || !b) return { why: `no two tool captures stored for ${version}` };
  const d = diffTools(a.tools, b.tools);
  if (d.added.length || d.removed.length || d.changed.length) {
    return { why: `the two captures of ${version} disagree with each other` };
  }
  return { tools: a.tools };
}

/* ── Building one record ────────────────────────────────────────────────── */

export function stateOf(d: Diff): State {
  if (d.outcome === "compared") return d.changes.length ? "changed" : "no change";
  return "can't tell";
}

/**
 * Build the record for one edge, reading the four runs from disk.
 *
 * Throws rather than returns on a refusal. A record that cannot be built
 * honestly is not written, and the caller says so by name.
 */
export function recordFor(pkg: string, a: string, b: string, now = new Date().toISOString()): LogRecord {
  const runs = {
    a: [loadRun(pkg, a, 1), loadRun(pkg, a, 2)] as const,
    b: [loadRun(pkg, b, 1), loadRun(pkg, b, 2)] as const,
  };
  const all = [...runs.a, ...runs.b];

  /* ── The refusal ──────────────────────────────────────────────────────
   * All four runs or none. A diff across a fingerprint boundary measures
   * the instrument, and reports the difference as the package's. */
  const prints = [...new Set(all.map((r) => String(r.raw.instrumentFingerprint ?? "(none)")))];
  if (prints.length !== 1) {
    const named = all.map((r) => `  ${relative(ROOT, r.path)}: ${String(r.raw.instrumentFingerprint ?? "(none)").slice(0, 12)}`);
    throw new Error(
      `refusing to record ${pkg} ${a} -> ${b}: the four runs were made by ${prints.length} different instruments.\n` +
        named.join("\n") +
        `\nA diff across that boundary would report the instrument's difference as the package's.`,
    );
  }

  const diff = versiondiff(
    pkg,
    { version: a, runs: [shapeOf(runs.a[0].raw), shapeOf(runs.a[1].raw)] },
    { version: b, runs: [shapeOf(runs.b[0].raw), shapeOf(runs.b[1].raw)] },
  );

  let tools: ToolSection | null = null;
  let toolsWhy: string | null = null;
  const ca = loadCaptures(pkg, a);
  const cb = loadCaptures(pkg, b);
  if ("why" in ca) toolsWhy = ca.why;
  else if ("why" in cb) toolsWhy = cb.why;
  else {
    const d = diffTools(ca.tools, cb.tools);
    tools = {
      added: d.added,
      removed: d.removed,
      descriptionChanged: d.changed
        .filter((c) => c.what.includes("description"))
        .map((c) => ({ name: c.name, before: c.before?.description ?? null, after: c.after?.description ?? null })),
      schemaChanged: d.changed.filter((c) => c.what.includes("input schema")).map((c) => c.name),
      otherChanged: d.changed
        .filter((c) => !c.what.includes("description") && !c.what.includes("input schema"))
        .map((c) => ({ name: c.name, fields: c.what })),
      unchanged: d.unchanged,
    };
  }

  const runFiles: Record<string, string> = {};
  for (const r of all) runFiles[relative(ROOT, r.path)] = r.hash;

  return {
    recordedAt: now,
    package: pkg,
    a,
    b,
    state: stateOf(diff),
    integrity: { a: runs.a[0].raw.package?.integrity ?? null, b: runs.b[0].raw.package?.integrity ?? null },
    measuredAt: { a: runs.a.map((r) => r.raw.measuredAt), b: runs.b.map((r) => r.raw.measuredAt) },
    publishedAt: { a: null, b: null },
    gap: "unknown",
    instrumentFingerprint: prints[0]!,
    calibrationBacked: !all.some((r) => r.raw.notCalibrationBacked === true),
    runFiles,
    diff,
    tools,
    toolsWhy,
  };
}

/* ── Writing and reading the log ────────────────────────────────────────── */

export function pathFor(pkg: string, a: string, b: string): string {
  return join(LOG, slugOf(pkg), `${a}..${b}.json`);
}

export function write(rec: LogRecord): string {
  const path = pathFor(rec.package, rec.a, rec.b);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(rec, null, 2));
  return path;
}

/** Every saved record for a package, oldest edge first. */
export function read(pkg: string): LogRecord[] {
  const dir = join(LOG, slugOf(pkg));
  if (!existsSync(dir)) return [];
  const recs = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as LogRecord);
  return recs.sort((p, q) => compareVersions(p.a, q.a) ?? p.a.localeCompare(q.a));
}

/**
 * Which of two versions came first, or null when that is not knowable here.
 *
 * `compareVersions` is the poller's comparator, and its job there is to answer
 * "is this the version you approved?" — for which "these two differ" is
 * enough. Between two prereleases of the SAME release it falls back to
 * comparing the tags as text, and says so in its own comment: "enough to say
 * not the same without claiming an order this does not really know."
 *
 * An edge in this log is directional. It prints additions and removals, so a
 * backwards edge prints every addition as a removal and reads as a maintainer
 * deleting what they had just added. `1.1.2-rc.33f45c4d7` against
 * `1.1.2-rc.faa269337` is two commit hashes: `3` sorts before `f`, which is a
 * fact about ASCII and not about which was published first.
 *
 * So the tag-text fallback is refused here. Where the release numbers differ
 * the order is known whatever the tags say; where they do not, this returns
 * null and the caller records no edge. Ordering by publish time would settle
 * these, and that needs the registry read this does not do yet.
 */
export function orderOf(a: string, b: string): number | null {
  const base = compareVersions(a, b);
  if (base === null) return null;
  const parts = (v: string) => /^(\d+\.\d+\.\d+)(?:-(.+))?$/.exec(v.trim());
  const x = parts(a);
  const y = parts(b);
  if (!x || !y) return null;
  const bothPre = x[2] !== undefined && y[2] !== undefined;
  if (bothPre && x[2] !== y[2] && x[1] === y[1]) return null;
  return base;
}

/**
 * The consecutive pairs of stored versions for a package.
 *
 * Where two stored versions cannot be ordered, no edge is made between them.
 * Guessing the direction would print an addition as a removal.
 */
export function edgesOf(pkg: string): { edges: Array<[string, string]>; unordered: Array<[string, string]> } {
  const versions = versionsOf(pkg).slice().sort((x, y) => compareVersions(x, y) ?? 0);
  const edges: Array<[string, string]> = [];
  const unordered: Array<[string, string]> = [];
  for (let i = 0; i + 1 < versions.length; i++) {
    const [x, y] = [versions[i]!, versions[i + 1]!];
    if (orderOf(x, y) === null) unordered.push([x, y]);
    else edges.push([x, y]);
  }
  return { edges, unordered };
}

/**
 * Every package that has runs stored, by its real name.
 *
 * The name is read out of a run file, not recovered from the folder name.
 * A folder is named with the slug — `@kolbo/mcp` is stored as `kolbo--mcp` —
 * and slugging a slug is not the identity: `slugOf("kolbo--mcp")` is
 * `kolbo-mcp`, which matches no folder. Taking the folder name for the
 * package name silently skipped all 11 scoped packages here and still printed
 * a cheerful total, which is the exact failure this log exists to not have.
 */
export function packagesWithRuns(): string[] {
  if (!existsSync(join(ROOT, "watch", "runs"))) return [];
  const names = new Set<string>();
  const dir = join(ROOT, "watch", "runs");
  for (const d of readdirSync(dir)) {
    for (const n of [1, 2]) {
      const f = join(dir, d, `run-${n}.json`);
      if (!existsSync(f)) continue;
      const name = (JSON.parse(readFileSync(f, "utf8")) as Record<string, any>)?.package?.name;
      if (typeof name === "string" && name) names.add(name);
      break;
    }
  }
  return [...names].sort();
}

/* ── The timeline ───────────────────────────────────────────────────────── */

const LABEL: Record<State, string> = {
  changed: "CHANGED",
  "no change": "no change",
  "can't tell": "can't tell",
  "not measured": "not measured",
};

/**
 * The saved records for one package, read back in order.
 *
 * Facts and the four states. No judgement of any change, and no claim about a
 * direction across edges: two changed releases are two changed releases, not a
 * pattern, and this does not have the sample to say otherwise.
 */
export function renderTimeline(pkg: string, recs: LogRecord[]): string {
  const out: string[] = [];
  out.push(pkg);
  out.push("=".repeat(pkg.length));
  out.push("");
  if (!recs.length) {
    out.push(`No saved records. Nothing is known here about ${pkg}.`);
    return out.join("\n");
  }

  const n = recs.length;
  out.push(
    `${n} saved ${n === 1 ? "record" : "records"}, covering ${n === 1 ? "one pair" : `${n} pairs`} of measured versions.`,
  );
  out.push(`This is not a history of the package. Only versions measured here appear, and how`);
  out.push(`many versions were published between any two of them is unknown.`);
  if (recs.some((r) => !r.calibrationBacked)) {
    out.push(`These measurements are not calibration-backed: they did not pass the publication`);
    out.push(`gate, and nothing here has the standing of a published report page.`);
  }
  out.push("");

  out.push(`  ${recs[0]!.a}`);
  for (const r of recs) {
    out.push(`     |    not measured: unknown number of versions between`);
    out.push(`     v`);
    out.push(`  ${r.b.padEnd(34)} ${LABEL[r.state]}`);

    if (r.state === "changed") {
      /* Both totals beside the field name. "33 tools added" and "33 added to
       * 278" are different facts, and the second is the one a reader can
       * check against the two numbers. */
      for (const c of r.diff.changes) {
        const k = r.diff.counts.find((x) => x.field === c.field);
        const span = k ? `  (${k.a} -> ${k.b})` : "";
        out.push(`        ${c.field}${span}`);
        for (const x of c.removed) out.push(`          - ${x}`);
        for (const x of c.added) out.push(`          + ${x}`);
      }
      const still = r.diff.counts.filter((k) => !r.diff.changes.some((c) => c.field === k.field));
      if (still.length) out.push(`        equal in: ${still.map((k) => `${k.field} (${k.a})`).join(", ")}`);
    } else if (r.state === "no change") {
      /*
       * This row used to print the two tool counts and call it evidence.
       * 46 and 46 is also what a one-for-one swap looks like, and neither
       * number says anything at all about a description or a schema.
       */
      const names = r.diff.counts.find((c) => c.field === "tools offered");
      const t = r.tools;
      const shaky = new Set(r.diff.cannotTell);
      const others = r.diff.counts.filter((c) => c.field !== "tools offered").map((c) => c.field);
      for (const part of noChangeBlock({
        namesA: names?.a ?? r.diff.sound.a.toolCount,
        namesB: names?.b ?? r.diff.sound.b.toolCount,
        added: t ? t.added.length : 0,
        removed: t ? t.removed.length : 0,
        descriptionsChanged: t ? t.descriptionChanged.length : null,
        schemasChanged: t ? t.schemaChanged.length : null,
        why: r.toolsWhy ?? null,
        alsoCompared: [
          ...others.filter((f) => !shaky.has(f)),
          ...(r.diff.readme === "same" ? ["README digest"] : []),
        ],
        alsoNotCompared: [
          ...others.filter((f) => shaky.has(f)).map((f) => `${f} (the two runs of one version disagreed about it)`),
          ...(r.diff.readme === "can't tell" ? ["README digest (the two runs of one version disagreed about it)"] : []),
        ],
      })) {
        out.push(...wrapTo(part, 74, "        "));
      }
      out.push(`        Both versions were measured twice with their runs agreeing.`);
    } else {
      out.push(`        ${r.diff.says}`);
    }

    if (r.diff.cannotTell.length && r.state !== "no change") {
      out.push(`        can't tell, no change reported: ${r.diff.cannotTell.join(", ")}`);
    }
    /* A no-change already lists the README and the tool fields in its two
     * named lists; repeating them below is the same fact a second time. */
    if (r.state === "no change") {
      out.push("");
      continue;
    }
    out.push(
      `        README digest: ${
        r.diff.readme === "same"
          ? "unchanged"
          : r.diff.readme === "changed"
            ? "differs, which means the text differs and nothing more"
            : r.diff.readme
      }`,
    );

    if (r.tools) {
      const t = r.tools;
      const bits: string[] = [];
      if (t.added.length) bits.push(`${t.added.length} added`);
      if (t.removed.length) bits.push(`${t.removed.length} removed`);
      if (t.descriptionChanged.length) bits.push(`${t.descriptionChanged.length} description changed`);
      if (t.schemaChanged.length) bits.push(`${t.schemaChanged.length} schema changed`);
      for (const o of t.otherChanged) for (const f of o.fields) bits.push(`${o.name}: ${f}`);
      out.push(`        tools: ${bits.length ? bits.join(", ") : "nothing moved"}, ${t.unchanged} unchanged`);
    } else {
      out.push(`        tools: not compared (${r.toolsWhy})`);
    }
    out.push("");
  }

  out.push(`What this does not say: no tool was called in any run, so nothing here is about`);
  out.push(`what a tool does. Every version was given the same fake credentials and no`);
  out.push(`settings of its own, so a tool list that depends on configuration was seen in one`);
  out.push(`configuration only. A website or program named above was looked up or started;`);
  out.push(`the room has no route off the host, so no connection completed and no content was`);
  out.push(`seen. Nothing above says why a version differs from another, or who changed it.`);
  out.push(`Nothing is blocked, and a change appearing here is not a reason to block anything.`);
  return out.join("\n");
}
