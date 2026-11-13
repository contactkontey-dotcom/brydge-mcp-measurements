/*
 * ═══════════════════════════════════════════════════════════════════════════
 * THE GATE, RUNNING. SHADOW MODE: IT CHANGES NOTHING.
 *
 *   node watch/gate/run.ts [--journal <file>] -- <command> [args...]
 *
 * The client launches this instead of the server; the server becomes its
 * child. In G1 every byte goes through in both directions and the only output
 * is a journal of what a gate would have hidden.
 *
 * ── STDOUT IS THE TRANSPORT ──────────────────────────────────────────────
 *
 * Nothing but the server's own bytes is ever written to it. The journal goes
 * to a file, a one-line summary to stderr at the end, and a test asserts no
 * console.log in any of these modules.
 *
 * ── THE CHILD'S LIFE ─────────────────────────────────────────────────────
 *
 * Spawned detached so it gets its own process group, which is what makes it
 * possible to take the whole tree down rather than leave a server running
 * with nobody holding its pipes — the pattern harness/client.ts already uses.
 * Signals are forwarded. The exit code is the child's.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { relay, type Line } from "./transport.ts";
import { Router, SHADOW_MEANS, type Note, type Side } from "./router.ts";

const argv = process.argv.slice(2);
const dashdash = argv.indexOf("--");
if (dashdash === -1 || dashdash === argv.length - 1) {
  process.stderr.write("usage: node watch/gate/run.ts [--journal <file>] -- <command> [args...]\n");
  process.exit(64);
}
const flags = argv.slice(0, dashdash);
const [command, ...args] = argv.slice(dashdash + 1);
const flag = (name: string): string | null => {
  const i = flags.indexOf(name);
  return i === -1 ? null : (flags[i + 1] ?? null);
};
const journalPath = flag("--journal");
const started = Date.now();

if (journalPath) {
  mkdirSync(dirname(journalPath), { recursive: true });
  writeFileSync(journalPath, "");
}

const router = new Router({ mode: "shadow" });

function write(note: Note): void {
  if (!journalPath) return;
  try {
    appendFileSync(journalPath, JSON.stringify(note) + "\n");
  } catch {
    /* A journal that cannot be written is not a reason to drop a message. */
  }
}

const child = spawn(command!, args, { stdio: ["pipe", "pipe", "pipe"], detached: true });

const observe = (side: Side) => (line: Line) => {
  for (const note of router.see(line, side)) write(note);
  return { pass: true } as const;
};
const readerFailed = (e: Error, line: Line) =>
  write({ kind: "unparsed-line", at: Date.now(), side: "server-to-client", bytes: line.raw.length, because: `the reader threw: ${e.message}` });

process.stdin.pipe(relay(observe("client-to-server"), readerFailed)).pipe(child.stdin!);
child.stdout!.pipe(relay(observe("server-to-client"), readerFailed)).pipe(process.stdout);
child.stderr!.pipe(process.stderr);

child.stdin!.on("error", () => {
  /* The server closed its input. Its exit is what matters, and that is below. */
});

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => {
    try {
      if (child.pid) process.kill(-child.pid, signal);
    } catch {
      /* already gone */
    }
  });
}

child.on("error", (e) => {
  process.stderr.write(`gate: the command did not start: ${e.message}\n`);
  process.exit(127);
});

child.on("exit", (code, signal) => {
  const counts = router.summary();
  const said = Object.entries(counts)
    .map(([k, n]) => `${k}=${n}`)
    .sort()
    .join(" ");
  process.stderr.write(
    `gate: ${Date.now() - started}ms, baseline ${router.baselineSize} tool(s), ${said || "nothing to note"}\n${SHADOW_MEANS}\n`,
  );
  /* Let the pipes drain before going. */
  setTimeout(() => process.exit(signal ? 128 : (code ?? 0)), 10);
});
