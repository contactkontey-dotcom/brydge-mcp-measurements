/*
 * Decisions: who looked at what, and what they decided about it.
 *
 * EVERY FIXTURE IS PLANTED, and every reviewer is `example-approver` — the
 * placeholder watch/CUSTOMERS.md requires, never a real name from any
 * account. The two description strings are written to read as obvious
 * fixtures, so that a failure printing one cannot be mistaken for a leak of
 * somebody's writing. Nothing here reads a capture.
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { flatten, GATEKEEPING } from "./banned.ts";
import {
  approvedTools,
  decide,
  deserialize,
  heldTools,
  HOLD_MEANS,
  ITEM_KINDS,
  itemHashOf,
  itemKeyOf,
  keyOf,
  lookup,
  put,
  Refused,
  renderTally,
  serialize,
  splitKey,
  tally,
  type DecisionsFile,
  type ReviewItem,
} from "../watch/decisions.ts";

const ROOT = join(import.meta.dirname, "..");
const WHO = "example-approver";
const DAY = "2026-11-12";
const PKG = "fixture-mcp";

const PROSE_A = "FIXTURE A: reads the planted file and returns its planted bytes.";
const PROSE_B = "FIXTURE B: reads the planted file, and now says what happens when it is missing.";

const descriptionItem = (tool = "read_file", after = PROSE_B): ReviewItem => ({
  kind: "description",
  tool,
  before: PROSE_A,
  after,
});
const schemaItem = (tool = "read_file"): ReviewItem => ({
  kind: "input schema",
  tool,
  before: { type: "object", properties: { path: { type: "string" } } },
  after: { type: "object", properties: { path: { type: "string" }, mode: { type: "string" } } },
});
const newToolItem = (tool = "write_file"): ReviewItem => ({
  kind: "new tool",
  tool,
  before: null,
  after: { name: tool, description: PROSE_A, inputSchema: { type: "object" } },
});

const save = (file: DecisionsFile, item: ReviewItem, decision: "approve" | "hold", opts: Partial<{ by: string; at: string; from: string; to: string }> = {}) =>
  put(file, PKG, decide({
    item,
    decision,
    by: opts.by ?? WHO,
    at: opts.at ?? DAY,
    fromVersion: opts.from ?? "1.0.0",
    toVersion: opts.to ?? "1.1.0",
  }));

/* ── A record ───────────────────────────────────────────────────────────── */

test("a record carries the eight things it is asked to carry, and nothing else", () => {
  const r = decide({ item: descriptionItem(), decision: "approve", by: WHO, at: DAY, fromVersion: "1.0.0", toVersion: "1.1.0" });
  assert.deepEqual(Object.keys(r).sort(), ["at", "by", "decision", "fromVersion", "itemHash", "kind", "name", "toVersion"]);
  assert.equal(r.kind, "description");
  assert.equal(r.name, "read_file");
  assert.equal(r.decision, "approve");
  assert.equal(r.by, WHO);
  assert.equal(r.at, DAY);
  assert.equal(r.itemHash, itemHashOf(descriptionItem()));
  assert.match(r.itemHash, /^[0-9a-f]{64}$/);
});

test("a decision refuses rather than guessing", () => {
  const base = { item: descriptionItem(), decision: "approve" as const, by: WHO, at: DAY, fromVersion: "1.0.0", toVersion: "1.1.0" };
  const refuses = (over: Record<string, unknown>, why: RegExp) =>
    assert.throws(() => decide({ ...base, ...over } as any), (e: Error) => e instanceof Refused && why.test(e.message), why.source);
  refuses({ by: "   " }, /needs a name/);
  refuses({ at: "12/11/2026" }, /not a date as YYYY-MM-DD/);
  refuses({ at: "2026-11-12T09:00:00Z" }, /not a date as YYYY-MM-DD/);
  refuses({ decision: "maybe" }, /not a decision/);
  refuses({ decision: "reject" }, /not a decision/);
  refuses({ item: { ...descriptionItem(), tool: " " } }, /names no tool/);
  refuses({ item: { ...descriptionItem(), kind: "other field" } }, /not a kind of item/);
  refuses({ toVersion: "" }, /between two named versions/);
});

test("the three kinds are the three the diffs can show", () => {
  assert.deepEqual(ITEM_KINDS, ["description", "input schema", "new tool"]);
  /* A tool differing only in some other field is deliberately not among
   * them: Stage 4 counts those in one line. */
  assert.ok(!ITEM_KINDS.includes("_meta" as any));
});

/* ── The hash is what a decision is about ───────────────────────────────── */

test("a decision does not apply once either side of the item has changed", () => {
  const file = save({}, descriptionItem(), "approve");
  assert.equal(lookup(file, PKG, "1.1.0", descriptionItem()).state, "decided");

  /* The maintainer edits that description again. */
  const edited = descriptionItem("read_file", PROSE_B + " And a third sentence.");
  const found = lookup(file, PKG, "1.1.0", edited);
  assert.equal(found.state, "stale");
  if (found.state !== "stale") return;
  assert.match(found.because, /a different description for this tool/);
  assert.match(found.because, /recorded [0-9a-f]{12}, this item is [0-9a-f]{12}/);

  /* And the other way: the text it was approved against is what matters, not
   * only the text it became. */
  const earlier: ReviewItem = { kind: "description", tool: "read_file", before: "FIXTURE ZERO: something else.", after: PROSE_B };
  assert.equal(lookup(file, PKG, "1.1.0", earlier).state, "stale");
});

test("one tool's description and its input schema are two decisions", () => {
  let file = save({}, descriptionItem(), "approve");
  file = save(file, schemaItem(), "hold");
  assert.equal(lookup(file, PKG, "1.1.0", descriptionItem()).state, "decided");
  const s = lookup(file, PKG, "1.1.0", schemaItem());
  assert.equal(s.state, "decided");
  if (s.state === "decided") assert.equal(s.record.decision, "hold");
  assert.notEqual(itemHashOf(descriptionItem()), itemHashOf(schemaItem()));
});

test("two items with the same content under different kinds hash differently", () => {
  const same = { type: "object" };
  const asSchema: ReviewItem = { kind: "input schema", tool: "t", before: null, after: same };
  const asTool: ReviewItem = { kind: "new tool", tool: "t", before: null, after: same };
  assert.notEqual(itemHashOf(asSchema), itemHashOf(asTool));
});

test("a schema's key order is not a change, so a decision survives a reserialised schema", () => {
  const one: ReviewItem = { kind: "input schema", tool: "t", before: null, after: { a: 1, b: 2 } };
  const other: ReviewItem = { kind: "input schema", tool: "t", before: null, after: { b: 2, a: 1 } };
  assert.equal(itemHashOf(one), itemHashOf(other));
});

test("a decision filed for one version is not handed back for another", () => {
  const file = save({}, descriptionItem(), "approve", { to: "1.1.0" });
  /* Reached under the version it was filed for, by a caller asking about a
   * different one: the record is there and does not apply. */
  const moved: DecisionsFile = { [keyOf(PKG, "1.2.0")]: file[keyOf(PKG, "1.1.0")]! };
  const found = lookup(moved, PKG, "1.2.0", descriptionItem());
  assert.equal(found.state, "stale");
  if (found.state === "stale") assert.match(found.because, /about the change to 1\.1\.0/);
});

test("deciding again replaces the decision, with its own name and date", () => {
  let file = save({}, descriptionItem(), "hold", { by: "example-approver", at: "2026-11-10" });
  file = save(file, descriptionItem(), "approve", { by: "example-second-approver", at: DAY });
  const found = lookup(file, PKG, "1.1.0", descriptionItem());
  assert.equal(found.state, "decided");
  if (found.state !== "decided") return;
  assert.equal(found.record.decision, "approve");
  assert.equal(found.record.by, "example-second-approver");
  assert.equal(found.record.at, DAY);
  assert.equal(Object.keys(file[keyOf(PKG, "1.1.0")]!).length, 1, "the replaced decision was kept as well");
});

test("put does not change the file it is given", () => {
  const before: DecisionsFile = {};
  const after = save(before, descriptionItem(), "approve");
  assert.deepEqual(before, {}, "put wrote into its argument");
  assert.equal(Object.keys(after).length, 1);
});

/* ── A tally ────────────────────────────────────────────────────────────── */

test("every item lands in exactly one bucket", () => {
  const items = [descriptionItem(), schemaItem(), newToolItem(), descriptionItem("other_tool")];
  let file = save({}, descriptionItem(), "approve");
  file = save(file, schemaItem(), "hold");
  /* A decision about an earlier edit of other_tool's description. */
  file = save(file, descriptionItem("other_tool", "FIXTURE C: an earlier edit."), "approve");

  const t = tally(file, PKG, "1.1.0", items);
  assert.deepEqual(t.approved.map((r) => r.name), ["read_file"]);
  assert.deepEqual(t.held.map((r) => r.name), ["read_file"]);
  assert.deepEqual(t.undecided.map((i) => i.tool), ["write_file"]);
  assert.deepEqual(t.stale.map((s) => s.item.tool), ["other_tool"]);
  assert.equal(t.approved.length + t.held.length + t.undecided.length + t.stale.length, items.length);
});

test("a decision about an item nobody is being shown counts for nothing", () => {
  const file = save({}, descriptionItem("gone_tool"), "approve");
  const t = tally(file, PKG, "1.1.0", [newToolItem()]);
  assert.deepEqual(approvedTools(t), [], "a decision about an absent item was carried into the approved set");
  assert.deepEqual(t.undecided.map((i) => i.tool), ["write_file"]);
});

test("approved and held tool names, with approved winning a tool that has both", () => {
  let file = save({}, descriptionItem(), "approve");
  file = save(file, schemaItem(), "hold");
  file = save(file, newToolItem(), "hold");
  const t = tally(file, PKG, "1.1.0", [descriptionItem(), schemaItem(), newToolItem()]);
  assert.deepEqual(approvedTools(t), ["read_file"]);
  /* read_file has a held item too, and is not in heldTools: something of it
   * was approved, so naming it held would be saying a thing that is not so. */
  assert.deepEqual(heldTools(t), ["write_file"]);
});

/* ── The file on disk ───────────────────────────────────────────────────── */

test("a file survives a round trip, keys sorted at both levels", () => {
  let file = save({}, schemaItem("zebra"), "hold");
  file = save(file, descriptionItem("alpha"), "approve");
  file = save(file, descriptionItem("alpha"), "approve", { to: "1.0.1" });
  const text = serialize(file);
  assert.deepEqual(deserialize(text), file);
  assert.deepEqual(Object.keys(deserialize(text)), [keyOf(PKG, "1.0.1"), keyOf(PKG, "1.1.0")]);
  assert.deepEqual(Object.keys(deserialize(text)[keyOf(PKG, "1.1.0")]!), ["description:alpha", "input schema:zebra"]);
  /* The replacer trap that emptied watch/approved.ts: a record that
   * serialised as {} would survive a deepEqual against nothing else. */
  assert.ok(text.includes('"itemHash"'), "the records serialised without their fields");
  assert.ok(text.includes(WHO));
});

test("the file holds no description text, no schema and no tool definition", () => {
  let file = save({}, descriptionItem(), "approve");
  file = save(file, schemaItem(), "approve");
  file = save(file, newToolItem(), "hold");
  const text = serialize(file);
  for (const prose of [PROSE_A, PROSE_B, PROSE_A.slice(10, 40), PROSE_B.slice(10, 40)]) {
    assert.ok(!text.includes(prose), "the decisions file holds the text of a description");
  }
  for (const bit of ["inputSchema", "properties", "type\":", "mode"]) {
    assert.ok(!text.includes(bit), `the decisions file holds part of a schema: ${bit}`);
  }
});

test("a file that is not decisions is refused, and the reason names the place", () => {
  const refuses = (text: string, why: RegExp) =>
    assert.throws(() => deserialize(text), (e: Error) => e instanceof Refused && why.test(e.message), `${why.source} for ${text.slice(0, 50)}`);
  refuses('{"no-version-here": {}}', /not a package@version key/);
  refuses(`{"${keyOf(PKG, "1.1.0")}": []}`, /not a group of records/);
  refuses(`{"${keyOf(PKG, "1.1.0")}": {"description:t": {}}}`, /has no kind of item/);
  const good = decide({ item: descriptionItem("t"), decision: "approve", by: WHO, at: DAY, fromVersion: "1.0.0", toVersion: "1.1.0" });
  const under = (itemKey: string, over: Record<string, unknown> = {}) =>
    JSON.stringify({ [keyOf(PKG, "1.1.0")]: { [itemKey]: { ...good, ...over } } });
  refuses(under("description:t", { by: "" }), /nobody decided it/);
  refuses(under("description:t", { at: "yesterday" }), /no date as YYYY-MM-DD/);
  refuses(under("description:t", { itemHash: "abc" }), /no sha256 of what was looked at/);
  refuses(under("description:t", { decision: "veto" }), /has no decision/);
  /* A record moved to another key would otherwise answer for a tool it is
   * not about. */
  refuses(under("description:other_tool"), /filed under "description:other_tool"/);
  assert.deepEqual(Object.keys(deserialize(under("description:t"))[keyOf(PKG, "1.1.0")]!), ["description:t"]);
});

test("keys split on the last @, so a scoped package survives", () => {
  assert.deepEqual(splitKey("@scope/pkg@1.2.3"), { package: "@scope/pkg", version: "1.2.3" });
  assert.deepEqual(splitKey("plain@0.0.1"), { package: "plain", version: "0.0.1" });
  assert.equal(splitKey("@scope/pkg"), null);
  assert.equal(splitKey("pkg@"), null);
  assert.equal(splitKey("@1.0.0"), null);
  assert.equal(itemKeyOf({ kind: "new tool", tool: "a_b" }), "new tool:a_b");
});

/* ── What it may not say ────────────────────────────────────────────────── */

test("hold is defined as three things, and claiming anything is stopped is not one", () => {
  assert.equal(HOLD_MEANS, "looked at, not added to the list, not in the allow rules");
  let file = save({}, descriptionItem(), "hold");
  file = save(file, newToolItem(), "approve");
  const text = renderTally(tally(file, PKG, "1.1.0", [descriptionItem(), schemaItem(), newToolItem()]), PKG, "1.0.0", "1.1.0");
  assert.ok(text.includes(`held means: ${HOLD_MEANS}.`), text);
  const flat = flatten([text, HOLD_MEANS].join("\n"));
  for (const w of GATEKEEPING) assert.ok(!flat.includes(w), `the output says "${w}"`);
  for (const w of ["reject", "rejected", "approval required", "gate", "quarantine", "ban", "disable", "stop"]) {
    assert.ok(!flat.includes(w), `the output claims to stop something: "${w}"`);
  }
});

test("a tally prints what each item is, and never what it says", () => {
  const file = save({}, descriptionItem(), "approve");
  const text = renderTally(tally(file, PKG, "1.1.0", [descriptionItem(), newToolItem()]), PKG, "1.0.0", "1.1.0");
  for (const prose of [PROSE_A, PROSE_B]) assert.ok(!text.includes(prose), "a tally printed a description");
  assert.match(text, /description — read_file, by example-approver on 2026-11-12/);
  assert.match(text, /new tool — write_file/);
  assert.match(text, /2 items to review/);
});

test("the module cannot read or write a file", () => {
  const src = flatten(
    readFileSync(join(ROOT, "watch", "decisions.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, ""),
  );
  for (const w of ["node:fs", "readfilesync", "writefilesync", "createrequire", "require(", "fetch("]) {
    assert.ok(!src.includes(w), `watch/decisions.ts reaches for "${w}"`);
  }
});
