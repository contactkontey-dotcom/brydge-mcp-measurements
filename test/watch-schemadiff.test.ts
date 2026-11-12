/*
 * The schema diff.
 *
 * EVERY SCHEMA HERE IS PLANTED. No assertion reads a stored capture, and
 * none of the prose in these fixtures came from anybody's package: the
 * descriptions below are written to be recognisable as fixtures, so that a
 * failure printing one cannot be mistaken for a leak of somebody's writing.
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { flatten, GATEKEEPING } from "./banned.ts";
import { KIND_ORDER, memberOf, paramsOf, PROSE_WITHHELD, renderSchemaDiff, requiredOf, schemaDiff, WALK_DEPTH, type Kind } from "../watch/schemadiff.ts";

const ROOT = join(import.meta.dirname, "..");

const obj = (properties: Record<string, unknown>, required?: string[]) => ({
  type: "object",
  properties,
  ...(required ? { required } : {}),
});

/** Every change of one kind, as `parameter — detail` for readable assertions. */
const of = (d: ReturnType<typeof schemaDiff>, kind: Kind) =>
  d.changes.filter((c) => c.kind === kind).map((c) => [c.parameter ?? c.pointer, c.detail] as const);

/* ── The named kinds ────────────────────────────────────────────────────── */

test("a parameter that arrived and one that went are two kinds, each named", () => {
  const d = schemaDiff(
    obj({ path: { type: "string" }, mode: { type: "string" } }),
    obj({ path: { type: "string" }, limit: { type: "number" } }),
  );
  assert.deepEqual(of(d, "parameter removed"), [["mode", "string"]]);
  assert.deepEqual(of(d, "parameter added"), [["limit", "number"]]);
  assert.equal(d.unexplained, 0, "a named kind left a pointer unexplained");
});

test("an added parameter says whether it is required", () => {
  const d = schemaDiff(obj({ path: { type: "string" } }, ["path"]), obj({ path: { type: "string" }, who: { type: "string" } }, ["path", "who"]));
  assert.deepEqual(of(d, "parameter added"), [["who", "string, required"]]);
  assert.equal(of(d, "now required").length, 0, "a parameter that did not exist before was called newly required");
});

test("required and no longer required are separate kinds, and the array is accounted for", () => {
  const became = schemaDiff(obj({ path: { type: "string" } }), obj({ path: { type: "string" } }, ["path"]));
  assert.deepEqual(of(became, "now required"), [["path", null]]);
  assert.equal(became.unexplained, 0, "the required array was reported twice over");

  const stopped = schemaDiff(obj({ path: { type: "string" } }, ["path"]), obj({ path: { type: "string" } }));
  assert.deepEqual(of(stopped, "no longer required"), [["path", null]]);
  assert.equal(stopped.unexplained, 0);
});

test("a type change names both types, including a union", () => {
  const one = schemaDiff(obj({ n: { type: "string" } }), obj({ n: { type: "number" } }));
  assert.deepEqual(of(one, "type changed"), [["n", "string -> number"]]);

  const union = schemaDiff(obj({ n: { type: "string" } }), obj({ n: { type: ["string", "null"] } }));
  assert.deepEqual(of(union, "type changed"), [["n", "string -> string or null"]]);
  assert.equal(union.unexplained, 0);

  const gained = schemaDiff(obj({ n: {} }), obj({ n: { type: "string" } }));
  assert.deepEqual(of(gained, "type changed"), [["n", "(no type) -> string"]]);
});

test("enum members in and out are two kinds, and both are named", () => {
  const d = schemaDiff(
    obj({ mode: { type: "string", enum: ["read", "write"] } }),
    obj({ mode: { type: "string", enum: ["read", "append", "force"] } }),
  );
  assert.deepEqual(of(d, "enum values removed"), [["mode", '"write"']]);
  assert.deepEqual(of(d, "enum values added"), [["mode", '"append", "force"']]);
  assert.equal(d.unexplained, 0);
});

test("an enum that only reordered is said to have reordered, not to have changed members", () => {
  const d = schemaDiff(
    obj({ mode: { enum: ["a", "b", "c"] } }),
    obj({ mode: { enum: ["c", "a", "b"] } }),
  );
  assert.equal(of(d, "enum values added").length, 0);
  assert.equal(of(d, "enum values removed").length, 0);
  assert.deepEqual(of(d, "differs"), [["mode", "the same 3 values in a different order"]]);
});

test("a long enum member is clipped and its length given", () => {
  const long = "x".repeat(80);
  const d = schemaDiff(obj({ mode: { enum: [] } }), obj({ mode: { enum: [long] } }));
  const [[, detail]] = of(d, "enum values added");
  assert.ok(detail!.includes("… (82 characters)"), detail!);
  assert.ok(detail!.length < 70, "the member was printed in full");
});

/* ── Nesting ────────────────────────────────────────────────────────────── */

test("a nested parameter is named the way its author would name it", () => {
  const d = schemaDiff(
    obj({ options: obj({ retries: { type: "number" } }) }),
    obj({ options: obj({ retries: { type: "string" } }) }),
  );
  assert.deepEqual(of(d, "type changed"), [["options.retries", "number -> string"]]);
  assert.equal(d.changes[0]!.pointer, "/properties/options/properties/retries/type");
});

test("the schema of an array's items, and a combinator branch, are both reached", () => {
  const items = schemaDiff(
    obj({ rows: { type: "array", items: obj({ id: { type: "string" } }) } }),
    obj({ rows: { type: "array", items: obj({ id: { type: "string" }, tag: { type: "string" } }) } }),
  );
  assert.deepEqual(of(items, "parameter added"), [["rows[].tag", "string"]]);

  const branch = schemaDiff(
    obj({ who: { anyOf: [obj({ name: { type: "string" } }), { type: "null" }] } }),
    obj({ who: { anyOf: [obj({ name: { type: "number" } }), { type: "null" }] } }),
  );
  assert.deepEqual(of(branch, "type changed"), [["who.anyOf[0].name", "string -> number"]]);
});

const deep = (n: number): Record<string, unknown> =>
  n === 0 ? { type: "string" } : obj({ [`level${n}`]: deep(n - 1) });

/** The same tower with the innermost type changed. */
const deepPair = (levels: number): [Record<string, unknown>, Record<string, unknown>] => {
  const a = deep(levels);
  const b = JSON.parse(JSON.stringify(a)) as Record<string, unknown>;
  let node: any = b;
  for (let i = levels; i > 0; i--) node = node.properties[`level${i}`];
  node.type = "number";
  return [a, b];
};

/*
 * THE TWO CAPS, AND THE BUG BETWEEN THEM.
 *
 * The pointer walk's default cap is 6 segments, tuned to `_meta`. A schema
 * spends two segments per level of nesting, so at that cap a type change
 * three parameters down came back as a capped ANCESTOR — which the named
 * kind's own pointer did not match, so one change printed as two
 * differences, the second of them unexplained. The schema diff now passes a
 * cap past every pointer a named kind can produce. These two tests are that
 * fix from both sides.
 */
test("one change three parameters down is one finding, not two", () => {
  const [a, b] = deepPair(3);
  const d = schemaDiff(a, b);
  assert.equal(d.changes.length, 1, renderSchemaDiff(d));
  assert.equal(d.changes[0]!.kind, "type changed");
  assert.equal(d.changes[0]!.parameter, "level3.level2.level1");
  assert.equal(d.unexplained, 0);
  assert.equal(d.changes[0]!.atCap, false);
});

test("a named kind is never also reported as a capped ancestor, however deep it sits", () => {
  for (let levels = 1; levels <= WALK_DEPTH; levels++) {
    const [a, b] = deepPair(levels);
    const d = schemaDiff(a, b);
    assert.equal(d.changes.length, 1, `at ${levels} levels: ${renderSchemaDiff(d)}`);
    assert.equal(d.unexplained, 0, `at ${levels} levels, a pointer went unexplained`);
  }
});

test("deeper than the walk reaches, the change is still reported, as a named subtree", () => {
  const [a, b] = deepPair(WALK_DEPTH + 3);
  const d = schemaDiff(a, b);
  /* Nothing is lost: the parameter walk cannot name it, so the pointer walk
   * reports the ancestor it stopped at, and says that is what it is. */
  assert.equal(d.changes.length, 1);
  assert.equal(d.changes[0]!.kind, "differs");
  assert.equal(d.changes[0]!.atCap, true);
  assert.equal(d.unexplained, 1);
  assert.match(renderSchemaDiff(d), /the walk stopped here; this names a subtree/);
});

/* ── Nothing falls between the layers ───────────────────────────────────── */

test("a keyword no named kind knows about is reported by pointer, never dropped", () => {
  const d = schemaDiff(
    obj({ n: { type: "number", maximum: 10 } }),
    obj({ n: { type: "number", maximum: 20 } }),
  );
  assert.equal(d.unexplained, 1);
  assert.deepEqual(of(d, "differs"), [["n", null]]);
  assert.equal(d.changes[0]!.pointer, "/properties/n/maximum");
  assert.match(renderSchemaDiff(d), /1 of 1 differing place is not one of the kinds above/);
});

test("a schema on one side only is its own finding", () => {
  const arrived = schemaDiff(null, obj({ path: { type: "string" } }));
  assert.deepEqual(of(arrived, "input schema arrived"), [["/", "the first version declared none and the second declares one"]]);
  const removed = schemaDiff(obj({ path: { type: "string" } }), undefined);
  assert.deepEqual(of(removed, "input schema removed"), [["/", "the first version declared one and the second declares none"]]);
  assert.equal(schemaDiff(null, null).identical, true);
  assert.equal(schemaDiff(undefined, null).identical, true, "absent and absent is not a difference");
});

test("two identical schemas say so, whatever order their keys were written in", () => {
  const d = schemaDiff(
    { type: "object", properties: { b: { type: "string" }, a: { type: "number" } } },
    { properties: { a: { type: "number" }, b: { type: "string" } }, type: "object" },
  );
  assert.equal(d.identical, true);
  assert.equal(d.changes.length, 0);
  assert.match(renderSchemaDiff(d), /the two are the same schema\./);
});

/* ── The prose in a schema is never printed ─────────────────────────────── */

/*
 * PLANTED. Written so that a failure which printed it is unmistakably a
 * fixture and not somebody's package.
 */
const FIXTURE_PROSE_A = "FIXTURE ONE: the absolute path of the file, as a planted test string.";
const FIXTURE_PROSE_B = "FIXTURE TWO: the absolute path of the file, as a different planted test string.";

test("a changed description is named and its length given; its text is not printed", () => {
  const d = schemaDiff(
    obj({ path: { type: "string", description: FIXTURE_PROSE_A } }),
    obj({ path: { type: "string", description: FIXTURE_PROSE_B } }),
  );
  assert.deepEqual(of(d, "wording changed"), [["path", "69 characters -> 79 characters, not printed here"]]);
  assert.equal(d.unexplained, 0, "a wording change was counted as something nobody named");

  const text = renderSchemaDiff(d);
  for (const prose of [FIXTURE_PROSE_A, FIXTURE_PROSE_B]) {
    assert.ok(!text.includes(prose), "the schema diff printed the text of a description");
    /* Not even a piece of it: ten characters is enough to be a quotation. */
    assert.ok(!text.includes(prose.slice(10, 40)), "the schema diff printed part of a description");
  }
  assert.ok(text.includes(PROSE_WITHHELD), "the output does not say the text is withheld");
});

test("title and $comment are withheld the same way", () => {
  const d = schemaDiff(
    { type: "object", title: "FIXTURE TITLE ONE", $comment: "FIXTURE COMMENT ONE", properties: {} },
    { type: "object", title: "FIXTURE TITLE TWO", $comment: "FIXTURE COMMENT TWO", properties: {} },
  );
  assert.equal(of(d, "wording changed").length, 2);
  const text = renderSchemaDiff(d);
  for (const prose of ["FIXTURE TITLE ONE", "FIXTURE TITLE TWO", "FIXTURE COMMENT ONE", "FIXTURE COMMENT TWO"]) {
    assert.ok(!text.includes(prose), `the schema diff printed ${prose}`);
  }
  assert.ok(text.includes("/title"), "the place the wording changed is not named");
  assert.ok(text.includes("/$comment"), "the place the wording changed is not named");
});

test("a description that arrived, and one that went, report as lengths against none", () => {
  const arrived = schemaDiff(obj({ p: { type: "string" } }), obj({ p: { type: "string", description: FIXTURE_PROSE_A } }));
  assert.deepEqual(of(arrived, "wording changed"), [["p", "none -> 69 characters, not printed here"]]);
  const went = schemaDiff(obj({ p: { type: "string", description: FIXTURE_PROSE_A } }), obj({ p: { type: "string" } }));
  assert.deepEqual(of(went, "wording changed"), [["p", "69 characters -> none, not printed here"]]);
});

/* ── What it may not say, and may not do ────────────────────────────────── */

test("every kind has a place in the print order", () => {
  const kinds: Kind[] = [
    "parameter added",
    "parameter removed",
    "now required",
    "no longer required",
    "type changed",
    "enum values added",
    "enum values removed",
    "wording changed",
    "differs",
    "input schema arrived",
    "input schema removed",
  ];
  for (const k of kinds) assert.ok(KIND_ORDER.includes(k), `${k} has no place in the order`);
  assert.equal(new Set(KIND_ORDER).size, KIND_ORDER.length, "a kind is in the order twice");
  assert.equal(KIND_ORDER.length, kinds.length, "the order and the kinds have drifted apart");
});

test("nothing printed here claims to stop anything, or says what a change is for", () => {
  const d = schemaDiff(
    obj({ path: { type: "string", description: FIXTURE_PROSE_A }, mode: { enum: ["read"] } }, ["path"]),
    obj({ path: { type: "number", description: FIXTURE_PROSE_B }, mode: { enum: ["read", "write"] }, extra: { type: "boolean" } }),
  );
  const flat = flatten([renderSchemaDiff(d), PROSE_WITHHELD, ...KIND_ORDER].join("\n"));
  for (const w of GATEKEEPING) assert.ok(!flat.includes(w), `the output says "${w}"`);
  for (const w of ["breaking", "dangerous", "suspicious", "malicious", "safe", "unsafe", "harmless", "cosmetic", "should"]) {
    assert.ok(!flat.includes(w), `the output judges what it found: "${w}"`);
  }
});

test("the module cannot read a schema: it has no way to open a file", () => {
  const src = flatten(
    readFileSync(join(ROOT, "watch", "schemadiff.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, ""),
  );
  for (const w of ["node:fs", "readfilesync", "createrequire", "require(", "fetch("]) {
    assert.ok(!src.includes(w), `watch/schemadiff.ts reaches for "${w}"`);
  }
});

test("paramsOf finds nothing in something that is not a schema", () => {
  for (const v of [null, undefined, 3, "string", [], [{ type: "string" }]]) {
    assert.equal(paramsOf(v).size, 0, JSON.stringify(v));
  }
  assert.equal(memberOf(undefined), "null", "an undefined enum member has to print as something");
});

/* ── The required arrays, name by name ──────────────────────────────────── */

/*
 * A `required` array differs for four reasons. Three are named by other
 * kinds; the fourth has no other kind that would ever reach it. The first
 * draft of the module named none of them, so a required parameter simply
 * ARRIVING left `/required` to come out as an unexplained difference beside
 * the "parameter added — string, required" line that had just said it.
 */

test("a required parameter arriving or going does not also report its array", () => {
  const arrived = schemaDiff(obj({ a: { type: "string" } }, ["a"]), obj({ a: { type: "string" }, b: { type: "string" } }, ["a", "b"]));
  assert.deepEqual(arrived.changes.map((c) => c.kind), ["parameter added"]);
  assert.equal(arrived.unexplained, 0);

  const went = schemaDiff(obj({ a: { type: "string" }, b: { type: "string" } }, ["a", "b"]), obj({ a: { type: "string" } }, ["a"]));
  assert.deepEqual(went.changes.map((c) => c.kind), ["parameter removed"]);
  assert.equal(went.unexplained, 0);
});

test("a requirement naming a parameter the schema does not declare is its own finding", () => {
  const d = schemaDiff(obj({ a: { type: "string" } }, ["a"]), obj({ a: { type: "string" } }, ["a", "ghost"]));
  assert.deepEqual(of(d, "differs"), [["/required", 'requires "ghost", which the schema on that side does not declare as a parameter']]);
  assert.equal(d.unexplained, 1);
  /* It is reported as a requirement that names nothing declared, and not as
   * a parameter: nothing was added to `properties`. */
  assert.equal(of(d, "parameter added").length, 0);
  assert.equal(of(d, "now required").length, 0);
});

test("a reorder, a repeat and a list that arrived are each reported, never dropped", () => {
  const reordered = schemaDiff(obj({ a: {}, b: {} }, ["a", "b"]), obj({ a: {}, b: {} }, ["b", "a"]));
  assert.deepEqual(of(reordered, "differs"), [["/required", "the same 2 name(s), listed in a different order or repeated"]]);
  assert.equal(reordered.unexplained, 1);

  const repeated = schemaDiff(obj({ a: {} }, ["a"]), obj({ a: {} }, ["a", "a"]));
  assert.equal(of(repeated, "differs").length, 1);

  const emptyList = schemaDiff(obj({ a: {} }), obj({ a: {} }, []));
  assert.deepEqual(of(emptyList, "differs"), [["/required", "the required list is on one side only and names the same 0 parameter(s)"]]);
});

test("a nested required array is named by its own holder's pointer", () => {
  const d = schemaDiff(
    obj({ options: obj({ retries: { type: "number" } }) }),
    obj({ options: obj({ retries: { type: "number" } }, ["retries"]) }),
  );
  assert.deepEqual(of(d, "now required"), [["options.retries", null]]);
  assert.equal(d.unexplained, 0, "the nested required array was reported twice over");
});

test("requiredOf reports the arrays, and paramsOf still reports the parameters", () => {
  const schema = obj({ a: { type: "string" }, nested: obj({ b: {} }, ["b"]) }, ["a"]);
  assert.deepEqual([...requiredOf(schema).entries()].sort(), [
    ["", ["a"]],
    ["/properties/nested", ["b"]],
  ]);
  assert.deepEqual([...paramsOf(schema).keys()].sort(), [
    "/properties/a",
    "/properties/nested",
    "/properties/nested/properties/b",
  ]);
});
