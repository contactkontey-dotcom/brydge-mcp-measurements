import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

/*
 * ═══════════════════════════════════════════════════════════════════════════
 * THE KERNEL'S ACCOUNT OF WHAT THE SERVER DID.
 *
 * `strace -ff -ttt` writes one file per process and thread of the server —
 * including every program it starts, a browser included — recording each file
 * it opened, each program it ran and each address it tried to connect to. It
 * does not care what language the server is written in, and nothing the
 * server says can change it. It is the most complete record in a run and the
 * one the others are checked against.
 *
 * What it cannot see: the contents of a connection, and which environment
 * variables native code reads. Those are covered — partly — elsewhere, and
 * the gaps are printed.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export interface TraceEvent {
  /** Milliseconds since the Unix epoch. */
  t: number;
  pid: number;
  syscall: "open" | "exec" | "connect";
  /** open: the path; exec: the program. */
  path?: string;
  flags?: string;
  argv?: string[];
  /** connect: where to. */
  family?: string;
  address?: string;
  port?: number;
  /** The system call's return value; negative is an error. */
  result: number;
  errno?: string;
}

/** A C string as strace prints it, back to what it was. */
function unquote(s: string): string {
  return s.replace(/\\(x[0-9a-fA-F]{2}|[0-7]{1,3}|.)/g, (_, e: string) => {
    if (e[0] === "x") return String.fromCharCode(parseInt(e.slice(1), 16));
    if (/^[0-7]+$/.test(e)) return String.fromCharCode(parseInt(e, 8));
    return ({ n: "\n", t: "\t", r: "\r", '"': '"', "\\": "\\" } as Record<string, string>)[e] ?? e;
  });
}

const STRING = /"((?:[^"\\]|\\.)*)"/;
const RESULT = /\)\s+=\s+(-?\d+)(?:\s+(E[A-Z0-9]+))?/;

/** One line of one process's trace. Exported for its test. */
export function parseLine(line: string, pid: number): TraceEvent | null {
  const m = /^(\d+\.\d+)\s+(\w+)\((.*)$/.exec(line);
  if (!m) return null;
  const t = Math.round(parseFloat(m[1]) * 1000);
  const call = m[2];
  const rest = m[3];
  const r = RESULT.exec(rest);
  if (!r) return null;
  const result = parseInt(r[1], 10);
  const errno = r[2];

  if (call === "openat" || call === "open" || call === "creat") {
    const s = STRING.exec(rest);
    if (!s) return null;
    const after = rest.slice(rest.indexOf(s[0]) + s[0].length);
    const flags = call === "creat" ? "O_WRONLY|O_CREAT|O_TRUNC" : (/,\s*([A-Z_|]+)/.exec(after)?.[1] ?? "");
    return { t, pid, syscall: "open", path: unquote(s[1]), flags, result, errno };
  }
  if (call === "execve") {
    const s = STRING.exec(rest);
    if (!s) return null;
    const argvText = /\[(.*?)\](?:,|\s)/.exec(rest)?.[1] ?? "";
    const argv = [...argvText.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((a) => unquote(a[1]));
    return { t, pid, syscall: "exec", path: unquote(s[1]), argv, result, errno };
  }
  if (call === "connect") {
    const family = /sa_family=(AF_\w+)/.exec(rest)?.[1] ?? "unknown";
    const port = /htons\((\d+)\)/.exec(rest);
    const v4 = /inet_addr\("([^"]+)"\)/.exec(rest);
    const v6 = /inet_pton\(AF_INET6,\s*"([^"]+)"/.exec(rest);
    const unix = /sun_path="([^"]*)"/.exec(rest);
    return {
      t,
      pid,
      syscall: "connect",
      family,
      address: v4?.[1] ?? v6?.[1] ?? (unix ? unquote(unix[1]) : undefined),
      port: port ? parseInt(port[1], 10) : undefined,
      result,
      errno,
    };
  }
  return null;
}

/** Every event from a `strace -ff -o <prefix>` run, oldest first. */
export function readTrace(dir: string, prefix: string): TraceEvent[] {
  const events: TraceEvent[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.startsWith(`${prefix}.`)) continue;
    const pid = parseInt(name.slice(prefix.length + 1), 10);
    if (!Number.isFinite(pid)) continue;
    for (const line of readFileSync(join(dir, name), "latin1").split("\n")) {
      const e = parseLine(line, pid);
      if (e) events.push(e);
    }
  }
  return events.sort((a, b) => a.t - b.t);
}

/** Whether an open was for writing. */
export const writes = (e: TraceEvent) => /O_WRONLY|O_RDWR|O_CREAT|O_TRUNC/.test(e.flags ?? "");

/** The programs started after `since`, by name. */
export const programsSince = (events: TraceEvent[], since: number) =>
  events.filter((e) => e.syscall === "exec" && e.t >= since && e.result === 0).map((e) => basename(e.path ?? ""));
