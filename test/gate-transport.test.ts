/*
 * The gate's framing. Bytes in, the same bytes out.
 *
 * Every fixture is planted. Nothing here reads a capture or a transcript.
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { Frames, lineOf, relay, type Reader, type Decision } from "../watch/gate/transport.ts";

const ROOT = join(import.meta.dirname, "..");
const B = (s: string) => Buffer.from(s, "utf8");

/** Push a whole input through a relay and collect what comes out. */
async function through(input: Buffer, chunkSize: number, read: Reader = () => ({ pass: true })): Promise<Buffer> {
  const r = relay(read);
  const out: Buffer[] = [];
  r.on("data", (c: Buffer) => out.push(c));
  const done = new Promise<void>((resolve) => r.on("end", () => resolve()));
  for (let i = 0; i < input.length; i += chunkSize) r.write(input.subarray(i, i + chunkSize));
  r.end();
  await done;
  return Buffer.concat(out);
}

/* ── Frames ─────────────────────────────────────────────────────────────── */

test("lines come out whole however the bytes were chunked", () => {
  const f = new Frames();
  assert.deepEqual(f.push(B("abc")).map(String), []);
  assert.deepEqual(f.push(B("def\ngh")).map(String), ["abcdef"]);
  assert.deepEqual(f.push(B("i\njk\n")).map(String), ["ghi", "jk"]);
  assert.equal(f.rest(), null);
});

test("a character split across two chunks is not mangled", () => {
  const f = new Frames();
  const e = B("café\n");
  /* Cut between the two bytes of é. */
  const cut = e.length - 2;
  assert.deepEqual(f.push(e.subarray(0, cut)).map(String), []);
  const got = f.push(e.subarray(cut));
  assert.equal(got.length, 1);
  assert.equal(got[0]!.toString("utf8"), "café");
});

test("a carriage return belongs to the line before the newline", () => {
  const f = new Frames();
  const got = f.push(B("one\r\ntwo\n"));
  assert.deepEqual(got.map((b) => b.toString("utf8")), ["one\r", "two"]);
});

test("bytes after the last newline are kept, and flushed as they are", () => {
  const f = new Frames();
  f.push(B("done\npart"));
  assert.equal(f.rest()!.toString("utf8"), "part");
  assert.equal(f.rest(), null, "the rest was handed out twice");
});

/* ── lineOf ─────────────────────────────────────────────────────────────── */

test("a line carries its bytes, its parse, and the reason it did not parse", () => {
  const ok = lineOf(B('{"a":1}'));
  assert.deepEqual(ok.parsed, { a: 1 });
  assert.equal(ok.parseError, null);

  const bad = lineOf(B("not json"));
  assert.equal(bad.parsed, null);
  assert.ok(bad.parseError);

  const blank = lineOf(B("   "));
  assert.equal(blank.parsed, null);
  assert.equal(blank.parseError, null, "whitespace is not a broken message");
});

/* ── The relay ──────────────────────────────────────────────────────────── */

test("what goes in comes out, byte for byte, at every chunk size", async () => {
  const input = B(
    '{"jsonrpc":"2.0","id":1,"method":"initialize"}\n' +
      '{"jsonrpc":"2.0","id":9007199254740993,"result":{"big":1.0,"e":"caf\\u00e9","dup":1}}\n' +
      "not json at all\r\n" +
      "\n" +
      '{"jsonrpc":"2.0","method":"notifications/tools/list_changed"}\n',
  );
  for (const size of [1, 2, 3, 7, 64, 4096]) {
    const out = await through(input, size);
    assert.equal(out.toString("utf8"), input.toString("utf8"), `chunk size ${size}`);
    assert.ok(out.equals(input), `chunk size ${size}: bytes differ`);
  }
});

test("a number no JavaScript can hold survives, because nothing re-serialises it", async () => {
  /* 2^53 + 1 and a float written with a trailing zero. Parse-and-print would
   * turn these into 9007199254740992 and 1, which is how a proxy silently
   * corrupts an id a client is waiting on. */
  const input = B('{"id":9007199254740993,"x":1.0,"y":1e400}\n');
  const out = await through(input, 3);
  assert.ok(out.equals(input));
  assert.ok(out.toString().includes("9007199254740993"));
  assert.ok(out.toString().includes("1.0"));
  /* And the parse of it really is lossy, which is the reason for the rule. */
  assert.equal(JSON.stringify(JSON.parse('{"id":9007199254740993}')), '{"id":9007199254740992}');
});

test("a message with no newline at the end still arrives", async () => {
  const input = B('{"jsonrpc":"2.0","id":1}\n{"half":true}');
  const out = await through(input, 5);
  assert.ok(out.equals(input), "the unterminated tail was changed or lost");
  assert.ok(!out.toString().endsWith("\n"), "a newline was invented for a line that had none");
});

test("a megabyte line passes whole", async () => {
  const big = JSON.stringify({ jsonrpc: "2.0", id: 1, result: { tools: "x".repeat(1_000_000) } });
  const input = B(big + "\n");
  const out = await through(input, 65536);
  assert.ok(out.equals(input));
});

test("a reader that throws does not stop the traffic", async () => {
  const input = B('{"a":1}\n{"b":2}\n');
  let thrown = 0;
  const r = relay(
    () => {
      thrown++;
      throw new Error("the reader is broken");
    },
    () => {},
  );
  const out: Buffer[] = [];
  r.on("data", (c: Buffer) => out.push(c));
  const done = new Promise<void>((resolve) => r.on("end", () => resolve()));
  r.end(input);
  await done;
  assert.equal(thrown, 2);
  assert.ok(Buffer.concat(out).equals(input), "a broken reader cost the client its messages");
});

test("a reader may replace or drop a line, and only that line", async () => {
  const input = B('{"keep":1}\n{"swap":2}\n{"gone":3}\n');
  const out = await through(input, 4, (line) => {
    if (line.text.includes("swap")) return { pass: false, replaceWith: B('{"swapped":true}') };
    if (line.text.includes("gone")) return { pass: false, drop: true };
    return { pass: true };
  });
  assert.equal(out.toString("utf8"), '{"keep":1}\n{"swapped":true}\n');
});

/* ── The rule that breaks every server if it is broken ──────────────────── */

const strip = (f: string) =>
  readFileSync(join(ROOT, f), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

test("no gate module writes to stdout, and none of them logs", () => {
  /*
   * stdout is the client's end of the transport. A stray line on it is a
   * message the client will try to parse.
   */
  for (const f of ["watch/gate/transport.ts", "watch/gate/router.ts", "watch/gate/enforce.ts", "watch/gate/pin.ts", "watch/gate/report.ts", "watch/gate/approve.ts"]) {
    const src = strip(f);
    for (const call of ["console.log", "console.info", "console.debug", "console.warn", "console.error"]) {
      assert.ok(!src.includes(call), `${f} uses ${call}`);
    }
    assert.equal([...src.matchAll(/process\.stdout\.write/g)].length, 0, `${f} writes to stdout itself`);
  }
});

test("every stdout write in run.ts is a refusal the gate made, and nothing else", () => {
  /*
   * G1 and G2 had this at zero: everything on stdout came from the server,
   * through the pipe. Enforcement changed it, because a refused call has
   * to be answered by somebody and the server never saw it. V2 added a
   * second, for a call whose tool list check did not finish.
   *
   * So the rule is no longer "one write". It is that every write is a
   * refusal this gate built and that none carries anything which came
   * from the server — counted, so a third cannot arrive quietly.
   */
  const src = strip("watch/gate/run.ts");
  for (const call of ["console.log", "console.info", "console.debug", "console.warn", "console.error"]) {
    assert.ok(!src.includes(call), `run.ts uses ${call}`);
  }
  const writes = [...src.matchAll(/process\.stdout\.write\(([^;]*)\);/g)].map((m) => m[1]!.replace(/\s+/g, " "));
  assert.equal(writes.length, 2, `run.ts makes ${writes.length} stdout writes: ${writes.join(" | ")}`);
  assert.ok(
    writes.some((w) => /action\.replyToClient/.test(w)),
    `no write carries the enforcer's refusal: ${writes.join(" | ")}`,
  );
  assert.ok(
    writes.some((w) => /\bsaid\b/.test(w)),
    `no write carries the refusal for a check that did not finish: ${writes.join(" | ")}`,
  );
  for (const w of writes) {
    assert.ok(!/child|read\.|line\.raw/.test(w), `a stdout write carries something from the server: ${w}`);
  }
});

/* ── Holding a line on purpose ──────────────────────────────────────────── */

/*
 * V1 of --verify-on-call: the mechanism, with nothing using it yet.
 *
 * A reader may return a promise, and that line and everything behind it
 * waits. These tests are about the two things that can go wrong with
 * that — order, and a stream left shut — and about the one thing that
 * must not change: a synchronous reader is still handled synchronously.
 */

/** Everything the relay produced, as whole lines. */
function lines(r: ReturnType<typeof relay>): { of: () => string[]; bytes: () => Buffer } {
  const chunks: Buffer[] = [];
  r.on("data", (c: Buffer) => chunks.push(c));
  return {
    of: () => Buffer.concat(chunks).toString("utf8").split("\n").filter(Boolean),
    bytes: () => Buffer.concat(chunks),
  };
}

const tick = () => new Promise((d) => setImmediate(d));
const after = (ms: number) => new Promise((d) => setTimeout(d, ms));

test("a synchronous reader is still synchronous, with no microtask in the way", async () => {
  /*
   * The property that makes "the feature is off" true of the code rather
   * than only of a test: with a reader that returns a decision, the line
   * is out by the time write() returns.
   */
  const r = relay(() => ({ pass: true }));
  const out = lines(r);
  r.write(Buffer.from('{"id":1}\n'));
  assert.deepEqual(out.of(), ['{"id":1}'], "a synchronous line needed a turn of the event loop");
});

test("a held line and everything behind it wait, and the order is kept", async () => {
  let release: ((d: { pass: true }) => void) | null = null;
  const asked: string[] = [];
  const r = relay((line) => {
    asked.push(line.text);
    if (line.text === '{"id":2}') return new Promise<{ pass: true }>((res) => (release = res));
    return { pass: true };
  });
  const out = lines(r);

  /* Five lines in one chunk; the second one holds. */
  r.write(Buffer.from('{"id":1}\n{"id":2}\n{"id":3}\n{"id":4}\n{"id":5}\n'));
  await tick();

  /* One has gone, two is held, and the reader has not even been shown the
   * rest: that is what keeps them in order. */
  assert.deepEqual(out.of(), ['{"id":1}'], "something behind the held line went out");
  assert.deepEqual(asked, ['{"id":1}', '{"id":2}'], `the reader saw ${asked.length} lines while one was held`);

  release!({ pass: true });
  await tick();
  assert.deepEqual(
    out.of().map((l) => JSON.parse(l).id),
    [1, 2, 3, 4, 5],
    "the lines came out in a different order",
  );
  assert.equal(asked.length, 5);
});

test("a hold spans chunks: what arrives later still comes out later", async () => {
  let release: ((d: { pass: true }) => void) | null = null;
  const asked: string[] = [];
  const r = relay((line) => {
    asked.push(line.text);
    if (line.text === '{"id":1}') return new Promise<{ pass: true }>((res) => (release = res));
    return { pass: true };
  });
  const out = lines(r);

  r.write(Buffer.from('{"id":1}\n'));
  await tick();
  /* A second chunk, written while the first is held. */
  r.write(Buffer.from('{"id":2}\n'));
  await after(20);
  assert.deepEqual(out.of(), [], "a line from a later chunk overtook a held one");
  assert.deepEqual(asked, ['{"id":1}'], "the reader was shown a later chunk while a line was held");

  release!({ pass: true });
  await after(20);
  assert.deepEqual(out.of().map((l) => JSON.parse(l).id), [1, 2]);
});

test("a hold that rejects releases the stream and keeps the line", async () => {
  const failures: string[] = [];
  const r = relay(
    (line) => (line.text === '{"id":2}' ? Promise.reject(new Error("the planted hold failed")) : { pass: true }),
    (e) => failures.push(e.message),
  );
  const out = lines(r);
  r.write(Buffer.from('{"id":1}\n{"id":2}\n{"id":3}\n'));
  await after(20);
  /* The line is not lost — a gate failing is not a reason for somebody's
   * server to stop hearing from its client. */
  assert.deepEqual(out.of().map((l) => JSON.parse(l).id), [1, 2, 3]);
  assert.deepEqual(failures, ["the planted hold failed"]);
});

test("a held line can be replaced or dropped, as a synchronous one can", async () => {
  const r = relay((line) =>
    line.text === '{"id":2}'
      ? Promise.resolve({ pass: false as const, replaceWith: Buffer.from('{"id":"instead"}') })
      : line.text === '{"id":3}'
        ? Promise.resolve({ pass: false as const, drop: true as const })
        : { pass: true as const },
  );
  const out = lines(r);
  r.write(Buffer.from('{"id":1}\n{"id":2}\n{"id":3}\n{"id":4}\n'));
  await after(20);
  assert.deepEqual(out.of().map((l) => JSON.parse(l).id), [1, "instead", 4]);
});

test("the stream always finishes, however a hold ends", async () => {
  /*
   * The worst thing this file could do is leave done() unspent: the
   * client's messages stop arriving at the server and nothing says why.
   * Three ways a hold can end, and all three must release.
   */
  for (const [what, decide] of [
    ["resolved", () => Promise.resolve({ pass: true as const })],
    ["rejected", () => Promise.reject(new Error("planted"))],
    ["a reader that throws after the hold", () => Promise.resolve({ pass: true as const }).then(() => { throw new Error("planted"); })],
  ] as const) {
    const r = relay((line) => (line.text === '{"id":1}' ? (decide() as Promise<Decision>) : { pass: true }), () => {});
    const out = lines(r);
    r.write(Buffer.from('{"id":1}\n{"id":2}\n'));
    r.end();
    const finished = await Promise.race([
      new Promise<string>((d) => r.on("end", () => d("ended"))),
      after(2_000).then(() => "the stream never ended"),
    ]);
    assert.equal(finished, "ended", `${what}: ${finished}`);
    /* And the line behind the hold still went. */
    assert.ok(out.of().some((l) => JSON.parse(l).id === 2), `${what}: the line behind the hold was lost`);
  }
});

test("a hold on the last line, with no newline, still ends the stream", async () => {
  let release: ((d: { pass: true }) => void) | null = null;
  const r = relay((line) => (line.unterminated ? new Promise<{ pass: true }>((res) => (release = res)) : { pass: true }));
  const out = lines(r);
  r.write(Buffer.from('{"id":1}\n{"id":2}'));
  r.end();
  await after(20);
  assert.deepEqual(out.of(), ['{"id":1}'], "the unterminated line went out before its hold resolved");
  release!({ pass: true });
  const ended = await Promise.race([
    new Promise<string>((d) => r.on("end", () => d("ended"))),
    after(2_000).then(() => "the stream never ended"),
  ]);
  assert.equal(ended, "ended");
  /* No newline invented for a line that never had one. */
  assert.equal(out.bytes().toString("utf8"), '{"id":1}\n{"id":2}');
});

test("a line injected while another is held goes FIRST, or it would deadlock", async () => {
  /*
   * Everywhere else the gate's own line follows the line that prompted it.
   * Here it must precede it: the held line is waiting for the answer to
   * the injected one, so deferring the injection behind the held line
   * would be a deadlock — and a quiet one, with a client simply never
   * hearing back.
   */
  let release: ((d: { pass: true }) => void) | null = null;
  const r: ReturnType<typeof relay> = relay((line) => {
    if (line.text !== '{"id":2}') return { pass: true };
    /* What the verifier will do: ask, then wait for the answer. */
    const held = new Promise<{ pass: true }>((res) => (release = res));
    r.inject(Buffer.from('{"id":"brydge-gate/1","method":"tools/list"}'));
    return held;
  });
  const out = lines(r);
  r.write(Buffer.from('{"id":1}\n{"id":2}\n{"id":3}\n'));
  await after(20);
  assert.deepEqual(
    out.of().map((l) => JSON.parse(l).id),
    [1, "brydge-gate/1"],
    "the gate's own request did not go out while the line that needs its answer was held",
  );
  release!({ pass: true });
  await after(20);
  assert.deepEqual(out.of().map((l) => JSON.parse(l).id), [1, "brydge-gate/1", 2, 3]);
});

test("with nothing held, the bytes are what they were", async () => {
  /*
   * The awkward shapes again, through the relay that can now hold: an id
   * above 2^53, a float that is not an integer, an accent, a line that is
   * not JSON, an empty line, keys out of order. One byte at a time, so
   * every boundary lands mid-message.
   */
  const planted =
    [
      '{"jsonrpc":"2.0","id":9007199254740993,"method":"tools/list"}',
      '{"jsonrpc":"2.0","id":1,"result":{"n":1.0,"s":"\\u00e9"}}',
      "not json at all",
      "",
      '{"b":1,"a":2}',
    ].join("\n") + "\n";
  const r = relay(() => ({ pass: true }));
  const out = lines(r);
  for (const byte of Buffer.from(planted)) r.write(Buffer.from([byte]));
  r.end();
  await after(30);
  assert.equal(out.bytes().toString("utf8"), planted, "the relay changed the bytes");
});
