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
import { ADOPTED, NotAPin, read as readPin, type Pin } from "./pin.ts";
import { Enforcer, enforcingLine, hidLine } from "./enforce.ts";
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
/*
 * SHADOW IS THE DEFAULT AND STAYS THE DEFAULT. Enforcement happens only
 * when somebody types it: a gate that started hiding things because of a
 * config it inherited would be the opposite of the point.
 */
const mode = flag("--mode") ?? "shadow";
if (mode !== "shadow" && mode !== "enforce") {
  refuse(64, [`gate: --mode is shadow or enforce, not ${JSON.stringify(mode)}`]);
}
const onBadPin = (flags.find((f) => f.startsWith("--on-bad-pin=")) ?? "--on-bad-pin=refuse").slice(13);
if (onBadPin !== "refuse" && onBadPin !== "empty") {
  refuse(64, [`gate: --on-bad-pin is refuse or empty, not ${JSON.stringify(onBadPin)}`]);
}
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

const HOW_TO_APPROVE =
  "To approve it: read the report this gate writes, then run " +
  '"node watch/cli.ts gate approve --pending <report> --decisions-from <decisions>".';

let pin: Pin | null = null;
let emptyPin = false;
if (pinPath !== null) {
  if (!pinPath) refuse(64, ["gate: --pin needs a file path"]);
  try {
    pin = readPin(pinPath);
  } catch (e) {
    const why = e instanceof NotAPin ? e.message : (e as Error).message;
    if (onBadPin === "empty") {
      /*
       * The opt-in. The pin is treated as naming nothing, so in enforce
       * mode every tool differs from it and none is passed on. It is the
       * other way to fail closed, for somebody who would rather the client
       * see a server with no tools than a server that did not start.
       */
      emptyPin = true;
      pin = {
        format: "brydge-gate-pin",
        version: 1,
        package: "unknown",
        packageVersion: "unknown",
        pinnedAt: today,
        source: ADOPTED,
        tools: {},
      };
      process.stderr.write(
        `gate: the pin at ${pinPath} cannot be used: ${why}.\n` +
          `gate: --on-bad-pin=empty was given, so it is treated as naming no tools. ` +
          `In enforce mode that means nothing is passed to the client. Repair it with ` +
          `"node watch/cli.ts gate pin <package@version>".\n`,
      );
    } else {
      refuse(78, [
        `gate: the pin at ${pinPath} cannot be used: ${why}.`,
        `gate: the server was not started, because a gate that cannot read its pin has nothing to compare a tool list against.`,
        `gate: write one with "node watch/cli.ts gate pin <package@version>", or pass a different --pin, or pass --on-bad-pin=empty to start with nothing pinned.`,
      ]);
    }
  }
}

/*
 * Enforcing against nothing would hide everything the server has, which is
 * not what anybody means by it.
 */
if (mode === "enforce" && !pin) {
  refuse(64, [
    "gate: --mode enforce needs --pin <file>: without one there is nothing to compare a tool list against,",
    "gate: and every tool would differ from it. The server was not started.",
  ]);
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

const enforcer =
  mode === "enforce" && pin
    ? new Enforcer({
        howToApprove: HOW_TO_APPROVE,
        pinFile: pinPath ?? "(none)",
        onHide: (hidden, shown) => process.stderr.write(`${hidLine(hidden, shown)}\n`),
        onRefuse: (tool, why) =>
          process.stderr.write(
            `gate: did not forward a call to "${tool}" (${why.kind === "withdrawn" ? "no longer offered by the server" : why.because}).\n`,
          ),
        onFailClosed: (because) => process.stderr.write(`gate: failing closed: ${because}\n`),
      })
    : null;

const router = new Router({
  mode,
  /* A pinned tool already carries exactly the four fields a baseline is. */
  baseline: pin ? Object.values(pin.tools).map((t) => ({ name: t.name, hash: t.hash, descriptionHash: t.descriptionHash, schemaHash: t.schemaHash })) : undefined,
  onList: (records, hidden) => {
    enforcer?.noteList(records, hidden);
    reportOn(records, hidden);
  },
});

if (enforcer && pin) {
  process.stderr.write(`${enforcingLine(pin, pinPath ?? "(none)")}\n`);
  if (emptyPin) process.stderr.write(`gate: that pin names no tools, so no tool will be passed to the client.\n`);
}

/* ── The child ──────────────────────────────────────────────────────────── */

const child = spawn(command!, args, { stdio: ["pipe", "pipe", "pipe"], detached: true });

/**
 * Ending because something failed closed, rather than because the server
 * finished. The child's exit handler reads it: killing the child makes it
 * exit on a signal, and without this the exit code would say "the server
 * was signalled" instead of "the gate ended the session".
 */
let stopping = false;

/** Nothing is spawned after this; the child is already running, so it goes. */
function stop(because: string): void {
  stopping = true;
  process.stderr.write(`gate: ${because}\n`);
  process.stderr.write(`gate: the session is ending. Nothing further was passed in either direction.\n`);
  try {
    if (child.pid) process.kill(-child.pid, "SIGTERM");
  } catch {
    /* already gone */
  }
  setTimeout(() => process.exit(78), 50);
}

const observe = (side: Side) => (line: Line) => {
  /*
   * The router sees every line in both modes: the journal and the report
   * are the same in enforce as in shadow. Only the action differs.
   */
  for (const n of router.see(line, side)) note(n);
  if (!enforcer) return { pass: true } as const;

  const action = side === "client-to-server" ? enforcer.fromClient(line) : enforcer.fromServer(line);
  if (action.forward) return { pass: true } as const;
  if (action.stop) {
    stop(action.stop);
    return { pass: false, drop: true } as const;
  }
  if (action.replaceWith) return { pass: false, replaceWith: action.replaceWith } as const;
  if (action.replyToClient) {
    /* Back to the client, not on to the server. The only bytes this gate
     * ever writes to stdout that did not come from the server. */
    process.stdout.write(Buffer.concat([action.replyToClient, Buffer.from("\n")]));
    return { pass: false, drop: true } as const;
  }
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
  const said = enforcer ? `enforce, ${enforcer.hiddenCount} hidden` : "shadow";
  process.stderr.write(
    `gate: ${Date.now() - started}ms, ${said}, ${router.baselineSize} tool(s) against ${against}, ${counts || "nothing to note"}` +
      `${reports ? `, ${reports} report(s)` : ""}\n${enforcer ? "" : `${SHADOW_MEANS}\n`}`,
  );
  setTimeout(() => process.exit(stopping ? 78 : signal ? 128 : (code ?? 0)), 10);
});
