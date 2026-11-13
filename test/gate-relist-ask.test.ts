/*
 * G4b: the gate asking for a tool list the client did not ask for.
 *
 * The policy is tested on the Lister, which holds no timers and sends
 * nothing, so every part of it can be driven with a clock. The behaviour is
 * then tested end to end against the planted hostile server and the planted
 * demo server. No other project's code is started, and no description is
 * printed.
 */
import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CAP, Lister, MIN_INTERVAL_MS, RESERVED_PREFIX, TIMEOUT_MS, askedLine, partialLine, reservedId, timedOutLine } from "../watch/gate/relist.ts";
import { Enforcer } from "../watch/gate/enforce.ts";
import { lineOf } from "../watch/gate/transport.ts";
import { adopt, write as writePin } from "../watch/gate/pin.ts";
import { recordOf } from "../watch/tools.ts";
import { CONTAINMENT, flatten, GATEKEEPING } from "./banned.ts";

/* ── The policy, on a clock ─────────────────────────────────────────────── */

/** A lister with a clock a test moves by hand. */
function listerAt(start = 1_000_000) {
  let t = start;
  const l = new Lister({ now: () => t });
  return { l, tick: (ms: number) => (t += ms), at: () => t };
}

const CHANGED = { jsonrpc: "2.0", method: "notifications/tools/list_changed" };
const started = { jsonrpc: "2.0", method: "notifications/initialized" };

test("the notification is recognised, and nothing else is", () => {
  const { l } = listerAt();
  assert.equal(l.isChangeNotice(CHANGED), true);
  /* Not a request with the same method name, which would be a different
   * message entirely. */
  assert.equal(l.isChangeNotice({ ...CHANGED, id: 7 }), false);
  for (const v of [null, 7, "x", [], {}, { method: "notifications/initialized" }, { method: "tools/list" }]) {
    assert.equal(l.isChangeNotice(v), false, `${JSON.stringify(v)} was taken for the notification`);
  }
});

test("nothing is asked before the client has finished starting up", () => {
  const { l } = listerAt();
  const first = l.consider();
  assert.equal(first.ask, false);
  assert.equal(first.ask === false && first.why, "the client has not finished starting up");
  assert.equal(l.asked, 0, "a request was counted although none was sent");

  l.sawClient(started);
  assert.equal(l.consider().ask, true);
});

test("the client's other messages do not start it", () => {
  const { l } = listerAt();
  for (const m of [{ method: "initialize", id: 1 }, { method: "tools/list", id: 2 }, { id: 1, result: {} }, null, "x"]) {
    l.sawClient(m);
  }
  assert.equal(l.consider().ask, false, "something other than notifications/initialized started it");
});

test("one request is outstanding at a time", () => {
  const { l, tick } = listerAt();
  l.sawClient(started);
  const a = l.consider();
  assert.equal(a.ask, true);
  tick(MIN_INTERVAL_MS * 3);
  const b = l.consider();
  assert.equal(b.ask, false);
  assert.equal(b.ask === false && b.why, "one is already outstanding");
  /* Once the answer comes back, the next notification may ask. */
  assert.equal(l.settle(a.ask === true ? a.id : ""), true);
  assert.equal(l.consider().ask, true);
});

test("a second is not asked within a second of the last", () => {
  const { l, tick } = listerAt();
  l.sawClient(started);
  const a = l.consider();
  assert.ok(a.ask && l.settle(a.id));
  tick(MIN_INTERVAL_MS - 1);
  const soon = l.consider();
  assert.equal(soon.ask, false);
  assert.equal(soon.ask === false && soon.why, "the last one was less than a second ago");
  tick(1);
  assert.equal(l.consider().ask, true, "it would not ask after a whole second");
});

test("a session asks at most twenty times, and says so once", () => {
  const { l, tick } = listerAt();
  l.sawClient(started);
  let line: string | null = null;
  for (let i = 0; i < CAP; i++) {
    tick(MIN_INTERVAL_MS);
    const a = l.consider();
    assert.ok(a.ask, `it stopped asking at ${i}, before the cap`);
    assert.equal(a.id, reservedId(i + 1), "the ids are not in order");
    const said = l.capLine();
    if (i + 1 < CAP) {
      /* Not a word before the last one: a gate announcing a cap it has not
       * reached would be telling somebody it had stopped looking. */
      assert.equal(said, null, `it said it was capped at ${i + 1} of ${CAP}`);
    } else {
      /* On the last one it is true, and that is when it is worth saying:
       * from here the gate goes back to the lists the client asks for. */
      line = said;
    }
    l.settle(a.id);
  }
  tick(MIN_INTERVAL_MS);
  const over = l.consider();
  assert.equal(over.ask, false);
  assert.equal(over.ask === false && over.why, "this session has asked as many times as it will");
  assert.ok(line, "the cap was reached and nothing was said");
  assert.match(line!, new RegExp(`asked the server for a tool list ${CAP} times`));
  assert.match(line!, /no longer asking/);
  assert.match(line!, /goes on comparing the lists the client asks for/);
  assert.equal(l.capLine(), null, "it said it twice");
  /* And it stays capped. */
  tick(MIN_INTERVAL_MS * 100);
  assert.equal(l.consider().ask, false);
  assert.equal(l.asked, CAP);
});

test("an answer that never comes is forgotten after five seconds", () => {
  const { l, tick } = listerAt();
  l.sawClient(started);
  const a = l.consider();
  assert.ok(a.ask);
  tick(TIMEOUT_MS - 1);
  assert.equal(l.forget(), null, "it gave up early");
  assert.equal(l.waiting, a.id);
  tick(1);
  assert.equal(l.forget(), a.id);
  assert.equal(l.waiting, null);
  /* And the next notification may ask again. */
  assert.equal(l.consider().ask, true);
});

test("only the gate's own ids are recognised as its own", () => {
  const { l } = listerAt();
  l.sawClient(started);
  const a = l.consider();
  assert.ok(a.ask);
  assert.equal(l.isMine(a.id), true);
  /* An id in the namespace that this session never sent is not its own:
   * a server answering brydge-gate/99 out of nowhere is not an answer. */
  assert.equal(l.isMine(reservedId(99)), false);
  assert.equal(l.settle(reservedId(99)), false);
  assert.equal(l.waiting, a.id, "a stranger's answer settled the real request");
  for (const id of [1, "1", null, undefined, {}]) assert.equal(l.isMine(id), false);
});

test("the request it sends is a plain tools/list under its own id", () => {
  const { l } = listerAt();
  l.sawClient(started);
  const a = l.consider();
  assert.ok(a.ask);
  const m = JSON.parse(a.payload.toString("utf8")) as Record<string, unknown>;
  assert.deepEqual(m, { jsonrpc: "2.0", id: reservedId(1), method: "tools/list" });
  assert.ok(String(m.id).startsWith(RESERVED_PREFIX));
  /* No newline inside: the relay adds one. */
  assert.ok(!a.payload.includes(0x0a));
});

test("what it says on stderr names the gate and claims nothing", () => {
  const text = [
    askedLine(reservedId(1), "the server said its tool list changed"),
    timedOutLine(reservedId(1)),
    partialLine(reservedId(1)),
  ].join("\n");
  assert.match(text, /The answer is not passed to the client/);
  assert.match(text, /it may ask again/);
  assert.match(text, /one page and not the whole surface/);
  const flat = flatten(text);
  for (const w of [...CONTAINMENT, ...GATEKEEPING]) assert.ok(!flat.includes(w), `it says "${w}"`);
});

/* ── A page is not a surface ─────────────────────────────────────────────── */

const A = "FIXTURE A: reads the planted file and returns its planted bytes.";
const enforcerFor = () => new Enforcer({ pinFile: "/nowhere/pin.json" });
const line = (m: unknown) => lineOf(Buffer.from(JSON.stringify(m), "utf8"));
const replyOf = (a: { replyToClient?: Buffer }) => JSON.parse(a.replyToClient!.toString("utf8")) as Record<string, any>;

test("a surface the gate has not read means no call is passed on", () => {
  const e = enforcerFor();
  e.noteList([{ name: "read_file" }, { name: "list_dir" }], []);
  /* Nothing is hidden, so both calls would go through. */
  assert.equal(e.whyRefused("read_file"), null);

  e.cannotReadSurface("the tool list the gate asked for came back as one page of itself");
  assert.equal(e.surfaceUnread, "the tool list the gate asked for came back as one page of itself");
  /* Now neither does, because the gate cannot say which tool changed. */
  for (const tool of ["read_file", "list_dir"]) {
    const why = e.whyRefused(tool);
    assert.equal(why?.kind, "unread", `${tool} was passed on against an unread surface`);
  }
  const r = replyOf(e.fromClient(line({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "read_file" } })));
  assert.match(r.error.message, /came back as one page of itself/);
  assert.match(r.error.message, /cannot tell whether "read_file" is one of the tools that changed/);
  assert.match(r.error.message, /not passing calls on until it has/);
  assert.equal(r.error.data.reason, "the tool list has not been read in full");
  /* And it says nothing about a command, a path or a flag. */
  assert.ok(!/--|node |\.json|\//.test(r.error.message.replace(/"[^"]*"/g, "")), r.error.message);
});

test("a whole list clears it", () => {
  const e = enforcerFor();
  e.cannotReadSurface("a page");
  assert.ok(e.whyRefused("read_file"));
  e.noteList([{ name: "read_file" }], []);
  assert.equal(e.surfaceUnread, null);
  assert.equal(e.whyRefused("read_file"), null, "a complete list did not clear it");
});

test("an unread surface outranks a hidden tool, because it is the larger doubt", () => {
  const e = enforcerFor();
  e.noteList([{ name: "read_file" }], [{ tool: "read_file", because: "not in the baseline" }]);
  e.cannotReadSurface("a page");
  assert.equal(e.whyRefused("read_file")?.kind, "unread");
});

/* ── Driven, against the planted servers ────────────────────────────────── */

const ROOT = join(import.meta.dirname, "..");
const HOSTILE = join(ROOT, "watch", "gate", "fixtures", "hostile-server.mjs");
const DEMO = join(ROOT, "watch", "gate", "fixtures", "demo-server.mjs");

const { build } = (await import("../watch/gate/build.mjs")) as unknown as {
  build: (o: { out: string }) => { files: string[] };
};
/* Its own build, for the reason gate-enforce.test.ts has one. */
const BUILD_DIR = mkdtempSync(join(tmpdir(), "gate-ask-build-"));
build({ out: BUILD_DIR });
const GATE = join(BUILD_DIR, "gate", "run.js");

interface Ran {
  answers: Array<Record<string, any>>;
  notices: string[];
  stderr: string;
  code: number | null;
}

/**
 * Drive it with a fixed script and real gaps.
 *
 * Not one message per answer: the gate's own request and its answer are
 * invisible to a client, so a driver that waits for an answer per message
 * would be waiting on something it can never see. Fixed gaps, and the
 * server's own timers do the rest.
 */
function run(args: string[], script: Array<unknown | { wait: number }>, capMs = 40_000): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { stdio: ["pipe", "pipe", "pipe"] });
    const answers: Array<Record<string, any>> = [];
    const notices: string[] = [];
    let err = "";
    let buf = "";
    let settled = false;
    child.stdin.on("error", () => {});
    child.stderr.on("data", (c: Buffer) => (err += c.toString("utf8")));
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      resolve({ answers, notices, stderr: err, code });
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
        else answers.push(m);
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
        await new Promise((d) => setTimeout(d, 60));
      }
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
const FLAG = "--relist-on-change";

/** A pin adopted from whatever the server offers on its first list. */
async function pinFor(server: string, args: string[]): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "gate-ask-pin-"));
  const pin = join(dir, "pin.json");
  const r = await run([GATE, "--write-pin", pin, "--package", "planted@0.0.0", "--", process.execPath, server, ...args], [INIT, READY, listMsg(2), { wait: 300 }]);
  assert.ok(existsSync(pin), `no pin was written for ${server} ${args.join(" ")}:\n${r.stderr}`);
  return pin;
}

/* ── THE POINT OF G4 ────────────────────────────────────────────────────── */

test("a client that never re-lists still has the call refused", { timeout: 120_000 }, async () => {
  /*
   * dropped-silent: the server stops offering a tool and says nothing. The
   * client lists once, at startup, and never again — so before G4b the gate
   * had one look at the surface and the call went through to a server that
   * no longer had the tool.
   *
   * With the flag on, the gate asks for a list of its own when... nothing.
   * In dropped-SILENT there is no notification, so there is nothing to ask
   * on, and the call IS forwarded. That is the honest limit, and it is what
   * this asserts: the flag does not make the gate clairvoyant.
   */
  const pin = await pinFor(DEMO, ["--mode=baseline"]);
  const script = [INIT, READY, listMsg(2), { wait: 900 }, callMsg(3, "demo_subtract")];
  const r = await run(
    [GATE, "--pin", pin, "--mode", "enforce", FLAG, "--", process.execPath, DEMO, "--mode=dropped-silent", "--drop-after=300"],
    script,
  );
  assert.equal(r.notices.length, 0, "dropped-silent sent a notification after all");
  const said = r.answers.find((m) => m.id === 3)!;
  /* The SERVER answers, because the gate never learned the tool was gone. */
  assert.equal(said.error?.code, -32601, "the gate claimed to know something it could not know");
  assert.ok(!/did not forward/.test(said.error.message), said.error.message);
  assert.ok(!/asked the server for a tool list/.test(r.stderr), "it asked without a notification");
});

test("a client that never re-lists HAS the call refused once the server says so", { timeout: 120_000 }, async () => {
  /*
   * The same thing with the notification: dropped-notified. The client
   * still lists exactly once. The gate asks for its own list on the
   * notification, learns the tool is gone, and refuses the call — which it
   * could not do before G4b.
   */
  const pin = await pinFor(DEMO, ["--mode=baseline"]);
  const script = [INIT, READY, listMsg(2), { wait: 900 }, callMsg(3, "demo_subtract")];
  const r = await run(
    [GATE, "--pin", pin, "--mode", "enforce", FLAG, "--", process.execPath, DEMO, "--mode=dropped-notified", "--drop-after=300"],
    script,
  );
  /* The client listed once. */
  assert.equal(r.answers.filter((m) => m.result?.tools).length, 1, "the client listed more than once");
  /* The gate asked once, and the answer never reached the client. */
  assert.match(r.stderr, /asked the server for a tool list of its own \(brydge-gate\/1\)/);
  assert.equal(
    r.answers.filter((m) => typeof m.id === "string" && m.id.startsWith(RESERVED_PREFIX)).length,
    0,
    "the answer to the gate's own request was passed to the client",
  );
  /* And THE GATE refuses the call, by name. */
  const said = r.answers.find((m) => m.id === 3)!;
  assert.equal(said.error?.code, -32000, `the server answered instead of the gate: ${JSON.stringify(said)}`);
  assert.match(said.error.message, /the gate did not forward this call/);
  assert.match(said.error.message, /no longer offering "demo_subtract"/);
});

test("with the flag off, the same session forwards that call", { timeout: 120_000 }, async () => {
  /* The control for the test above: without the flag, nothing is asked and
   * the server answers for itself. */
  const pin = await pinFor(DEMO, ["--mode=baseline"]);
  const script = [INIT, READY, listMsg(2), { wait: 900 }, callMsg(3, "demo_subtract")];
  const r = await run(
    [GATE, "--pin", pin, "--mode", "enforce", "--", process.execPath, DEMO, "--mode=dropped-notified", "--drop-after=300"],
    script,
  );
  assert.equal(r.answers.find((m) => m.id === 3)!.error?.code, -32601, "something asked for a list without the flag");
  assert.ok(!/asked the server for a tool list/.test(r.stderr));
});

/* ── Both byte comparisons ──────────────────────────────────────────────── */

/** Everything the server received, as whole lines. */
const received = (file: string): string[] =>
  existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean) : [];

test("with the flag off, the server receives exactly what it receives with no gate", { timeout: 120_000 }, async () => {
  const script = [INIT, READY, listMsg(2), { wait: 400 }, listMsg(3), { wait: 200 }, { jsonrpc: "2.0", id: 99, method: "fixture/done" }];
  const dir = mkdtempSync(join(tmpdir(), "gate-ask-in-"));
  const direct = join(dir, "direct.txt");
  const gated = join(dir, "gated.txt");

  await run([HOSTILE, "--case=notify", `--log-in=${direct}`], script);
  await run([GATE, "--", process.execPath, HOSTILE, "--case=notify", `--log-in=${gated}`], script);

  const a = received(direct);
  assert.ok(a.length >= 4, `the planted server logged only ${a.length} line(s)`);
  assert.deepEqual(received(gated), a, "the gate changed what reached the server");
});

test("with the flag on, the only extra lines the server receives are the gate's own", { timeout: 120_000 }, async () => {
  const script = [INIT, READY, listMsg(2), { wait: 400 }, listMsg(3), { wait: 200 }, { jsonrpc: "2.0", id: 99, method: "fixture/done" }];
  const dir = mkdtempSync(join(tmpdir(), "gate-ask-in2-"));
  const off = join(dir, "off.txt");
  const on = join(dir, "on.txt");

  await run([GATE, "--", process.execPath, HOSTILE, "--case=notify", `--log-in=${off}`], script);
  const r = await run([GATE, FLAG, "--", process.execPath, HOSTILE, "--case=notify", `--log-in=${on}`], script);

  const before = received(off);
  const after = received(on);
  const mine = after.filter((l) => l.includes(`"${RESERVED_PREFIX}`));
  assert.ok(mine.length > 0, `nothing of the gate's reached the server:\n${r.stderr}`);
  /* Every one of them is a plain tools/list under one of the gate's ids. */
  for (const l of mine) {
    const m = JSON.parse(l) as Record<string, unknown>;
    assert.equal(m.method, "tools/list", `the gate sent something else: ${l}`);
    assert.equal(m.jsonrpc, "2.0");
    assert.deepEqual(Object.keys(m).sort(), ["id", "jsonrpc", "method"], `the gate's request carries more than it should: ${l}`);
    assert.ok(String(m.id).startsWith(RESERVED_PREFIX));
  }
  /* And with those removed, what the server received is what it received
   * with the flag off — same lines, same order. */
  assert.deepEqual(after.filter((l) => !l.includes(`"${RESERVED_PREFIX}`)), before, "the flag changed something else as well");
});

/* ── The hostile server answering badly ─────────────────────────────────── */

const askScript = [INIT, READY, listMsg(2), { wait: 1_500 }, callMsg(3, "list_dir"), { wait: 200 }, { jsonrpc: "2.0", id: 99, method: "fixture/done" }];

test("a server that will not answer the gate's request leaves the session working", { timeout: 120_000 }, async () => {
  const r = await run([GATE, FLAG, "--", process.execPath, HOSTILE, "--case=relist-ignore"], [INIT, READY, listMsg(2), { wait: 6_000 }, callMsg(3, "list_dir"), { wait: 300 }, { jsonrpc: "2.0", id: 99, method: "fixture/done" }], 60_000);
  assert.match(r.stderr, /asked the server for a tool list of its own/);
  assert.match(r.stderr, /no answer to the tool list this gate asked for/);
  assert.match(r.stderr, /Nothing changed; it may ask again/);
  /* The client's own messages were answered throughout. */
  assert.ok(r.answers.find((m) => m.id === 2)?.result?.tools, "the client's list did not come back");
  assert.ok(r.answers.find((m) => m.id === 3)?.result, "the client's call did not come back");
});

test("an error, or an answer to an id nobody sent, is no information", { timeout: 120_000 }, async () => {
  for (const kase of ["relist-error", "relist-stranger"]) {
    const r = await run([GATE, FLAG, "--", process.execPath, HOSTILE, `--case=${kase}`], askScript);
    assert.match(r.stderr, /asked the server for a tool list of its own/, `${kase}: it did not ask`);
    /* Nothing of the gate's reached the client. */
    assert.equal(
      r.answers.filter((m) => typeof m.id === "string" && m.id.startsWith(RESERVED_PREFIX)).length,
      0,
      `${kase}: something of the gate's was passed to the client`,
    );
    /* And the session carried on. */
    assert.ok(r.answers.find((m) => m.id === 3)?.result, `${kase}: the client's call did not come back`);
    assert.ok(!/the session is ending/.test(r.stderr), `${kase}: the session ended\n${r.stderr}`);
  }
});

test("a page of a list is not compared, and under enforcement no call is passed on", { timeout: 120_000 }, async () => {
  const pin = await pinFor(HOSTILE, ["--case=relist-page"]);
  const r = await run(
    [GATE, "--pin", pin, "--mode", "enforce", FLAG, "--", process.execPath, HOSTILE, "--case=relist-page"],
    askScript,
  );
  assert.match(r.stderr, /carries a cursor, so it is one page and not the whole surface/);
  assert.match(r.stderr, /It was not compared/);
  const said = r.answers.find((m) => m.id === 3)!;
  assert.equal(said.error?.code, -32000, `the call was forwarded against a surface the gate had not read: ${JSON.stringify(said)}`);
  assert.match(said.error.message, /has not read what the server is offering now/);
  assert.equal(said.error.data.reason, "the tool list has not been read in full");
});

test("a page of a list in shadow mode changes nothing", { timeout: 120_000 }, async () => {
  const pin = await pinFor(HOSTILE, ["--case=relist-page"]);
  const r = await run([GATE, "--pin", pin, FLAG, "--", process.execPath, HOSTILE, "--case=relist-page"], askScript);
  assert.match(r.stderr, /one page and not the whole surface/);
  /* Shadow hides nothing and stops nothing, a partial list included. */
  assert.ok(r.answers.find((m) => m.id === 3)?.result, "shadow mode stopped a call");
  assert.match(r.stderr, /Nothing was hidden from the client and no call was stopped/);
});

test("a server that answers every list with a notification does not make a loop", { timeout: 180_000 }, async () => {
  /*
   * relist-loop sends notifications/tools/list_changed in answer to every
   * tools/list, including the gate's own. Without the interval and the cap
   * the gate and the server would pass that between them for ever.
   */
  const r = await run(
    [GATE, FLAG, "--journal", join(mkdtempSync(join(tmpdir(), "gate-loop-")), "j.ndjson"), "--", process.execPath, HOSTILE, "--case=relist-loop"],
    [INIT, READY, listMsg(2), { wait: 4_000 }, { jsonrpc: "2.0", id: 99, method: "fixture/done" }],
    90_000,
  );
  const asked = [...r.stderr.matchAll(/asked the server for a tool list of its own/g)].length;
  /* Four seconds, a second apart: a handful, not hundreds. */
  assert.ok(asked >= 1, `it never asked:\n${r.stderr}`);
  assert.ok(asked <= 6, `it asked ${asked} times in four seconds`);
  assert.ok(asked <= CAP, `it asked ${asked} times, past the cap of ${CAP}`);
  assert.ok(r.answers.find((m) => m.id === 2)?.result?.tools, "the client's own list did not come back");
});

test("a storm of notifications is capped, and the cap is said once", { timeout: 180_000 }, async () => {
  /*
   * relist-many sends sixty notifications at once. The interval alone would
   * let one through per second for a minute; the cap ends it at twenty, and
   * says so.
   */
  const r = await run(
    [GATE, FLAG, "--", process.execPath, HOSTILE, "--case=relist-many"],
    [INIT, READY, listMsg(2), { wait: 30_000 }, { jsonrpc: "2.0", id: 99, method: "fixture/done" }],
    120_000,
  );
  const asked = [...r.stderr.matchAll(/asked the server for a tool list of its own/g)].length;
  assert.ok(asked <= CAP, `it asked ${asked} times, past the cap of ${CAP}`);
  const capped = [...r.stderr.matchAll(/as many as it will/g)].length;
  if (asked === CAP) {
    assert.equal(capped, 1, `the cap was reached and said ${capped} times`);
  }
  assert.ok(r.answers.find((m) => m.id === 2)?.result?.tools, "the client's own list did not come back");
});

test("nothing the server sends under the gate's namespace reaches the client", { timeout: 120_000 }, async () => {
  /*
   * relist-stranger answers "brydge-gate/99", which this session never
   * sent, and then sends a request under the gate's real id.
   *
   * Both are dropped. The first used to be forwarded, which made the
   * gate's own announcement false — it says answers under those ids do not
   * reach the client — and gave a server a way to reach a client wearing
   * the gate's name. The second is dropped because a client answering it
   * would put a reserved id on the wire from the client's side, which is
   * the collision that ends a session: a server should not be able to end
   * one by picking an id.
   */
  const r = await run([GATE, FLAG, "--", process.execPath, HOSTILE, "--case=relist-stranger"], askScript);
  assert.equal(
    r.answers.filter((m) => typeof m.id === "string" && m.id.startsWith(RESERVED_PREFIX)).length,
    0,
    "a message under the gate's namespace reached the client",
  );
  assert.match(r.stderr, /under id "brydge-gate\/99", which is in this gate's namespace/);
  assert.match(r.stderr, /It was not passed to the client/);
  /* The session is unharmed and the client's own call is answered. */
  assert.ok(!/the session is ending/.test(r.stderr), r.stderr);
  assert.ok(r.answers.find((m) => m.id === 3)?.result, "the client's call did not come back");
});

test("the announcement is true: no answer under those ids goes to the client", { timeout: 120_000 }, async () => {
  /*
   * The announcement is a promise to whoever reads the log. This checks it
   * against every planted case that puts something in that namespace.
   */
  for (const kase of ["notify", "relist-error", "relist-stranger", "relist-page"]) {
    const r = await run([GATE, FLAG, "--", process.execPath, HOSTILE, `--case=${kase}`], askScript);
    assert.match(r.stderr, /Those requests use ids beginning "brydge-gate\/" and their answers are not passed to the client/);
    const leaked = r.answers.filter((m) => typeof m.id === "string" && m.id.startsWith(RESERVED_PREFIX));
    assert.deepEqual(leaked, [], `${kase}: ${leaked.length} message(s) under the gate's ids reached the client`);
  }
});

test("a page of a list is not compared at all, so nothing is reported from it", { timeout: 120_000 }, async () => {
  /*
   * Not just "no call is passed on" — the partial list must not reach the
   * comparison in the first place. A tool on a page the gate did not get
   * is absent from the page it did get, and comparing that page would
   * record it as a difference: a would-hide note, and in shadow mode a
   * REPORT saying a tool changed, on the strength of one page of a list.
   *
   * The journal is where that shows. With the guard: an own-list note, a
   * pagination note, and no comparison. Without it: a would-hide too.
   */
  const dir = mkdtempSync(join(tmpdir(), "gate-page-"));
  const journal = join(dir, "j.ndjson");
  const pending = join(dir, "pending");
  const pin = await pinFor(HOSTILE, ["--case=relist-page"]);
  await run(
    [GATE, "--pin", pin, "--journal", journal, "--pending", pending, FLAG, "--", process.execPath, HOSTILE, "--case=relist-page"],
    askScript,
  );
  const kinds = readFileSync(journal, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => (JSON.parse(l) as { kind: string }).kind);
  assert.ok(kinds.includes("own-list"), `the gate's own list was not recorded: ${kinds.join(", ")}`);
  assert.ok(kinds.includes("pagination"), "the cursor was not recorded");
  /* One comparison, for the one list the client asked for. */
  const compared = kinds.filter((k) => k === "would-hide" || k === "list-unchanged").length;
  assert.equal(compared, 1, `${compared} comparisons for one client list: a page of a list was compared too`);
  /* And nothing was reported from it. */
  const reports = existsSync(pending) ? readdirSync(pending) : [];
  assert.deepEqual(reports, [], "a report was written from a list the gate never read in full");
});
