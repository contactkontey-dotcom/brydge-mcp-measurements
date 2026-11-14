/*
 * V2: checking the tool list before a call goes through.
 *
 * The policy is tested on the Verifier, which holds a clock it is given
 * and sends through a function it is given, so every branch can be driven
 * without a server. The behaviour is then tested end to end against the
 * planted hostile server and the planted demo server. No other project's
 * code is started, and no description is printed.
 *
 * This is the one feature that makes a client's message wait, so four of
 * the tests below are about nothing but releasing it again: the server
 * dying mid-check, the client closing its input mid-hold, a second call
 * arriving behind a held one, and the budget running out.
 */
import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Lister, reservedId, VERIFY_BUDGET } from "../watch/gate/relist.ts";
import { announcement, askedLine, failedLine, TIMEOUT_MS, Verifier, WINDOW_MS } from "../watch/gate/verify.ts";
import { CONTAINMENT, flatten, GATEKEEPING } from "./banned.ts";

/* ── The policy, on a clock ─────────────────────────────────────────────── */

/** A verifier whose clock a test moves by hand, and whose sends it records. */
function verifierAt(over: { window?: number; timeout?: number } = {}) {
  let t = 1_000_000;
  const sent: string[] = [];
  const outcomes: Array<{ outcome: string; ms: number }> = [];
  const lister = new Lister({ now: () => t });
  lister.sawClient({ jsonrpc: "2.0", method: "notifications/initialized" });
  const v = new Verifier({
    lister,
    window: over.window ?? WINDOW_MS,
    timeout: over.timeout ?? 40,
    now: () => t,
    inject: (payload) => sent.push(String((JSON.parse(payload.toString("utf8")) as { id: unknown }).id)),
    onOutcome: (outcome, ms) => outcomes.push({ outcome, ms }),
  });
  return { v, lister, sent, outcomes, tick: (ms: number) => (t += ms), at: () => t };
}

test("a picture inside the window is not checked, and nothing waits", async () => {
  const { v, sent, tick } = verifierAt({ window: 10_000 });
  v.pictureSeen();
  tick(9_999);
  assert.equal(v.stale(), false);
  assert.equal(await v.ensureFresh(), "fresh");
  assert.deepEqual(sent, [], "it asked although the picture was fresh");
  assert.equal(v.callsHeld, 0, "it held a call although the picture was fresh");
  assert.equal(v.checksMade, 0);
});

test("a picture older than the window is checked, and the wait ends when a list arrives", async () => {
  /* A generous timeout: this test is about reaching "checked", not about
   * the clock. A short one here is load-sensitive, and a unit test that
   * fails because the machine is busy is worse than no test. */
  const { v, sent, tick, outcomes } = verifierAt({ window: 10_000, timeout: 10_000 });
  v.pictureSeen();
  tick(10_000);
  assert.equal(v.stale(), true);
  const held = v.ensureFresh("demo_add");
  await new Promise((d) => setImmediate(d));
  assert.deepEqual(sent, [reservedId(1)], "it did not ask");
  /* The answer arriving is what ends the wait. */
  v.pictureSeen();
  assert.equal(await held, "checked");
  assert.equal(v.callsHeld, 1);
  assert.deepEqual(outcomes.map((o) => o.outcome), ["checked"]);
});

test("no answer in time is a timeout", async () => {
  const { v, sent } = verifierAt({ timeout: 30 });
  assert.equal(await v.ensureFresh(), "timed-out");
  assert.deepEqual(sent, [reservedId(1)]);
});

test("a call before the client has finished starting up is not checked and not a failure", async () => {
  let t = 1_000;
  const lister = new Lister({ now: () => t });
  const sent: string[] = [];
  const v = new Verifier({ lister, window: 10, timeout: 20, now: () => t, inject: (p) => sent.push(String(p)) });
  /* No notifications/initialized has been seen. */
  assert.equal(await v.ensureFresh(), "not-started");
  assert.deepEqual(sent, [], "it asked before the client had finished starting up");
  assert.equal(v.callsHeld, 0, "it held a call before the client had finished starting up");
});

test("one request already outstanding is waited for, not doubled", async () => {
  /*
   * A list the gate asked for on a notification is on its way. Its answer
   * refreshes the picture just as well, so sending a second would be
   * traffic for nothing — and refusing over it would be a false refusal.
   */
  const { v, lister, sent } = verifierAt({ timeout: 10_000 });
  const first = lister.consider();
  assert.ok(first.ask);
  const held = v.ensureFresh();
  await new Promise((d) => setImmediate(d));
  assert.deepEqual(sent, [], "it sent a second request while one was outstanding");
  assert.equal(v.callsHeld, 1, "it did not wait");
  v.pictureSeen();
  assert.equal(await held, "checked");
});

test("the budget is twenty, and past it a call is treated as a timeout", async () => {
  const { v, sent, lister, tick } = verifierAt({ timeout: 10 });
  for (let i = 0; i < VERIFY_BUDGET; i++) {
    /* Each one times out, so the next is free to ask again. */
    assert.equal(await v.ensureFresh(), "timed-out", `check ${i + 1} did not time out`);
    tick(TIMEOUT_MS);
  }
  assert.equal(sent.length, VERIFY_BUDGET, `it sent ${sent.length} requests for a budget of ${VERIFY_BUDGET}`);
  assert.equal(lister.checksCount, VERIFY_BUDGET);
  /* Past the budget: nothing is sent and nothing waits, and the answer is
   * the same as a timeout's so the caller has one thing to handle. */
  assert.equal(await v.ensureFresh(), "no-budget");
  assert.equal(sent.length, VERIFY_BUDGET, "it asked past its budget");
  const said = lister.verifyCapLine();
  assert.equal(said, null, "the budget line was not already said");
});

test("the budget's line is said once, when it runs out", () => {
  let t = 0;
  const lister = new Lister({ now: () => t });
  lister.sawClient({ jsonrpc: "2.0", method: "notifications/initialized" });
  let said: string | null = null;
  for (let i = 0; i < VERIFY_BUDGET; i++) {
    assert.ok(lister.considerVerify(1).ask, `declined at ${i + 1}`);
    t += 10;
    const now = lister.verifyCapLine();
    if (i + 1 < VERIFY_BUDGET) {
      /* Not a word before it runs out: a gate announcing a budget it has
       * not spent would be telling somebody it had stopped checking. */
      assert.equal(now, null, `it said it at ${i + 1} of ${VERIFY_BUDGET}`);
    } else {
      said = now;
    }
  }
  assert.ok(said, "the budget ran out and nothing was said");
  assert.match(said!, new RegExp(`before a call ${VERIFY_BUDGET} times`));
  assert.match(said!, /treated as one whose check timed out/);
  assert.equal(lister.verifyCapLine(), null, "it said it twice");
});

test("what it says names the gate, the cost and the hold, and claims nothing", () => {
  const enforcing = announcement(10_000, 3_000, "refuse", true);
  const forwarding = announcement(10_000, 3_000, "forward", true);
  const shadow = announcement(10_000, 3_000, "refuse", false);
  assert.match(enforcing, /--verify-on-call is on/);
  assert.match(enforcing, /HOLDS the call — and everything the client sends behind it/);
  assert.match(enforcing, /the one place a client's message waits on this gate/);
  assert.match(enforcing, /If no answer comes in time the call is not forwarded/);
  assert.match(forwarding, /--on-verify-timeout=forward was given/);
  /* Shadow says it refuses nothing, which is the decision it rests on. */
  assert.match(shadow, /This is shadow mode, so nothing is refused whatever the check finds/);

  const text = [enforcing, forwarding, shadow, askedLine(reservedId(1), 10_000), failedLine("timed-out", 3_000, true, "refuse"), failedLine("no-budget", 0, false, "forward")].join("\n");
  const flat = flatten(text);
  for (const w of [...CONTAINMENT, ...GATEKEEPING]) assert.ok(!flat.includes(w), `it says "${w}"`);
});

/* ── Driven, against the planted servers ────────────────────────────────── */

const ROOT = join(import.meta.dirname, "..");
const HOSTILE = join(ROOT, "watch", "gate", "fixtures", "hostile-server.mjs");
const DEMO = join(ROOT, "watch", "gate", "fixtures", "demo-server.mjs");

const { build } = (await import("../watch/gate/build.mjs")) as unknown as {
  build: (o: { out: string }) => { files: string[] };
};
const BUILD_DIR = mkdtempSync(join(tmpdir(), "gate-verify-build-"));
build({ out: BUILD_DIR });
const GATE = join(BUILD_DIR, "gate", "run.js");

interface Ran {
  answers: Array<Record<string, any>>;
  order: unknown[];
  notices: string[];
  stderr: string;
  code: number | null;
}

/** Drive it to a script, with real pauses. */
function run(args: string[], script: Array<unknown | { wait: number }>, capMs = 60_000): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { stdio: ["pipe", "pipe", "pipe"] });
    const answers: Array<Record<string, any>> = [];
    const order: unknown[] = [];
    const notices: string[] = [];
    let err = "";
    let buf = "";
    let settled = false;
    child.stdin.on("error", () => {});
    child.stderr.on("data", (c: Buffer) => (err += c.toString("utf8")));
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      resolve({ answers, order, notices, stderr: err, code });
    };
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (c: string) => {
      buf += c;
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const l = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!l.trim()) continue;
        let m: Record<string, any>;
        try {
          m = JSON.parse(l) as Record<string, any>;
        } catch {
          continue;
        }
        if (m.id === undefined) notices.push(String(m.method));
        else {
          answers.push(m);
          order.push(m.id);
        }
      }
    });
    child.on("exit", (code) => setTimeout(() => finish(code), 200));
    void (async () => {
      for (const step of script) {
        if (step && typeof step === "object" && "wait" in step) {
          await new Promise((d) => setTimeout(d, (step as { wait: number }).wait));
          continue;
        }
        child.stdin.write(JSON.stringify(step) + "\n");
        await new Promise((d) => setTimeout(d, 40));
      }
      await new Promise((d) => setTimeout(d, 200));
      try {
        child.stdin.end();
      } catch {
        /* gone */
      }
    })();
    setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* gone */
      }
      finish(null);
    }, capMs);
  });
}

const INIT = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "planted", version: "1" } } };
const READY = { jsonrpc: "2.0", method: "notifications/initialized" };
const listMsg = (id: number) => ({ jsonrpc: "2.0", id, method: "tools/list" });
const callMsg = (id: number, name: string) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: {} } });
const VERIFY = "--verify-on-call";

/** A pin adopted from whatever a planted server offers on its first list. */
async function pinFor(server: string, args: string[] = []): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "gate-verify-pin-"));
  const pin = join(dir, "pin.json");
  const r = await run([GATE, "--write-pin", pin, "--package", "planted@0.0.0", "--", process.execPath, server, ...args], [INIT, READY, listMsg(2), { wait: 300 }]);
  assert.ok(existsSync(pin), `no pin for ${server}:\n${r.stderr}`);
  return pin;
}

/* ── THE CASE V2 EXISTS FOR ─────────────────────────────────────────────── */

test("a silent rewording is caught before the call, with no notification and no re-list", { timeout: 120_000 }, async () => {
  /*
   * reworded-silent: the server changes a description and says nothing.
   * The client lists ONCE. Before this flag the call went through to a
   * server whose words had changed, and the README said so as the limit
   * of the whole approach. This is that limit closed.
   */
  const pin = await pinFor(DEMO, ["--mode=baseline"]);
  const r = await run(
    [GATE, "--pin", pin, "--mode", "enforce", VERIFY, "--verify-window", "400", "--", process.execPath, DEMO, "--mode=reworded-silent", "--drop-after=300"],
    [INIT, READY, listMsg(2), { wait: 900 }, callMsg(3, "demo_add")],
  );
  assert.equal(r.notices.length, 0, "the silent mode announced something");
  assert.equal(r.answers.filter((m) => m.result?.tools).length, 1, "the client listed more than once");
  assert.match(r.stderr, /asked the server for a tool list before forwarding a call \(brydge-gate\/1\)/);
  const said = r.answers.find((m) => m.id === 3)!;
  assert.equal(said.error?.code, -32000, `the call was forwarded: ${JSON.stringify(said)}`);
  assert.match(said.error.message, /"demo_add" is hidden, because its description differs from the baseline/);
});

test("with the flag off, the same session forwards that call", { timeout: 120_000 }, async () => {
  const pin = await pinFor(DEMO, ["--mode=baseline"]);
  const r = await run(
    [GATE, "--pin", pin, "--mode", "enforce", "--", process.execPath, DEMO, "--mode=reworded-silent", "--drop-after=300"],
    [INIT, READY, listMsg(2), { wait: 900 }, callMsg(3, "demo_add")],
  );
  /* It was forwarded: the server answered it. What it answered is the
   * server's business — these calls carry no arguments. */
  assert.ok(r.answers.find((m) => m.id === 3)?.result, "the call was not forwarded without the flag");
  assert.ok(!/before forwarding a call/.test(r.stderr));
});

/* ── The four ways a hold must end ──────────────────────────────────────── */

test("the server dying mid-check ends the session with a clear line, and does not hang", { timeout: 120_000 }, async () => {
  /*
   * relist-die exits when it is asked for a list under one of the gate's
   * ids. The answer the held call is waiting for is never coming, so the
   * gate says so and goes: a client whose transport closes knows the
   * session is over, where one left waiting knows nothing.
   */
  const pin = await pinFor(HOSTILE, ["--case=plain"]);
  const began = Date.now();
  const r = await run(
    [GATE, "--pin", pin, "--mode", "enforce", VERIFY, "--verify-window", "100", "--verify-timeout", "20000", "--", process.execPath, HOSTILE, "--case=relist-die"],
    [INIT, READY, listMsg(2), { wait: 300 }, callMsg(3, "read_file")],
    40_000,
  );
  const took = Date.now() - began;
  /* It went, and it did not sit out the 20s timeout to do it. */
  assert.notEqual(r.code, null, "the gate had to be killed: it hung");
  assert.ok(took < 20_000, `it took ${took}ms, which is the timeout rather than the exit`);
  assert.match(r.stderr, /the server exited while a call was waiting for the tool list check it asked for \(brydge-gate\/1\)/);
  assert.match(r.stderr, /That answer is not coming, so the session is ending rather than waiting for it/);
});

test("the client closing its input during a hold still ends the session", { timeout: 120_000 }, async () => {
  /*
   * The client sends a call and immediately closes its input. The hold is
   * open; the flush that closes the server's input cannot run until it
   * releases. Nothing may be lost and nothing may hang.
   */
  const pin = await pinFor(HOSTILE, ["--case=plain"]);
  const r = await run(
    [GATE, "--pin", pin, "--mode", "enforce", VERIFY, "--verify-window", "100", "--verify-timeout", "400", "--", process.execPath, HOSTILE, "--case=relist-ignore"],
    [INIT, READY, listMsg(2), { wait: 300 }, callMsg(3, "read_file")],
    30_000,
  );
  assert.notEqual(r.code, null, "the gate hung when the client closed its input mid-hold");
  /* The held call was answered — a refusal, since nothing came back. */
  const said = r.answers.find((m) => m.id === 3);
  assert.ok(said, "the held call was never answered");
  assert.equal(said!.error?.code, -32000);
  assert.match(said!.error.message, /it asked the server for its current tool list before passing this on/);
});

test("a second call behind a held one waits, keeps its place, and starts no second check", { timeout: 120_000 }, async () => {
  /*
   * The order a client sent things in is kept by the stream: the second
   * call is not even read while the first is held. By the time it is, the
   * picture is fresh, so it is not held at all — one check, not two.
   */
  const pin = await pinFor(HOSTILE, ["--case=relist-slow"]);
  const r = await run(
    [GATE, "--pin", pin, "--mode", "enforce", VERIFY, "--verify-window", "200", "--verify-timeout", "5000", "--", process.execPath, HOSTILE, "--case=relist-slow"],
    [INIT, READY, listMsg(2), { wait: 400 }, callMsg(3, "list_dir"), callMsg(4, "list_dir"), callMsg(5, "list_dir"), { wait: 2_500 }],
    40_000,
  );
  /* Exactly one check, for three calls inside one window. */
  const checks = [...r.stderr.matchAll(/asked the server for a tool list before forwarding a call/g)].length;
  assert.equal(checks, 1, `${checks} checks for three calls inside one window`);
  /* And the answers came back in the order the calls went out. */
  const calls = r.order.filter((id) => typeof id === "number" && id >= 3);
  assert.deepEqual(calls, [3, 4, 5], `the answers came back as ${calls.join(", ")}`);
});

test("past its budget a call is treated as one whose check timed out", { timeout: 180_000 }, async () => {
  /*
   * relist-ignore never answers a list asked under one of the gate's ids,
   * so every check times out and the budget burns down. The twenty-first
   * call is refused for the same reason, and the budget says so once.
   */
  const pin = await pinFor(HOSTILE, ["--case=plain"]);
  const calls: unknown[] = [];
  for (let i = 0; i < VERIFY_BUDGET + 1; i++) calls.push(callMsg(10 + i, "list_dir"));
  const r = await run(
    [GATE, "--pin", pin, "--mode", "enforce", VERIFY, "--verify-window", "0", "--verify-timeout", "60", "--", process.execPath, HOSTILE, "--case=relist-ignore"],
    [INIT, READY, listMsg(2), { wait: 200 }, ...calls, { wait: 500 }],
    120_000,
  );
  const asked = [...r.stderr.matchAll(/asked the server for a tool list before forwarding a call/g)].length;
  assert.equal(asked, VERIFY_BUDGET, `it asked ${asked} times for a budget of ${VERIFY_BUDGET}`);
  assert.match(r.stderr, new RegExp(`before a call ${VERIFY_BUDGET} times`));
  assert.equal([...r.stderr.matchAll(/before a call \d+ times/g)].length, 1, "the budget line was said more than once");
  /* Every call was answered, the last one included, and all refused. */
  const answered = r.answers.filter((m) => typeof m.id === "number" && m.id >= 10);
  assert.equal(answered.length, VERIFY_BUDGET + 1, `${answered.length} of ${VERIFY_BUDGET + 1} calls were answered`);
  for (const m of answered) assert.equal(m.error?.code, -32000, `call ${m.id} was forwarded`);
});

/* ── The hostile server's other answers ─────────────────────────────────── */

test("a slow list inside the timeout is waited for, and the call then goes on its merits", { timeout: 120_000 }, async () => {
  const pin = await pinFor(HOSTILE, ["--case=relist-slow"]);
  const r = await run(
    [GATE, "--pin", pin, "--mode", "enforce", VERIFY, "--verify-window", "200", "--verify-timeout", "5000", "--", process.execPath, HOSTILE, "--case=relist-slow"],
    [INIT, READY, listMsg(2), { wait: 400 }, callMsg(3, "list_dir"), { wait: 2_500 }],
    40_000,
  );
  assert.ok(!/check did not finish/.test(r.stderr), `it gave up on a list that was coming:\n${r.stderr}`);
  /* list_dir is in the pin and unchanged, so the call goes through. */
  assert.ok(r.answers.find((m) => m.id === 3)?.result, "a call to an unchanged tool was not forwarded");
  /* And the cost is written down. */
  assert.match(r.stderr, /1 check\(s\) before a call, \d+ms held in total/);
});

test("no answer at all refuses by default, and forwards with the opt-out", { timeout: 120_000 }, async () => {
  const pin = await pinFor(HOSTILE, ["--case=plain"]);
  const script = [INIT, READY, listMsg(2), { wait: 300 }, callMsg(3, "list_dir"), { wait: 400 }];
  const base = [GATE, "--pin", pin, "--mode", "enforce", VERIFY, "--verify-window", "100", "--verify-timeout", "200"];

  const refused = await run([...base, "--", process.execPath, HOSTILE, "--case=relist-ignore"], script);
  const said = refused.answers.find((m) => m.id === 3)!;
  assert.equal(said.error?.code, -32000, `the call went through: ${JSON.stringify(said)}`);
  assert.match(said.error.message, /it asked the server for its current tool list before passing this on, and no answer came back in time/);
  assert.equal(said.error.data.reason, "the tool list could not be checked before this call");
  assert.match(refused.stderr, /The call was not forwarded/);

  const forwarded = await run([...base, "--on-verify-timeout=forward", "--", process.execPath, HOSTILE, "--case=relist-ignore"], script);
  assert.ok(forwarded.answers.find((m) => m.id === 3)?.result, "the opt-out did not forward the call");
  assert.match(forwarded.stderr, /The call was forwarded anyway/);
});

test("a storm of notifications does not stop a call being checked", { timeout: 120_000 }, async () => {
  /*
   * relist-many sends sixty notifications. With --relist-on-change those
   * use that flag's budget; the verification budget is counted apart, so
   * a call still gets its check.
   */
  const pin = await pinFor(HOSTILE, ["--case=plain"]);
  const r = await run(
    [GATE, "--pin", pin, "--mode", "enforce", "--relist-on-change", VERIFY, "--verify-window", "100", "--verify-timeout", "1500", "--", process.execPath, HOSTILE, "--case=relist-many"],
    [INIT, READY, listMsg(2), { wait: 1_500 }, callMsg(3, "list_dir"), { wait: 1_000 }],
    60_000,
  );
  assert.ok(r.answers.find((m) => m.id === 3), "the call was never answered during a storm");
  /* The call was answered one way or the other, and the gate did not die. */
  assert.ok(!/the session is ending/.test(r.stderr), r.stderr);
});

test("a client using one of the gate's ids ends the session, with this flag too", { timeout: 120_000 }, async () => {
  const pin = await pinFor(HOSTILE, ["--case=plain"]);
  const r = await run(
    [GATE, "--pin", pin, "--mode", "enforce", VERIFY, "--", process.execPath, HOSTILE, "--case=plain"],
    [INIT, READY, { jsonrpc: "2.0", id: reservedId(1), method: "tools/list" }, { wait: 300 }],
  );
  assert.match(r.stderr, /the client sent a request with id "brydge-gate\/1"/);
  assert.equal(r.code, 78);
});

/* ── Shadow, and the flags ──────────────────────────────────────────────── */

test("in shadow mode it checks, reports, and refuses nothing", { timeout: 120_000 }, async () => {
  const pin = await pinFor(DEMO, ["--mode=baseline"]);
  const pending = mkdtempSync(join(tmpdir(), "gate-verify-pending-"));
  const r = await run(
    [GATE, "--pin", pin, "--pending", pending, VERIFY, "--verify-window", "400", "--", process.execPath, DEMO, "--mode=reworded-silent", "--drop-after=300"],
    [INIT, READY, listMsg(2), { wait: 900 }, callMsg(3, "demo_add")],
  );
  assert.match(r.stderr, /This is shadow mode, so nothing is refused whatever the check finds/);
  assert.match(r.stderr, /asked the server for a tool list before forwarding a call/);
  /* The call went through — shadow refuses nothing. */
  assert.ok(r.answers.find((m) => m.id === 3)?.result, "shadow mode refused a call");
  /* And the check found the change: a report was written for it. */
  assert.equal(readdirSync(pending).length, 1, "the check found nothing to report");
  assert.match(r.stderr, /Nothing was hidden from the client and no call was stopped/);
});

test("the flag is off unless typed, and its settings do nothing without it", { timeout: 120_000 }, async () => {
  const pin = await pinFor(HOSTILE, ["--case=plain"]);
  const off = await run([GATE, "--pin", pin, "--", process.execPath, HOSTILE, "--case=plain"], [INIT, READY, listMsg(2), { wait: 200 }]);
  assert.ok(!/--verify-on-call is on/.test(off.stderr), "it announced a flag nobody passed");

  /* A window with no flag is a setting that would do nothing. */
  for (const extra of [["--verify-window", "100"], ["--verify-timeout", "100"], ["--on-verify-timeout=forward"]]) {
    const r = await run([GATE, "--pin", pin, ...extra, "--", process.execPath, HOSTILE, "--case=plain"], [INIT], 10_000);
    assert.match(r.stderr, /only applies with --verify-on-call, which was not given/, `${extra[0]} was accepted alone`);
    assert.equal(r.answers.length, 0, `${extra[0]}: the server was started anyway`);
  }
  /* And a setting that is not a number, or an unknown choice. */
  const bad = await run([GATE, "--pin", pin, VERIFY, "--verify-window", "soon", "--", process.execPath, HOSTILE], [INIT], 10_000);
  assert.match(bad.stderr, /--verify-window is a number of milliseconds, not "soon"/);
  const worse = await run([GATE, "--pin", pin, VERIFY, "--on-verify-timeout=maybe", "--", process.execPath, HOSTILE], [INIT], 10_000);
  assert.match(worse.stderr, /--on-verify-timeout is refuse or forward, not "maybe"/);
});

test("the announcement is said once, and says what it holds", { timeout: 120_000 }, async () => {
  const pin = await pinFor(HOSTILE, ["--case=plain"]);
  const r = await run([GATE, "--pin", pin, "--mode", "enforce", VERIFY, "--", process.execPath, HOSTILE, "--case=plain"], [INIT, READY, listMsg(2), { wait: 200 }]);
  assert.equal([...r.stderr.matchAll(/--verify-on-call is on/g)].length, 1, "it announced the flag more than once");
  assert.match(r.stderr, /HOLDS the call — and everything the client sends behind it/);
  assert.match(r.stderr, /10000ms old/);
  assert.match(r.stderr, /3000ms/);
});

test("a page of a list is not a fresh picture, so the check does not finish", { timeout: 120_000 }, async () => {
  /*
   * relist-page answers the gate's own request with one page and a
   * cursor. A page is not a surface, so the picture never becomes fresh,
   * so the wait runs out and the call is refused for that reason.
   *
   * I claimed in the plan that this "falls out of the existing path" and
   * wrote no test for it. A mutation that made a partial answer count as
   * a fresh picture then passed everything — the call was still refused,
   * but instantly and for a different reason, which is not the same
   * behaviour and should not have been invisible.
   */
  const pin = await pinFor(HOSTILE, ["--case=relist-page"]);
  const r = await run(
    [GATE, "--pin", pin, "--mode", "enforce", VERIFY, "--verify-window", "100", "--verify-timeout", "300", "--", process.execPath, HOSTILE, "--case=relist-page"],
    [INIT, READY, listMsg(2), { wait: 300 }, callMsg(3, "read_file"), { wait: 500 }],
  );
  /* It asked, got a page, and did not treat that as an answer. */
  assert.match(r.stderr, /asked the server for a tool list before forwarding a call/);
  assert.match(r.stderr, /one page and not the whole surface/);
  assert.match(r.stderr, /the tool list check did not finish \(no answer in \d+ms\)/);

  const said = r.answers.find((m) => m.id === 3)!;
  assert.equal(said.error?.code, -32000, `the call went through on a page of a list: ${JSON.stringify(said)}`);
  assert.equal(said.error.data.reason, "the tool list could not be checked before this call");
});
