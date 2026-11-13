/*
 * What the gate would do, and the fact that in shadow mode it does none of it.
 *
 * Every fixture is planted. The two description strings are written to read
 * as fixtures, and one test asserts no note ever carries either of them.
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { CONTAINMENT, flatten, GATEKEEPING } from "./banned.ts";
import { lineOf } from "../watch/gate/transport.ts";
import { Router, SHADOW_MEANS, pinnedOf, toolsOf, type Note } from "../watch/gate/router.ts";
import { recordOf } from "../watch/tools.ts";

const ROOT = join(import.meta.dirname, "..");
const A = "FIXTURE A: reads the planted file and returns its planted bytes.";
const B2 = "FIXTURE B: reads the planted file and now says what happens when it is missing.";

const line = (m: unknown) => lineOf(Buffer.from(JSON.stringify(m), "utf8"));
const listRequest = (id: unknown) => ({ jsonrpc: "2.0", id, method: "tools/list" });
const listResult = (id: unknown, tools: unknown[], extra: Record<string, unknown> = {}) => ({
  jsonrpc: "2.0",
  id,
  result: { tools, ...extra },
});
const tool = (over: Record<string, unknown>) => ({ name: "read_file", description: A, inputSchema: { type: "object" }, ...over });

/** A router that has seen one list and taken it as the baseline. */
function withBaseline(tools: unknown[] = [tool({})]) {
  const r = new Router();
  r.see(line(listRequest(1)), "client-to-server");
  r.see(line(listResult(1, tools)), "server-to-client");
  return r;
}

const kinds = (notes: Note[]) => notes.map((n) => n.kind);

/* ── The baseline ───────────────────────────────────────────────────────── */

test("the first list seen becomes the baseline, and says that is what it is", () => {
  const r = withBaseline([tool({}), tool({ name: "list_dir" })]);
  assert.deepEqual(kinds(r.notes), ["baseline"]);
  assert.deepEqual(r.notes[0], { kind: "baseline", at: r.notes[0]!.at, tools: 2, source: "first list seen" });
  assert.equal(r.baselineSize, 2);
});

test("a baseline may be given instead, which is the shape a pin will have", () => {
  const given = [pinnedOf(recordOf(tool({})))];
  const r = new Router({ baseline: given });
  assert.equal(r.baselineSize, 1);
  assert.equal((r.notes[0] as { source: string }).source, "given");
  assert.deepEqual(Object.keys(given[0]!).sort(), ["descriptionHash", "hash", "name", "schemaHash"]);
});

/* ── What it would hide ─────────────────────────────────────────────────── */

test("a tool that was not there, and three ways an existing one can differ", () => {
  const r = withBaseline([tool({}), tool({ name: "list_dir" }), tool({ name: "search" }), tool({ name: "untouched" })]);
  r.see(line(listRequest(2)), "client-to-server");
  const notes = r.see(
    line(
      listResult(2, [
        tool({}),
        tool({ name: "list_dir", description: B2 }),
        tool({ name: "search", inputSchema: { type: "object", properties: { q: { type: "string" } } } }),
        tool({ name: "untouched" }),
        tool({ name: "arrived" }),
      ]),
    ),
    "server-to-client",
  );
  assert.deepEqual(kinds(notes), ["would-hide"]);
  const hidden = (notes[0] as { hidden: Array<{ tool: string; because: string }> }).hidden;
  assert.deepEqual(hidden.map((h) => `${h.tool}: ${h.because}`).sort(), [
    "arrived: not in the baseline",
    "list_dir: its description differs from the baseline",
    "search: its input schema differs from the baseline",
  ]);
  assert.equal((notes[0] as { shown: number }).shown, 2, "the count shown does not match what was left");
});

test("a change in a field that is neither is named as that, not as a description", () => {
  const r = withBaseline([tool({ _meta: { ui: { resourceUri: "one" } } })]);
  r.see(line(listRequest(2)), "client-to-server");
  const notes = r.see(line(listResult(2, [tool({ _meta: { ui: { resourceUri: "two" } } })])), "server-to-client");
  const hidden = (notes[0] as { hidden: Array<{ because: string }> }).hidden;
  assert.deepEqual(hidden.map((h) => h.because), ["it differs from the baseline in some other field"]);
});

test("a list that matches the baseline is said to match, not left silent", () => {
  const r = withBaseline();
  r.see(line(listRequest(2)), "client-to-server");
  const notes = r.see(line(listResult(2, [tool({})])), "server-to-client");
  assert.deepEqual(kinds(notes), ["list-unchanged"]);
});

test("key order in a schema is not a difference", () => {
  const r = withBaseline([tool({ inputSchema: { type: "object", properties: { b: 1, a: 2 } } })]);
  r.see(line(listRequest(2)), "client-to-server");
  const notes = r.see(line(listResult(2, [tool({ inputSchema: { properties: { a: 2, b: 1 }, type: "object" } })])), "server-to-client");
  assert.deepEqual(kinds(notes), ["list-unchanged"]);
});

/* ── Fail closed ────────────────────────────────────────────────────────── */

test("a batch is a fail-closed, whichever way it is going", () => {
  for (const side of ["client-to-server", "server-to-client"] as const) {
    const r = new Router();
    const notes = r.see(lineOf(Buffer.from('[{"jsonrpc":"2.0","id":1,"method":"tools/list"}]')), side);
    assert.deepEqual(kinds(notes), ["fail-closed"]);
    assert.match((notes[0] as { because: string }).because, /a batch of 1 message\(s\)/);
  }
});

test("a tools/list this cannot read is a fail-closed, with the reason", () => {
  const cases: Array<[unknown, RegExp]> = [
    [{ tools: "not an array" }, /carries no tools array/],
    [{ tools: [{ description: "no name here" }] }, /tool 1 has no name/],
    [{ tools: [tool({}), 7] }, /tool 2 is not an object/],
    ["a string result", /not an object/],
  ];
  for (const [result, why] of cases) {
    const r = new Router();
    r.see(line(listRequest(1)), "client-to-server");
    const notes = r.see(line({ jsonrpc: "2.0", id: 1, result }), "server-to-client");
    assert.deepEqual(kinds(notes), ["fail-closed"], JSON.stringify(result).slice(0, 40));
    assert.match((notes[0] as { because: string }).because, why);
  }
  assert.ok("because" in toolsOf({ tools: 3 }));
  assert.ok("tools" in toolsOf({ tools: [] }), "a server offering nothing is still a readable list");
});

test("an error answer to tools/list is nothing to gate, and is not a fail-closed", () => {
  const r = new Router();
  r.see(line(listRequest(1)), "client-to-server");
  const notes = r.see(line({ jsonrpc: "2.0", id: 1, error: { code: -32601, message: "FIXTURE: no." } }), "server-to-client");
  assert.deepEqual(kinds(notes), []);
});

/* ── Everything else it notices ─────────────────────────────────────────── */

test("a page is named a page, so a partial list is not taken for the surface", () => {
  const r = withBaseline();
  r.see(line(listRequest(2)), "client-to-server");
  const notes = r.see(line(listResult(2, [tool({})], { nextCursor: "abc" })), "server-to-client");
  assert.ok(kinds(notes).includes("pagination"));
});

test("the server asking the client for something is recorded by method and passes", () => {
  const r = new Router();
  for (const method of ["sampling/createMessage", "roots/list", "elicitation/create", "ping"]) {
    const notes = r.see(line({ jsonrpc: "2.0", id: `x-${method}`, method, params: {} }), "server-to-client");
    assert.deepEqual(kinds(notes), ["server-request"]);
    assert.equal((notes[0] as { method: string }).method, method);
  }
});

test("list_changed is noticed", () => {
  const r = new Router();
  const notes = r.see(line({ jsonrpc: "2.0", method: "notifications/tools/list_changed" }), "server-to-client");
  assert.deepEqual(kinds(notes), ["list-changed"]);
});

test("a response is matched to the request that asked, by id, string or number", () => {
  for (const id of [7, "seven", 0]) {
    const r = withBaseline();
    r.see(line({ jsonrpc: "2.0", id, method: "tools/list" }), "client-to-server");
    const notes = r.see(line(listResult(id, [tool({}), tool({ name: "new_one" })])), "server-to-client");
    assert.deepEqual(kinds(notes), ["would-hide"], `id ${JSON.stringify(id)}`);
  }
});

test("a response to something that was never asked is not taken for a tool list", () => {
  const r = withBaseline();
  const notes = r.see(line(listResult(999, [tool({ name: "unasked" })])), "server-to-client");
  assert.deepEqual(kinds(notes), [], "a stray response was read as a tools/list");
});

test("a tools/call response is not a tools/list response", () => {
  const r = withBaseline();
  r.see(line({ jsonrpc: "2.0", id: 5, method: "tools/call" }), "client-to-server");
  const notes = r.see(line({ jsonrpc: "2.0", id: 5, result: { content: [] } }), "server-to-client");
  assert.deepEqual(kinds(notes), []);
});

test("an id reused for a second request is tracked by the second one", () => {
  const r = withBaseline();
  r.see(line({ jsonrpc: "2.0", id: 1, method: "tools/call" }), "client-to-server");
  r.see(line({ jsonrpc: "2.0", id: 1, method: "tools/list" }), "client-to-server");
  const notes = r.see(line(listResult(1, [tool({}), tool({ name: "arrived" })])), "server-to-client");
  assert.deepEqual(kinds(notes), ["would-hide"]);
});

test("a line that is not JSON is noted by size and reason, never by content", () => {
  const r = new Router();
  const notes = r.see(lineOf(Buffer.from("this is not JSON and it mentions " + A)), "server-to-client");
  assert.deepEqual(kinds(notes), ["unparsed-line"]);
  const text = JSON.stringify(notes[0]);
  assert.ok(!text.includes(A), "an unparsed line's content was written into a note");
  assert.ok(text.includes('"bytes"'));
});

test("an empty line is not a broken message", () => {
  const r = new Router();
  assert.deepEqual(kinds(r.see(lineOf(Buffer.from("   ")), "server-to-client")), []);
});

/* ── What it may never carry or say ─────────────────────────────────────── */

test("no note ever carries a description, in any shape", () => {
  const r = withBaseline([tool({})]);
  r.see(line(listRequest(2)), "client-to-server");
  r.see(line(listResult(2, [tool({ description: B2 }), tool({ name: "arrived", description: B2 })])), "server-to-client");
  r.see(lineOf(Buffer.from("noise " + B2)), "server-to-client");
  const text = JSON.stringify(r.notes);
  for (const prose of [A, B2, A.slice(10, 40), B2.slice(10, 40)]) {
    assert.ok(!text.includes(prose), "a note carries the text of a description");
  }
  /* Names, counts, kinds: yes. */
  assert.ok(text.includes("arrived"));
});

test("nothing here says a thing was stopped, and shadow mode says what it did not do", () => {
  const r = withBaseline();
  r.see(line(listRequest(2)), "client-to-server");
  r.see(line(listResult(2, [tool({ description: B2 }), tool({ name: "arrived" })])), "server-to-client");
  r.see(lineOf(Buffer.from("[]")), "server-to-client");
  const text = flatten(JSON.stringify(r.notes) + " " + SHADOW_MEANS + " " + readFileSync(join(ROOT, "watch", "gate", "run.ts"), "utf8"));
  for (const w of [...GATEKEEPING, ...CONTAINMENT, "malicious", "suspicious"]) {
    assert.ok(!text.includes(w), `the gate says "${w}"`);
  }
  assert.match(SHADOW_MEANS, /forwarded exactly as it arrived/);
  assert.match(SHADOW_MEANS, /Nothing was hidden from the client and no call was stopped/);
  assert.equal(r.mode, "shadow");
});

test("no word in any gate module says the server is contained", () => {
  /*
   * Over the SOURCE, not just the output. A comment that called this safe
   * would be read by whoever extends it, and the next thing it said would
   * be a sentence on a page.
   */
  for (const f of ["watch/gate/transport.ts", "watch/gate/router.ts", "watch/gate/run.ts", "watch/gate/fixtures/hostile-server.mjs"]) {
    const src = flatten(readFileSync(join(ROOT, f), "utf8"));
    for (const w of [...CONTAINMENT, ...GATEKEEPING]) {
      assert.ok(!src.includes(w), `${f} says "${w}"`);
    }
  }
});

test("the summary is counts and nothing else", () => {
  const r = withBaseline();
  r.see(line(listRequest(2)), "client-to-server");
  r.see(line(listResult(2, [tool({ name: "arrived" })])), "server-to-client");
  const s = r.summary();
  assert.deepEqual(Object.keys(s).sort(), ["baseline", "would-hide"]);
  for (const v of Object.values(s)) assert.equal(typeof v, "number");
});
