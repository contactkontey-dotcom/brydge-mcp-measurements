/*
 * Enforcement, which happens only when somebody types --mode enforce.
 *
 * The planted hostile server is the only server here. Every description in
 * it is a fixture written to read as one, and nothing in this file reads a
 * capture or prints a description.
 *
 * THE KILL RULE has a test of its own: with everything approved, what the
 * client receives under enforcement must be byte for byte what it receives
 * with no gate at all. If that is not true the mode is not worth having,
 * because the client is then reading the gate rather than the server.
 */
import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CONTAINMENT, flatten, GATEKEEPING } from "./banned.ts";
import { DID_NOT_FORWARD, Enforcer, REFUSAL_CODE, enforcingLine, hidLine, nameOf } from "../watch/gate/enforce.ts";
import { lineOf } from "../watch/gate/transport.ts";
import { adopt, write as writePin } from "../watch/gate/pin.ts";
import { recordOf } from "../watch/tools.ts";
import type { WouldHide } from "../watch/gate/router.ts";

const ROOT = join(import.meta.dirname, "..");
const SERVER = join(ROOT, "watch", "gate", "fixtures", "hostile-server.mjs");
/*
 * This file's own build, not the shared watch/gate/built.
 *
 * gate-built.test.ts cleans and rebuilds that tree while it runs, and the
 * whole suite runs these files at the same time: sharing it once meant the
 * gate died on its first line here, reported as the server exiting. Each
 * suite that launches a built gate builds one of its own.
 */
const { build } = (await import("../watch/gate/build.mjs")) as unknown as {
  build: (o: { out: string }) => { files: string[] };
};
const BUILD_DIR = mkdtempSync(join(tmpdir(), "gate-enforce-build-"));
build({ out: BUILD_DIR });
const BUILT = join(BUILD_DIR, "gate", "run.js");

const A = "FIXTURE A: reads the planted file and returns its planted bytes.";
const HOW = 'To approve it: run "gate approve".';

/* ── The enforcer, on its own ───────────────────────────────────────────── */

const enforcer = (over: Partial<ConstructorParameters<typeof Enforcer>[0]> = {}) =>
  new Enforcer({ howToApprove: HOW, pinFile: "/tmp/pin.json", ...over });

const line = (m: unknown) => lineOf(Buffer.from(JSON.stringify(m), "utf8"));
const reply = (a: { replyToClient?: Buffer }) => JSON.parse(a.replyToClient!.toString("utf8")) as Record<string, any>;

test("a call to a hidden tool is refused, and the refusal says who refused", () => {
  const e = enforcer();
  e.noteList([{ name: "read_file" }, { name: "list_dir" }], [{ tool: "read_file", because: "its description differs from the baseline" }]);
  const a = e.fromClient(line({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "read_file", arguments: {} } }));
  assert.equal(a.forward, false, "a call to a hidden tool was forwarded");
  const r = reply(a);
  assert.equal(r.id, 7);
  assert.equal(r.error.code, REFUSAL_CODE);
  assert.ok(r.error.message.startsWith(DID_NOT_FORWARD), r.error.message);
  assert.match(r.error.message, /"read_file" is hidden, because its description differs from the baseline/);
  assert.equal(r.error.data.gate, "brydge-gate");
  assert.equal(r.error.data.didNotForward, true);
  /* Not the code a server uses for a tool it does not have: the gate must
   * not be mistaken for the server saying there is no such tool. */
  assert.notEqual(r.error.code, -32601);
  assert.notEqual(r.error.code, -32602);
  assert.ok(!/unknown tool|method not found|no such tool/i.test(r.error.message), r.error.message);
});

/*
 * THE CASE A CLIENT ACTUALLY MEETS. It listed the tools before enforcement
 * hid one — or before the server changed it — so its menu still shows the
 * tool. The refusal has to tell it the tool was hidden, not pretend the
 * tool never existed.
 */
test("a tool the client cached before it was hidden is refused as hidden, and says so", () => {
  const e = enforcer();
  /* The client's first list: nothing hidden, so it caches both names. */
  e.noteList([{ name: "read_file" }, { name: "list_dir" }], []);
  assert.equal(e.whyRefused("read_file"), null, "a tool nobody hides was refused");
  /* The server changes it; the next list hides it. The client does not
   * re-list, and calls what it remembers. */
  e.noteList([{ name: "read_file" }, { name: "list_dir" }], [{ tool: "read_file", because: "its description differs from the baseline" }]);
  const r = reply(e.fromClient(line({ jsonrpc: "2.0", id: 11, method: "tools/call", params: { name: "read_file" } })));
  assert.match(r.error.message, /is hidden/);
  assert.match(r.error.message, /If your client listed the tools before it was hidden, it may still be showing it/);
  assert.match(r.error.message, /gate approve/);
  assert.equal(r.error.data.reason, "its description differs from the baseline");
});

test("a tool the server has stopped offering says that, not that it is hidden", () => {
  const e = enforcer();
  e.noteList([{ name: "read_file" }, { name: "list_dir" }], []);
  e.noteList([{ name: "list_dir" }], []);
  const r = reply(e.fromClient(line({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "read_file" } })));
  assert.match(r.error.message, /the server is no longer offering "read_file"/);
  assert.match(r.error.message, /It was in an earlier tool list in this session and is not in the current one/);
  assert.ok(!r.error.message.includes("is hidden"), "a withdrawn tool was called hidden");
  assert.equal(r.error.data.reason, "no longer offered by the server");
});

test("a call to a tool that is not hidden is forwarded, and so is everything else", () => {
  const e = enforcer();
  e.noteList([{ name: "read_file" }, { name: "list_dir" }], [{ tool: "read_file", because: "not in the baseline" }]);
  assert.equal(e.fromClient(line({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_dir" } })).forward, true);
  assert.equal(e.fromClient(line({ jsonrpc: "2.0", id: 2, method: "resources/list" })).forward, true);
  assert.equal(e.fromClient(line({ jsonrpc: "2.0", method: "notifications/cancelled" })).forward, true);
  assert.equal(e.fromClient(lineOf(Buffer.from("not json"))).forward, true);
});

test("before any list has been answered, nothing is refused", () => {
  /* A client that calls before it lists meets a gate with nothing to
   * compare against; refusing on a guess would break it. */
  const e = enforcer();
  assert.equal(e.whyRefused("read_file"), null);
  assert.equal(e.fromClient(line({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "read_file" } })).forward, true);
});

test("a tools/call with no tool name is forwarded, for the server to answer", () => {
  const e = enforcer();
  e.noteList([{ name: "a" }], [{ tool: "a", because: "not in the baseline" }]);
  assert.equal(nameOf({ arguments: {} }), null);
  assert.equal(e.fromClient(line({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { arguments: {} } })).forward, true);
});

/* ── Rewriting a list ───────────────────────────────────────────────────── */

const listResult = (id: unknown, names: string[], extra: Record<string, unknown> = {}) => ({
  jsonrpc: "2.0",
  id,
  result: { tools: names.map((n) => ({ name: n, description: A, inputSchema: { type: "object" } })), ...extra },
});

/** Ask for a list, then hand the enforcer the answer. */
function listed(e: Enforcer, id: unknown, names: string[], hidden: WouldHide[], extra: Record<string, unknown> = {}) {
  e.fromClient(line({ jsonrpc: "2.0", id, method: "tools/list" }));
  e.noteList(names.map((n) => ({ name: n })), hidden);
  return e.fromServer(line(listResult(id, names, extra)));
}

test("a list with nothing hidden is forwarded as it arrived, not rewritten", () => {
  /*
   * The kill rule, in one unit. Re-serialising a result that needs no
   * change would alter key order and spacing, and a client seeing different
   * bytes with the gate in front of an approved server is reading the gate.
   */
  const e = enforcer();
  const a = listed(e, 2, ["read_file", "list_dir"], []);
  assert.equal(a.forward, true);
  assert.equal(a.replaceWith, undefined);
});

test("a list with something hidden is rewritten, keeping everything else", () => {
  const e = enforcer();
  const a = listed(e, 2, ["read_file", "list_dir"], [{ tool: "read_file", because: "not in the baseline" }], {
    nextCursor: "abc",
    _meta: { page: 1 },
  });
  assert.equal(a.forward, false);
  const out = JSON.parse(a.replaceWith!.toString("utf8")) as Record<string, any>;
  assert.deepEqual(out.result.tools.map((t: { name: string }) => t.name), ["list_dir"]);
  /* The server's own fields survive: a cursor the gate dropped would lose
   * the client the rest of the list. */
  assert.equal(out.result.nextCursor, "abc");
  assert.deepEqual(out.result._meta, { page: 1 });
  assert.equal(out.jsonrpc, "2.0");
  assert.equal(out.id, 2);
  /* The surviving tool is unchanged, whole. */
  assert.deepEqual(out.result.tools[0], { name: "list_dir", description: A, inputSchema: { type: "object" } });
  /* Framing: one line, parseable, no newline inside. */
  assert.ok(!a.replaceWith!.includes(0x0a), "the rewritten line carries a newline inside it");
});

test("every later list is gated, not only the first", () => {
  const e = enforcer();
  assert.equal(listed(e, 2, ["a"], []).forward, true);
  assert.equal(listed(e, 3, ["a", "b"], [{ tool: "b", because: "not in the baseline" }]).forward, false);
  assert.equal(listed(e, 4, ["a", "b"], [{ tool: "b", because: "not in the baseline" }]).forward, false);
  /* And when the server puts it back as it was, the list passes again. */
  assert.equal(listed(e, 5, ["a", "b"], []).forward, true);
});

test("a response to something that was not a tools/list is never rewritten", () => {
  const e = enforcer();
  e.noteList([{ name: "a" }], [{ tool: "a", because: "not in the baseline" }]);
  e.fromClient(line({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "other" } }));
  assert.equal(e.fromServer(line({ jsonrpc: "2.0", id: 9, result: { content: [] } })).forward, true);
  /* Nor a server-initiated request, nor a notification. */
  assert.equal(e.fromServer(line({ jsonrpc: "2.0", id: "s1", method: "roots/list" })).forward, true);
  assert.equal(e.fromServer(line({ jsonrpc: "2.0", method: "notifications/tools/list_changed" })).forward, true);
});

/* ── Failing closed ─────────────────────────────────────────────────────── */

test("a tool list this cannot read is not forwarded, and the client is told why", () => {
  const e = enforcer();
  e.fromClient(line({ jsonrpc: "2.0", id: 2, method: "tools/list" }));
  const a = e.fromServer(line({ jsonrpc: "2.0", id: 2, result: { tools: "not an array" } }));
  assert.equal(a.forward, false, "an ungated tool list reached the client");
  const r = reply(a);
  assert.equal(r.error.code, REFUSAL_CODE);
  assert.match(r.error.message, /the gate did not forward this tool list: the result carries no tools array/);
  assert.match(r.error.message, /It cannot hide what it cannot read/);
  assert.match(r.error.message, /Pin: \/tmp\/pin\.json/);
  assert.match(r.error.message, /gate approve/);
});

test("a batch stops the session, naming the file and what to do", () => {
  for (const side of ["fromClient", "fromServer"] as const) {
    const e = enforcer();
    const a = e[side](lineOf(Buffer.from('[{"jsonrpc":"2.0","id":1,"method":"tools/list"}]')));
    assert.equal(a.forward, false);
    assert.match(a.stop!, /a batch of 1 message\(s\)/);
    assert.match(a.stop!, /cannot hide or refuse one/);
    assert.match(a.stop!, /Pin: \/tmp\/pin\.json/);
  }
});

test("the hooks fire, so a caller can write the stderr lines", () => {
  const hid: Array<{ n: number; shown: number }> = [];
  const refused: string[] = [];
  const closed: string[] = [];
  const e = enforcer({
    onHide: (h, shown) => hid.push({ n: h.length, shown }),
    onRefuse: (t) => refused.push(t),
    onFailClosed: (b) => closed.push(b),
  });
  listed(e, 2, ["a", "b"], [{ tool: "a", because: "not in the baseline" }]);
  e.fromClient(line({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "a" } }));
  e.fromClient(lineOf(Buffer.from("[]")));
  assert.deepEqual(hid, [{ n: 1, shown: 1 }]);
  assert.deepEqual(refused, ["a"]);
  assert.equal(closed.length, 1);
});

/* ── What it says ───────────────────────────────────────────────────────── */

test("the lines stderr gets name the gate and claim nothing about the server", () => {
  const pin = adopt("fixture-mcp", "1.0.0", [recordOf({ name: "a", description: A })], "2026-11-13");
  const on = enforcingLine(pin, "/tmp/pin.json");
  assert.match(on, /enforcing against 1 pinned tool\(s\)/);
  assert.match(on, /adopted, not reviewed/);
  assert.match(on, /The server is running and this does not change what it can reach/);
  const hid = hidLine([{ tool: "a", because: "not in the baseline" }], 3);
  assert.match(hid, /did not pass 1 tool\(s\) to the client \(1 not in the baseline\); 3 passed on\./);

  const e = enforcer();
  e.noteList([{ name: "a" }], [{ tool: "a", because: "not in the baseline" }]);
  const r = reply(e.fromClient(line({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "a" } })));
  const flat = flatten([on, hid, r.error.message].join("\n"));
  for (const w of [...CONTAINMENT, ...GATEKEEPING]) assert.ok(!flat.includes(w), `the gate says "${w}"`);
  assert.ok(flat.includes("did not forward"));
});

/* ── Driven end to end, against the planted server ──────────────────────── */

interface Ran {
  stdout: Buffer;
  stderr: string;
  code: number | null;
}

/**
 * One line to send. `afterId` waits until the answer to that request has
 * come back before sending this one: a client that calls a tool before the
 * list that would hide it has arrived is a different case, tested on its
 * own above, and letting it happen by accident here would make these tests
 * pass or fail on timing.
 */
type Send = unknown | { msg: unknown; afterId: number };
const msgOf = (s: Send) => (s && typeof s === "object" && "msg" in s ? (s as { msg: unknown }).msg : s);
const afterOf = (s: Send) => (s && typeof s === "object" && "afterId" in s ? (s as { afterId: number }).afterId : null);

function run(args: string[], lines: Send[], capMs = 30_000): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = [];
    let err = "";
    let settled = false;
    let gone = false;
    child.stdout.on("data", (c: Buffer) => out.push(c));
    child.stderr.on("data", (c: Buffer) => (err += c.toString("utf8")));
    /* A process that has already exited makes the write throw EPIPE on a
     * stream with no listener, which would end the test run itself. */
    child.stdin.on("error", () => {});
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      resolve({ stdout: Buffer.concat(out), stderr: err, code });
    };
    child.on("exit", (code) => {
      gone = true;
      setTimeout(() => finish(code), 150);
    });

    /** Has an answer to this id come back yet? */
    const answered = (id: number) =>
      Buffer.concat(out)
        .toString("utf8")
        .split("\n")
        .filter(Boolean)
        .some((l) => {
          try {
            const m = JSON.parse(l) as Record<string, unknown>;
            return m.id === id && ("result" in m || "error" in m);
          } catch {
            return false;
          }
        });

    void (async () => {
      for (const l of lines) {
        const after = afterOf(l);
        if (after !== null) {
          const until = Date.now() + 15_000;
          while (!answered(after) && !gone && Date.now() < until) await new Promise((r) => setTimeout(r, 25));
        }
        if (gone) break;
        child.stdin.write(JSON.stringify(msgOf(l)) + "\n");
        await new Promise((r) => setTimeout(r, 70));
      }
      try {
        child.stdin.end();
      } catch {
        /* gone */
      }
      setTimeout(() => {
        if (settled) return;
        try {
          child.kill("SIGKILL");
        } catch {
          /* gone */
        }
        finish(null);
      }, capMs);
    })();
  });
}

const INIT = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "planted", version: "1" } } };
const DONE = { jsonrpc: "2.0", id: 99, method: "fixture/done" };
const listMsg = (id: number) => ({ jsonrpc: "2.0", id, method: "tools/list" });
const callMsg = (id: number, name: string) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: {} } });

/** Pin whatever the planted server offers on its first list. */
async function pinFirstList(kase: string): Promise<string> {
  const first = await run([SERVER, `--case=${kase}`], [INIT, listMsg(2), DONE]);
  const answer = first.stdout
    .toString("utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, any>)
    .find((m) => m.result?.tools);
  assert.ok(answer, `${kase}: the planted server answered no tool list`);
  const dir = mkdtempSync(join(tmpdir(), "gate-enforce-"));
  const file = join(dir, "pin.json");
  writePin(file, adopt("planted-hostile-server", "0.0.0", answer.result.tools.map(recordOf), "2026-11-13"));
  return file;
}

const messages = (b: Buffer) =>
  b.toString("utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, any>);

test("THE KILL RULE: with everything approved, enforce is byte-identical to no gate at all", { timeout: 120_000 }, async () => {
  const pin = await pinFirstList("stable");
  const conv = [INIT, listMsg(2), listMsg(3), callMsg(4, "read_file"), DONE];
  const direct = await run([SERVER, "--case=stable"], conv);
  const shadow = await run([BUILT, "--pin", pin, "--", process.execPath, SERVER, "--case=stable"], conv);
  const enforce = await run([BUILT, "--pin", pin, "--mode", "enforce", "--", process.execPath, SERVER, "--case=stable"], conv);

  assert.ok(direct.stdout.length > 0, "the planted server produced nothing to compare");
  assert.ok(shadow.stdout.equals(direct.stdout), "shadow changed the bytes");
  assert.ok(
    enforce.stdout.equals(direct.stdout),
    "enforce with everything approved is not byte-identical to direct, which is the kill rule",
  );
  assert.match(enforce.stderr, /enforcing against 2 pinned tool\(s\)/);
  assert.ok(!/did not pass/.test(enforce.stderr), "something was hidden although everything was approved");
});

for (const kase of ["plain", "chunks", "storm", "slow", "notify"]) {
  test(`enforce survives the planted server: ${kase}`, { timeout: 120_000 }, async () => {
    const pin = await pinFirstList(kase);
    const conv = [
      INIT,
      listMsg(2),
      { msg: listMsg(3), afterId: 2 },
      { msg: callMsg(4, "read_file"), afterId: 3 },
      callMsg(5, "list_dir"),
      DONE,
    ];
    const r = await run([BUILT, "--pin", pin, "--mode", "enforce", "--", process.execPath, SERVER, `--case=${kase}`], conv);
    const got = messages(r.stdout);

    /* The first list matches the pin and passes whole. */
    const firstList = got.find((m) => m.id === 2 && m.result?.tools);
    assert.ok(firstList, `${kase}: the client never got its first tool list`);
    assert.deepEqual(firstList.result.tools.map((t: { name: string }) => t.name).sort(), ["list_dir", "read_file"]);

    /* The second differs, so what reaches the client is filtered. */
    const second = got.find((m) => m.id === 3 && m.result?.tools);
    assert.ok(second, `${kase}: the client never got its second tool list`);
    assert.deepEqual(second.result.tools.map((t: { name: string }) => t.name), ["list_dir"], `${kase}: the wrong tools were passed on`);

    /* The call to the changed tool is refused by the gate, by name. */
    const refusal = got.find((m) => m.id === 4);
    assert.ok(refusal?.error, `${kase}: a call to a hidden tool was answered by the server`);
    assert.equal(refusal.error.code, REFUSAL_CODE);
    assert.ok(refusal.error.message.startsWith(DID_NOT_FORWARD));
    /* The call to the untouched tool is answered by the server. */
    assert.ok(got.find((m) => m.id === 5)?.result, `${kase}: a call to a tool nobody hid was not forwarded`);
  });
}

test("a tool withdrawn mid-session is refused as withdrawn, end to end", { timeout: 120_000 }, async () => {
  const pin = await pinFirstList("withdraw");
  const conv = [INIT, listMsg(2), { msg: listMsg(3), afterId: 2 }, { msg: callMsg(4, "read_file"), afterId: 3 }, DONE];
  const r = await run([BUILT, "--pin", pin, "--mode", "enforce", "--", process.execPath, SERVER, "--case=withdraw"], conv);
  const refusal = messages(r.stdout).find((m) => m.id === 4);
  assert.ok(refusal?.error, "the call to a withdrawn tool was forwarded");
  assert.match(refusal.error.message, /no longer offering "read_file"/);
});

test("an id the client reuses is still matched to the right request", { timeout: 120_000 }, async () => {
  const pin = await pinFirstList("plain");
  /* Same id for a call and then a list. The list must still be gated. */
  const conv = [INIT, listMsg(2), { msg: callMsg(7, "list_dir"), afterId: 2 }, { msg: listMsg(7), afterId: 7 }, DONE];
  const r = await run([BUILT, "--pin", pin, "--mode", "enforce", "--", process.execPath, SERVER, "--case=plain"], conv);
  const lists = messages(r.stdout).filter((m) => m.result?.tools);
  assert.equal(lists.length, 2, "the second list did not come back");
  assert.deepEqual(lists[1]!.result.tools.map((t: { name: string }) => t.name), ["list_dir"], "a reused id let an ungated list through");
});

test("an unreadable tool list reaches the client as an error, not as a list", { timeout: 120_000 }, async () => {
  const pin = await pinFirstList("plain");
  const r = await run(
    [BUILT, "--pin", pin, "--mode", "enforce", "--", process.execPath, SERVER, "--case=unreadable"],
    [INIT, listMsg(2), DONE],
  );
  const answer = messages(r.stdout).find((m) => m.id === 2);
  assert.ok(answer?.error, "an ungated tool list reached the client");
  assert.match(answer.error.message, /did not forward this tool list/);
  assert.match(r.stderr, /failing closed/);
});

test("a batch under enforcement ends the session and says why", { timeout: 120_000 }, async () => {
  const pin = await pinFirstList("plain");
  const r = await run(
    [BUILT, "--pin", pin, "--mode", "enforce", "--", process.execPath, SERVER, "--case=batch"],
    [INIT, listMsg(2), DONE],
  );
  assert.match(r.stderr, /failing closed: a batch of/);
  assert.match(r.stderr, /the session is ending/);
  assert.equal(r.code, 78);
});

/* ── The flags ──────────────────────────────────────────────────────────── */

test("enforce without a pin does not start the server", { timeout: 60_000 }, async () => {
  const r = await run([BUILT, "--mode", "enforce", "--", process.execPath, SERVER], [INIT, DONE], 5_000);
  assert.match(r.stderr, /--mode enforce needs --pin/);
  assert.match(r.stderr, /The server was not started/);
  assert.equal(r.stdout.length, 0);
  assert.equal(r.code, 64);
});

test("an unknown mode is refused before anything is spawned", { timeout: 60_000 }, async () => {
  const r = await run([BUILT, "--mode", "watch", "--", process.execPath, SERVER], [INIT, DONE], 5_000);
  assert.match(r.stderr, /--mode is shadow or enforce, not "watch"/);
  assert.equal(r.stdout.length, 0);
});

test("--on-bad-pin=empty starts with nothing pinned, and says what that means", { timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gate-badpin-"));
  const bad = join(dir, "pin.json");
  writeFileSync(bad, "{ this is not a pin");
  const r = await run(
    [BUILT, "--pin", bad, "--mode", "enforce", "--on-bad-pin=empty", "--", process.execPath, SERVER, "--case=plain"],
    [INIT, listMsg(2), DONE],
  );
  assert.match(r.stderr, /cannot be used/);
  assert.match(r.stderr, /treated as naming no tools/);
  assert.match(r.stderr, /no tool will be passed to the client/);
  const list = messages(r.stdout).find((m) => m.id === 2);
  assert.ok(list?.result, "the client got no answer at all");
  assert.deepEqual(list.result.tools, [], "a tool was passed on against a pin that names none");
});

test("without that flag a bad pin still does not start the server", { timeout: 60_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gate-badpin2-"));
  const bad = join(dir, "pin.json");
  writeFileSync(bad, "{ this is not a pin");
  const r = await run([BUILT, "--pin", bad, "--mode", "enforce", "--", process.execPath, SERVER], [INIT, DONE], 5_000);
  assert.match(r.stderr, /the server was not started/);
  assert.match(r.stderr, /--on-bad-pin=empty/);
  assert.equal(r.stdout.length, 0);
  assert.equal(r.code, 78);
});

test("shadow is what you get when nobody asks for anything", { timeout: 120_000 }, async () => {
  const pin = await pinFirstList("plain");
  const r = await run([BUILT, "--pin", pin, "--", process.execPath, SERVER, "--case=plain"], [INIT, listMsg(2), listMsg(3), DONE]);
  const second = messages(r.stdout).find((m) => m.id === 3 && m.result?.tools);
  assert.deepEqual(
    second!.result.tools.map((t: { name: string }) => t.name).sort(),
    ["list_dir", "read_file", "write_file"],
    "the default mode hid something",
  );
  assert.ok(!/enforcing against/.test(r.stderr), "the default mode said it was enforcing");
  assert.match(r.stderr, /Nothing was hidden from the client and no call was stopped/);
});
