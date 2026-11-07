import { test } from "node:test";
import assert from "node:assert/strict";
import { canonical, captureFrom, diffTools, firstDifference, parseToolList, recordOf, renderToolDiff, toolsFromSession } from "../watch/tools.ts";

const tool = (name: string, description: string | null, schema: unknown = { type: "object", properties: {} }, extra: Record<string, unknown> = {}) => ({
  name,
  ...(description === null ? {} : { description }),
  inputSchema: schema,
  ...extra,
});

/* ── hashing ────────────────────────────────────────────────────────────── */

test("key order is not a change", () => {
  /* A server may serialise its schema's keys in any order, and two orderings
   * of the same schema are the same schema. Hashing raw text would report a
   * change every time a serialiser changed its mind. */
  assert.equal(canonical({ b: 1, a: 2 }), canonical({ a: 2, b: 1 }));
  assert.equal(canonical({ a: { y: 1, x: [3, { q: 1, p: 2 }] } }), canonical({ a: { x: [3, { p: 2, q: 1 }] , y: 1 } }));
  const x = recordOf(tool("t", "d", { type: "object", required: ["a"], properties: { a: { type: "string" } } }));
  const y = recordOf(tool("t", "d", { properties: { a: { type: "string" } }, required: ["a"], type: "object" }));
  assert.equal(x.hash, y.hash);
  /* Array order IS meaningful and must not be normalised away. */
  assert.notEqual(canonical({ r: ["a", "b"] }), canonical({ r: ["b", "a"] }));
});

test("the three hashes move independently", () => {
  const base = recordOf(tool("t", "first", { type: "object" }));
  const reworded = recordOf(tool("t", "second", { type: "object" }));
  const reschemad = recordOf(tool("t", "first", { type: "object", properties: { n: { type: "number" } } }));
  assert.notEqual(base.descriptionHash, reworded.descriptionHash);
  assert.equal(base.schemaHash, reworded.schemaHash, "a reworded description moved the schema hash");
  assert.equal(base.descriptionHash, reschemad.descriptionHash, "a changed schema moved the description hash");
  assert.notEqual(base.schemaHash, reschemad.schemaHash);
  assert.notEqual(base.hash, reworded.hash);
});

test("a tool with no description or schema hashes to null for those, not to a hash of nothing", () => {
  const r = recordOf({ name: "bare" });
  assert.equal(r.description, null);
  assert.equal(r.descriptionHash, null);
  assert.equal(r.schemaHash, null);
  assert.ok(r.hash.length === 64);
});

test("fields we do not single out are kept and still counted in the whole-tool hash", () => {
  const a = recordOf(tool("t", "d", { type: "object" }, { annotations: { readOnlyHint: true } }));
  const b = recordOf(tool("t", "d", { type: "object" }, { annotations: { readOnlyHint: false } }));
  assert.deepEqual(a.extra.annotations, { readOnlyHint: true });
  assert.equal(a.descriptionHash, b.descriptionHash);
  assert.equal(a.schemaHash, b.schemaHash);
  assert.notEqual(a.hash, b.hash, "a change outside description and schema went unnoticed");
  const d = diffTools([a], [b]);
  assert.deepEqual(d.changed[0]!.what, ["/annotations/readOnlyHint"], "the field that moved was not named");
});

/* ── the shapes a list arrives in ───────────────────────────────────────── */

test("a tool list is accepted in each shape somebody would send it", () => {
  const list = [tool("a", "x"), tool("b", "y")];
  for (const shape of [list, { tools: list }, { result: { tools: list } }, { message: { result: { tools: list } } }]) {
    assert.equal(parseToolList(shape).length, 2);
  }
});

test("something that is not a tool list is refused, with what was expected", () => {
  for (const bad of [{}, [1, 2], [{ noName: true }], { tools: "nope" }, null, "x"]) {
    assert.throws(() => parseToolList(bad), /no tool list found/);
  }
  /* An empty list is a list. A server that offers no tools is a real case,
   * and refusing it would turn "it offered nothing" into a parse error. */
  assert.deepEqual(parseToolList([]), []);
  assert.deepEqual(parseToolList({ tools: [] }), []);
});

/* ── pulling it out of a stored session ─────────────────────────────────── */

test("the reply is matched by id, not by being a message with a tools key", () => {
  const list = [tool("a", "x")];
  const session = {
    transcript: [
      { t: 1, dir: "to-server", message: { jsonrpc: "2.0", id: 1, method: "initialize" } },
      { t: 2, dir: "from-server", message: { jsonrpc: "2.0", id: 1, result: { serverInfo: {} } } },
      { t: 3, dir: "to-server", message: { jsonrpc: "2.0", id: 2, method: "tools/list" } },
      /* A notification that happens to carry a tools key. Not the answer. */
      { t: 4, dir: "from-server", message: { jsonrpc: "2.0", method: "notifications/message", result: { tools: [tool("decoy", "no")] } } },
      { t: 5, dir: "from-server", message: { jsonrpc: "2.0", id: 2, result: { tools: list } } },
    ],
  };
  const got = toolsFromSession(session)!;
  assert.equal(got.length, 1);
  assert.equal(got[0]!.name, "a", "a notification was taken for the reply");
});

test("a session with no tools/list reply yields null, not an empty list", () => {
  /* Null and [] mean different things: "it never answered" and "it offered
   * nothing". Collapsing them would let a failed run read as a server with
   * no tools. */
  assert.equal(toolsFromSession({ transcript: [] }), null);
  assert.equal(toolsFromSession({}), null);
  assert.equal(
    toolsFromSession({ transcript: [{ dir: "to-server", message: { id: 2, method: "tools/list" } }] }),
    null,
  );
});

/* ── diffing ────────────────────────────────────────────────────────────── */

test("added, removed, changed and identical are counted separately", () => {
  const a = captureFrom("p", "1", [tool("keep", "same"), tool("edit", "before"), tool("gone", "x")], "2026-11-06");
  const b = captureFrom("p", "2", [tool("keep", "same"), tool("edit", "after"), tool("new", "y")], "2026-11-06");
  const d = diffTools(a.tools, b.tools);
  assert.deepEqual(d.added, ["new"]);
  assert.deepEqual(d.removed, ["gone"]);
  assert.equal(d.changed.length, 1);
  assert.equal(d.changed[0]!.name, "edit");
  assert.deepEqual(d.changed[0]!.what, ["description"]);
  assert.equal(d.unchanged, 1);
});

test("a tool whose description and schema both moved says both", () => {
  const a = captureFrom("p", "1", [tool("t", "before", { type: "object" })], "x");
  const b = captureFrom("p", "2", [tool("t", "after", { type: "string" })], "x");
  assert.deepEqual(diffTools(a.tools, b.tools).changed[0]!.what, ["description", "input schema"]);
});

test("the first differing line is found, so a reworded description need not be dumped whole", () => {
  const before = "Line one.\nLine two.\nLine three.";
  const after = "Line one.\nLine two, revised.\nLine three.";
  const fd = firstDifference(before, after)!;
  assert.equal(fd.at, 2);
  assert.match(fd.before, /^Line two\.$/);
  assert.match(fd.after, /revised/);
  assert.equal(firstDifference("same", "same"), null);
  /* One side longer than the other must not crash or read as equal. */
  assert.equal(firstDifference("a", "a\nb")!.at, 2);
  assert.equal(firstDifference(null, "a")!.at, 1);
});

test("the rendered diff reports counts, shows what moved, and judges nothing", () => {
  const a = captureFrom("p", "1", [tool("keep", "same"), tool("edit", "Old first line.\nrest")], "x");
  const b = captureFrom("p", "2", [tool("keep", "same"), tool("edit", "New first line.\nrest"), tool("new", "y")], "x");
  const text = renderToolDiff("p", "1", "2", diffTools(a.tools, b.tools));
  assert.match(text, /1 added, 0 removed, 1 changed, 1 identical\./);
  assert.match(text, /\+ new/);
  assert.match(text, /edit: description/);
  assert.match(text, /before: Old first line\./);
  assert.match(text, /after:  New first line\./);
  assert.match(text, /What this does not say/);
  assert.match(text, /no tool was called/);
  assert.equal(/\b(safe|unsafe|suspicious|malicious|dangerous)\b/i.exec(text), null);
});

test("both texts are printed, and --full stops them being clipped", () => {
  /* A description is the sentence a model reads before deciding whether to
   * call a tool. "The description changed" is not the useful part — what it
   * now says is — so both texts are printed in either mode. */
  const long = "x".repeat(900);
  const a = captureFrom("p", "1", [tool("t", "aaa\nbbb" + long)], "x");
  const b = captureFrom("p", "2", [tool("t", "aaa\nccc" + long)], "x");
  const d = diffTools(a.tools, b.tools);

  const clipped = renderToolDiff("p", "1", "2", d);
  assert.match(clipped, /before: aaa\nbbb/);
  assert.match(clipped, /after:  aaa\nccc/);
  assert.match(clipped, /description 907 characters -> 907 characters/);
  assert.match(clipped, / …/, "a long description was not clipped");
  assert.match(clipped, /first line that differs is line 2/);

  const full = renderToolDiff("p", "1", "2", d, { full: true });
  assert.ok(full.includes("bbb" + long), "--full clipped the description anyway");
  assert.ok(full.length > clipped.length);
});

test("a description that appears or disappears is printed as such, not as empty text", () => {
  const a = captureFrom("p", "1", [tool("t", null)], "x");
  const b = captureFrom("p", "2", [tool("t", "now described")], "x");
  const text = renderToolDiff("p", "1", "2", diffTools(a.tools, b.tools));
  assert.match(text, /description \(none\) -> 13 characters/);
  assert.match(text, /before: \(none\)/);
  assert.match(text, /after:  now described/);
});

test("a capture sorts by name so two captures of one version compare directly", () => {
  const c = captureFrom("p", "1", [tool("z", "1"), tool("a", "2")], "x");
  assert.deepEqual(c.tools.map((t) => t.name), ["a", "z"]);
  assert.equal(c.count, 2);
});
