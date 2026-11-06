/*
 * ═══════════════════════════════════════════════════════════════════════════
 * WHICH APPROVED VERSIONS HAVE BEEN OVERTAKEN.
 *
 * Input is lines of `package@approved-version` — the versions somebody looked
 * at. For each, this asks the registry what the latest published version is
 * and says whether it is the same one.
 *
 * IT REPORTS AND STOPS THERE. No install, no measurement, no exit code that
 * means stop, nothing that could hold up a build. A newer version existing is
 * not a finding about anything; it is the ordinary way software is published.
 * The exit code is 0 whatever it finds, and the only non-zero cases are a
 * usage error and an unreadable input file.
 *
 * A LINE THAT CANNOT BE CHECKED SAYS SO. A registry error, a package that is
 * gone, a version string nobody can order — each is reported as "could not
 * check" with the reason, for that line only. One unreachable package does
 * not take the rest of the list down with it, and "could not check" is never
 * quietly folded in with "up to date".
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { spawnSync } from "node:child_process";

export interface Line {
  package: string;
  approved: string;
}

export type Status = "newer available" | "approved is latest" | "could not check" | "approved is ahead";

export interface Result {
  package: string;
  approved: string;
  latest: string | null;
  status: Status;
  /** Present when the status is "could not check". */
  because?: string;
}

/** `name@version`, handling scoped names. Blank lines and `#` comments are skipped. */
export function parseLines(text: string): { lines: Line[]; bad: Array<{ raw: string; because: string }> } {
  const lines: Line[] = [];
  const bad: Array<{ raw: string; because: string }> = [];
  for (const raw of text.split(/\r?\n/)) {
    const s = raw.replace(/#.*$/, "").trim();
    if (!s) continue;
    const at = s.lastIndexOf("@");
    if (at <= 0) {
      bad.push({ raw: s, because: "no version: a line is package@version" });
      continue;
    }
    lines.push({ package: s.slice(0, at), approved: s.slice(at + 1) });
  }
  return { lines, bad };
}

/**
 * Compare two version strings. Returns 1 if `a` is ahead, -1 if behind, 0 if
 * equal, and null when either cannot be ordered.
 *
 * Null rather than a guess: an unorderable version is reported as "could not
 * check", not silently treated as equal. A release with a build tag or a
 * scheme this does not understand should produce a question, not a shrug.
 */
export function compareVersions(a: string, b: string): number | null {
  const parse = (v: string) => {
    const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(v.trim());
    return m ? { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ?? null } : null;
  };
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) if (x.nums[i]! !== y.nums[i]!) return x.nums[i]! > y.nums[i]! ? 1 : -1;
  /* 1.0.0 is ahead of 1.0.0-rc.1; two different prereleases are compared as
   * text, which is enough to say "not the same" without claiming an order
   * this does not really know. */
  if (x.pre === y.pre) return 0;
  if (x.pre === null) return 1;
  if (y.pre === null) return -1;
  return x.pre > y.pre ? 1 : -1;
}

/** Ask the registry for a package's latest version. Never throws. */
export function latestOf(pkg: string, run = defaultRun): { version: string | null; because?: string } {
  const r = run(pkg);
  if (r.error) return { version: null, because: r.error };
  const v = (r.stdout ?? "").trim();
  if (!v) return { version: null, because: "the registry returned no version" };
  return { version: v };
}

function defaultRun(pkg: string): { stdout?: string; error?: string } {
  const r = spawnSync("npm", ["view", pkg, "version", "--loglevel", "error"], {
    encoding: "utf8",
    timeout: 60_000,
  });
  if (r.error) return { error: r.error.message };
  if (r.status !== 0) return { error: npmReason(r.stderr ?? "", r.status) };
  return { stdout: r.stdout };
}

/**
 * The useful line out of npm's stderr.
 *
 * Taking the last line gives "A complete log of this run can be found in:
 * /root/.npm/_logs/...", which tells a reader nothing about their package and
 * leaks a path from our machine into their report. The line worth having is
 * the one naming the failure.
 */
export function npmReason(stderr: string, status: number | null): string {
  const lines = stderr
    .split("\n")
    .map((l) => l.replace(/^npm (error|ERR!)\s*/, "").trim())
    .filter(Boolean)
    .filter((l) => !/^A complete log of this run/.test(l) && !/_logs\//.test(l) && !/^code /.test(l));
  const named = lines.find((l) => /\b(E?\d{3})\b|not found|not be found|ENOTFOUND|ETIMEDOUT|EAI_AGAIN/i.test(l));
  return named ?? lines[0] ?? `npm exited ${status}`;
}

/** Check one line. */
export function pollOne(line: Line, run = defaultRun): Result {
  const { version, because } = latestOf(line.package, run);
  if (!version) return { package: line.package, approved: line.approved, latest: null, status: "could not check", because };
  const c = compareVersions(version, line.approved);
  if (c === null) {
    return {
      package: line.package,
      approved: line.approved,
      latest: version,
      status: "could not check",
      because: `cannot order "${line.approved}" against "${version}"`,
    };
  }
  return {
    package: line.package,
    approved: line.approved,
    latest: version,
    status: c > 0 ? "newer available" : c === 0 ? "approved is latest" : "approved is ahead",
  };
}

/** The poll as plain text, grouped so nothing unchecked reads as checked. */
export function renderPoll(results: Result[], bad: Array<{ raw: string; because: string }> = []): string {
  const by = (s: Status) => results.filter((r) => r.status === s);
  const out: string[] = [];
  const newer = by("newer available");
  out.push(`${results.length} approved version(s) checked.`);
  out.push("");
  out.push(`Newer version published: ${newer.length}`);
  for (const r of newer) out.push(`  ${r.package}: you approved ${r.approved}, latest is ${r.latest}`);
  const same = by("approved is latest");
  out.push("");
  out.push(`Still the latest: ${same.length}`);
  for (const r of same) out.push(`  ${r.package}: ${r.approved}`);
  const ahead = by("approved is ahead");
  if (ahead.length) {
    out.push("");
    out.push(`Approved version is ahead of the registry's latest: ${ahead.length}`);
    for (const r of ahead) out.push(`  ${r.package}: you approved ${r.approved}, the registry's latest is ${r.latest}`);
  }
  const cant = by("could not check");
  if (cant.length || bad.length) {
    out.push("");
    out.push(`Could not check: ${cant.length + bad.length}`);
    for (const r of cant) out.push(`  ${r.package}@${r.approved}: ${r.because}`);
    for (const b of bad) out.push(`  ${b.raw}: ${b.because}`);
  }
  out.push("");
  out.push(`What this does not say: a newer version existing is not a statement about either version.`);
  out.push(`Nothing here was installed, started or measured — this asked the registry for a version number`);
  out.push(`and compared it with the one you approved. Nothing is blocked and nothing needs to be.`);
  return out.join("\n");
}
