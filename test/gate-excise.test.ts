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

/* ── Tools out of a tools/list result ───────────────────────────────────── */

import { exciseTools } from "../watch/gate/excise.ts";

const T = (name: string, extra = "") => `{"name":${JSON.stringify(name)},"description":"FIXTURE: planted.","inputSchema":{"type":"object"}${extra}}`;
const list = (id: string, ...tools: string[]) => `{"jsonrpc":"2.0","id":${id},"result":{"tools":[${tools.join(",")}]}}`;

/** Every removed span put back is the original; what remains parses and lacks the names. */
function toolsHold(input: string, hidden: string[]): string {
  const raw = buf(input);
  const r = exciseTools(raw, new Set(hidden));
  assert.ok(r.ok, `refused: ${!r.ok && r.because}`);
  if (!r.ok) throw new Error("unreachable");
  let restored = Buffer.alloc(0);
  let cursor = 0;
  let outCursor = 0;
  for (const s of r.removed) {
    const keptLen = s.start - cursor;
    restored = Buffer.concat([restored, r.bytes.subarray(outCursor, outCursor + keptLen), raw.subarray(s.start, s.end)]);
    outCursor += keptLen;
    cursor = s.end;
  }
  restored = Buffer.concat([restored, r.bytes.subarray(outCursor)]);
  assert.ok(restored.equals(raw), "the spans put back are not the original");
  const parsed = JSON.parse(r.bytes.toString("utf8")) as { result: { tools: Array<{ name: string }> } };
  for (const h of hidden) assert.ok(!parsed.result.tools.some((t) => t.name === h), `${h} is still in the list`);
  assert.equal(r.kept, parsed.result.tools.length);
  return r.bytes.toString("utf8");
}

test("a hidden tool in the middle goes with the comma after it", () => {
  const out = toolsHold(list("1", T("a"), T("b"), T("c")), ["b"]);
  assert.equal(out, list("1", T("a"), T("c")));
});

test("a hidden tool first, last, and two adjacent ones", () => {
  assert.equal(toolsHold(list("1", T("a"), T("b"), T("c")), ["a"]), list("1", T("b"), T("c")));
  assert.equal(toolsHold(list("1", T("a"), T("b"), T("c")), ["c"]), list("1", T("a"), T("b")));
  assert.equal(toolsHold(list("1", T("a"), T("b"), T("c"), T("d")), ["b", "c"]), list("1", T("a"), T("d")));
  assert.equal(toolsHold(list("1", T("a"), T("b"), T("c")), ["b", "c"]), list("1", T("a")));
  assert.equal(toolsHold(list("1", T("a"), T("b"), T("c")), ["a", "b"]), list("1", T("c")));
});

test("every tool hidden: an empty array remains, and the rest of the message is untouched", () => {
  assert.equal(toolsHold(list("1", T("a"), T("b")), ["a", "b"]), `{"jsonrpc":"2.0","id":1,"result":{"tools":[]}}`);
});

test("nothing hidden among them: the bytes come back unchanged, with no spans", () => {
  const raw = buf(list("1", T("a"), T("b")));
  const r = exciseTools(raw, new Set(["zzz"]));
  assert.ok(r.ok && r.removed.length === 0 && r.bytes.equals(raw) && r.kept === 2);
});

for (const [label, id] of [
  ["zero", "0"],
  ["negative zero", "-0"],
  ["an integer past 2^53", "9007199254740993"],
  ["a float with a trailing zero", "1.0"],
  ["a string", '"req-7"'],
] as const) {
  test(`the list's id token survives a hidden tool: ${label}`, () => {
    const out = toolsHold(list(id, T("a"), T("hide_me"), T("c")), ["hide_me"]);
    assert.ok(out.includes(`"id":${id},`), `the id token ${id} was altered`);
  });
}

test("pretty-printed lists keep their whitespace outside the spans", () => {
  const input = `{\n  "jsonrpc": "2.0",\n  "id": 0,\n  "result": {\n    "tools": [\n      ${T("a")},\n      ${T("b")},\n      ${T("c")}\n    ],\n    "nextCursor": null\n  }\n}`;
  const out = toolsHold(input, ["b"]);
  assert.equal(out, `{\n  "jsonrpc": "2.0",\n  "id": 0,\n  "result": {\n    "tools": [\n      ${T("a")},\n      ${T("c")}\n    ],\n    "nextCursor": null\n  }\n}`);
});

test("a tools array nested inside a tool is somebody else's and is left alone", () => {
  const nested = T("a", `,"_meta":{"tools":[{"name":"hide_me"}]}`);
  const out = toolsHold(list("1", nested, T("hide_me")), ["hide_me"]);
  assert.equal(out, list("1", nested), "the nested array was touched, or the real element was not");
});

test("a name spelled with an escape is still the name", () => {
  const escaped = `{"name":"hide\\u005fme","description":"FIXTURE: planted."}`;
  const out = toolsHold(list("1", T("a"), escaped), ["hide_me"]);
  assert.equal(out, list("1", T("a")));
});

test("the result's other members are untouched when tools are cut", () => {
  const input = `{"jsonrpc":"2.0","id":1,"result":{"before":{"x":[1,2]},"tools":[${T("a")},${T("b")}],"nextCursor":"FIXTURE"}}`;
  assert.equal(toolsHold(input, ["a"]), `{"jsonrpc":"2.0","id":1,"result":{"before":{"x":[1,2]},"tools":[${T("b")}],"nextCursor":"FIXTURE"}}`);
});

const toolsRefuse = (input: string, hidden: string[], why: RegExp) => {
  const r = exciseTools(buf(input), new Set(hidden));
  assert.ok(!r.ok, `not refused: ${input}`);
  if (r.ok) throw new Error("unreachable");
  assert.match(r.because, why);
};

test("tools that cannot be placed without doubt are refused by name", () => {
  toolsRefuse(`{"jsonrpc":"2.0","id":1,"result":{"notools":[]}}`, ["a"], /0 "tools" member/);
  toolsRefuse(`{"jsonrpc":"2.0","id":1,"result":{"tools":{"a":1}}}`, ["a"], /"tools" is not an array/);
  toolsRefuse(`{"jsonrpc":"2.0","id":1,"result":{"tools":[1]}}`, ["a"], /tool 1 is not an object/);
  toolsRefuse(`{"jsonrpc":"2.0","id":1,"result":{"tools":[{"name":"a","name":"b"}]}}`, ["a"], /tool 1 has 2 "name" member/);
  toolsRefuse(`{"jsonrpc":"2.0","id":1,"result":{"tools":[{"description":"x"}]}}`, ["a"], /tool 1 has 0 "name" member/);
  toolsRefuse(`{"jsonrpc":"2.0","id":1,"result":{"tools":[{"name":7}]}}`, ["a"], /its name is not a string/);
  toolsRefuse(`{"jsonrpc":"2.0","id":1,"result":{"tools":[]},"result":{"tools":[]}}`, ["a"], /2 "result" member/);
  toolsRefuse(`{"jsonrpc":"2.0","id":1,"result":{"tools":[],"tools":[]}}`, ["a"], /2 "tools" member/);
  toolsRefuse(`{"jsonrpc":"2.0","id":1,"error":{"code":1}}`, ["a"], /0 "result" member/);
});
