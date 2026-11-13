/*
 * ═══════════════════════════════════════════════════════════════════════════
 * THE GATE, RUNNING. SHADOW MODE: IT CHANGES NOTHING.
 *
 *   node watch/gate/built/gate/run.js [options] -- <command> [args...]
 *
 *   --pin <file>       the surface somebody signed off
 *   --pending <dir>    where a report goes when the live list differs
 *   --journal <file>   one line per note
 *
 * The client launches this instead of the server; the server becomes its
 * child. Every byte goes through in both directions. With a pin, the live
 * tool list is compared against it on every list the server answers, and a
 * report is written; without one, the first list seen is the baseline and
 * later lists are compared against that.
 *
 * NOTHING IS HIDDEN AND NO CALL IS STOPPED. That is G1's promise and G2
 * keeps it: this records what a gate would hide. Enforcement is not built.
 *
 * ── THE TWO THINGS IT REFUSES TO START FOR ───────────────────────────────
 *
 * A build older than its sources, and a pin it cannot read. Both are about
 * the gate's own setup rather than about the server, and in both cases
 * starting the server is the risk being taken — startup is when a server
 * reads credentials, which is this project's own Level 1 finding — while a
 * gate that cannot read its pin, or is running code nobody meant to ship,
 * has nothing to offer in exchange. It says which, and what to do, on
 * stderr, and exits without spawning anything.
 *
 * ── STDOUT IS THE TRANSPORT ──────────────────────────────────────────────
 *
 * Nothing but the server's own bytes is ever written to it.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { relay, type Line } from "./transport.ts";
import { Router, SHADOW_MEANS, type Note, type Side, type WouldHide } from "./router.ts";
import { NotAPin, read as readPin, type Pin } from "./pin.ts";
import { pendingOf, stderrLine } from "./report.ts";
import { HOW_TO_BUILD, staleness } from "./stale.ts";
import type { ToolRecord } from "../tools.ts";

/** Nothing is spawned after this is called. */
function refuse(code: number, lines: string[]): never {
  for (const l of lines) process.stderr.write(`${l}\n`);
  process.exit(code);
}

const argv = process.argv.slice(2);
const dashdash = argv.indexOf("--");
if (dashdash === -1 || dashdash === argv.length - 1) {
  refuse(64, ["usage: run.js [--pin <file>] [--pending <dir>] [--journal <file>] -- <command> [args...]"]);
}
const flags = argv.slice(0, dashdash);
const [command, ...args] = argv.slice(dashdash + 1);
const flag = (name: string): string | null => {
  const i = flags.indexOf(name);
  return i === -1 ? null : (flags[i + 1] ?? null);
};
const journalPath = flag("--journal");
const pinPath = flag("--pin");
const pendingDir = flag("--pending");
const started = Date.now();
const today = new Date().toISOString().slice(0, 10);

/* ── Before anything is spawned ─────────────────────────────────────────── */

const build = staleness();
if (!build.ok) {
  refuse(70, [
    `gate: ${build.because}.`,
    `gate: the server was not started. Build it and try again: ${HOW_TO_BUILD}`,
  ]);
}

let pin: Pin | null = null;
if (pinPath !== null) {
  if (!pinPath) refuse(64, ["gate: --pin needs a file path"]);
  try {
    pin = readPin(pinPath);
  } catch (e) {
    const why = e instanceof NotAPin ? e.message : (e as Error).message;
    refuse(78, [
      `gate: the pin at ${pinPath} cannot be used: ${why}.`,
      `gate: the server was not started, because a gate that cannot read its pin has nothing to compare a tool list against.`,
      `gate: write one with "node watch/cli.ts gate pin <package@version>", or pass a different --pin.`,
    ]);
  }
}

/* ── The journal and the report ─────────────────────────────────────────── */

if (journalPath) {
  mkdirSync(dirname(journalPath), { recursive: true });
  writeFileSync(journalPath, "");
}
if (pendingDir) mkdirSync(pendingDir, { recursive: true });

function note(n: Note): void {
  if (!journalPath) return;
  try {
    appendFileSync(journalPath, JSON.stringify(n) + "\n");
  } catch {
    /* A journal that cannot be written is not a reason to drop a message. */
  }
}

let reports = 0;
function reportOn(records: ToolRecord[], hidden: WouldHide[]): void {
  if (!pin || !pendingDir || !hidden.length) return;
  try {
    const pending = pendingOf(pin, records, hidden, today);
    const file = join(pendingDir, `${pin.package.replace(/[^A-Za-z0-9._@-]+/g, "--")}-${Date.now()}.json`);
    writeFileSync(file, JSON.stringify(pending, null, 2) + "\n");
    reports++;
    /* One line. A client's log is not where somebody's prose belongs. */
    process.stderr.write(`${stderrLine(pending, file)}\n`);
  } catch (e) {
    process.stderr.write(`gate: the report could not be written: ${(e as Error).message}\n`);
  }
}

const router = new Router({
  mode: "shadow",
  /* A pinned tool already carries exactly the four fields a baseline is. */
  baseline: pin ? Object.values(pin.tools).map((t) => ({ name: t.name, hash: t.hash, descriptionHash: t.descriptionHash, schemaHash: t.schemaHash })) : undefined,
  onList: reportOn,
});

/* ── The child ──────────────────────────────────────────────────────────── */

const child = spawn(command!, args, { stdio: ["pipe", "pipe", "pipe"], detached: true });

const observe = (side: Side) => (line: Line) => {
  for (const n of router.see(line, side)) note(n);
  return { pass: true } as const;
};
const readerFailed = (e: Error, line: Line) =>
  note({ kind: "unparsed-line", at: Date.now(), side: "server-to-client", bytes: line.raw.length, because: `the reader threw: ${e.message}` });

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
  const counts = Object.entries(router.summary())
    .map(([k, n]) => `${k}=${n}`)
    .sort()
    .join(" ");
  const against = pin ? `pin ${pin.package}@${pin.packageVersion} (${pin.source})` : "no pin: the first list seen";
  process.stderr.write(
    `gate: ${Date.now() - started}ms, ${router.baselineSize} tool(s) against ${against}, ${counts || "nothing to note"}` +
      `${reports ? `, ${reports} report(s)` : ""}\n${SHADOW_MEANS}\n`,
  );
  setTimeout(() => process.exit(signal ? 128 : (code ?? 0)), 10);
});
