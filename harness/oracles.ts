import { execFileSync } from "node:child_process";
import { join } from "node:path";
import type { Observation } from "../engine/comparison/task.ts";
import type { Canaries } from "./canaries.ts";
import type { CaughtConnection, DnsQuery, WebRequest } from "./net.ts";
import type { DiskDiff } from "./snapshot.ts";
import { writes, type TraceEvent } from "./trace.ts";
import type { OracleName, Probe } from "./types.ts";
import { readWorkbook } from "./xlsx.ts";

/*
 * ═══════════════════════════════════════════════════════════════════════════
 * THE INDEPENDENT SYSTEMS, AND HOW EACH ONE ANSWERS "WHAT ACTUALLY HAPPENED?"
 *
 * The comparison harness reads a third party that neither the platform nor
 * BRYDGE controls. Here the third parties are the kernel and the sandbox: the
 * files on disk, the syscalls the kernel recorded, a git repository read with
 * git itself, the requests a local web server logged, an arithmetic done
 * independently, a workbook read by our own reader. NONE of them is the
 * server's reply — the reply is judged separately, against these, for honesty.
 *
 * Every oracle turns what it read into the SAME `Observation` the comparison
 * harness uses, so the SAME `judge` decides the verdict. The oracle's only job
 * is to look; it never decides.
 *
 * A note on `exhaustive`, the field that lets "not found" mean something. On
 * GitHub the harness must enumerate a window and can still miss a renamed
 * thing, so absence is often UNKNOWN. Here the kernel trace and a full disk
 * snapshot see everything a process did, so absence is ESTABLISHED — these
 * oracles set `exhaustive: true` and stand behind it.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export interface Reply {
  isError: boolean;
  /** Every text block of the tool result, joined. */
  text: string;
  /** structuredContent, if the server returned any. */
  structured: unknown;
}

/** Everything an oracle may read. Assembled once per call by the session runner. */
export interface OracleContext {
  /** Resolved absolute paths for the run. */
  paths: { work: string; outside: string; home: string; runDir: string };
  web: string;
  /** The disk difference across this one call. */
  disk: DiskDiff;
  /** Whether a given absolute path exists now, and its content if it is text. */
  fileNow: (path: string) => { exists: boolean; content: string | null };
  /** Every syscall recorded during this call. */
  trace: TraceEvent[];
  dns: DnsQuery[];
  caught: CaughtConnection[];
  webReqs: WebRequest[];
  reply: Reply;
  canaries: Canaries;
}

/** Resolve {work} {outside} {home} {web} in a value the spec wrote. */
export function resolve(value: string, ctx: Pick<OracleContext, "paths" | "web">): string {
  return value
    .replaceAll("{work}", ctx.paths.work)
    .replaceAll("{outside}", ctx.paths.outside)
    .replaceAll("{home}", ctx.paths.home)
    .replaceAll("{web}", ctx.web);
}

const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : JSON.stringify(v));

/* An Observation the engine will read as "reached the system, looked fully". */
const seen = (found: boolean, fields: Observation["fields"], raw: unknown, ref: string | null = null): Observation => ({
  reachable: true,
  exhaustive: true,
  found,
  fields,
  externalRef: ref,
  raw,
});

/* ─── disk ─────────────────────────────────────────────────────────────────
 * Did the file the probe names change on disk, and to what? For a boundary
 * restraint probe, "found" is a write landing anywhere outside {work} — from
 * the snapshot diff OR from a write syscall the kernel recorded, whichever
 * caught it. A server cannot write outside the sandbox without the kernel
 * seeing the open. */
function disk(probe: Probe, ctx: OracleContext): Observation {
  const target = resolve(str(probe.where.path ?? ""), ctx);
  const now = target ? ctx.fileNow(target) : { exists: false, content: null };

  /* An escape is a write that landed in the forbidden directory, or on the
   * exact path the tool was told to refuse. We look in the per-call disk diff
   * (which snapshots {outside}) AND in this call's slice of the kernel trace,
   * scoped to {outside} or that one target — never to the harness's own files
   * (the probe log, the temp dir), which are written throughout every run. */
  const out = ctx.paths.outside + "/";
  /* The per-call disk diff is the reliable signal — its before/after snapshots
   * bracket THIS call alone. The kernel trace is only sliced by timestamp, and
   * calls to a fast server are microseconds apart, so a trace window cannot
   * tell one call's write from the next. So the trace is used only to confirm a
   * write to this probe's EXACT target path (unique per probe); the broad "did
   * anything land under {outside}" question is answered by the diff. */
  const diskEscapes = [...new Set([...ctx.disk.created, ...ctx.disk.modified])]
    .map((rel) => join(ctx.paths.runDir, rel))
    .filter((p) => p.startsWith(out));
  const tracedEscapes = target.startsWith(out)
    ? ctx.trace.filter((e) => e.syscall === "open" && writes(e) && e.result >= 0 && e.path === target).map((e) => e.path!)
    : [];
  const escapedTo = [...new Set([...diskEscapes, ...tracedEscapes])];

  const fields: Observation["fields"] = {
    exists: now.exists,
    content: now.content,
    created: ctx.disk.created.join(", "),
    modified: ctx.disk.modified.join(", "),
    removed: ctx.disk.removed.join(", "),
    changedCount: ctx.disk.created.length + ctx.disk.modified.length + ctx.disk.removed.length,
    escapedWork: escapedTo.length > 0,
    escapedTo: [...new Set(escapedTo)].join(", "),
  };

  /* A boundary restraint probe is "found" (i.e. the bad thing happened) when a
   * write escaped {work}. A normal write probe is "found" when its file is
   * present now. */
  const found = probe.boundary && probe.mustNotExist ? escapedTo.length > 0 : now.exists || ctx.disk.created.length + ctx.disk.modified.length > 0;
  return seen(found, fields, { disk: ctx.disk, escapedTo }, target || null);
}

/* ─── opens ────────────────────────────────────────────────────────────────
 * Did the server open the file the probe names? The kernel trace is the record.
 * For a boundary restraint read, "found" is a successful open of the forbidden
 * path. */
function opens(probe: Probe, ctx: OracleContext): Observation {
  const target = resolve(str(probe.where.path ?? ""), ctx);
  const opened = ctx.trace.filter((e) => e.syscall === "open" && e.path === target);
  const successfully = opened.some((e) => e.result >= 0);
  const fields: Observation["fields"] = {
    opened: successfully,
    attempts: opened.length,
    lastErrno: opened.length ? (opened[opened.length - 1].errno ?? "") : "",
  };
  return seen(successfully, fields, { opens: opened }, target || null);
}

/* ─── git ────────────────────────────────────────────────────────────────── */
function git(probe: Probe, ctx: OracleContext): Observation {
  const dir = resolve(str(probe.where.dir ?? ""), ctx);
  /* The oracle reads as root a repository owned by the unprivileged server
   * user; without this git refuses it as "dubious ownership". */
  const g = (args: string[]) => execFileSync("git", ["-C", dir, "-c", "safe.directory=*", ...args], { encoding: "utf8" }).trim();
  let head = "",
    subject = "",
    author = "",
    count = 0,
    fileAtHead: string | null = null,
    reached = true;
  try {
    head = g(["rev-parse", "HEAD"]);
    subject = g(["log", "-1", "--format=%s"]);
    author = g(["log", "-1", "--format=%an <%ae>"]);
    count = parseInt(g(["rev-list", "--count", "HEAD"]), 10);
    if (probe.where.path) {
      try {
        fileAtHead = g(["show", `HEAD:${str(probe.where.path)}`]);
      } catch {
        fileAtHead = null;
      }
    }
  } catch {
    reached = false;
  }
  const fields: Observation["fields"] = { head, subject, author, count, fileAtHead };
  return { reachable: reached, exhaustive: true, found: reached && head !== "", fields, externalRef: head || null, raw: { head, subject, author, count } };
}

/* ─── http ───────────────────────────────────────────────────────────────── */
function http(probe: Probe, ctx: OracleContext): Observation {
  const path = str(probe.where.path ?? "");
  const hits = ctx.webReqs.filter((r) => r.path.split("?")[0] === path);
  const requested = hits.length > 0;
  /* A server told a page is disallowed by robots.txt should not fetch it.
   * "found" for such a restraint probe is a request that happened anyway. */
  const askedRobots = ctx.webReqs.some((r) => r.path === "/robots.txt");
  const fields: Observation["fields"] = {
    requested,
    hits: hits.length,
    method: requested ? hits[0].method : "",
    userAgent: requested ? (hits[0].userAgent ?? "") : "",
    askedRobots,
    replyText: ctx.reply.text.slice(0, 4000),
  };
  return seen(requested, fields, { requests: hits }, requested ? `${hits[0].method} ${path}` : null);
}

/* ─── exec ─────────────────────────────────────────────────────────────────
 * Which programs did the server start? For a boundary restraint on a shell
 * server, "found" is a program outside the allowed set having run. */
function exec(probe: Probe, ctx: OracleContext): Observation {
  const wanted = str(probe.where.program ?? "");
  const runs = ctx.trace.filter((e) => e.syscall === "exec" && e.result >= 0);
  const names = runs.map((e) => (e.path ?? "").split("/").pop() ?? "");
  const ran = wanted ? names.includes(wanted) : runs.length > 0;
  const fields: Observation["fields"] = {
    ran,
    programs: [...new Set(names)].join(", "),
    count: runs.length,
    argv: runs.map((e) => (e.argv ?? []).join(" ")).join(" | ").slice(0, 2000),
  };
  return seen(ran, fields, { execs: runs.map((e) => ({ path: e.path, argv: e.argv })) }, wanted || null);
}

/* ─── compute ────────────────────────────────────────────────────────────────
 * The right answer, worked out HERE, independently of the server. For
 * arithmetic the answer is a fixed string in `where.expected`. For the current
 * time it is computed live from the clock and the requested zone with Intl —
 * so a server one hour off, or in the wrong zone, does not match, and an honest
 * one does (checked to the hour, to tolerate the seconds between call and read).
 * `matches` is the field the probe's condition tests. */
function compute(probe: Probe, ctx: OracleContext): Observation {
  const reply = ctx.reply.text + " " + (ctx.reply.structured != null ? JSON.stringify(ctx.reply.structured) : "");
  if (probe.where.mode === "now") {
    const tz = str(probe.where.timezone || "UTC");
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
    const p = (t: string) => parts.find((x) => x.type === t)?.value ?? "";
    const date = `${p("year")}-${p("month")}-${p("day")}`;
    const stamp = `${date}T${p("hour")}`;
    const matches = reply.includes(stamp) || reply.includes(`${date} ${p("hour")}`);
    return seen(ctx.reply.text !== "", { expected: stamp, replyText: ctx.reply.text, matches }, { expected: stamp, reply: ctx.reply.text });
  }
  const expected = str(probe.where.expected ?? "");
  const matches = expected !== "" && reply.includes(expected);
  return seen(ctx.reply.text !== "" || ctx.reply.structured != null, { expected, replyText: ctx.reply.text, structured: ctx.reply.structured != null ? JSON.stringify(ctx.reply.structured) : "", matches }, { expected, reply: ctx.reply.text });
}

/* ─── reply ──────────────────────────────────────────────────────────────────
 * For a tool whose only effect is what it returns — a converter, a formatter —
 * the reply IS the artifact, judged against text written down before the run. */
function reply(_probe: Probe, ctx: OracleContext): Observation {
  const fields: Observation["fields"] = {
    replyText: ctx.reply.text,
    isError: ctx.reply.isError,
    structured: ctx.reply.structured != null ? JSON.stringify(ctx.reply.structured) : "",
  };
  return seen(ctx.reply.text !== "" || ctx.reply.structured != null, fields, { reply: ctx.reply.text });
}

/* ─── xlsx ──────────────────────────────────────────────────────────────────
 * Read the workbook the server wrote to, with our own reader, and report the
 * value in the cell the probe names. */
function xlsx(probe: Probe, ctx: OracleContext): Observation {
  const file = resolve(str(probe.where.path ?? ""), ctx);
  const sheet = str(probe.where.sheet ?? "");
  const cell = str(probe.where.cell ?? "");
  let value: string | null = null;
  let reached = true;
  try {
    const book = readWorkbook(file);
    value = book[sheet]?.[cell] ?? null;
  } catch {
    reached = false;
  }
  const fields: Observation["fields"] = { cell, value, sheet };
  return { reachable: reached, exhaustive: true, found: reached && value !== null, fields, externalRef: `${sheet}!${cell}`, raw: { value } };
}

const ORACLES: Record<OracleName, (p: Probe, c: OracleContext) => Observation> = {
  disk,
  opens,
  git,
  http,
  exec,
  compute,
  reply,
  xlsx,
};

/** Run one probe's oracle over the context assembled for its call. */
export function observe(probe: Probe, ctx: OracleContext): Observation {
  return ORACLES[probe.oracle](probe, ctx);
}
