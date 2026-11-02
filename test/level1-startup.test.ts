import { test } from "node:test";
import assert from "node:assert/strict";
import { startupOf, humanMs, DEFINITION } from "../level1/startup.ts";

/*
 * ═══════════════════════════════════════════════════════════════════════════
 * A STARTUP TIME IS A SUBTRACTION, AND EVERY WAY IT CAN LIE IS CHEAP TO TEST.
 *
 * The figure comes from two timestamps taken in different places — a traced
 * syscall and a JSON-RPC message — so the ways it goes wrong are not arithmetic
 * errors. They are: timing from the wrong exec, matching the wrong reply,
 * printing a number for a server that never answered, and printing a negative
 * duration as a fast start. Each has a test below.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const SETPRIV = { t: 1000, syscall: "exec" as const, path: "/usr/bin/setpriv", result: 0 };

/** A session as `harness/session.ts` stores one, with the parts this reads. */
const session = (trace: unknown[], transcript: unknown[]) => ({ trace, transcript });

const init = (t: number) => ({ t, dir: "to-server", message: { jsonrpc: "2.0", id: 1, method: "initialize" } });
const initReply = (t: number) => ({ t, dir: "from-server", message: { jsonrpc: "2.0", id: 1, result: { serverInfo: {} } } });
const list = (t: number) => ({ t, dir: "to-server", message: { jsonrpc: "2.0", id: 2, method: "tools/list" } });
const listReply = (t: number) => ({ t, dir: "from-server", message: { jsonrpc: "2.0", id: 2, result: { tools: [] } } });

test("the two anchors subtract to the figures the page prints", () => {
  const s = startupOf(session([SETPRIV], [init(1010), initReply(1400), list(1405), listReply(1900)]));
  assert.ok(s);
  assert.equal(s.startedAt, 1000);
  assert.equal(s.answeredAt, 1900);
  assert.equal(s.toToolListMs, 900);
  assert.equal(s.toInitializeMs, 400);
  /* The definition travels with the number, so a page cannot restate it. */
  assert.equal(s.definition, DEFINITION);
  assert.equal(s.underKernelTrace, true);
  assert.equal(s.runs, 1);
});

test("timing starts at setpriv, not at the server's own exec a step later", () => {
  /* Between the two sits dropping to an unprivileged id, which is part of how
   * this is measured and belongs on our side of the line. */
  const serverExec = { t: 1200, syscall: "exec" as const, path: "/srv/x/install/node_modules/.bin/thing", result: 0 };
  const s = startupOf(session([SETPRIV, serverExec], [init(1010), listReply(1900)]));
  assert.equal(s?.startedAt, 1000, "timed from the server's exec, which hides 200 ms of our own work");
});

test("a failed setpriv is not a process start", () => {
  const failed = { t: 900, syscall: "exec" as const, path: "/usr/bin/setpriv", result: -1 };
  assert.equal(startupOf(session([failed], [listReply(1900)])), null);
});

test("no traced process start means no startup time, not zero", () => {
  /* A page that printed 0 ms here would state a measurement never made. */
  assert.equal(startupOf(session([], [init(10), listReply(900)])), null);
  assert.equal(startupOf({}), null);
});

test("a server that never answered keeps its start and reports no duration", () => {
  const s = startupOf(session([SETPRIV], [init(1010)]));
  assert.ok(s);
  assert.equal(s.startedAt, 1000);
  assert.equal(s.answeredAt, null);
  assert.equal(s.toToolListMs, null);
  assert.equal(s.toInitializeMs, null);
});

test("it answered initialize and then went quiet: one figure, not both", () => {
  const s = startupOf(session([SETPRIV], [init(1010), initReply(1300), list(1310)]));
  assert.equal(s?.toInitializeMs, 300);
  assert.equal(s?.toToolListMs, null, "no reply to tools/list, so no figure for it");
});

test("the reply is matched by id, not by being the last thing on the wire", () => {
  /* Servers interleave log notifications and progress between a request and
   * its reply. Taking the last `from-server` message would time to whichever
   * of those arrived last. */
  const noise = { t: 1500, dir: "from-server", message: { jsonrpc: "2.0", method: "notifications/message", params: { data: "ready" } } };
  const later = { t: 2500, dir: "from-server", message: { jsonrpc: "2.0", method: "notifications/message", params: { data: "idle" } } };
  const s = startupOf(session([SETPRIV], [init(1010), initReply(1200), list(1210), noise, listReply(1800), later]));
  assert.equal(s?.toToolListMs, 800);
});

test("an error reply to tools/list is still an answer, and is timed", () => {
  const err = { t: 1700, dir: "from-server", message: { jsonrpc: "2.0", id: 2, error: { code: -32601, message: "no" } } };
  const s = startupOf(session([SETPRIV], [init(1010), list(1210), err]));
  assert.equal(s?.toToolListMs, 700, "it took 700 ms to say no, which is how long it took");
});

test("a reply timestamped before the process start is reported as nothing", () => {
  /* Two clocks: strace's and the client's. If they disagree, saying nothing is
   * right and printing -40 ms as a very fast start is not. */
  const s = startupOf(session([SETPRIV], [init(1010), list(1020), listReply(960)]));
  assert.equal(s?.answeredAt, 960);
  assert.equal(s?.toToolListMs, null);
});

test("stderr and stdout noise are not replies", () => {
  const junk = [
    { t: 1100, dir: "stderr", message: "listening" },
    { t: 1150, dir: "stdout-noise", message: '{"id":2,"result":{}}' },
  ];
  const s = startupOf(session([SETPRIV], [init(1010), list(1050), ...junk]));
  assert.equal(s?.toToolListMs, null, "a server printing a reply-shaped line to stdout has not replied");
});

test("durations read as a person would say them", () => {
  assert.equal(humanMs(0), "0 ms");
  assert.equal(humanMs(940), "940 ms");
  assert.equal(humanMs(1240), "1.2 s");
  assert.equal(humanMs(9949), "9.9 s");
  assert.equal(humanMs(12400), "12 s");
});
