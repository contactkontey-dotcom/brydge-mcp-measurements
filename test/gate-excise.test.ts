/*
 * The byte excision: one span out, every other byte where it was.
 *
 * The property every case below checks is the same one: the output is the
 * input with exactly one contiguous span removed, so putting the span back
 * gives the input. That is what "forward original bytes" means when a field
 * has to come out of the middle of them, and it is what a re-serialising
 * rewrite cannot promise.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { exciseInstructions, FIELD } from "../watch/gate/excise.ts";

const buf = (s: string) => Buffer.from(s, "utf8");

/** The span put back is the original. */
function holds(input: string): Buffer {
  const raw = buf(input);
  const r = exciseInstructions(raw);
  assert.ok(r.ok, `refused: ${!r.ok && r.because}`);
  if (!r.ok) throw new Error("unreachable");
  const restored = Buffer.concat([raw.subarray(0, r.removed.start), raw.subarray(r.removed.start, r.removed.end), raw.subarray(r.removed.end)]);
  assert.ok(restored.equals(raw), "the span put back is not the original");
  assert.equal(r.bytes.length, raw.length - (r.removed.end - r.removed.start), "more or less than the span was removed");
  /* What remains is still JSON, and has no instructions in it. */
  const parsed = JSON.parse(r.bytes.toString("utf8")) as Record<string, any>;
  assert.ok(!(FIELD in parsed.result), "the field is still there");
  return r.bytes;
}

/* Planted text, with a sentinel so a test can prove it is gone. */
const TEXT = "FIXTURE: planted PLANTED-SENTINEL-9182 instructions.";

test("the field in the middle: the comma after it goes with it", () => {
  const out = holds(`{"jsonrpc":"2.0","id":0,"result":{"protocolVersion":"2025-06-18","instructions":${JSON.stringify(TEXT)},"serverInfo":{"name":"x","version":"1"}}}`);
  assert.equal(out.toString("utf8"), `{"jsonrpc":"2.0","id":0,"result":{"protocolVersion":"2025-06-18","serverInfo":{"name":"x","version":"1"}}}`);
});

test("the field last: the comma before it goes with it", () => {
  const out = holds(`{"jsonrpc":"2.0","id":0,"result":{"protocolVersion":"2025-06-18","instructions":${JSON.stringify(TEXT)}}}`);
  assert.equal(out.toString("utf8"), `{"jsonrpc":"2.0","id":0,"result":{"protocolVersion":"2025-06-18"}}`);
});

test("the field first: the comma after it goes with it", () => {
  const out = holds(`{"jsonrpc":"2.0","id":0,"result":{"instructions":${JSON.stringify(TEXT)},"protocolVersion":"2025-06-18"}}`);
  assert.equal(out.toString("utf8"), `{"jsonrpc":"2.0","id":0,"result":{"protocolVersion":"2025-06-18"}}`);
});

test("the only member: an empty result is what remains", () => {
  const out = holds(`{"jsonrpc":"2.0","id":0,"result":{"instructions":${JSON.stringify(TEXT)}}}`);
  assert.equal(out.toString("utf8"), `{"jsonrpc":"2.0","id":0,"result":{}}`);
});

test("pretty-printed JSON: whitespace outside the span is kept, byte for byte", () => {
  const input = `{\n  "jsonrpc": "2.0",\n  "id": 0,\n  "result": {\n    "protocolVersion": "2025-06-18",\n    "instructions": ${JSON.stringify(TEXT)},\n    "serverInfo": { "name": "x" }\n  }\n}`;
  const out = holds(input);
  assert.equal(out.toString("utf8"), `{\n  "jsonrpc": "2.0",\n  "id": 0,\n  "result": {\n    "protocolVersion": "2025-06-18",\n    "serverInfo": { "name": "x" }\n  }\n}`);
});

/* ── The id token is never touched, because it is never read ────────────── */

for (const [label, id] of [
  ["zero", "0"],
  ["negative zero", "-0"],
  ["an integer past 2^53", "9007199254740993"],
  ["a float with a trailing zero", "1.0"],
  ["a string", '"server-discover-probe-1"'],
  ["an exponent", "1e2"],
] as const) {
  test(`the id token survives: ${label}`, () => {
    const out = holds(`{"jsonrpc":"2.0","id":${id},"result":{"a":1,"instructions":${JSON.stringify(TEXT)}}}`);
    assert.ok(out.toString("utf8").includes(`"id":${id},`), `the id token ${id} was altered`);
  });
}

/* ── Escapes and look-alikes ────────────────────────────────────────────── */

test("a string value full of escapes is stepped over whole", () => {
  const nasty = '"FIXTURE: \\"quoted\\" and \\\\ backslash and \\u0022 and \\n newline and a } brace and a , comma"';
  const out = holds(`{"jsonrpc":"2.0","id":1,"result":{"instructions":${nasty},"after":true}}`);
  assert.equal(out.toString("utf8"), `{"jsonrpc":"2.0","id":1,"result":{"after":true}}`);
});

test("a nested key named instructions is somebody else's and is left alone", () => {
  /* Inside serverInfo and inside a nested object: neither is the field. */
  const input = `{"jsonrpc":"2.0","id":1,"result":{"serverInfo":{"instructions":"FIXTURE: not this one","name":"x"},"instructions":${JSON.stringify(TEXT)},"meta":{"deep":{"instructions":"FIXTURE: nor this"}}}}`;
  const out = holds(input).toString("utf8");
  assert.ok(out.includes('"serverInfo":{"instructions":"FIXTURE: not this one","name":"x"}'), "a nested key was removed");
  assert.ok(out.includes('"deep":{"instructions":"FIXTURE: nor this"}'), "a deeper nested key was removed");
  assert.ok(!out.includes("PLANTED-SENTINEL-9182"), "the real field stayed");
});

test("the word in a string value elsewhere is not a key", () => {
  const input = `{"jsonrpc":"2.0","id":1,"result":{"note":"\\"instructions\\": fake","instructions":${JSON.stringify(TEXT)}}}`;
  const out = holds(input).toString("utf8");
  assert.ok(out.includes('"note":"\\"instructions\\": fake"'));
});

test("a non-string value is removed whole as well: object, array, number, null", () => {
  for (const v of ['{"text":"FIXTURE","n":[1,2,{"x":"}"}]}', '["FIXTURE",{"a":"]"}]', "12.5", "null", "true"]) {
    const out = holds(`{"jsonrpc":"2.0","id":1,"result":{"instructions":${v},"keep":1}}`);
    assert.equal(out.toString("utf8"), `{"jsonrpc":"2.0","id":1,"result":{"keep":1}}`, `value ${v} not removed cleanly`);
  }
});

test("a key that is the field only after decoding is still the field", () => {
  /* "instructions" spelled with a \u escape in the key. A scanner comparing
   * raw bytes would miss it; a client decodes it and reads it. */
  const out = holds(`{"jsonrpc":"2.0","id":1,"result":{"instru\\u0063tions":${JSON.stringify(TEXT)},"k":1}}`);
  assert.equal(out.toString("utf8"), `{"jsonrpc":"2.0","id":1,"result":{"k":1}}`);
});

/* ── Fail closed, by name ───────────────────────────────────────────────── */

const refuses = (input: string, why: RegExp) => {
  const r = exciseInstructions(buf(input));
  assert.ok(!r.ok, `not refused: ${input}`);
  if (r.ok) throw new Error("unreachable");
  assert.match(r.because, why);
};

test("two instructions members: which one a client reads is not defined, so neither is cut", () => {
  refuses(`{"jsonrpc":"2.0","id":1,"result":{"instructions":"FIXTURE A","instructions":"FIXTURE B"}}`, /2 "instructions" members/);
});

test("no instructions member: nothing to cut is a refusal, not a no-op", () => {
  /* The caller only asks when it has seen the field; a disagreement between
   * the parsed copy and the bytes is exactly when to stop. */
  refuses(`{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"x"}}`, /has no "instructions" member/);
});

test("result is not an object, or there is no result, or two of them", () => {
  refuses(`{"jsonrpc":"2.0","id":1,"result":"FIXTURE"}`, /"result" is not an object/);
  refuses(`{"jsonrpc":"2.0","id":1,"result":[1]}`, /"result" is not an object/);
  refuses(`{"jsonrpc":"2.0","id":1,"error":{"code":1}}`, /0 "result" member/);
  refuses(`{"jsonrpc":"2.0","id":1,"result":{"instructions":"a"},"result":{"instructions":"b"}}`, /2 "result" member/);
});

test("not one object: an array, trailing bytes, a string that never closes", () => {
  refuses(`[{"result":{"instructions":"a"}}]`, /not one JSON object/);
  refuses(`{"jsonrpc":"2.0","id":1,"result":{"instructions":"a"}} trailing`, /bytes after the message's closing brace/);
  refuses(`{"jsonrpc":"2.0","id":1,"result":{"instructions":"a}}`, /not one JSON object|could not be read|does not close/);
  refuses(``, /not one JSON object/);
});

test("the field name is fixed", () => {
  assert.equal(FIELD, "instructions");
});
