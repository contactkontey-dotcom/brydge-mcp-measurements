/*
 * The queue, and what a set of decisions does to an approved list.
 *
 * EVERY FIXTURE IS PLANTED. The tool definitions below are written here, the
 * reviewers are all `example-approver`, and the description strings are
 * written to read as obvious fixtures. Nothing reads a capture.
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { flatten, GATEKEEPING } from "./banned.ts";
import { itemHashOf, keyOf, Refused, type DecisionsFile } from "../watch/decisions.ts";
import {
  apply,
  definitionOf,
  FORMAT,
  FORMAT_VERSION,
  KIND_ORDER,
  otherFieldLines,
  parseExport,
  queueFor,
  renderApplied,
  renderQueue,
  TOOLS_ONLY,
  type Exported,
} from "../watch/review.ts";
import { recordOf, type ToolRecord } from "../watch/tools.ts";
import type { ApprovedEntry } from "../watch/approved.ts";

const ROOT = join(import.meta.dirname, "..");
const WHO = "example-approver";
const DAY = "2026-11-12";
const PKG = "fixture-mcp";

const A_PROSE = "FIXTURE A: reads the planted file and returns its planted bytes.";
const B_PROSE = "FIXTURE B: reads the planted file, and now says what happens when it is missing.";

const tool = (over: Record<string, unknown>): ToolRecord => recordOf({ name: "t", ...over });

/** The pair used through most of this file. */
const left = [
  tool({ name: "reworded", description: A_PROSE }),
  tool({ name: "reshaped", inputSchema: { type: "object", properties: { path: { type: "string" } } } }),
  tool({ name: "both", description: A_PROSE, inputSchema: { type: "object" } }),
  tool({ name: "untouched", description: A_PROSE }),
  tool({ name: "gone", description: A_PROSE }),
  tool({ name: "only_meta", description: A_PROSE, _meta: { ui: { resourceUri: "one" } } }),
];
const right = [
  tool({ name: "reworded", description: B_PROSE }),
  tool({ name: "reshaped", inputSchema: { type: "object", properties: { path: { type: "string" }, mode: { type: "string" } } } }),
  tool({ name: "both", description: B_PROSE, inputSchema: { type: "object", properties: { x: { type: "number" } } } }),
  tool({ name: "untouched", description: A_PROSE }),
  tool({ name: "only_meta", description: A_PROSE, _meta: { ui: { resourceUri: "two" } } }),
  tool({ name: "arrived", description: B_PROSE }),
];

const queue = () => queueFor(PKG, "1.0.0", "1.1.0", left, right);

/* ── The queue ──────────────────────────────────────────────────────────── */

test("the three kinds, in reading order, and two items for a tool that moved twice", () => {
  const q = queue();
  assert.deepEqual(
    q.items.map((i) => `${i.kind}:${i.tool}`),
    ["description:both", "description:reworded", "input schema:both", "input schema:reshaped", "new tool:arrived"],
  );
  /* Descriptions before schemas before new tools: what a tool says about
   * itself is the thing nobody sees without comparing. */
  assert.deepEqual(KIND_ORDER, ["description", "input schema", "new tool"]);
  const kinds = q.items.map((i) => KIND_ORDER.indexOf(i.kind));
  assert.deepEqual(kinds, [...kinds].sort((a, b) => a - b));
});

test("a tool differing only in another field is not an item, and is counted", () => {
  const q = queue();
  assert.ok(!q.items.some((i) => i.tool === "only_meta"), "a tool with no description or schema change is in the queue");
  assert.equal(q.otherField.tools, 1);
  assert.deepEqual(q.otherField.pointers, [{ pointer: "/_meta/ui/resourceUri", tools: 1, atCap: false }]);
});

/*
 * THE 47-AND-50 BUG. The first draft tallied pointers over every changed
 * tool and printed the total in the sentence about the tools that differ
 * ONLY somewhere else. On the real kolbo pair that read "47 tools differ
 * only in a field that is neither ... : 50 at /_meta/ui/resourceUri" — two
 * sets, one sentence. Each line now counts its own set.
 */
test("each line's counts are about its own set of tools", () => {
  const a = [
    tool({ name: "only_a", _meta: { k: "one" } }),
    tool({ name: "only_b", _meta: { k: "one" } }),
    tool({ name: "in_queue", description: A_PROSE, _meta: { k: "one" } }),
  ];
  const b = [
    tool({ name: "only_a", _meta: { k: "two" } }),
    tool({ name: "only_b", _meta: { k: "two" } }),
    tool({ name: "in_queue", description: B_PROSE, _meta: { k: "two" } }),
  ];
  const q = queueFor(PKG, "1.0.0", "1.1.0", a, b);
  assert.equal(q.otherField.tools, 2);
  assert.equal(q.alsoOtherField.tools, 1);
  const lines = otherFieldLines(q);
  assert.equal(lines.length, 2);
  assert.match(lines[0]!, /^2 tools differ only in a field that is neither the description nor the input schema, and are not in the queue: 2 at \/_meta\/k\.$/);
  /* And the singular agrees with its verb: the first draft said "1 tool differ". */
  const oneEach = queueFor(PKG, "1.0.0", "1.1.0", [a[0]!, a[2]!], [b[0]!, b[2]!]);
  assert.match(otherFieldLines(oneEach)[0]!, /^1 tool differs only in a field/);
  assert.match(otherFieldLines(oneEach)[1]!, /^1 tool in the queue differs in such a field as well/);
  assert.match(lines[1]!, /^1 tool in the queue differs in such a field as well, which no item covers: 1 at \/_meta\/k\.$/);
  /* The number in each line appears in it twice and means the same thing
   * both times. */
  for (const line of lines) {
    const counts = [...line.matchAll(/\b(\d+)\b/g)].map((m) => m[1]);
    assert.equal(new Set(counts).size, 1, line);
  }
});

test("a tool that went is named and is not an item: there is nothing to approve", () => {
  const q = queue();
  assert.deepEqual(q.removed, ["gone"]);
  assert.ok(!q.items.some((i) => i.tool === "gone"));
  assert.match(renderQueue(q), /1 tool on 1\.0\.0 and not on 1\.1\.0, which is nothing to approve: gone\./);
  assert.equal(q.unchanged, 1, "untouched is the only identical tool");
});

test("the queue prints kinds and names, and never an item's content", () => {
  const text = renderQueue(queue());
  for (const prose of [A_PROSE, B_PROSE, A_PROSE.slice(10, 40)]) {
    assert.ok(!text.includes(prose), "the queue printed a description");
  }
  assert.ok(!text.includes("inputSchema"), "the queue printed a schema");
  assert.match(text, /5 items to review/);
});

test("a new tool's item carries the whole definition, without our derived hashes", () => {
  const d = definitionOf(right[5]!);
  assert.deepEqual(Object.keys(d).sort(), ["description", "inputSchema", "name"]);
  for (const k of ["hash", "descriptionHash", "schemaHash", "extra"]) {
    assert.ok(!(k in d), `the definition carries ${k}, which we derived rather than the server sending it`);
  }
});

/* ── An exported file ───────────────────────────────────────────────────── */

const exportOf = (over: Partial<Exported> = {}): Exported => ({
  format: FORMAT,
  version: FORMAT_VERSION,
  package: PKG,
  fromVersion: "1.0.0",
  toVersion: "1.1.0",
  decisions: [],
  ...over,
});

const decisionFor = (kind: string, name: string, decision: "approve" | "hold", hash?: string) => {
  const item = queue().items.find((i) => i.kind === kind && i.tool === name)!;
  return { kind: item.kind, name, decision, by: WHO, at: DAY, itemHash: hash ?? itemHashOf(item) };
};

test("a file that is not an export is refused, and the reason says what is wrong", () => {
  const refuses = (text: string, why: RegExp) =>
    assert.throws(() => parseExport(text), (e: Error) => e instanceof Refused && why.test(e.message), why.source);
  refuses("not json", /not JSON/);
  refuses("[]", /not an exported set of decisions/);
  refuses('{"format":"something-else"}', /the format is "something-else"/);
  refuses(JSON.stringify({ format: FORMAT, version: 99 }), /format version is 99/);
  refuses(JSON.stringify({ format: FORMAT, version: FORMAT_VERSION }), /names no package/);
  refuses(JSON.stringify(exportOf({ decisions: undefined as any })), /no list of decisions/);
  refuses(JSON.stringify(exportOf({ decisions: [{ kind: "description" } as any] })), /decision 1 names no name/);
  assert.equal(parseExport(JSON.stringify(exportOf())).package, PKG);
});

/* ── Applying ───────────────────────────────────────────────────────────── */

const previous: ApprovedEntry = {
  package: PKG,
  version: "1.0.0",
  approvedAt: "2026-11-01",
  approvedBy: WHO,
  tools: ["reworded", "reshaped", "both", "untouched", "gone", "only_meta"],
  hosts: ["one.example"],
  programs: ["node"],
};
const measured = {
  tools: ["arrived", "both", "only_meta", "reshaped", "reworded", "untouched"],
  hosts: ["one.example", "two.example"],
  programs: ["node"],
};

const applied = (decisions: Exported["decisions"], over: { previous?: ApprovedEntry | null; file?: DecisionsFile } = {}) =>
  apply({
    queue: queue(),
    file: over.file ?? {},
    incoming: exportOf({ decisions }),
    previous: over.previous === undefined ? previous : over.previous,
    measured,
    at: DAY,
  });

test("decisions about another package, or another pair of versions, are refused outright", () => {
  const refuses = (over: Partial<Exported>, why: RegExp) =>
    assert.throws(
      () => apply({ queue: queue(), file: {}, incoming: exportOf(over), previous, measured, at: DAY }),
      (e: Error) => e instanceof Refused && why.test(e.message),
      why.source,
    );
  refuses({ package: "other-mcp" }, /about other-mcp, and this is fixture-mcp/);
  refuses({ fromVersion: "0.9.0" }, /about 0\.9\.0 -> 1\.1\.0, and this is 1\.0\.0 -> 1\.1\.0/);
  refuses({ toVersion: "1.2.0" }, /-> 1\.2\.0, and this is 1\.0\.0 -> 1\.1\.0/);
});

test("a decision whose hash does not match this item is reported and not applied", () => {
  const a = applied([decisionFor("description", "reworded", "approve", "f".repeat(64))]);
  assert.equal(a.refused.length, 1);
  assert.match(a.refused[0]!.because, /a different description for reworded \(the file says ffffffffffff, this item is [0-9a-f]{12}\)/);
  assert.equal(a.tally.approved.length, 0, "a decision with the wrong hash was applied anyway");
  assert.ok(!a.carried.tools.includes("reworded"));
});

test("a decision about an item this pair of versions does not have is reported", () => {
  const a = applied([{ kind: "description", name: "no_such_tool", decision: "approve", by: WHO, at: DAY, itemHash: "0".repeat(64) }]);
  assert.equal(a.refused.length, 1);
  assert.match(a.refused[0]!.because, /there is no description to decide for no_such_tool between these two versions/);
});

test("a record a decision cannot be made from is reported, not written", () => {
  const a = applied([{ ...decisionFor("description", "reworded", "approve"), by: "  " }]);
  assert.equal(a.refused.length, 1);
  assert.match(a.refused[0]!.because, /needs a name/);
});

test("a tool goes on the list only when every item about it was approved", () => {
  /* `both` has two items. Approve the description, hold the schema. */
  const a = applied([
    decisionFor("description", "both", "approve"),
    decisionFor("input schema", "both", "hold"),
  ]);
  assert.ok(!a.carried.tools.includes("both"), "a tool with a held item went on the list");
  const left = a.carried.left.find((l) => l.tool === "both")!;
  /* Named with both halves, so "not on the list" never reads as "nobody
   * looked at it". */
  assert.match(left.because, /its description was approved; its input schema was held/);

  const bothApproved = applied([
    decisionFor("description", "both", "approve"),
    decisionFor("input schema", "both", "approve"),
  ]);
  assert.ok(bothApproved.carried.tools.includes("both"));
});

test("undecided and stale are each named, and neither is approved", () => {
  const a = applied([decisionFor("new tool", "arrived", "approve")]);
  const why = (tool: string) => a.carried.left.find((l) => l.tool === tool)?.because ?? "";
  assert.match(why("reworded"), /its description is not yet decided/);
  assert.match(why("reshaped"), /its input schema is not yet decided/);
  assert.match(why("both"), /its description is not yet decided; its input schema is not yet decided/);
  assert.ok(a.carried.tools.includes("arrived"));

  /* A decision taken against an earlier edit of the same description. */
  const stale: DecisionsFile = {
    [keyOf(PKG, "1.1.0")]: {
      "description:reworded": {
        kind: "description",
        name: "reworded",
        decision: "approve",
        by: WHO,
        at: "2026-11-01",
        fromVersion: "1.0.0",
        toVersion: "1.1.0",
        itemHash: "a".repeat(64),
      },
    },
  };
  const withStale = applied([], { file: stale });
  assert.match(why2(withStale, "reworded"), /the decision about its description was about an earlier edit/);
});

const why2 = (a: ReturnType<typeof applied>, tool: string) => a.carried.left.find((l) => l.tool === tool)?.because ?? "";

test("an unchanged tool is carried from the previous list, and one that was never on it is not", () => {
  const a = applied([]);
  assert.deepEqual(a.carried.carried, ["only_meta", "untouched"]);
  assert.ok(a.carried.tools.includes("untouched"));

  const withoutIt: ApprovedEntry = { ...previous, tools: previous.tools.filter((t) => t !== "untouched") };
  const b = applied([], { previous: withoutIt });
  assert.ok(!b.carried.tools.includes("untouched"));
  assert.match(why2(b, "untouched"), /unchanged between these two versions and was not on the previous list/);

  const noList = applied([], { previous: null });
  assert.deepEqual(noList.carried.carried, []);
  assert.match(why2(noList, "untouched"), /no previous list to carry it from/);
});

test("the entry names whoever approved something, and is dated the day it was written", () => {
  const a = applied([decisionFor("new tool", "arrived", "approve")]);
  assert.equal(a.entry!.version, "1.1.0");
  assert.equal(a.entry!.approvedAt, DAY);
  assert.equal(a.entry!.approvedBy, WHO);
  assert.deepEqual(a.entry!.tools, ["arrived", "only_meta", "untouched"]);
  assert.match(renderApplied(a), /The entry is dated 2026-11-12, the day it was written, from decisions made by example-approver on 2026-11-12\./);

  /* Everything carried, nothing approved: there is no name to put. */
  const carriedOnly = applied([]);
  assert.equal("approvedBy" in carriedOnly.entry!, false, "a name was invented for an entry nobody approved anything on");
  assert.match(renderApplied(carriedOnly), /from no decision made here/);
});

test("the websites and programs come from the measurement, and the output says so", () => {
  const a = applied([decisionFor("new tool", "arrived", "approve")]);
  assert.deepEqual(a.entry!.hosts, measured.hosts);
  assert.deepEqual(a.entry!.programs, measured.programs);
  /* And anything in them the previous list did not have is named: the
   * review was about tools, and a signature must not drift onto a startup
   * surface nobody looked at. */
  assert.deepEqual(a.unreviewed.hosts, ["two.example"]);
  assert.deepEqual(a.unreviewed.programs, []);
  const text = renderApplied(a);
  assert.match(text, /In 1\.1\.0's measurement and not on the previous list:/);
  assert.match(text, /website: two\.example/);
  assert.ok(text.includes(TOOLS_ONLY), "the output does not say the review was about tools");
});

test("without a measured shape there is no entry, and nothing pretends otherwise", () => {
  const a = apply({ queue: queue(), file: {}, incoming: exportOf({ decisions: [] }), previous, measured: null, at: DAY });
  assert.equal(a.entry, null);
  assert.deepEqual(a.unreviewed, { hosts: [], programs: [] });
});

test("the merged decisions are returned, and the file given is not changed", () => {
  const file: DecisionsFile = {};
  const a = applied([decisionFor("new tool", "arrived", "approve")], { file });
  assert.deepEqual(file, {}, "apply wrote into the file it was given");
  assert.equal(Object.keys(a.merged[keyOf(PKG, "1.1.0")]!).length, 1);
});

/* ── What it may not say ────────────────────────────────────────────────── */

test("nothing printed here claims to stop anything, or prints an item's content", () => {
  const a = applied([
    decisionFor("description", "both", "approve"),
    decisionFor("input schema", "both", "hold"),
    decisionFor("new tool", "arrived", "hold"),
  ]);
  const text = [renderApplied(a), renderQueue(a.queue), TOOLS_ONLY, ...otherFieldLines(a.queue)].join("\n");
  for (const prose of [A_PROSE, B_PROSE, A_PROSE.slice(10, 40), B_PROSE.slice(10, 40)]) {
    assert.ok(!text.includes(prose), "the output printed a description");
  }
  const flat = flatten(text);
  for (const w of GATEKEEPING) assert.ok(!flat.includes(w), `the output says "${w}"`);
  for (const w of ["reject", "unsafe", "dangerous", "suspicious", "quarantine", "disable", "breaking"]) {
    assert.ok(!flat.includes(w), `the output judges what it found: "${w}"`);
  }
  /* "held" has to appear: it is the decision somebody made. */
  assert.ok(flat.includes("held"));
});

test("the module cannot read or write a file", () => {
  const src = flatten(
    readFileSync(join(ROOT, "watch", "review.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, ""),
  );
  for (const w of ["node:fs", "readfilesync", "writefilesync", "createrequire", "require(", "fetch("]) {
    assert.ok(!src.includes(w), `watch/review.ts reaches for "${w}"`);
  }
});
