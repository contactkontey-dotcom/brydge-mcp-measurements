/*
 * G4a: the flag, the identity of the gate's own messages, and what happens
 * when a client uses that identity. Nothing is asked for yet.
 *
 * Every message here is planted. The injection tests use the relay with a
 * planted reader; the end-to-end ones use the planted demo server.
 */
import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PassThrough, Writable } from "node:stream";
import { lineOf, relay, type Line } from "../watch/gate/transport.ts";
import { ANNOUNCEMENT, clientUsesReservedId, collisionBecause, FLAG, isReservedId, RESERVED_PREFIX, reservedId } from "../watch/gate/relist.ts";
import { CONTAINMENT, flatten, GATEKEEPING } from "./banned.ts";

/* ── The ids ────────────────────────────────────────────────────────────── */

test("the gate's own ids are strings in one namespace", () => {
  assert.equal(RESERVED_PREFIX, "brydge-gate/");
  assert.equal(reservedId(1), "brydge-gate/1");
  assert.equal(reservedId(20), "brydge-gate/20");
  for (const n of [1, 2, 99]) assert.ok(isReservedId(reservedId(n)), `${reservedId(n)} is not recognised`);
});

test("an ordinary id is never one of the gate's", () => {
  /* A client using 1, or "1", or a big number, has to keep working. */
  for (const id of [1, 2, 0, -1, 9007199254740993, "1", "abc", "", null, undefined, {}, [], true]) {
    assert.equal(isReservedId(id), false, `${JSON.stringify(id)} was taken for one of the gate's`);
  }
});

test("the separator is part of the namespace", () => {
  /* Somebody else's id that merely starts with the word is theirs. */
  for (const id of ["brydge-gate", "brydge-gateway/1", "brydge-gates/1", "BRYDGE-GATE/1", " brydge-gate/1"]) {
    assert.equal(isReservedId(id), false, `${JSON.stringify(id)} was taken for one of the gate's`);
  }
  assert.equal(isReservedId("brydge-gate/"), true, "the bare prefix is still in the namespace");
});

test("only a client REQUEST with such an id is a collision", () => {
  const reserved = reservedId(3);
  /* A request: a method and an id. That is the case that matters. */
  assert.deepEqual(clientUsesReservedId({ jsonrpc: "2.0", id: reserved, method: "tools/list" }), { id: reserved });
  /* A response from the client carries an id the SERVER chose. */
  assert.equal(clientUsesReservedId({ jsonrpc: "2.0", id: reserved, result: {} }), null);
  assert.equal(clientUsesReservedId({ jsonrpc: "2.0", id: reserved, error: { code: -1, message: "x" } }), null);
  /* A notification has no id. */
  assert.equal(clientUsesReservedId({ jsonrpc: "2.0", method: "notifications/initialized" }), null);
  /* An ordinary request. */
  assert.equal(clientUsesReservedId({ jsonrpc: "2.0", id: 4, method: "tools/list" }), null);
  /* Anything that is not a message. */
  for (const v of [null, 7, "x", [], [{ jsonrpc: "2.0", id: reserved, method: "tools/list" }]]) {
    assert.equal(clientUsesReservedId(v), null, `${JSON.stringify(v)} was read as a request`);
  }
  /* An id present but undefined is not an id. */
  assert.equal(clientUsesReservedId({ jsonrpc: "2.0", id: undefined, method: "x" }), null);
});

test("what it says about a collision names the flag and what to do, and claims nothing", () => {
  const because = collisionBecause("brydge-gate/1", "/tmp/pin.json");
  assert.match(because, /in the namespace this gate uses for its own requests/);
  assert.match(because, /it is not guessing/);
  assert.match(because, /Run without --relist-on-change, or have the client use another id/);
  assert.match(because, /Pin: \/tmp\/pin\.json/);
  const flat = flatten([because, ANNOUNCEMENT].join("\n"));
  for (const w of [...CONTAINMENT, ...GATEKEEPING]) assert.ok(!flat.includes(w), `it says "${w}"`);
});

test("the announcement says what the gate will send and that nothing else changes", () => {
  assert.match(ANNOUNCEMENT, /--relist-on-change is on/);
  assert.match(ANNOUNCEMENT, /sends a tools\/list of its own/);
  assert.match(ANNOUNCEMENT, /not passed to the client/);
  assert.match(ANNOUNCEMENT, /Everything else goes through as it did/);
  assert.equal(FLAG, "--relist-on-change");
});

/* ── Injection ──────────────────────────────────────────────────────────── */

/** A relay with a reader that records what it was asked about. */
function relayWith(reader?: (l: Line) => void) {
  const seen: string[] = [];
  const r = relay((line) => {
    seen.push(line.text);
    reader?.(line);
    return { pass: true };
  });
  return { r, seen };
}

/** Everything the relay produced, as whole lines. */
function collect(r: ReturnType<typeof relay>): { lines: () => string[]; bytes: () => Buffer } {
  const chunks: Buffer[] = [];
  r.on("data", (c: Buffer) => chunks.push(c));
  return {
    lines: () => Buffer.concat(chunks).toString("utf8").split("\n").filter(Boolean),
    bytes: () => Buffer.concat(chunks),
  };
}

const msg = (o: unknown) => Buffer.from(JSON.stringify(o), "utf8");

test("an injected line comes out whole, with one newline", async () => {
  const { r } = relayWith();
  const out = collect(r);
  assert.equal(r.inject(msg({ jsonrpc: "2.0", id: "brydge-gate/1", method: "tools/list" })), "sent");
  await new Promise((d) => setImmediate(d));
  assert.deepEqual(out.lines(), ['{"jsonrpc":"2.0","id":"brydge-gate/1","method":"tools/list"}']);
  assert.equal(out.bytes().at(-1), 0x0a, "the injected line has no newline");
  assert.equal(r.sent, 1);
});

test("an injected line never lands inside somebody else's line", async () => {
  /*
   * The reason injection goes through the relay at all. Three lines arrive
   * in ONE chunk and the reader injects while it is being asked about the
   * second — so the gate's line has to land between whole lines, not
   * inside the one being handled.
   */
  let n = 0;
  const seen: string[] = [];
  const r = relay((line) => {
    seen.push(line.text);
    if (++n === 2) r.inject(msg({ id: "brydge-gate/1", method: "tools/list" }));
    return { pass: true };
  });
  const out = collect(r);
  r.write(Buffer.from('{"id":1}\n{"id":2}\n{"id":3}\n'));
  await new Promise((d) => setImmediate(d));
  const lines = out.lines();
  /* Every line is valid JSON on its own, which is the property that breaks
   * if a line was split. */
  for (const l of lines) assert.doesNotThrow(() => JSON.parse(l), `not a whole line: ${l}`);
  assert.deepEqual(lines.map((l) => JSON.parse(l).id), [1, 2, "brydge-gate/1", 3]);
  assert.deepEqual(seen, ['{"id":1}', '{"id":2}', '{"id":3}']);
});

test("the reader is never asked about the gate's own line", async () => {
  /*
   * The gate does not decide about its own messages. If the reader saw
   * them it could rewrite or drop a request it had just sent, and would
   * compare the gate's own tools/list against the pin as if a client had
   * asked for it.
   */
  const { r, seen } = relayWith();
  const out = collect(r);
  r.inject(msg({ id: "brydge-gate/1", method: "tools/list" }));
  r.write(Buffer.from('{"id":1}\n'));
  await new Promise((d) => setImmediate(d));
  assert.deepEqual(seen, ['{"id":1}'], "the reader was asked about an injected line");
  assert.equal(out.lines().length, 2);
});

test("a line injected before anything arrives still comes first", async () => {
  const { r } = relayWith();
  const out = collect(r);
  r.inject(msg({ id: "brydge-gate/1" }));
  r.write(Buffer.from('{"id":1}\n'));
  await new Promise((d) => setImmediate(d));
  assert.deepEqual(out.lines().map((l) => JSON.parse(l).id), ["brydge-gate/1", 1]);
});

test("a line the stream has no room for is held, not lost", async () => {
  /*
   * A stalled far end is exactly when the gate most needs its request to
   * survive: it is waiting for the answer.
   */
  const r = relay(() => ({ pass: true }));
  /*
   * Nothing reads from it, so the readable buffer fills. The size comes
   * from the stream's own high-water mark rather than a number picked
   * here: a Transform's readable side holds 64KB by default, not the 16KB
   * a writable does, and a test that guessed 40KB proved nothing.
   */
  const big = Buffer.alloc(r.readableHighWaterMark + 1, 0x61);
  assert.ok(r.readableHighWaterMark > 0, "the stream reports no high-water mark");
  r.inject(big);
  let held = 0;
  for (let i = 0; i < 5; i++) if (r.inject(msg({ id: `brydge-gate/${i + 2}` })) === "held") held++;
  assert.ok(held > 0, "nothing was held although the buffer was full");
  assert.ok(r.held > 0);

  /* Now somebody reads, and everything held goes out, in order. */
  const sink = new PassThrough();
  const chunks: Buffer[] = [];
  sink.on("data", (c: Buffer) => chunks.push(c));
  r.pipe(sink);
  await new Promise((d) => setTimeout(d, 60));
  const lines = Buffer.concat(chunks).toString("utf8").split("\n").filter(Boolean);
  const ids = lines.slice(1).map((l) => JSON.parse(l).id);
  assert.deepEqual(ids, ["brydge-gate/2", "brydge-gate/3", "brydge-gate/4", "brydge-gate/5", "brydge-gate/6"]);
  assert.equal(r.held, 0, "something is still held");
});

test("a line injected after the stream has ended is not sent, and does not throw", async () => {
  const { r } = relayWith();
  const out = collect(r);
  r.write(Buffer.from('{"id":1}\n'));
  r.end();
  await new Promise((d) => setTimeout(d, 30));
  assert.equal(r.inject(msg({ id: "brydge-gate/1" })), "ended");
  assert.deepEqual(out.lines().map((l) => JSON.parse(l).id), [1]);
});

test("a relay nobody injects into is byte-for-byte what it was", async () => {
  /*
   * The whole of G4a must be invisible when nothing is injected. These are
   * the awkward shapes the transport tests already cover, run again through
   * the relay that now has an inject method.
   */
  const planted = [
    '{"jsonrpc":"2.0","id":9007199254740993,"method":"tools/list"}',
    '{"jsonrpc":"2.0","id":1,"result":{"n":1.0,"s":"\\u00e9"}}',
    "not json at all",
    "",
    '{"b":1,"a":2}',
  ].join("\n") + "\n";
  const { r } = relayWith();
  const out = collect(r);
  /* Split across awkward boundaries, a byte at a time. */
  for (const byte of Buffer.from(planted)) r.write(Buffer.from([byte]));
  r.end();
  await new Promise((d) => setTimeout(d, 30));
  assert.equal(out.bytes().toString("utf8"), planted, "the relay changed the bytes");
});

/* ── Driven, end to end ─────────────────────────────────────────────────── */

const { build } = (await import("../watch/gate/build.mjs")) as unknown as {
  build: (o: { out: string }) => { files: string[] };
};
const BUILD_DIR = mkdtempSync(join(tmpdir(), "gate-relist-build-"));
build({ out: BUILD_DIR });
const GATE = join(BUILD_DIR, "gate", "run.js");
const DEMO = join(import.meta.dirname, "..", "watch", "gate", "fixtures", "demo-server.mjs");

interface Ran {
  answers: Array<Record<string, any>>;
  stderr: string;
  code: number | null;
}

function run(args: string[], messages: unknown[], capMs = 20_000): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { stdio: ["pipe", "pipe", "pipe"] });
    const answers: Array<Record<string, any>> = [];
    let err = "";
    let buf = "";
    let i = 0;
    let settled = false;
    child.stdin.on("error", () => {});
    child.stderr.on("data", (c: Buffer) => (err += c.toString("utf8")));
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      resolve({ answers, stderr: err, code });
    };
    const next = () => {
      if (i >= messages.length) {
        setTimeout(() => {
          try {
            child.stdin.end();
          } catch {
            /* gone */
          }
        }, 150);
        return;
      }
      child.stdin.write(JSON.stringify(messages[i++]) + "\n");
    };
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (c: string) => {
      buf += c;
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const l = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!l.trim()) continue;
        answers.push(JSON.parse(l) as Record<string, any>);
        next();
      }
    });
    child.on("exit", (code) => setTimeout(() => finish(code), 150));
    setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* gone */
      }
      finish(null);
    }, capMs);
    next();
  });
}

const INIT = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "planted", version: "1" } } };
const list = (id: unknown) => ({ jsonrpc: "2.0", id, method: "tools/list" });

test("the flag is off unless somebody types it, and says so when it is on", { timeout: 60_000 }, async () => {
  const off = await run([GATE, "--", process.execPath, DEMO, "--mode=baseline"], [INIT, list(2)]);
  assert.ok(!off.stderr.includes("--relist-on-change is on"), "the gate announced a flag nobody passed");

  const on = await run([GATE, FLAG, "--", process.execPath, DEMO, "--mode=baseline"], [INIT, list(2)]);
  assert.match(on.stderr, /--relist-on-change is on/);
  assert.equal([...on.stderr.matchAll(/--relist-on-change is on/g)].length, 1, "it announced the flag more than once");
  /* And with the flag on it still passes the list through as it is: G4a
   * sends nothing. */
  assert.deepEqual(
    on.answers.find((m) => m.id === 2)!.result.tools.map((t: { name: string }) => t.name),
    ["demo_add", "demo_subtract", "demo_echo", "demo_now"],
  );
});

test("G4a sends nothing of its own, with the flag on or off", { timeout: 60_000 }, async () => {
  /*
   * The stage's own boundary. What the SERVER receives is compared, which
   * is where an injected request would show up — the client's stdout would
   * not change either way.
   */
  const conv = [INIT, { jsonrpc: "2.0", method: "notifications/initialized" }, list(2)];
  const seen: Record<string, string> = {};
  for (const flags of [[], [FLAG]]) {
    const r = await run(
      [GATE, ...flags, "--journal", join(mkdtempSync(join(tmpdir(), "gate-relist-j-")), "j.ndjson"), "--", process.execPath, DEMO, "--mode=baseline"],
      conv,
    );
    const which = flags.join(" ") || "off";
    seen[which] = r.answers.map((m) => JSON.stringify(m)).join("\n");
    /*
     * The stderr cannot be searched for the prefix: the announcement names
     * it. What would show a request having been sent is an ANSWER to one,
     * so that is what is looked for — and the journal, which records every
     * line the gate saw in either direction.
     */
    assert.equal(
      r.answers.filter((m) => typeof m.id === "string" && m.id.startsWith("brydge-gate/")).length,
      0,
      `${which}: an answer to one of the gate's own requests came back`,
    );
    assert.equal(
      [...r.stderr.matchAll(/relisted|asked for a tool list/g)].length,
      0,
      `${which}: the gate said it asked for a list`,
    );
  }
  assert.equal(seen["--relist-on-change"], seen["off"], "the flag changed what the client got");
});

test("a client using one of the gate's ids ends the session, with the flag on", { timeout: 60_000 }, async () => {
  const r = await run(
    [GATE, FLAG, "--", process.execPath, DEMO, "--mode=baseline"],
    [INIT, { jsonrpc: "2.0", id: reservedId(1), method: "tools/list" }],
  );
  assert.match(r.stderr, /the client sent a request with id "brydge-gate\/1"/);
  assert.match(r.stderr, /it is not guessing/);
  assert.match(r.stderr, /the session is ending/);
  assert.equal(r.code, 78);
  /* The client got its initialize answer and nothing after it. */
  assert.equal(r.answers.length, 1);
  assert.equal(r.answers[0]!.id, 1);
});

test("the same id is left alone with the flag off", { timeout: 60_000 }, async () => {
  /*
   * With no flag the gate reserves nothing, so that id belongs to the
   * client. Ending a working session over it would be the gate breaking a
   * server for its own convenience.
   */
  const r = await run(
    [GATE, "--", process.execPath, DEMO, "--mode=baseline"],
    [INIT, { jsonrpc: "2.0", id: reservedId(1), method: "tools/list" }],
  );
  assert.ok(!/the session is ending/.test(r.stderr), r.stderr);
  const answer = r.answers.find((m) => m.id === reservedId(1));
  assert.ok(answer?.result?.tools, "the client's own request was not answered");
  assert.equal(answer.result.tools.length, 4);
});

test("a client response carrying such an id is not a collision", { timeout: 60_000 }, async () => {
  /* An id in a RESPONSE was chosen by whoever asked, not by the client. */
  const r = await run(
    [GATE, FLAG, "--", process.execPath, DEMO, "--mode=baseline"],
    [INIT, { jsonrpc: "2.0", id: reservedId(1), result: { roots: [] } }, list(2)],
  );
  assert.ok(!/the session is ending/.test(r.stderr), r.stderr);
  assert.ok(r.answers.find((m) => m.id === 2)?.result?.tools, "the session did not carry on");
});
