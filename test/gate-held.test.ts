/*
 * The held-call report: tool, time, and a fingerprint of the arguments.
 *
 * Two things are being held to here. The first is that a call which waited
 * and did not go leaves a record somebody can correlate — the same call
 * twice is the same fingerprint. The second is that THE ARGUMENTS ARE
 * NEVER IN THE FILE, which is asserted by putting a planted sentinel in
 * them and looking for it everywhere the gate writes.
 *
 * What the file cannot do is in watch/gate/held.ts, next to the code: a
 * fingerprint of a small set of arguments is a label, not concealment.
 */
import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PREFIX, fingerprintOf, lineOf, recordOf } from "../watch/gate/held.ts";
import { CONTAINMENT, flatten, GATEKEEPING } from "./banned.ts";

const ROOT = join(import.meta.dirname, "..");
const DEMO = join(ROOT, "watch", "gate", "fixtures", "demo-server.mjs");
const HOSTILE = join(ROOT, "watch", "gate", "fixtures", "hostile-server.mjs");
const { build } = (await import("../watch/gate/build.mjs")) as unknown as { build: (o: { out: string }) => unknown };
const BUILD_DIR = mkdtempSync(join(tmpdir(), "gate-held-build-"));
build({ out: BUILD_DIR });
const GATE = join(BUILD_DIR, "gate", "run.js");

/* ── The fingerprint ────────────────────────────────────────────────────── */

test("the same arguments fingerprint alike, whatever order their keys arrive in", () => {
  const a = fingerprintOf({ path: "/planted/one", depth: 2 });
  const b = fingerprintOf({ depth: 2, path: "/planted/one" });
  assert.equal(a, b, "key order changed the fingerprint");
  assert.match(a, new RegExp(`^${PREFIX}[0-9a-f]{64}$`));
});

test("different arguments fingerprint differently", () => {
  assert.notEqual(fingerprintOf({ path: "/planted/one" }), fingerprintOf({ path: "/planted/two" }));
  /* Nesting and types are in it, not just the leaves. */
  assert.notEqual(fingerprintOf({ n: 1 }), fingerprintOf({ n: "1" }));
  assert.notEqual(fingerprintOf({ a: [1, 2] }), fingerprintOf({ a: [2, 1] }));
});

test("no arguments and null arguments fingerprint alike, which is written down rather than hidden", () => {
  assert.equal(fingerprintOf(undefined), fingerprintOf(null));
  const held = readFileSync(join(ROOT, "watch", "gate", "held.ts"), "utf8");
  assert.match(held, /fingerprint alike/, "the collision is not named in the module");
});

test("a record is three fields, and the third is a fingerprint", () => {
  const at = new Date("2026-11-15T16:54:17.758Z");
  const r = recordOf("demo_subtract", { a: 9, b: 4 }, at);
  assert.deepEqual(Object.keys(r), ["tool", "at", "arguments"]);
  assert.equal(r.tool, "demo_subtract");
  assert.equal(r.at, "2026-11-15T16:54:17.758Z");
  assert.equal(r.arguments, fingerprintOf({ a: 9, b: 4 }));
  /* One JSON object, one newline: a file of these is read line by line. */
  assert.equal(lineOf("demo_subtract", { a: 9, b: 4 }, at), JSON.stringify(r) + "\n");
});

test("nothing the module says claims more than it does", () => {
  const held = readFileSync(join(ROOT, "watch", "gate", "held.ts"), "utf8");
  const flat = flatten(held);
  for (const w of [...CONTAINMENT, ...GATEKEEPING]) {
    assert.ok(!flat.includes(w), `held.ts says "${w}"`);
  }
  /* And it says the thing that is easiest to leave out. */
  assert.match(held, /A HASH IS NOT PRIVACY/);
  assert.match(held, /Twelve guesses is not an attack/);
  assert.match(held, /NOT A WAY TO RUN THE CALL AGAIN/);
});

/* ── Through the built gate ─────────────────────────────────────────────── */

const INIT = { jsonrpc: "2.0", id: 1, method: "initialize", params: {} };
const READY = { jsonrpc: "2.0", method: "notifications/initialized" };
const LIST = { jsonrpc: "2.0", id: 2, method: "tools/list" };
const call = (id: number, name: string, args?: unknown) => ({ jsonrpc: "2.0", id, method: "tools/call", ...(args === undefined ? { params: { name } } : { params: { name, arguments: args } }) });

interface Ran { out: string; err: string; code: number | null }

function run(args: string[], script: Array<unknown | { wait: number }>, capMs = 30_000): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    let settled = false;
    child.stdin.on("error", () => {});
    child.stdout.on("data", (c: Buffer) => (out += c.toString("utf8")));
    child.stderr.on("data", (c: Buffer) => (err += c.toString("utf8")));
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      resolve({ out, err, code });
    };
    child.on("exit", (code) => setTimeout(() => finish(code), 150));
    void (async () => {
      for (const m of script) {
        if (m && typeof m === "object" && "wait" in m) {
          await new Promise((d) => setTimeout(d, (m as { wait: number }).wait));
          continue;
        }
        try {
          child.stdin.write(JSON.stringify(m) + "\n");
        } catch {
          break;
        }
        await new Promise((d) => setTimeout(d, 120));
      }
      await new Promise((d) => setTimeout(d, 250));
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

const dir = () => mkdtempSync(join(tmpdir(), "gate-held-"));
const records = (file: string) =>
  existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, any>) : [];

async function pinFor(server: string, args: string[]): Promise<string> {
  const pin = join(dir(), "pin.json");
  const r = await run([GATE, "--write-pin", pin, "--package", "planted@1.0.0", "--", process.execPath, server, ...args], [INIT, READY, LIST]);
  assert.ok(existsSync(pin), r.err);
  return pin;
}

const PLANTED = "PLANTED-ARGUMENT-SENTINEL-6677";

test("a call held and then not forwarded is recorded; one that goes through is not", { timeout: 120_000 }, async () => {
  const pin = await pinFor(DEMO, ["--mode=baseline"]);
  const held = join(dir(), "held.jsonl");
  const r = await run(
    [GATE, "--pin", pin, "--mode", "enforce", "--verify-on-call", "--verify-window", "0", "--held", held,
      "--", process.execPath, DEMO, "--mode=dropped-silent", "--drop-after=200"],
    [INIT, READY, LIST, { wait: 500 }, call(3, "demo_subtract", { a: 9, b: 4, note: PLANTED }), call(4, "demo_add", { a: 1, b: 1 })],
  );
  assert.equal(r.code, 0, r.err);
  const rows = records(held);
  assert.deepEqual(rows.map((x) => x.tool), ["demo_subtract"], "the forwarded call was recorded, or the refused one was not");
  assert.match(rows[0]!.arguments, new RegExp(`^${PREFIX}[0-9a-f]{64}$`));
  assert.match(rows[0]!.at, /^\d{4}-\d{2}-\d{2}T/);
  /* The one that went through really did. */
  assert.match(r.out.replace(/\s/g, ""), /"id":4,"result"/);
});

test("the arguments are nowhere: not in the file, not in stderr, not in the journal", { timeout: 120_000 }, async () => {
  const pin = await pinFor(DEMO, ["--mode=baseline"]);
  const d = dir();
  const held = join(d, "held.jsonl");
  const journal = join(d, "journal.jsonl");
  const r = await run(
    [GATE, "--pin", pin, "--mode", "enforce", "--verify-on-call", "--verify-window", "0", "--held", held, "--journal", journal,
      "--", process.execPath, DEMO, "--mode=dropped-silent", "--drop-after=200"],
    [INIT, READY, LIST, { wait: 500 }, call(3, "demo_subtract", { a: 9, b: 4, note: PLANTED })],
  );
  for (const [what, text] of [
    ["the held report", readFileSync(held, "utf8")],
    ["the journal", readFileSync(journal, "utf8")],
    ["stderr", r.err],
  ] as const) {
    assert.ok(!text.includes(PLANTED), `${what} carries an argument value`);
    assert.ok(!text.includes('"a":9') && !text.includes('"b":4'), `${what} carries an argument value`);
  }
  /* The journal says a call was refused and names the tool; the held file
   * names the same tool at the same moment. That correlation is the only
   * one there is, and it is enough to find the line. */
  const refused = records(journal).filter((n) => n.kind === "refused");
  assert.deepEqual(refused.map((n) => n.tool), ["demo_subtract"]);
  assert.equal(records(held)[0]!.tool, refused[0]!.tool);
});

test("the same call twice is the same fingerprint; a different call is a different one", { timeout: 120_000 }, async () => {
  const pin = await pinFor(DEMO, ["--mode=baseline"]);
  const held = join(dir(), "held.jsonl");
  await run(
    [GATE, "--pin", pin, "--mode", "enforce", "--verify-on-call", "--verify-window", "0", "--held", held,
      "--", process.execPath, DEMO, "--mode=dropped-silent", "--drop-after=200"],
    [INIT, READY, LIST, { wait: 500 },
      call(3, "demo_subtract", { a: 9, b: 4 }),
      call(4, "demo_subtract", { b: 4, a: 9 }),
      call(5, "demo_subtract", { a: 1, b: 1 }),
      call(6, "demo_subtract")],
  );
  const rows = records(held);
  assert.equal(rows.length, 4, `four held calls, ${rows.length} recorded`);
  assert.equal(rows[0]!.arguments, rows[1]!.arguments, "the same arguments in another key order fingerprinted differently");
  assert.notEqual(rows[0]!.arguments, rows[2]!.arguments);
  assert.equal(rows[3]!.arguments, fingerprintOf(undefined), "a call with no arguments was not recorded as such");
});

test("a check that never answers is a held call that did not go, and it is recorded", { timeout: 120_000 }, async () => {
  /* The other way a held call fails: the hostile server never answers the
   * list the gate asks for, so the check times out and the call is not
   * forwarded. */
  const pin = await pinFor(HOSTILE, ["--case=plain"]);
  const held = join(dir(), "held.jsonl");
  const r = await run(
    [GATE, "--pin", pin, "--mode", "enforce", "--verify-on-call", "--verify-window", "0", "--verify-timeout", "400", "--held", held,
      "--", process.execPath, HOSTILE, "--case=relist-ignore"],
    [INIT, READY, LIST, { wait: 300 }, call(3, "read_file", { path: PLANTED })],
  );
  assert.equal(r.code, 0, r.err);
  const rows = records(held);
  assert.deepEqual(rows.map((x) => x.tool), ["read_file"]);
  assert.ok(!readFileSync(held, "utf8").includes(PLANTED));
  assert.match(r.err, /did not forward a call to "read_file" \(the tool list could not be checked before this call\)/);
});

test("one file, one session", { timeout: 120_000 }, async () => {
  const pin = await pinFor(DEMO, ["--mode=baseline"]);
  const held = join(dir(), "held.jsonl");
  const once = [INIT, READY, LIST, { wait: 500 }, call(3, "demo_subtract", { a: 9, b: 4 })];
  const args = [GATE, "--pin", pin, "--mode", "enforce", "--verify-on-call", "--verify-window", "0", "--held", held,
    "--", process.execPath, DEMO, "--mode=dropped-silent", "--drop-after=200"];
  await run(args, once);
  assert.equal(records(held).length, 1);
  await run(args, once);
  assert.equal(records(held).length, 1, "the second session appended to the first one's file");
});

test("--held is refused where the file could only ever be empty", { timeout: 60_000 }, async () => {
  const pin = await pinFor(DEMO, ["--mode=baseline"]);
  const held = join(dir(), "held.jsonl");
  const noVerify = await run([GATE, "--pin", pin, "--mode", "enforce", "--held", held, "--", process.execPath, DEMO], [INIT], 8_000);
  assert.equal(noVerify.code, 64);
  assert.match(noVerify.err, /--held only applies with --verify-on-call, which was not given/);
  assert.match(noVerify.err, /nothing waits without it, so no call could be held\. The server was not started\./);

  const shadow = await run([GATE, "--pin", pin, "--verify-on-call", "--held", held, "--", process.execPath, DEMO], [INIT], 8_000);
  assert.equal(shadow.code, 64);
  assert.match(shadow.err, /--held only applies with --mode enforce/);
  assert.match(shadow.err, /shadow mode forwards every call, so none is ever held and not forwarded/);
});

test("a session that ends on something failing closed does not record a refused call", { timeout: 120_000 }, async () => {
  /*
   * A batch from the client ends the session under enforcement. The call
   * inside it was never held and never refused — it was somewhere the gate
   * cannot reach — and a record of it would read as a refusal that
   * happened.
   */
  const pin = await pinFor(DEMO, ["--mode=baseline"]);
  const held = join(dir(), "held.jsonl");
  const r = await run(
    [GATE, "--pin", pin, "--mode", "enforce", "--verify-on-call", "--verify-window", "0", "--held", held,
      "--", process.execPath, DEMO, "--mode=baseline"],
    [INIT, READY, LIST, [call(3, "demo_add", { a: 1, b: 1 })]],
  );
  assert.equal(r.code, 78, `exit ${r.code}:\n${r.err}`);
  assert.deepEqual(records(held), [], "a session ending on a batch recorded a held call");
});
