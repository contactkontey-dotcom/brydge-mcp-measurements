import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { judge, type ComparisonState } from "../engine/comparison/judge.ts";
import type { Observation, TaskSpec } from "../engine/comparison/task.ts";
import { analyze } from "./analyze.ts";
import { plant, type Canaries } from "./canaries.ts";
import { initialize, McpClient } from "./client.ts";
import { honestyOf } from "./honesty.ts";
import { startCatchAll, startDns, startWeb, type CaughtConnection, type DnsQuery, type WebRequest } from "./net.ts";
import { observe, resolve, type OracleContext, type Reply } from "./oracles.ts";
import { readProbeLog } from "./probelog.ts";
import { diff, snapshot } from "./snapshot.ts";
import { readTrace } from "./trace.ts";
import type { Fixtures, Probe, ProbeResult, ServerSpec } from "./types.ts";
import { writeWorkbook } from "./xlsx.ts";

/*
 * ═══════════════════════════════════════════════════════════════════════════
 * ONE SEALED SESSION WITH ONE SERVER.
 *
 * This runs as root INSIDE `unshare -n -m` — a namespace with its own network
 * (loopback only) and its own mounts. It builds the world the server wakes up
 * in, from nothing:
 *
 *   • loopback up, /etc/resolv.conf pointing at our own DNS, /home replaced by
 *     an empty tmpfs so the machine's real files are not there to be found;
 *   • a home directory salted with fake secrets;
 *   • the files, repositories, workbooks and web pages the spec calls for;
 *   • our DNS stub, our catch-all listeners, our web fixture.
 *
 * Then it starts the server as an UNPRIVILEGED user under `strace`, with the
 * in-process probes loaded, drives the protocol, and for each declared call
 * asks an independent oracle what actually happened. Nothing the server says
 * decides its own verdict. The result is written to a file the outer process
 * reads; then everything is torn down.
 *
 * The uid/gid are the unprivileged `brydge-measure` account the outer process
 * created. The server can read and write its sandbox and its fake home — so a
 * boundary it is supposed to honour is enforced by the SERVER, never by the
 * operating system refusing it. Measuring the OS would prove nothing.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const MEASURE_UID = 996;
const MEASURE_GID = 995;
const HOME = "/home/measure";

export interface SessionConfig {
  spec: ServerSpec;
  runDir: string;
  /** Where the copied probe files live (outside /home, so tmpfs cannot hide them). */
  probeDir: string;
  /** Absolute path to the installed executable, and its resolved args. */
  bin: string;
  args: string[];
}

function sh(cmd: string, args: string[]): void {
  execFileSync(cmd, args, { stdio: ["ignore", "ignore", "inherit"] });
}

/** Build the sandbox world: namespace setup, fake home, fixtures on disk. */
function buildWorld(cfg: SessionConfig): { canaries: Canaries; paths: OracleContext["paths"]; pages: Record<string, { type: string; body: string; status?: number }> } {
  const { runDir, probeDir } = cfg;

  /* Keep every mount we make to ourselves. */
  try {
    sh("mount", ["--make-rprivate", "/"]);
  } catch {
    /* already private */
  }

  /* Loopback up, so anything can bind 127.0.0.1. */
  sh("python3", [join(probeDir, "lo-up.py")]);

  /* Our own resolver: every name resolves to 127.0.0.1, where our listeners are. */
  const resolv = join(runDir, "resolv.conf");
  writeFileSync(resolv, "nameserver 127.0.0.1\noptions ndots:0 attempts:1 timeout:1\n");
  sh("mount", ["--bind", resolv, "/etc/resolv.conf"]);

  /* An empty /home: the machine's real repositories are not here to be found. */
  sh("mount", ["-t", "tmpfs", "tmpfs", "/home"]);
  mkdirSync(HOME, { recursive: true });

  const canaries = plant(HOME);

  const work = join(runDir, "work");
  const outside = join(runDir, "outside");
  mkdirSync(work, { recursive: true });
  mkdirSync(outside, { recursive: true });
  const paths = { work, outside, home: HOME, runDir };

  /* A git identity, so a server's commits do not fail for want of config. It is
   * not a secret; it is the sort of thing a developer's machine always has. */
  writeFileSync(join(HOME, ".gitconfig"), "[user]\n  name = Measured User\n  email = user@example.test\n[safe]\n  directory = *\n[init]\n  defaultBranch = main\n");

  const pages = layFixtures(cfg.spec.fixtures, paths);

  /* The server runs unprivileged, so it must own what it is meant to touch —
   * the sandbox is not the thing enforcing a boundary; the server is. */
  for (const dir of [work, outside, HOME]) sh("chown", ["-R", `${MEASURE_UID}:${MEASURE_GID}`, dir]);

  return { canaries, paths, pages };
}

/** Write the files, build the repositories and workbooks. Returns the pages to serve. */
function layFixtures(fx: Fixtures, paths: OracleContext["paths"]): Record<string, { type: string; body: string; status?: number }> {
  const r = (s: string) => resolve(s, { paths, web: "" });
  for (const dir of fx.dirs ?? []) mkdirSync(r(dir), { recursive: true });
  for (const [path, body] of Object.entries(fx.files ?? {})) {
    const full = r(path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body);
  }
  if (fx.git) {
    const dir = r(fx.git.dir);
    mkdirSync(dir, { recursive: true });
    const g = (args: string[]) =>
      execFileSync("git", ["-C", dir, ...args], {
        stdio: ["ignore", "ignore", "inherit"],
        env: { ...process.env, HOME, GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.test", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.test" },
      });
    g(["init", "-q"]);
    for (const commit of fx.git.commits) {
      for (const [path, body] of Object.entries(commit.files)) {
        const full = join(dir, path);
        mkdirSync(dirname(full), { recursive: true });
        writeFileSync(full, body);
      }
      g(["add", "-A"]);
      g(["commit", "-q", "-m", commit.message]);
    }
  }
  for (const [path, sheets] of Object.entries(fx.xlsx ?? {})) writeWorkbook(r(path), sheets);
  return fx.web ?? {};
}

/** Extract the reply the way a client would read it. */
function readReply(resp: Record<string, unknown>): Reply {
  if (resp.error) {
    const err = resp.error as { message?: string };
    return { isError: true, text: err.message ?? "error", structured: null };
  }
  const result = (resp.result ?? {}) as { content?: Array<{ type?: string; text?: string }>; isError?: boolean; structuredContent?: unknown };
  const text = (result.content ?? [])
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text)
    .join("\n");
  return { isError: result.isError === true, text, structured: result.structuredContent ?? null };
}

const between = <T extends { t: number }>(rows: T[], from: number, to: number): T[] => rows.filter((x) => x.t >= from - 50 && x.t <= to + 50);

const asTask = (p: Probe): TaskSpec => ({ key: p.key, asked: p.claim, system: p.oracle, expected: p.reading, must: p.must, where: p.where, ...(p.mustNotExist ? { mustNotExist: true } : {}) });

const LIVE_ORACLES = new Set(["git", "xlsx", "http", "compute", "reply"]);

interface Capture {
  probe: Probe;
  where: Record<string, string | number>;
  window: { start: number; end: number };
  disk: ReturnType<typeof diff>;
  targetContent: { exists: boolean; content: string | null };
  reply: Reply;
  liveObs: Observation | null;
}

function fileState(path: string): { exists: boolean; content: string | null } {
  try {
    const buf = readFileSync(path);
    return { exists: true, content: buf.length < 1_000_000 ? buf.toString("utf8") : `<${buf.length} bytes>` };
  } catch {
    return { exists: false, content: null };
  }
}

async function main(): Promise<void> {
  const cfg: SessionConfig = JSON.parse(readFileSync(process.argv[2], "utf8"));
  const { spec, runDir, probeDir } = cfg;
  const timeout = spec.callTimeoutSeconds ?? 60;

  const { canaries, paths, pages } = buildWorld(cfg);

  /* Start the network listeners now that loopback is up. */
  const nets = { dns: [] as DnsQuery[], caught: [] as CaughtConnection[], webReqs: [] as WebRequest[] };
  const closers: Array<() => void> = [];
  closers.push(await startDns(nets.dns));
  closers.push(await startCatchAll(80, nets.caught));
  closers.push(await startCatchAll(443, nets.caught));
  const webFixture = await startWeb(pages, nets.webReqs);
  closers.push(webFixture.close);
  const web = webFixture.base;

  /* The probe log the in-process probes append to; the server user must write it. */
  const probeLogPath = join(runDir, "probe.log");
  writeFileSync(probeLogPath, "");
  chmodSync(probeLogPath, 0o666);

  const traceDir = join(runDir, "trace");
  mkdirSync(traceDir, { recursive: true });
  sh("chown", [`${MEASURE_UID}:${MEASURE_GID}`, traceDir]);

  const serverEnv: Record<string, string> = {
    PATH: `${dirname(cfg.bin)}:${dirname(process.execPath)}:/usr/local/bin:/usr/bin:/bin`,
    HOME,
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    TMPDIR: join(runDir, "tmp"),
    ...canaries.env,
    ...(spec.env ?? {}),
    BRYDGE_PROBE_LOG: probeLogPath,
    NODE_OPTIONS: `--require ${join(probeDir, "node-probe.cjs")}`,
    PYTHONPATH: probeDir,
    PYTHONDONTWRITEBYTECODE: "1",
  };
  mkdirSync(serverEnv.TMPDIR, { recursive: true });
  sh("chown", [`${MEASURE_UID}:${MEASURE_GID}`, serverEnv.TMPDIR]);

  const straceArgs = [
    "-ff",
    "-ttt",
    "-qq",
    "-s",
    "256",
    "-e",
    "trace=open,openat,creat,execve,connect",
    "-o",
    join(traceDir, "t"),
    "setpriv",
    "--reuid",
    String(MEASURE_UID),
    "--regid",
    String(MEASURE_GID),
    "--clear-groups",
    "--",
    cfg.bin,
    ...cfg.args.map((a) => resolve(a, { paths, web })),
  ];

  const client = new McpClient("strace", straceArgs, { env: serverEnv, cwd: paths.work });

  const captures: Capture[] = [];
  let offered: string[] = [];
  let serverInfo: unknown = null;
  let initError: string | null = null;

  try {
    const init = await initialize(client, timeout);
    if (init.error) throw new Error(`server did not initialize: ${JSON.stringify(init.error)}`);
    serverInfo = (init.result as { serverInfo?: unknown } | undefined)?.serverInfo ?? null;
    const list = await client.request("tools/list", {}, timeout);
    offered = (((list.result as { tools?: Array<{ name?: string }> } | undefined)?.tools ?? []).map((t) => t.name).filter(Boolean) as string[]).sort();

    for (const probe of spec.probes) {
      const resolvedArgs = JSON.parse(resolve(JSON.stringify(probe.arguments), { paths, web }));
      const where: Record<string, string | number> = {};
      for (const [k, v] of Object.entries(probe.where)) where[k] = typeof v === "string" ? resolve(v, { paths, web }) : v;

      for (const b of probe.before ?? []) {
        await client.request("tools/call", { name: b.tool, arguments: JSON.parse(resolve(JSON.stringify(b.arguments), { paths, web })) }, timeout).catch(() => ({}));
      }

      const before = snapshot([paths.work, paths.outside]);
      const start = Date.now();
      const resp = await client.request("tools/call", { name: probe.tool, arguments: resolvedArgs }, timeout);
      const end = Date.now();
      const after = snapshot([paths.work, paths.outside]);
      const reply = readReply(resp);
      const d = diff(before, after, runDir);
      const targetContent = probe.where.path ? fileState(resolve(String(probe.where.path), { paths, web })) : { exists: false, content: null };

      let liveObs: Observation | null = null;
      if (LIVE_ORACLES.has(probe.oracle)) {
        const ctx: OracleContext = {
          paths,
          web,
          disk: d,
          fileNow: () => targetContent,
          trace: [],
          dns: between(nets.dns, start, end),
          caught: between(nets.caught, start, end),
          webReqs: between(nets.webReqs, start, end),
          reply,
          canaries,
        };
        liveObs = observe({ ...probe, where }, ctx);
      }
      captures.push({ probe, where, window: { start, end }, disk: d, targetContent, reply, liveObs });
    }
  } catch (e) {
    initError = e instanceof Error ? e.message : String(e);
  }

  await client.close();

  /* Now the kernel trace is flushed and complete. (readTrace/readProbeLog are
   * imported statically at the top, so they were loaded before /home became a
   * tmpfs and the module files under it went out of view.) */
  const trace = readTrace(traceDir, "t");
  const probeLog = readProbeLog(probeLogPath);

  const results: ProbeResult[] = [];
  const replies: string[] = [];
  const written: Record<string, string> = {};

  for (const cap of captures) {
    const { probe } = cap;
    const windowTrace = trace.filter((e) => e.t >= cap.window.start - 50 && e.t <= cap.window.end + 50);
    const ctx: OracleContext = {
      paths,
      web,
      disk: cap.disk,
      fileNow: () => cap.targetContent,
      trace: windowTrace,
      dns: between(nets.dns, cap.window.start, cap.window.end),
      caught: between(nets.caught, cap.window.start, cap.window.end),
      webReqs: between(nets.webReqs, cap.window.start, cap.window.end),
      reply: cap.reply,
      canaries,
    };
    const obs = cap.liveObs ?? observe({ ...probe, where: cap.where }, ctx);
    const verdict = judge(asTask(probe), obs);
    const honesty = honestyOf(probe, verdict.state as ComparisonState, cap.reply.isError);
    replies.push(cap.reply.text);
    for (const rel of [...cap.disk.created, ...cap.disk.modified]) written[rel] = fileState(join(runDir, rel)).content ?? "";

    results.push({
      key: probe.key,
      tool: probe.tool,
      claim: probe.claim,
      reading: probe.reading,
      arguments: JSON.parse(resolve(JSON.stringify(probe.arguments), { paths, web })),
      oracle: probe.oracle,
      where: cap.where,
      mustNotExist: probe.mustNotExist === true,
      boundary: probe.boundary === true,
      state: verdict.state,
      reason: verdict.reason,
      conditions: verdict.conditions,
      evidenceDigest: verdict.evidenceDigest,
      observed: obs.fields,
      reply: { isError: cap.reply.isError, text: cap.reply.text.slice(0, 4000), honest: honesty.honest, says: honesty.says },
    });
  }

  const runLogs = {
    trace,
    probeLog,
    dns: nets.dns,
    caught: nets.caught,
    webReqs: nets.webReqs,
    serverRequests: client.serverRequests,
    written,
    replies,
    offered,
  };
  const { findings, anySecurity } = analyze(runLogs, spec.declared, canaries, results, HOME);

  const out = {
    slug: spec.slug,
    serverInfo,
    initError,
    offered,
    notChecked: spec.notChecked,
    results,
    findings,
    anySecurity,
    session: {
      trace: trace.map((e) => ({ t: e.t, syscall: e.syscall, path: e.path, flags: e.flags, argv: e.argv, address: e.address, port: e.port, result: e.result, errno: e.errno })),
      probeLog,
      dns: nets.dns,
      caught: nets.caught,
      webReqs: nets.webReqs,
      serverRequests: client.serverRequests,
      transcript: client.transcript,
      written,
      replies,
    },
    canaryWhere: [...canaries.where.entries()].map(([, origin]) => origin),
  };
  writeFileSync(join(runDir, "session-result.json"), JSON.stringify(out));

  for (const c of closers) c();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
