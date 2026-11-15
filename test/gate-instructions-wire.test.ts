/*
 * I2: the instructions field on the wire, through the built gate.
 *
 * The planted fields server carries planted wording A by default, B with
 * --instructions=b, none, a non-string, or two keys at once (--instructions=
 * dup, hand-written because no serialiser makes one). The gate is the built
 * one, because that is what a client launches.
 *
 * What is asserted is bytes, exit codes, journal kinds and sentences written
 * in this repository. The two planted wordings carry tokens INSTR-A-5531 and
 * INSTR-B-7748 so a test can prove a string is ABSENT from somewhere without
 * ever printing it.
 */
import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { exciseInstructions } from "../watch/gate/excise.ts";
import { UNPINNED_LINE } from "../watch/gate/instructions.ts";
import { instructionsStateOf, parse } from "../watch/gate/pin.ts";

const ROOT = join(import.meta.dirname, "..");
const FIELDS = join(ROOT, "watch", "gate", "fixtures", "fields-server.mjs");
const { build } = (await import("../watch/gate/build.mjs")) as unknown as { build: (o: { out: string }) => unknown };
const BUILD_DIR = mkdtempSync(join(tmpdir(), "gate-wire-build-"));
build({ out: BUILD_DIR });
const GATE = join(BUILD_DIR, "gate", "run.js");

const A_TOKEN = "INSTR-A-5531";
const B_TOKEN = "INSTR-B-7748";
const init = (id: unknown = 0) => ({ jsonrpc: "2.0", id, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "planted", version: "1" } } });
const READY = { jsonrpc: "2.0", method: "notifications/initialized" };
const listMsg = (id: number) => ({ jsonrpc: "2.0", id, method: "tools/list" });
const DISCOVER = { jsonrpc: "2.0", id: "server-discover-probe-1", method: "server/discover", params: { _meta: {} } };

interface Ran { stdout: Buffer; stderr: string; code: number | null; journal: Array<Record<string, any>> }

/** Write every message with a pause, keep the bytes, read the journal. */
function run(args: string[], messages: unknown[], capMs = 20_000): Promise<Ran> {
  const journal = join(mkdtempSync(join(tmpdir(), "gate-wire-journal-")), "journal.jsonl");
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [GATE, "--journal", journal, ...args], { stdio: ["pipe", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let err = "";
    let settled = false;
    child.stdin.on("error", () => {});
    child.stdout.on("data", (c: Buffer) => chunks.push(c));
    child.stderr.on("data", (c: Buffer) => (err += c.toString("utf8")));
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      const notes = existsSync(journal) ? readFileSync(journal, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, any>) : [];
      resolve({ stdout: Buffer.concat(chunks), stderr: err, code, journal: notes });
    };
    child.on("exit", (code) => setTimeout(() => finish(code), 200));
    void (async () => {
      for (const m of messages) {
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

/** The server alone, same script, for the bytes a client reads with no gate. */
function direct(serverArgs: string[], messages: unknown[]): Promise<Buffer> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [FIELDS, ...serverArgs], { stdio: ["pipe", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    child.stdin.on("error", () => {});
    child.stdout.on("data", (c: Buffer) => chunks.push(c));
    child.on("exit", () => setTimeout(() => resolve(Buffer.concat(chunks)), 200));
    void (async () => {
      for (const m of messages) {
        child.stdin.write(JSON.stringify(m) + "\n");
        await new Promise((d) => setTimeout(d, 120));
      }
      await new Promise((d) => setTimeout(d, 250));
      child.stdin.end();
    })();
  });
}

const server = (...extra: string[]) => ["--", process.execPath, FIELDS, ...extra];

/** A pin taken by the gate itself, which looks at the handshake. */
async function pinFrom(...serverArgs: string[]): Promise<string> {
  const pin = join(mkdtempSync(join(tmpdir(), "gate-wire-pin-")), "pin.json");
  const r = await run(["--write-pin", pin, "--package", "brydge-fields-server@1.0.0", ...server(...serverArgs)], [init(), READY, listMsg(1)]);
  assert.ok(existsSync(pin), `no pin written:\n${r.stderr}`);
  return pin;
}

const lines = (b: Buffer) => b.toString("utf8").split("\n").filter(Boolean);
const kinds = (r: Ran) => r.journal.map((n) => n.kind as string);
const noText = (r: Ran, where: string) => {
  const all = r.stderr + JSON.stringify(r.journal);
  assert.ok(!all.includes(A_TOKEN) && !all.includes(B_TOKEN), `${where}: the instructions text leaked into stderr or the journal`);
  assert.ok(!all.includes("FIXTURE: planted instructions"), `${where}: the instructions text leaked into stderr or the journal`);
};

/* ── The pin covers what the gate saw ───────────────────────────────────── */

test("--write-pin looks at the handshake: the pin names the instructions it saw", async () => {
  const pin = parse(readFileSync(await pinFrom("--instructions=a"), "utf8"));
  const state = instructionsStateOf(pin);
  assert.equal(state.kind, "text");
  assert.equal(pin.instructions!.length, pin.instructions!.text.length);
  /* A server sending none is pinned as none, not left uncovered. */
  const none = parse(readFileSync(await pinFrom("--instructions=none"), "utf8"));
  assert.deepEqual(instructionsStateOf(none), { kind: "absent" });
  /* A non-string cannot be pinned, so the pin does not cover it, and says so. */
  const other = parse(readFileSync(await pinFrom("--instructions=other"), "utf8"));
  assert.deepEqual(instructionsStateOf(other), { kind: "unpinned" });
});

/* ── Approved: the server's bytes, untouched ────────────────────────────── */

test("approved instructions: the client reads the server's bytes, byte for byte", async () => {
  const pin = await pinFrom("--instructions=a");
  const script = [init(), READY, listMsg(1)];
  const a = await direct(["--instructions=a"], script);
  const g = await run(["--pin", pin, "--mode", "enforce", ...server("--instructions=a")], script);
  assert.equal(g.code, 0);
  assert.equal(g.stdout.toString("hex"), a.toString("hex"), "the gate changed bytes although nothing differed");
  assert.ok(kinds(g).includes("instructions-unchanged"), `no comparison noted: ${kinds(g)}`);
  assert.ok(!kinds(g).includes("hidden-instructions"));
  noText(g, "approved");
});

/* ── Changed: one span out, every other byte where it was ───────────────── */

test("changed instructions: the field is gone and every other byte is the server's", async () => {
  const pin = await pinFrom("--instructions=a");
  const script = [init(), READY, listMsg(1)];
  const a = await direct(["--instructions=b"], script);
  const g = await run(["--pin", pin, "--mode", "enforce", ...server("--instructions=b")], script);
  assert.equal(g.code, 0, g.stderr);

  const directLines = lines(a);
  const gatedLines = lines(g.stdout);
  assert.equal(gatedLines.length, directLines.length, "a message was added or dropped");
  /* The initialize result: what the unit excision makes of the server's
   * line is exactly what the client read. */
  const cut = exciseInstructions(Buffer.from(directLines[0]!, "utf8"));
  assert.ok(cut.ok);
  assert.equal(gatedLines[0], cut.ok && cut.bytes.toString("utf8"), "the initialize result is not the server's bytes minus one span");
  assert.ok(!gatedLines[0]!.includes(B_TOKEN), "the changed instructions reached the client");
  /* Every other line, byte for byte. */
  for (let i = 1; i < directLines.length; i++) assert.equal(gatedLines[i], directLines[i], `line ${i + 1} differs`);

  assert.match(g.stderr, /did not pass the server's instructions to the client: the instructions differ from the pin \(\d+ characters pinned, \d+ seen\)\./);
  assert.ok(kinds(g).includes("would-hide-instructions"));
  const hid = g.journal.find((n) => n.kind === "hidden-instructions");
  assert.ok(hid, "no hidden-instructions note in the journal");
  assert.equal(hid!.n, 1);
  assert.match(hid!.because, /differ from the pin/);
  assert.match(g.stderr, /enforce, 0 hidden, instructions not passed on/);
  noText(g, "changed");
});

for (const [label, id] of [
  ["zero", 0],
  ["an integer past 2^53", 9007199254740993n],
  ["a string", "req-7"],
] as const) {
  test(`the id token survives the excision end to end: ${label}`, async () => {
    const pin = await pinFrom("--instructions=a");
    /* Written by hand so the big integer is a token in the bytes and not a
     * JavaScript number. */
    const idToken = typeof id === "bigint" ? id.toString() : JSON.stringify(id);
    const raw = `{"jsonrpc":"2.0","id":${idToken},"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"planted","version":"1"}}}`;
    const journal = join(mkdtempSync(join(tmpdir(), "gate-wire-id-")), "journal.jsonl");
    const out = await new Promise<Buffer>((resolve) => {
      const child = spawn(process.execPath, [GATE, "--journal", journal, "--pin", pin, "--mode", "enforce", ...server("--instructions=b")], { stdio: ["pipe", "pipe", "pipe"] });
      const chunks: Buffer[] = [];
      child.stdin.on("error", () => {});
      child.stdout.on("data", (c: Buffer) => chunks.push(c));
      child.on("exit", () => setTimeout(() => resolve(Buffer.concat(chunks)), 200));
      child.stdin.write(raw + "\n");
      setTimeout(() => child.stdin.end(), 400);
    });
    /*
     * Against the SERVER'S bytes, not the client's request: the planted
     * server parses and re-serialises, so it answers 9007199254740993 with
     * ...992 itself. That rounding is the server's and the gate forwards
     * it. What the gate must not do is round anything the server wrote —
     * so the id token in the gate's output must be the one in the server's.
     */
    const own = await new Promise<Buffer>((resolve) => {
      const child = spawn(process.execPath, [FIELDS, "--instructions=b"], { stdio: ["pipe", "pipe", "pipe"] });
      const chunks: Buffer[] = [];
      child.stdout.on("data", (c: Buffer) => chunks.push(c));
      child.on("exit", () => setTimeout(() => resolve(Buffer.concat(chunks)), 200));
      child.stdin.write(raw + "\n");
      setTimeout(() => child.stdin.end(), 400);
    });
    const serverToken = /"id":([^,]+),/.exec(lines(own)[0]!)![1];
    const first = lines(out)[0]!;
    assert.ok(first.includes(`"id":${serverToken},`), `the id token ${serverToken} the server wrote was altered in: ${first.slice(0, 80)}`);
    assert.ok(!first.includes(B_TOKEN), "the changed instructions reached the client");
    const cut = exciseInstructions(Buffer.from(lines(own)[0]!, "utf8"));
    assert.ok(cut.ok);
    assert.equal(first, cut.ok && cut.bytes.toString("utf8"), "not the server's bytes minus one span");
  });
}

/* ── The other shapes ───────────────────────────────────────────────────── */

test("a server answering server/discover with an initialize-shaped result is treated the same", async () => {
  const pin = await pinFrom("--instructions=a");
  const script = [DISCOVER, init(), READY, listMsg(1)];
  const a = await direct(["--instructions=b", "--discover"], script);
  const g = await run(["--pin", pin, "--mode", "enforce", ...server("--instructions=b", "--discover")], script);
  assert.equal(g.code, 0, g.stderr);
  const d = lines(a);
  const o = lines(g.stdout);
  assert.equal(o.length, d.length);
  /* Both results carried the field; both lost exactly it. */
  for (const i of [0, 1]) {
    const cut = exciseInstructions(Buffer.from(d[i]!, "utf8"));
    assert.ok(cut.ok, `line ${i + 1}: ${!cut.ok && cut.because}`);
    assert.equal(o[i], cut.ok && cut.bytes.toString("utf8"), `line ${i + 1} is not the server's bytes minus one span`);
  }
  assert.ok(o[0]!.includes('"id":"server-discover-probe-1"'), "the discover id was altered");
  assert.equal(g.journal.filter((n) => n.kind === "hidden-instructions").length, 2);
  assert.equal(g.journal.filter((n) => n.kind === "hidden-instructions").at(-1)!.n, 2);
});

test("a non-string instructions field differs from pinned text and comes out whole", async () => {
  const pin = await pinFrom("--instructions=a");
  const g = await run(["--pin", pin, "--mode", "enforce", ...server("--instructions=other")], [init(), READY]);
  assert.equal(g.code, 0, g.stderr);
  const first = JSON.parse(lines(g.stdout)[0]!) as Record<string, any>;
  assert.ok(!("instructions" in first.result), "the non-string field reached the client");
  assert.match(g.stderr, /did not pass the server's instructions to the client: the server sent an instructions field that is not a string\./);
});

test("pinned text and a server sending none: a difference noted, nothing to take out, bytes forwarded", async () => {
  const pin = await pinFrom("--instructions=a");
  const script = [init(), READY];
  const a = await direct(["--instructions=none"], script);
  const g = await run(["--pin", pin, "--mode", "enforce", ...server("--instructions=none")], script);
  assert.equal(g.code, 0, g.stderr);
  assert.equal(g.stdout.toString("hex"), a.toString("hex"), "bytes were changed although there was nothing to take out");
  const note = g.journal.find((n) => n.kind === "would-hide-instructions");
  assert.ok(note);
  assert.equal(note!.because, "the server sent no instructions and the pin names some");
  assert.ok(!kinds(g).includes("hidden-instructions"), "something was hidden although the server sent no instructions");
});

test("approved as none: instructions that then appear are taken out", async () => {
  /* The pin was taken from a server sending none, so it names none. */
  const pin = await pinFrom("--instructions=none");
  assert.deepEqual(instructionsStateOf(parse(readFileSync(pin, "utf8"))), { kind: "absent" });
  const g = await run(["--pin", pin, "--mode", "enforce", ...server("--instructions=a")], [init(), READY]);
  assert.equal(g.code, 0, g.stderr);
  const first = lines(g.stdout)[0]!;
  assert.ok(!first.includes(A_TOKEN), "instructions reached the client against a pin naming none");
  assert.match(g.stderr, /did not pass the server's instructions to the client: the server sent instructions and the pin names none\./);
});

/* ── Shadow: looked at, written down, passed on ─────────────────────────── */

test("shadow mode: the difference is noted, and the bytes are the server's", async () => {
  const pin = await pinFrom("--instructions=a");
  const script = [init(), READY, listMsg(1)];
  const a = await direct(["--instructions=b"], script);
  const g = await run(["--pin", pin, ...server("--instructions=b")], script);
  assert.equal(g.code, 0, g.stderr);
  assert.equal(g.stdout.toString("hex"), a.toString("hex"), "shadow mode changed the bytes");
  assert.ok(kinds(g).includes("would-hide-instructions"));
  assert.ok(!kinds(g).includes("hidden-instructions"), "shadow mode recorded a hiding");
  assert.match(g.stderr, /the instructions differ from the pin \(\d+ characters pinned, \d+ seen\); shadow mode, so they were passed on as they arrived\./);
  noText(g, "shadow");
});

/* ── An old pin: nothing compared, said once ────────────────────────────── */

test("a version-1 pin: the instructions pass through, and the gate says once that the pin does not cover them", async () => {
  const pin = await pinFrom("--instructions=a");
  const v1 = JSON.parse(readFileSync(pin, "utf8")) as Record<string, any>;
  delete v1.instructions;
  v1.version = 1;
  const old = join(mkdtempSync(join(tmpdir(), "gate-wire-v1-")), "v1.json");
  writeFileSync(old, JSON.stringify(v1));
  const script = [init(), READY, listMsg(1)];
  const a = await direct(["--instructions=b"], script);
  const g = await run(["--pin", old, "--mode", "enforce", ...server("--instructions=b")], script);
  assert.equal(g.code, 0, g.stderr);
  assert.equal(g.stdout.toString("hex"), a.toString("hex"), "an old pin changed the bytes");
  assert.equal(g.stderr.split(UNPINNED_LINE).length - 1, 1, "the unpinned line was not said exactly once");
  assert.ok(kinds(g).includes("instructions-unpinned"));
  assert.ok(!kinds(g).includes("would-hide-instructions"), "an old pin produced a difference nobody made");
});

/* ── Fail closed ────────────────────────────────────────────────────────── */

test("two instructions keys in one result: the session ends, saying why, and nothing more is forwarded", async () => {
  const pin = await pinFrom("--instructions=a");
  const g = await run(["--pin", pin, "--mode", "enforce", ...server("--instructions=dup")], [init(), READY, listMsg(1)]);
  assert.equal(g.code, 78, `exit ${g.code}:\n${g.stderr}`);
  assert.equal(g.stdout.length, 0, "something was forwarded to the client after the scan could not place the field");
  assert.match(g.stderr, /failing closed: the instructions differ from the pin \(\d+ characters pinned, \d+ seen\), and the field could not be taken out of the message without doubt: "result" has 2 "instructions" members/);
  assert.match(g.stderr, /Forwarding a message that was supposed to be changed is not something this does\./);
  assert.match(g.stderr, /the session is ending\. Nothing further was passed in either direction\./);
  noText(g, "dup");
});

test("two keys that both match the pin are not a difference, so nothing is cut and nothing stops", async () => {
  /*
   * The parsed copy sees the last key, the pin names that wording, the
   * verdict is "same", and the bytes go on. Whether a client reads the
   * first or the last is the client's business; the gate only acts when
   * it has something to act on.
   */
  const pin = await pinFrom("--instructions=b");
  const g = await run(["--pin", pin, "--mode", "enforce", ...server("--instructions=dup")], [init(), READY]);
  assert.equal(g.code, 0, g.stderr);
  assert.ok(kinds(g).includes("instructions-unchanged"));
});
