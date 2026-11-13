/*
 * The report the gate writes, and the one line it puts in a client's log.
 *
 * Every fixture is planted. The descriptions carry a zero-width space and a
 * soft hyphen on purpose: a change a reader cannot see is the case the whole
 * thing exists for, and the report has to show it.
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { CONTAINMENT, flatten, GATEKEEPING } from "./banned.ts";
import { ADOPTED, adopt, fromDecisions } from "../watch/gate/pin.ts";
import { ADOPTED_LINE, SHADOW_LINE, pendingOf, stderrLine } from "../watch/gate/report.ts";
import type { WouldHide } from "../watch/gate/router.ts";
import { recordOf, type ToolRecord } from "../watch/tools.ts";

const ROOT = join(import.meta.dirname, "..");
const A = "FIXTURE A: reads the planted file and returns its planted bytes.";
const B = "FIXTURE B: reads the planted​ file and says what hap­pens when it is missing.";
const DAY = "2026-11-13";

const tool = (over: Record<string, unknown> = {}): ToolRecord =>
  recordOf({ name: "read_file", description: A, inputSchema: { type: "object", properties: { path: { type: "string" } } }, ...over });

const pinned = [tool(), tool({ name: "list_dir" })];
const live = [
  tool({ description: B }),
  tool({ name: "list_dir" }),
  tool({ name: "write_file", description: "FIXTURE C: writes the planted bytes." }),
];
const hidden: WouldHide[] = [
  { tool: "read_file", because: "its description differs from the baseline" },
  { tool: "write_file", because: "not in the baseline" },
];

const adoptedPin = () => adopt("fixture-mcp", "1.0.0", pinned, "2026-11-01");
const decidedPin = () =>
  fromDecisions({
    package: "fixture-mcp",
    version: "1.0.0",
    approved: pinned.map((t) => t.name),
    tools: pinned,
    decisions: { "description:read_file": { by: "example-approver", at: "2026-11-01", itemHash: "a".repeat(64), decision: "approve" } },
    at: "2026-11-01",
  }).pin;

/* ── The report ─────────────────────────────────────────────────────────── */

test("the report is a prepared queue: descriptions first, then new tools", () => {
  const p = pendingOf(adoptedPin(), live, hidden, DAY);
  assert.deepEqual(p.prepared.items.map((i) => `${i.kind}:${i.tool}`), ["description:read_file", "new tool:write_file"]);
  assert.equal(p.prepared.from, "pinned 2026-11-01");
  assert.equal(p.prepared.to, `offered ${DAY}`);
  /* The same shape site-side rendering already takes, so nothing about the
   * diff is written twice. */
  const item = p.prepared.items[0]!;
  assert.ok(item.words, "a changed description came without a word diff");
  assert.ok(item.itemHash.match(/^[0-9a-f]{64}$/));
});

test("a change a reader cannot see is in the report, by code point", () => {
  const p = pendingOf(adoptedPin(), live, hidden, DAY);
  const words = p.prepared.items.find((i) => i.kind === "description")!.words!;
  const legend = words.legend.join(" ");
  assert.match(legend, /ZERO WIDTH SPACE/);
  assert.match(legend, /SOFT HYPHEN/);
  /* And the marked-up runs carry the markers rather than the characters. */
  const text = words.runs.map((r) => r.text).join("");
  assert.ok(text.includes("⟦U+200B⟧"), "the zero-width space is not shown");
  assert.ok(!text.includes("​"), "the zero-width space reached the report as itself");
});

test("an adopted pin says so in the report, every time", () => {
  const p = pendingOf(adoptedPin(), live, hidden, DAY);
  assert.equal(p.pinnedBy, ADOPTED);
  assert.equal(p.notes[0], ADOPTED_LINE);
  assert.match(ADOPTED_LINE, /not from anything anybody signed off/);

  const d = pendingOf(decidedPin(), live, hidden, DAY);
  assert.equal(d.pinnedBy, "decisions");
  assert.ok(!d.notes.includes(ADOPTED_LINE), "a reviewed pin was labelled unreviewed");
});

test("the report says what shadow mode did not do", () => {
  const p = pendingOf(adoptedPin(), live, hidden, DAY);
  assert.equal(p.shadow, SHADOW_LINE);
  assert.match(SHADOW_LINE, /nothing was hidden from the client/);
});

test("what the gate would have hidden is carried as names and reasons", () => {
  const p = pendingOf(adoptedPin(), live, hidden, DAY);
  assert.deepEqual(p.wouldHide, hidden);
});

/* ── The one line in a client's log ─────────────────────────────────────── */

test("the stderr line is counts, kinds and a path, and never a description", () => {
  const p = pendingOf(adoptedPin(), live, hidden, DAY);
  const line = stderrLine(p, "/tmp/pending/x.json");
  assert.equal(line.split("\n").length, 1, "the line a client's log gets is more than one line");
  assert.match(line, /^gate: 2 tool\(s\) differ from the pin, against a pin that was adopted, not reviewed \(1 its description differs from the baseline; 1 not in the baseline\); written to \/tmp\/pending\/x\.json$/);
  for (const prose of [A, B, A.slice(10, 40), B.slice(10, 40), "FIXTURE"]) {
    assert.ok(!line.includes(prose), "the line carries a description");
  }
});

test("a reviewed pin's line does not call itself unreviewed", () => {
  const line = stderrLine(pendingOf(decidedPin(), live, hidden, DAY), "/tmp/x.json");
  assert.ok(!line.includes(ADOPTED), line);
  assert.match(line, /^gate: 2 tool\(s\) differ from the pin \(/);
});

/* ── What it may never say ──────────────────────────────────────────────── */

test("nothing in the report or the module claims the server is contained", () => {
  const p = pendingOf(adoptedPin(), live, hidden, DAY);
  const text = flatten(
    [JSON.stringify(p.notes), p.shadow, stderrLine(p, "/tmp/x.json"), readFileSync(join(ROOT, "watch", "gate", "report.ts"), "utf8")].join("\n"),
  );
  for (const w of [...CONTAINMENT, ...GATEKEEPING]) assert.ok(!text.includes(w), `the report says "${w}"`);
});
