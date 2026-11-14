/*
 * WHAT --verify-on-call COSTS A CALL, AND A SESSION.
 *
 * The flag holds a client's message while it asks the server for a tool
 * list. That is a real wait, paid by whoever is at the other end of the
 * client, so it is measured rather than estimated.
 *
 * Two numbers, and neither of them is one figure:
 *
 *   PER CALL. The same call three ways — flag off, flag on with the picture
 *   fresh, flag on with every call held (a window of zero). The spread is
 *   reported because a single number from one run on one machine says less
 *   than it looks: these move between runs here, and a real server across a
 *   real pipe is a different thing again.
 *
 *   PER SESSION. Twelve calls 60ms apart against a 200ms window, so some
 *   fall inside it and some do not. That is the figure a conversation
 *   actually pays, rather than the worst case multiplied by N.
 *
 * The three ways are interleaved within each round, so a machine that gets
 * busier partway through makes all of them slower rather than one of them.
 *
 * The server is the planted demo server, and the gate's own share is what
 * is measured. A real server's answer takes as long as it takes; the gate
 * adds one round trip to it.
 *
 * Run: node watch/gate/build.mjs && node watch/gate/verifycost.mjs [--rounds=N]
 */
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const GATE = join(HERE, "built", "gate", "run.js");
const DEMO = join(HERE, "fixtures", "demo-server.mjs");
const HOSTILE = join(HERE, "fixtures", "hostile-server.mjs");
const ROUNDS = Number((process.argv.find((a) => a.startsWith("--rounds=")) ?? "--rounds=12").slice(9));

const INIT = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "planted", version: "1" } } };
const READY = { jsonrpc: "2.0", method: "notifications/initialized" };
const list = (id) => ({ jsonrpc: "2.0", id, method: "tools/list" });
const callNamed = (id, name) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: {} } });
const call = (id) => callNamed(id, "demo_now");

const SUMMARY = /(\d+) check\(s\) before a call, (\d+)ms held in total/;

/**
 * Run one session, timing each tools/call from the moment it is written to
 * the moment its answer comes back. That is what a client waits.
 *
 * The script is walked one message at a time. A request waits for its
 * answer before the next message goes; a notification has no answer to
 * wait for, so it steps straight on — getting that wrong is what made an
 * earlier version of this file measure nothing at all.
 */
function session(args, calls, gapMs = 0, tool = "demo_now") {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { stdio: ["pipe", "pipe", "pipe"] });
    const sentAt = new Map();
    const waits = [];
    let err = "";
    let buf = "";
    let step = 0;
    child.stdin.on("error", () => {});
    child.stderr.on("data", (c) => (err += c.toString("utf8")));

    const script = [INIT, READY, list(2), ...Array.from({ length: calls }, (_, i) => callNamed(10 + i, tool))];
    const next = () => {
      if (step >= script.length) {
        setTimeout(() => {
          try {
            child.stdin.end();
          } catch {
            /* already gone */
          }
        }, 80);
        return;
      }
      const m = script[step++];
      setTimeout(() => {
        if (m.id !== undefined) sentAt.set(m.id, process.hrtime.bigint());
        try {
          child.stdin.write(JSON.stringify(m) + "\n");
        } catch {
          return;
        }
        /* A notification is never answered, so nothing will arrive to
         * prompt the next step. Step on now. */
        if (m.id === undefined) next();
      }, gapMs);
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (c) => {
      buf += c;
      let nl;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const l = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!l.trim()) continue;
        let msg;
        try {
          msg = JSON.parse(l);
        } catch {
          continue;
        }
        if (msg.id === undefined) continue;
        const at = sentAt.get(msg.id);
        if (at === undefined) continue;
        if (typeof msg.id === "number" && msg.id >= 10) waits.push(Number(process.hrtime.bigint() - at) / 1e6);
        next();
      }
    });
    child.on("exit", () => setTimeout(() => resolve({ waits, stderr: err }), 60));
    setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
    }, 30_000);
    next();
  });
}

const stats = (xs) => {
  const s = [...xs].filter((x) => typeof x === "number").sort((a, b) => a - b);
  if (!s.length) return null;
  const at = (p) => s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
  return { n: s.length, min: +s[0].toFixed(1), median: +at(50).toFixed(1), p90: +at(90).toFixed(1), max: +s[s.length - 1].toFixed(1) };
};
const gap = (a, b, k) => (a && b ? +(a[k] - b[k]).toFixed(1) : null);

const pinFile = join(mkdtempSync(join(tmpdir(), "verifycost-")), "pin.json");
await session([GATE, "--write-pin", pinFile, "--package", "brydge-demo-server@1.0.0", "--", process.execPath, DEMO, "--mode=baseline"], 0);

const base = [GATE, "--pin", pinFile, "--mode", "enforce", "--", process.execPath, DEMO, "--mode=baseline"];
const checking = (windowMs) => [
  GATE, "--pin", pinFile, "--mode", "enforce", "--verify-on-call", "--verify-window", String(windowMs),
  "--", process.execPath, DEMO, "--mode=baseline",
];

/* ── Per call ───────────────────────────────────────────────────────────── */

const off = [];
const fresh = [];
const held = [];
for (let r = 0; r < ROUNDS; r++) {
  off.push(...(await session(base, 3)).waits);
  /* Ten seconds: the client's own tools/list was a moment ago, so the
   * picture is fresh and no call is held. */
  fresh.push(...(await session(checking(10_000), 3)).waits);
  /* Zero: every call finds the picture stale, so every call is held. */
  held.push(...(await session(checking(0), 3)).waits);
}

/* ── Per session ────────────────────────────────────────────────────────── */

const sessions = [];
for (let r = 0; r < ROUNDS; r++) {
  const run = await session(checking(200), 12, 60);
  const m = SUMMARY.exec(run.stderr);
  sessions.push({
    calls: run.waits.length,
    checks: m ? Number(m[1]) : null,
    heldMs: m ? Number(m[2]) : null,
    waitedMs: +run.waits.reduce((a, b) => a + b, 0).toFixed(1),
  });
}

/* ── A hold against a server that takes its time ────────────────────────── */

/*
 * The figures above come from a planted server on the same machine, which
 * answers a tool list in well under a millisecond. They are the gate's own
 * share and nothing else. A hold lasts as long as the SERVER takes to
 * answer, so here is the same hold against the planted hostile server's
 * `relist-slow` case, which sits on the answer for 1200ms before giving it.
 *
 * Whether the call is then forwarded or refused does not matter to this
 * number: either way it is what the client waited.
 */
const slowPin = join(mkdtempSync(join(tmpdir(), "verifycost-slow-")), "pin.json");
await session([GATE, "--write-pin", slowPin, "--package", "brydge-hostile@1.0.0", "--", process.execPath, HOSTILE, "--case=plain"], 0, 0, "read_file");
const slow = [];
for (let r = 0; r < 3; r++) {
  const run = await session(
    [GATE, "--pin", slowPin, "--mode", "enforce", "--verify-on-call", "--verify-window", "0", "--verify-timeout", "5000",
      "--", process.execPath, HOSTILE, "--case=relist-slow"],
    1, 0, "read_file",
  );
  slow.push(...run.waits);
}

const S = { off: stats(off), fresh: stats(fresh), held: stats(held) };
console.log(
  JSON.stringify(
    {
      rounds: ROUNDS,
      per_call_ms: { flag_off: S.off, flag_on_picture_fresh: S.fresh, flag_on_every_call_held: S.held },
      added_by_a_hold_ms: { min: gap(S.held, S.off, "min"), median: gap(S.held, S.off, "median"), p90: gap(S.held, S.off, "p90"), max: gap(S.held, S.off, "max") },
      added_with_the_picture_fresh_ms: { median: gap(S.fresh, S.off, "median"), p90: gap(S.fresh, S.off, "p90") },
      hold_against_a_server_that_takes_1200ms_to_answer_ms: stats(slow),
      per_session: {
        calls: stats(sessions.map((s) => s.calls)),
        checks_made: stats(sessions.map((s) => s.checks)),
        held_ms_in_total: stats(sessions.map((s) => s.heldMs)),
        client_waited_ms_in_total: stats(sessions.map((s) => s.waitedMs)),
      },
      note_on_the_slow_case: "A hold lasts as long as the server takes to answer its tool list, up to --verify-timeout. The gate's own share is the small figure; the server's answer is the rest.",
      note: "Spread, not one figure. These move between runs on one machine; a real server across a real pipe is a different thing again. What is measured is the gate's own share.",
    },
    null,
    2,
  ),
);
