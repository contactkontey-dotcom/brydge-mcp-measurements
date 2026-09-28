import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { installFindings, type InstallLogs } from "./harness/analyze.ts";
import { plant, type Canaries } from "./harness/canaries.ts";
import { fingerprint } from "./harness/fingerprint.ts";
import { LIMITS } from "./harness/limits.ts";
import { readProbeLog } from "./harness/probelog.ts";
import { readTrace } from "./harness/trace.ts";
import type { Finding, ProbeResult, ServerSpec } from "./harness/types.ts";

/*
 * ═══════════════════════════════════════════════════════════════════════════
 * THE OUTSIDE HALF: INSTALL IN THE OPEN, MEASURE IN A SEALED ROOM.
 *
 * Installing a package needs the registry, so it happens HERE, outside the
 * network namespace — but under the same watch: fake secrets planted in a fake
 * home, the install run under strace with the in-process probes loaded, so a
 * postinstall script that reads a credential is caught at install time, which
 * is where a good number of the real ones do their reading.
 *
 * Then the session is launched inside `unshare -n -m`, where there is no route
 * off the machine, and the sealed half (harness/session.ts) does the rest.
 * This half reads back what it wrote, folds in the install findings, and
 * writes one result per server — to `results/` in the open, or to `held/`
 * (git-ignored) when anything security-relevant turned up and the maintainer
 * has not yet been told.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const ROOT = dirname(fileURLToPath(import.meta.url));
const SESSION = join(ROOT, "harness", "session.ts");
const RUN_BASE = "/srv/brydge-measure";
const MEASURE_UID = 996;
const MEASURE_GID = 995;
const INSTALL_HOME_NAME = "install-home";

interface Runner {
  out: string;
  err: string;
  code: number | null;
}

function run(cmd: string, args: string[], opts: { env?: Record<string, string>; cwd?: string; timeoutMs?: number } = {}): Runner {
  try {
    const out = execFileSync(cmd, args, { env: opts.env, cwd: opts.cwd, timeout: opts.timeoutMs ?? 300_000, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
    return { out, err: "", code: 0 };
  } catch (e) {
    const x = e as { stdout?: string; stderr?: string; status?: number | null };
    return { out: x.stdout ?? "", err: x.stderr ?? String(e), code: x.status ?? null };
  }
}

const straceWrap = (traceDir: string, cmd: string[]) => [
  "-ff", "-ttt", "-qq", "-s", "256", "-e", "trace=open,openat,creat,execve,connect", "-o", join(traceDir, "t"), "--", ...cmd,
];

/** Fetch a registry's own record of what it served, for a reproducible integrity line. */
async function integrityOf(spec: ServerSpec): Promise<string[]> {
  try {
    if (spec.registry === "npm") {
      const r = await fetch(`https://registry.npmjs.org/${spec.name}/${spec.version}`);
      const j = (await r.json()) as { dist?: { integrity?: string; tarball?: string; shasum?: string } };
      return [`npm ${spec.name}@${spec.version}`, `integrity ${j.dist?.integrity ?? j.dist?.shasum ?? "?"}`, `tarball ${j.dist?.tarball ?? "?"}`];
    }
    if (spec.registry === "pypi") {
      const r = await fetch(`https://pypi.org/pypi/${spec.name}/${spec.version}/json`);
      const j = (await r.json()) as { urls?: Array<{ filename?: string; digests?: { sha256?: string } }> };
      return (j.urls ?? []).map((u) => `pypi ${u.filename} sha256:${u.digests?.sha256 ?? "?"}`);
    }
  } catch {
    /* best effort; the version pin is the reproducibility floor */
  }
  return [`${spec.registry} ${spec.name} ${spec.version} (integrity not retrieved)`];
}

interface Installed {
  bin: string;
  logs: InstallLogs;
  canaries: Canaries;
  home: string;
  installOut: string;
}

/** Install the package under strace, with canaries planted in a fake home. */
async function install(spec: ServerSpec, runDir: string, probeDir: string): Promise<Installed> {
  const installDir = join(runDir, "install");
  const installHome = join(runDir, INSTALL_HOME_NAME);
  const traceDir = join(runDir, "install-trace");
  const probeLog = join(runDir, "install-probe.log");
  mkdirSync(installDir, { recursive: true });
  mkdirSync(installHome, { recursive: true });
  mkdirSync(traceDir, { recursive: true });
  writeFileSync(probeLog, "");
  const canaries = plant(installHome);

  /* IMPORTANT: no in-process probe at install time. Preloading the Node probe
   * replaces process.env with a Proxy, and npm (unlike uv) refuses to run when
   * process.env is a Proxy — it exits silently before installing anything. So
   * install is watched by the KERNEL TRACE alone, which is enough: the only
   * install-time behaviour we judge is what files the install scripts open, and
   * strace sees every open regardless of language. Individual environment reads
   * by an install script are not attributed — a stated limit of the method. */
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    HOME: installHome,
    ...canaries.env,
  };

  const isNode = spec.registry === "npm" || (spec.registry === "local" && spec.language !== "python");
  let bin = "";
  let installed: Runner;
  if (isNode) {
    const emptyNpmrc = join(runDir, "empty-npmrc");
    writeFileSync(emptyNpmrc, "");
    /* A local package is packed to a tarball first, then installed from it, so
     * npm COPIES it into node_modules (a bare `npm install <dir>` symlinks to
     * the source, which would dangle once the session hides /home). Installing
     * the tarball also runs the package's install scripts, which is the point. */
    let pkg: string;
    if (spec.registry === "local") {
      const packed = run("npm", ["pack", spec.path!, "--pack-destination", installDir, "--loglevel", "error"], { env });
      const tgz = packed.out.trim().split("\n").pop()!.trim();
      pkg = join(installDir, tgz);
    } else {
      pkg = `${spec.name}@${spec.version}`;
    }
    const cmd = ["npm", "install", "--prefix", installDir, "--userconfig", emptyNpmrc, "--cache", join(installDir, ".npm-cache"), "--no-audit", "--no-fund", "--no-save", "--loglevel", "error", pkg];
    installed = run("strace", straceWrap(traceDir, cmd), { env, timeoutMs: 420_000 });
    bin = join(installDir, "node_modules", ".bin", spec.bin);
  } else {
    const venv = join(installDir, "venv");
    const uvEnv = { ...env, UV_NO_CONFIG: "1", NETRC: "/dev/null" };
    run("uv", ["venv", venv, "--python", "3.11", "--seed"], { env: uvEnv, timeoutMs: 180_000 });
    const pkg = spec.registry === "local" ? spec.path! : `${spec.name}==${spec.version}`;
    const cmd = ["uv", "pip", "install", "--python", join(venv, "bin", "python"), pkg];
    installed = run("strace", straceWrap(traceDir, cmd), { env: uvEnv, timeoutMs: 420_000 });
    bin = join(venv, "bin", spec.bin);
  }

  const logs: InstallLogs = {
    trace: readTrace(traceDir, "t"),
    probeLog: readProbeLog(probeLog),
    integrity: await integrityOf(spec),
  };
  return { bin, logs, canaries, home: installHome, installOut: (installed.out + "\n" + installed.err).slice(-4000) };
}

interface SessionResult {
  slug: string;
  serverInfo: unknown;
  initError: string | null;
  offered: string[];
  notChecked: ServerSpec["notChecked"];
  results: ProbeResult[];
  findings: Finding[];
  anySecurity: boolean;
  session: Record<string, unknown>;
  canaryWhere: string[];
}

/** Launch the sealed session and read back what it wrote. */
function runSession(spec: ServerSpec, runDir: string, probeDir: string, bin: string): SessionResult {
  const configPath = join(runDir, "config.json");
  writeFileSync(configPath, JSON.stringify({ spec, runDir, probeDir, bin, args: spec.args }));
  const env: Record<string, string> = {
    PATH: `${dirname(process.execPath)}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/sbin:/usr/bin:/bin`,
    HOME: "/root",
    LANG: "C.UTF-8",
  };
  const r = run("unshare", ["-n", "-m", process.execPath, SESSION, configPath], { env, timeoutMs: 15 * 60_000 });
  const resultPath = join(runDir, "session-result.json");
  try {
    return JSON.parse(readFileSync(resultPath, "utf8")) as SessionResult;
  } catch {
    throw new Error(`session produced no result.\n--- stdout ---\n${r.out.slice(-3000)}\n--- stderr ---\n${r.err.slice(-3000)}`);
  }
}

function copyProbes(probeDir: string): void {
  mkdirSync(probeDir, { recursive: true });
  for (const name of ["node-probe.cjs", "sitecustomize.py", "lo-up.py"]) {
    copyFileSync(join(ROOT, "harness", "probes", name), join(probeDir, name));
    chmodSync(join(probeDir, name), 0o644);
  }
}

export interface ServerReport {
  slug: string;
  name: string;
  registry: string;
  version: string;
  readmeCommand: string;
  bin: string;
  args: string[];
  note?: string;
  measuredAt: string;
  fingerprint: string;
  serverInfo: unknown;
  initError: string | null;
  declared: ServerSpec["declared"];
  offered: string[];
  notChecked: ServerSpec["notChecked"];
  results: ProbeResult[];
  findings: Finding[];
  held: boolean;
  limits: typeof LIMITS;
}

/** Measure one server end to end and return its report plus the raw record. */
export async function measureServer(spec: ServerSpec): Promise<{ report: ServerReport; raw: unknown }> {
  const runDir = join(RUN_BASE, `${spec.slug}-${Date.now()}`);
  const probeDir = join(runDir, "probes");
  mkdirSync(runDir, { recursive: true });
  chmodSync(runDir, 0o755);
  copyProbes(probeDir);

  const installed = await install(spec, runDir, probeDir);
  const instFindings = installed.bin ? installFindings(installed.logs, spec.declared, installed.canaries, installed.home) : [];

  const session = runSession(spec, runDir, probeDir, installed.bin);
  const findings = [...session.findings, ...instFindings];
  const held = session.anySecurity || instFindings.some((f) => f.security);

  const report: ServerReport = {
    slug: spec.slug,
    name: spec.name,
    registry: spec.registry,
    version: spec.version,
    readmeCommand: spec.readmeCommand,
    bin: installed.bin,
    args: spec.args,
    note: spec.note,
    measuredAt: new Date().toISOString(),
    fingerprint: fingerprint().digest,
    serverInfo: session.serverInfo,
    initError: session.initError,
    declared: spec.declared,
    offered: session.offered,
    notChecked: session.notChecked,
    results: session.results,
    findings,
    held,
    limits: LIMITS,
  };
  const raw = { installOut: installed.installOut, installIntegrity: installed.logs.integrity, session: session.session, canaryWhere: session.canaryWhere };
  return { report, raw };
}

/* ═══ Writing results, and the publication gate ═══════════════════════════ */

function writeReport(report: ServerReport, raw: unknown): string {
  const dir = join(ROOT, report.held ? "held" : "results");
  const other = join(ROOT, report.held ? "results" : "held");
  mkdirSync(dir, { recursive: true });
  /* If a server moved between published and held since the last run, drop its
   * stale file from the other side so it is never in both. */
  for (const suffix of [".json", ".raw.json"]) {
    try {
      rmSync(join(other, `${report.slug}${suffix}`));
    } catch {
      /* nothing there */
    }
  }
  writeFileSync(join(dir, `${report.slug}.json`), JSON.stringify(report, null, 2));
  writeFileSync(join(dir, `${report.slug}.raw.json`), JSON.stringify(raw));
  return join(dir, `${report.slug}.json`);
}

/**
 * Calibration: the harness is pointed at servers whose lies are known in
 * advance, and it must catch every one and accuse no honest tool. The verdict
 * is exact-match against the answer key. Nothing real publishes until this
 * passes under the current fingerprint.
 */
function checkCalibration(reports: ServerReport[], key: import("./calibration/index.ts").AnswerKey): { pass: boolean; lines: string[] } {
  const lines: string[] = [];
  let pass = true;
  const fail = (s: string) => {
    pass = false;
    lines.push(`FAIL ${s}`);
  };
  for (const report of reports) {
    const expected = key[report.slug];
    if (!expected) {
      fail(`${report.slug}: no answer key`);
      continue;
    }
    const stateByKey = new Map(report.results.map((r) => [r.key, r.state]));
    for (const [probeKey, want] of Object.entries(expected.probes)) {
      const got = stateByKey.get(probeKey);
      if (got !== want) fail(`${report.slug}: probe ${probeKey} expected ${want}, got ${got ?? "(missing)"}`);
    }
    const gotFindingIds = new Set(report.findings.map((f) => f.id));
    for (const id of expected.findings) if (!gotFindingIds.has(id)) fail(`${report.slug}: expected finding "${id}" not raised`);
    const gotSecurity = new Set(report.findings.filter((f) => f.security).map((f) => f.id));
    const wantSecurity = new Set(expected.security);
    for (const id of wantSecurity) if (!gotSecurity.has(id)) fail(`${report.slug}: expected SECURITY finding "${id}" not raised`);
    for (const id of gotSecurity) if (!wantSecurity.has(id)) fail(`${report.slug}: raised SECURITY finding "${id}" that is not a planted lie (false accusation)`);
    if (pass) lines.push(`ok   ${report.slug}: ${Object.keys(expected.probes).length} probes, ${expected.security.length} security findings, all as planted`);
  }
  return { pass, lines };
}

async function main(): Promise<void> {
  const arg = process.argv[2];
  const fp = fingerprint();

  if (arg === "calibrate") {
    const { CALIBRATION, ANSWER_KEY } = await import("./calibration/index.ts");
    const reports: ServerReport[] = [];
    for (const spec of CALIBRATION) {
      const { report, raw } = await measureServer(spec);
      mkdirSync(join(ROOT, "calibration", "runs"), { recursive: true });
      writeFileSync(join(ROOT, "calibration", "runs", `${spec.slug}.json`), JSON.stringify(report, null, 2));
      writeFileSync(join(ROOT, "calibration", "runs", `${spec.slug}.raw.json`), JSON.stringify(raw));
      reports.push(report);
    }
    const { pass, lines } = checkCalibration(reports, ANSWER_KEY);
    const result = { pass, fingerprint: fp.digest, ranAt: new Date().toISOString(), lines, files: fp.files };
    writeFileSync(join(ROOT, "calibration", "result.json"), JSON.stringify(result, null, 2));
    for (const l of lines) console.log(l);
    console.log(pass ? `\nCALIBRATION PASSED · fingerprint ${fp.digest.slice(0, 12)}` : `\nCALIBRATION FAILED`);
    process.exit(pass ? 0 : 1);
  }

  /* Publication gate: a real run may only proceed if calibration passed under
   * this exact fingerprint. */
  let calibration: { pass: boolean; fingerprint: string } | null = null;
  try {
    calibration = JSON.parse(readFileSync(join(ROOT, "calibration", "result.json"), "utf8"));
  } catch {
    /* none yet */
  }
  if (!calibration?.pass || calibration.fingerprint !== fp.digest) {
    console.error(`Refusing to measure: calibration has not passed under the current fingerprint (${fp.digest.slice(0, 12)}).`);
    console.error(calibration ? `Last calibration: pass=${calibration.pass}, fingerprint=${calibration.fingerprint.slice(0, 12)}` : `No calibration on record. Run: node measure.ts calibrate`);
    process.exit(2);
  }

  const { SERVERS } = await import("./servers/index.ts");
  const chosen = arg ? SERVERS.filter((s) => s.slug === arg) : SERVERS;
  if (!chosen.length) {
    console.error(arg ? `No server with slug "${arg}".` : `No servers defined.`);
    process.exit(1);
  }
  for (const spec of chosen) {
    console.log(`measuring ${spec.slug} …`);
    const { report, raw } = await measureServer(spec);
    const path = writeReport(report, raw);
    console.log(`  ${report.held ? "HELD (security finding; not published until disclosed)" : "written"}: ${path}`);
  }
}

/* Run only when invoked directly, not when imported by a test. */
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
