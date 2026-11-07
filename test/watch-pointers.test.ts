/*
 * Naming the key that moved.
 *
 * "47 tools differ only in _meta" left a reader to guess what in `_meta`.
 * These pin the pointer that replaced it, and the one case that rules out
 * the obvious design: @kolbo/mcp's `_meta` carries BOTH a literal key named
 * "ui/resourceUri" AND a nested ui.resourceUri, so a dotted path writes two
 * different things identically.
 */
import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { diffTools, differingPointers, escapePointer, POINTER_DEPTH, recordOf } from "../watch/tools.ts";
import { renderAlert } from "../watch/alert.ts";
import * as client from "../site/diff-client.js";

const recs = (xs: Array<Record<string, unknown>>) => xs.map(recordOf);
const ROOT = join(import.meta.dirname, "..");

test("a nested key and a literal key containing a slash are different pointers", () => {
  const a = { _meta: { "ui/resourceUri": "one", ui: { resourceUri: "one" } } };
  const b = { _meta: { "ui/resourceUri": "two", ui: { resourceUri: "two" } } };
  const got = differingPointers(a, b).map((p) => p.pointer).sort();
  assert.deepEqual(got, ["/_meta/ui/resourceUri", "/_meta/ui~1resourceUri"]);
  assert.notEqual(got[0], got[1], "a dotted path would have written these the same");
});

test("RFC 6901 escaping, both characters", () => {
  assert.equal(escapePointer("plain"), "plain");
  assert.equal(escapePointer("a/b"), "a~1b");
  assert.equal(escapePointer("a~b"), "a~0b");
  /* ~ first, then /, or "a/b" would round-trip wrong */
  assert.equal(escapePointer("a~/b"), "a~0~1b");
});

test("the walk stops at the depth cap and says the branch is not a leaf", () => {
  const deep = (v: string) => ({ a: { b: { c: { d: { e: { f: { g: v } } } } } } });
  const got = differingPointers(deep("one"), deep("two"));
  assert.equal(got.length, 1);
  assert.equal(got[0]!.atCap, true, "a capped walk did not say so");
  assert.equal(got[0]!.pointer.split("/").length - 1, POINTER_DEPTH);
});

test("a leaf inside the cap is not marked as capped", () => {
  const got = differingPointers({ a: { b: 1 } }, { a: { b: 2 } });
  assert.deepEqual(got, [{ pointer: "/a/b", atCap: false }]);
});

test("a tool's pointers reach diffTools and are kept apart from the field names", () => {
  const d = diffTools(
    recs([{ name: "t", _meta: { ui: { resourceUri: "one" } } }]),
    recs([{ name: "t", _meta: { ui: { resourceUri: "two" } } }]),
  );
  assert.equal(d.changed.length, 1);
  assert.deepEqual(d.changed[0]!.pointers, [{ pointer: "/_meta/ui/resourceUri", atCap: false }]);
  assert.ok(d.changed[0]!.what.includes("/_meta/ui/resourceUri"));
});

/* ── The alert ─────────────────────────────────────────────────────────── */

const alertFor = (a: Array<Record<string, unknown>>, b: Array<Record<string, unknown>>) =>
  renderAlert({
    package: "p", approved: "1.0.0", found: "1.1.0", measuredOn: "2026-11-07",
    diff: null, tools: diffTools(recs(a), recs(b)),
  });

test("the alert names each key that moved, one counted line, tools never listed", () => {
  const many = (n: number, v: string) =>
    Array.from({ length: n }, (_, i) => ({ name: `t${i}`, _meta: { "ui/resourceUri": v, ui: { resourceUri: v } } }));
  const text = alertFor(many(47, "one"), many(47, "two"));
  assert.match(text, /47 tools differ only at \/_meta\/ui\/resourceUri\. Not listed individually\./);
  assert.match(text, /47 tools differ only at \/_meta\/ui~1resourceUri\. Not listed individually\./);
  assert.ok(!text.includes("t0:"), "a tool was listed by name");
  assert.ok(!text.includes("t46"), "a tool was listed by name");
  /* and it explains the escaping, so ~1 is not read as part of the key */
  assert.match(text, /JSON Pointers \(RFC 6901\)/);
  assert.match(text, /"~1" is a "\/"/);
});

test("the alert says when a pointer names a branch rather than a leaf", () => {
  const deep = (v: string) => ({ name: "t", _meta: { a: { b: { c: { d: { e: { f: v } } } } } } });
  const text = alertFor([deep("one")], [deep("two")]);
  assert.match(text, /or below it/);
  assert.match(text, new RegExp(`stopped at ${POINTER_DEPTH} levels deep`));
});

test("nothing calls a change a build artifact, noise, or incidental", () => {
  const text = alertFor(
    [{ name: "t", _meta: { ui: { resourceUri: "one" } } }],
    [{ name: "t", _meta: { ui: { resourceUri: "two" } } }],
  ).toLowerCase();
  /* "just a" and "only a" are ordinary English and appear in the standing
   * limits paragraph; the ban is on characterising the CHANGE, not on the
   * word "only". */
  for (const w of ["build artifact", "build noise", "noise", "incidental", "harmless", "cosmetic", "cache-bust", "merely", "nothing to"]) {
    assert.ok(!text.includes(w), `the alert says "${w}"`);
  }
  assert.match(text, /does not say what the key is for/);
});

test("no source file calls such a change a build artifact or noise", () => {
  for (const f of ["watch/alert.ts", "watch/tools.ts", "watch/log.ts", "site/diff-client.js", "site/build.ts"]) {
    const text = readFileSync(join(ROOT, f), "utf8");
    for (const w of ["build artifact", "build noise"]) {
      assert.ok(!text.includes(w), `${f} says "${w}"`);
    }
  }
});

/* ── The page's copy of the walk ───────────────────────────────────────── */

test("the page's pointer walk agrees with the module's, on the same input", () => {
  /*
   * site/diff-client.js cannot import watch/tools.ts — one is browser code
   * and the other is a Node module — so the walk exists twice. This is the
   * seam where the two would drift.
   */
  assert.equal(client.POINTER_DEPTH, POINTER_DEPTH);
  for (const [a, b] of [
    [{ _meta: { "ui/resourceUri": "one", ui: { resourceUri: "one" } } }, { _meta: { "ui/resourceUri": "two", ui: { resourceUri: "two" } } }],
    [{ a: { b: 1 } }, { a: { b: 2 } }],
    [{ a: { b: { c: { d: { e: { f: { g: 1 } } } } } } }, { a: { b: { c: { d: { e: { f: { g: 2 } } } } } } }],
    [{ x: [1, 2] }, { x: [1, 3] }],
    [{ k: "same" }, { k: "same" }],
  ] as Array<[Record<string, unknown>, Record<string, unknown>]>) {
    assert.deepEqual(client.differingPointers(a, b), differingPointers(a, b), `the two walks disagree on ${JSON.stringify(a)}`);
  }
  for (const seg of ["plain", "a/b", "a~b", "a~/b"]) {
    assert.equal(client.escapePointer(seg), escapePointer(seg));
  }
});

/* ── The real pair ─────────────────────────────────────────────────────── */

const kolbo = (v: string) => join(ROOT, "watch", "runs", `kolbo--mcp@${v}`, "tools-1.json");
const haveKolbo = existsSync(kolbo("1.128.0")) && existsSync(kolbo("1.131.2"));

test("the kolbo pair reports both of its _meta keys", { skip: !haveKolbo }, () => {
  const load = (v: string) => JSON.parse(readFileSync(kolbo(v), "utf8")).tools;
  const d = diffTools(load("1.128.0"), load("1.131.2"));
  const tally = new Map<string, number>();
  for (const c of d.changed) for (const p of c.pointers ?? []) tally.set(p.pointer, (tally.get(p.pointer) ?? 0) + 1);
  assert.deepEqual([...tally.keys()].sort(), ["/_meta/ui/resourceUri", "/_meta/ui~1resourceUri"]);
  assert.equal(tally.get("/_meta/ui/resourceUri"), 50);
  assert.equal(tally.get("/_meta/ui~1resourceUri"), 50);
});
