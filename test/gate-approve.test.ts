/*
 * A decision, carried into the pin.
 *
 * Every fixture is planted and every reviewer is `example-approver`. The
 * description strings read as fixtures so a failure that printed one could
 * not be mistaken for somebody's package. Nothing here reads a capture.
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { CONTAINMENT, flatten, GATEKEEPING } from "./banned.ts";
import { carry, itemFor, renderCarried } from "../watch/gate/approve.ts";
import { ADOPTED, adopt, parse, serialize } from "../watch/gate/pin.ts";
import { pendingOf } from "../watch/gate/report.ts";
import type { WouldHide } from "../watch/gate/router.ts";
import { itemHashOf, keyOf, Refused, type DecisionsFile } from "../watch/decisions.ts";
import { FORMAT, FORMAT_VERSION, type Exported } from "../watch/review.ts";
import { normalise, recordOf, type ToolRecord } from "../watch/tools.ts";

const ROOT = join(import.meta.dirname, "..");
const WHO = "example-approver";
const DAY = "2026-11-13";
const PKG = "fixture-mcp";

const A = "FIXTURE A: reads the planted file and returns its planted bytes.";
const B = "FIXTURE B: reads the planted file and says what happens when it is missing.";
const C = "FIXTURE C: reads the planted file, a third time, differently.";

const tool = (over: Record<string, unknown> = {}): ToolRecord =>
  recordOf({ name: "read_file", description: A, inputSchema: { type: "object" }, ...over });

/** A pin of two tools, and a live surface where one description moved and one tool arrived. */
const pinned = [tool(), tool({ name: "list_dir" })];
const live = [tool({ description: B }), tool({ name: "list_dir" }), tool({ name: "write_file", description: C })];
const hidden: WouldHide[] = [
  { tool: "read_file", because: "its description differs from the baseline" },
  { tool: "write_file", because: "not in the baseline" },
];

const basePin = () => adopt(PKG, "1.0.0", pinned, "2026-11-01");
const report = (pin = basePin(), offered = live, hide = hidden) => pendingOf(pin, offered, hide, DAY);

const exportOf = (decisions: Exported["decisions"], over: Partial<Exported> = {}): Exported => ({
  format: FORMAT,
  version: FORMAT_VERSION,
  package: PKG,
  fromVersion: "pinned 2026-11-01",
  toVersion: `offered ${DAY}`,
  decisions,
  ...over,
});

/** A decision taken straight from what the report says about that item. */
const decisionFor = (p: ReturnType<typeof report>, kind: string, name: string, decision: "approve" | "hold") => {
  const item = p.prepared.items.find((i) => i.kind === kind && i.tool === name)!;
  return { kind: item.kind, name, decision, by: WHO, at: DAY, itemHash: item.itemHash };
};

/* ── The report carries what an approval needs ──────────────────────────── */

test("the report carries the live definition of every tool it flagged", () => {
  const p = report();
  assert.deepEqual(Object.keys(p.offered).sort(), ["read_file", "write_file"]);
  /* Without it an approval would have nothing to pin, and re-reading the
   * server to find it again would be pinning a surface nobody reviewed. */
  assert.equal(p.offered["read_file"]!.description, B);
  assert.ok(!("list_dir" in p.offered), "a tool nobody flagged was carried anyway");
});

/* ── Approving ──────────────────────────────────────────────────────────── */

test("an approved change is pinned, and the next run would not flag it", () => {
  const pin = basePin();
  const p = report(pin);
  const a = carry({ pin, pending: p, incoming: exportOf([decisionFor(p, "description", "read_file", "approve")]), decisions: {} });

  assert.deepEqual(a.carried.approved.map((x) => x.tool), ["read_file"]);
  assert.equal(a.pinChanged, true);
  assert.equal(a.pin.tools["read_file"]!.definition.description, B, "the pin still holds the old description");
  assert.equal(a.pin.tools["read_file"]!.how, "approve");
  assert.equal(a.pin.tools["read_file"]!.by, WHO);
  assert.equal(a.pin.tools["read_file"]!.at, DAY);
  assert.match(a.pin.tools["read_file"]!.itemHash!, /^[0-9a-f]{64}$/);

  /* The next run, against the new pin: read_file no longer differs. */
  const again = report(a.pin, live, []);
  assert.equal(a.pin.tools["read_file"]!.hash, normalise(live[0]!).hash);
  assert.ok(!again.wouldHide.length);
  /* And the pin it produced is one `parse` accepts. */
  assert.doesNotThrow(() => parse(serialize(a.pin)));
});

test("a held item is recorded and not pinned, so the next run flags it again", () => {
  const pin = basePin();
  const p = report(pin);
  const a = carry({ pin, pending: p, incoming: exportOf([decisionFor(p, "description", "read_file", "hold")]), decisions: {} });

  assert.deepEqual(a.carried.held.map((x) => x.tool), ["read_file"]);
  assert.equal(a.pinChanged, false, "a hold changed the pin");
  assert.equal(a.pin.tools["read_file"]!.definition.description, A, "a hold overwrote the pinned definition");
  assert.ok(a.carried.stillFlagged.includes("read_file"));

  /* The decision is in the record even though the pin has nowhere to put
   * it: holding is the absence of an approval, not a state to store. */
  const key = keyOf(PKG, `offered ${DAY}`);
  assert.equal(a.decisions[key]!["description:read_file"]!.decision, "hold");
  assert.equal(a.decisions[key]!["description:read_file"]!.by, WHO);
});

test("a new tool approved is pinned whole; held, it stays off the pin", () => {
  const pin = basePin();
  const p = report(pin);
  const approved = carry({ pin, pending: p, incoming: exportOf([decisionFor(p, "new tool", "write_file", "approve")]), decisions: {} });
  assert.ok(approved.pin.tools["write_file"], "an approved new tool was not pinned");
  assert.equal(approved.pin.tools["write_file"]!.definition.description, C);

  const held = carry({ pin, pending: p, incoming: exportOf([decisionFor(p, "new tool", "write_file", "hold")]), decisions: {} });
  assert.equal(held.pin.tools["write_file"], undefined, "a held new tool was pinned anyway");
  assert.ok(held.carried.stillFlagged.includes("write_file"));
});

test("approving one of two leaves the other flagged", () => {
  const pin = basePin();
  const p = report(pin);
  const a = carry({
    pin,
    pending: p,
    incoming: exportOf([decisionFor(p, "description", "read_file", "approve"), decisionFor(p, "new tool", "write_file", "hold")]),
    decisions: {},
  });
  assert.deepEqual(a.carried.stillFlagged, ["write_file"]);
  assert.match(renderCarried(a, "/tmp/pin.json"), /1 tool\(s\) still differ from the pin: write_file\./);
});

/* ── THE RULE: a decision never applies to an item with a different hash ── */

test("a decision does not carry to an item the server changed after the report", () => {
  /*
   * The case the whole mechanism is for. Somebody reads the report, decides
   * to approve the new description — and before the decision is applied the
   * server edits that description AGAIN. The decision is about text nobody
   * has now read, and carrying it would make "approved" mean "approved this
   * tool, whatever it says next".
   */
  const pin = basePin();
  const p = report(pin);
  const decision = decisionFor(p, "description", "read_file", "approve");

  /* The report is rewritten with a third description: same tool, same kind,
   * different content. */
  const changed = report(pin, [tool({ description: C }), tool({ name: "list_dir" })], [hidden[0]!]);
  const a = carry({ pin, pending: changed, incoming: exportOf([decision]), decisions: {} });

  assert.deepEqual(a.carried.approved, [], "the decision was carried onto a different description");
  assert.equal(a.pinChanged, false);
  assert.equal(a.carried.refused.length, 1);
  assert.match(a.carried.refused[0]!.because, /a different description for read_file/);
  assert.match(a.carried.refused[0]!.because, /the file says [0-9a-f]{12}, the report says [0-9a-f]{12}/);
  assert.ok(a.carried.stillFlagged.includes("read_file"), "the tool stopped being flagged without an approval");
});

test("a report whose offered definition no longer matches its own item hash is refused", () => {
  /*
   * The other half of the same rule: the decision and the report agree, and
   * the definition the report carries is not the one that hash is of. A
   * report edited by hand, or assembled wrongly, pins nothing.
   */
  const pin = basePin();
  const p = report(pin);
  const decision = decisionFor(p, "description", "read_file", "approve");
  const tampered = { ...p, offered: { ...p.offered, read_file: { ...p.offered["read_file"]!, description: C } } };
  const a = carry({ pin, pending: tampered, incoming: exportOf([decision]), decisions: {} });
  assert.equal(a.carried.approved.length, 0);
  assert.match(a.carried.refused[0]!.because, /has changed since that report was written/);
});

test("a decision about a tool the report does not carry is refused by name", () => {
  const pin = basePin();
  const p = report(pin);
  const a = carry({
    pin,
    pending: p,
    incoming: exportOf([{ kind: "description", name: "no_such_tool", decision: "approve", by: WHO, at: DAY, itemHash: "0".repeat(64) }]),
    decisions: {},
  });
  assert.match(a.carried.refused[0]!.because, /the report carries no description for no_such_tool/);
  assert.equal(a.pinChanged, false);
});

test("decisions about another package are refused outright", () => {
  const pin = basePin();
  const p = report(pin);
  assert.throws(
    () => carry({ pin, pending: p, incoming: exportOf([], { package: "other-mcp" }), decisions: {} }),
    (e: Error) => e instanceof Refused && /about other-mcp, and this pin is for fixture-mcp/.test(e.message),
  );
});

test("a record that cannot be made into a decision is refused, not written", () => {
  const pin = basePin();
  const p = report(pin);
  const a = carry({
    pin,
    pending: p,
    incoming: exportOf([{ ...decisionFor(p, "description", "read_file", "approve"), by: "   " }]),
    decisions: {},
  });
  assert.match(a.carried.refused[0]!.because, /needs a name/);
  assert.equal(a.pinChanged, false);
  assert.deepEqual(a.decisions, {}, "a refused decision was recorded anyway");
});

/* ── itemFor ────────────────────────────────────────────────────────────── */

test("an item is rebuilt from the pin and the live definition, per kind", () => {
  const pin = basePin();
  const liveDef = { name: "read_file", description: B, inputSchema: { type: "object", properties: { p: { type: "string" } } } };
  const d = itemFor("description", "read_file", pin.tools["read_file"], liveDef)!;
  assert.deepEqual(d, { kind: "description", tool: "read_file", before: A, after: B });
  const s = itemFor("input schema", "read_file", pin.tools["read_file"], liveDef)!;
  assert.deepEqual(s.before, { type: "object" });
  const n = itemFor("new tool", "write_file", undefined, liveDef)!;
  assert.equal(n.before, null);
  assert.equal(itemFor("description", "read_file", undefined, liveDef), null, "a description was diffed against no pin");
  assert.equal(itemFor("description", "read_file", pin.tools["read_file"], undefined), null);
  assert.equal(itemHashOf(d), itemHashOf({ kind: "description", tool: "read_file", before: A, after: B }));
});

/* ── What it may not say ────────────────────────────────────────────────── */

test("nothing printed carries a description, or claims the server is contained", () => {
  const pin = basePin();
  const p = report(pin);
  const a = carry({
    pin,
    pending: p,
    incoming: exportOf([decisionFor(p, "description", "read_file", "approve"), decisionFor(p, "new tool", "write_file", "hold")]),
    decisions: {} as DecisionsFile,
  });
  const text = renderCarried(a, "/tmp/pin.json");
  for (const prose of [A, B, C, A.slice(10, 40), B.slice(10, 40)]) {
    assert.ok(!text.includes(prose), "the output printed a description");
  }
  const flat = flatten(text + readFileSync(join(ROOT, "watch", "gate", "approve.ts"), "utf8"));
  for (const w of [...CONTAINMENT, ...GATEKEEPING]) assert.ok(!flat.includes(w), `it says "${w}"`);
  assert.ok(flat.includes("held"));
});

test("the module cannot read or write a file", () => {
  const src = flatten(
    readFileSync(join(ROOT, "watch", "gate", "approve.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, ""),
  );
  for (const w of ["node:fs", "readfilesync", "writefilesync", "require(", "fetch("]) {
    assert.ok(!src.includes(w), `watch/gate/approve.ts reaches for "${w}"`);
  }
});

test("an adopted pin stays adopted at the top, and an approved tool says approve", () => {
  const pin = basePin();
  const p = report(pin);
  const a = carry({ pin, pending: p, incoming: exportOf([decisionFor(p, "description", "read_file", "approve")]), decisions: {} });
  assert.equal(a.pin.source, ADOPTED, "approving one tool relabelled the whole pin as reviewed");
  assert.equal(a.pin.tools["read_file"]!.how, "approve");
  assert.equal(a.pin.tools["list_dir"]!.how, ADOPTED, "a tool nobody decided about was relabelled");
});

/* ── The round trip the pin depends on ──────────────────────────────────── */

test("a tool with no inputSchema at all stops being flagged once approved", () => {
  /*
   * THE DEFECT THIS PINS. `definitionOf` writes `inputSchema: null` for a
   * tool whose wire object has no such key, so the definition a pin stores
   * hashed differently from the tool it came from — and a gate comparing
   * them flagged that tool on every run for ever, whatever anybody
   * approved. Both sides are normalised now; this fixture has no schema at
   * all, which is the shape that broke.
   */
  const bare = (description: string) => recordOf({ name: "ping", description });
  const pin = adopt(PKG, "1.0.0", [bare(A)], "2026-11-01");
  const liveBare = [bare(B)];
  const flagged: WouldHide[] = [{ tool: "ping", because: "its description differs from the baseline" }];
  const p = pendingOf(pin, liveBare, flagged, DAY);

  const a = carry({ pin, pending: p, incoming: exportOf([decisionFor(p, "description", "ping", "approve")]), decisions: {} });
  assert.deepEqual(a.carried.approved.map((x) => x.tool), ["ping"]);
  assert.deepEqual(a.carried.stillFlagged, [], "an approved tool with no schema is still flagged");
  assert.equal(a.pin.tools["ping"]!.hash, normalise(liveBare[0]!).hash);
  assert.equal(a.pin.tools["ping"]!.schemaHash, null);
  assert.doesNotThrow(() => parse(serialize(a.pin)), "the pin it wrote is not one the reader accepts");
});

test("normalising is idempotent, so a pin re-pinned is the same pin", () => {
  for (const raw of [
    { name: "a", description: A },
    { name: "b", description: A, inputSchema: { type: "object" } },
    { name: "c", description: null, inputSchema: null },
    { name: "d", description: A, annotations: { readOnlyHint: true }, _meta: { x: 1 } },
  ]) {
    const once = normalise(recordOf(raw));
    const twice = normalise(once);
    assert.equal(twice.hash, once.hash, `${raw.name}: normalising twice changed the hash`);
    assert.equal(twice.descriptionHash, once.descriptionHash);
    assert.equal(twice.schemaHash, once.schemaHash);
  }
});
