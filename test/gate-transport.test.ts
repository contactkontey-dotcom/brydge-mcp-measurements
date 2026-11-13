/*
 * The gate's framing. Bytes in, the same bytes out.
 *
 * Every fixture is planted. Nothing here reads a capture or a transcript.
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { Frames, lineOf, relay, type Reader } from "../watch/gate/transport.ts";

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

test("run.ts writes to stdout exactly once, and only a refusal it made", () => {
  /*
   * G1 and G2 had this at zero: everything on stdout came from the server,
   * through the pipe. Enforcement changed that, because a refused call has
   * to be answered by somebody and the server never saw it. One write, of
   * one thing, is the whole of the change — so it is counted rather than
   * permitted in general.
   */
  const src = strip("watch/gate/run.ts");
  for (const call of ["console.log", "console.info", "console.debug", "console.warn", "console.error"]) {
    assert.ok(!src.includes(call), `run.ts uses ${call}`);
  }
  const writes = [...src.matchAll(/process\.stdout\.write\(([^;]*)\);/g)];
  assert.equal(writes.length, 1, "run.ts writes to stdout somewhere new");
  const what = writes[0]![1]!.replace(/\s+/g, " ");
  assert.match(what, /action\.replyToClient/, `the one stdout write is not the refusal: ${what}`);
  assert.ok(!/child|server|read/.test(what), `the one stdout write carries something else too: ${what}`);
});
