/*
 * The Claude Code export. Every rule here is quoted from Claude Code's own
 * permissions documentation, not inferred from the shape of the identifier.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { exportClaudeCode, isRefusal, normaliseAlias, refuseAlias, unusableTools } from "../watch/export-claude-code.ts";
import type { ApprovedEntry } from "../watch/approved.ts";

const entry = (tools: string[]): ApprovedEntry => ({
  package: "thing-mcp",
  version: "1.0.0",
  approvedAt: "2026-11-07",
  approvedBy: "an-approver",
  tools,
  hosts: [],
  programs: [],
});

const ok = (v: ReturnType<typeof exportClaudeCode>) => {
  assert.ok(!isRefusal(v), isRefusal(v) ? v.because : "");
  return v as Exclude<typeof v, { because: string }>;
};

test("one line per tool, in the documented mcp__<server>__<tool> form", () => {
  const out = ok(exportClaudeCode(entry(["b_tool", "a_tool"]), "mine"));
  assert.deepEqual(out.lines, ['  "mcp__mine__a_tool",', '  "mcp__mine__b_tool",']);
});

test("no wildcard line is emitted, and the header says why", () => {
  const out = ok(exportClaudeCode(entry(["one", "two"]), "mine"));
  for (const l of out.lines) assert.ok(!l.includes("*"), `a wildcard line was emitted: ${l}`);
  assert.ok(!out.text.split("\n").some((l) => !l.startsWith("#") && l.includes("__*")));
  assert.match(out.text, /NO WILDCARD LINE/);
  assert.match(out.text, /ones a later version adds/);
});

test("the header says it is Claude Code only and that the alias is the config key", () => {
  const out = ok(exportClaudeCode(entry(["one"]), "mine"));
  assert.match(out.text, /For Claude Code only/);
  assert.match(out.text, /not portable to any other/);
  assert.match(out.text, /"mcpServers" object/);
  assert.match(out.text, /not the npm package name/);
  /* and that approving is a different act from measuring */
  assert.match(out.text, /No tool was ever called/);
});

/* ── Trap 1: characters Claude Code rewrites ───────────────────────────── */

test("a dot or a space in the alias becomes an underscore, and the header says so", () => {
  assert.deepEqual(normaliseAlias("my.server"), { alias: "my_server", rewritten: true });
  assert.deepEqual(normaliseAlias("my server"), { alias: "my_server", rewritten: true });
  assert.deepEqual(normaliseAlias("ok-name_1"), { alias: "ok-name_1", rewritten: false });

  const out = ok(exportClaudeCode(entry(["t"]), "my.server"));
  assert.deepEqual(out.lines, ['  "mcp__my_server__t",']);
  assert.match(out.text, /You passed "my\.server"/);
  assert.match(out.text, /so the lines below use "my_server"/);
});

test("a hyphen is left alone: it is not among the rewritten characters", () => {
  const out = ok(exportClaudeCode(entry(["t"]), "package-registry"));
  assert.deepEqual(out.lines, ['  "mcp__package-registry__t",']);
  assert.ok(!out.text.includes("You passed"), "it claimed a rewrite that did not happen");
});

/* ── Trap 2: an alias the per-tool form cannot express ─────────────────── */

test("an alias containing __ is refused, not exported", () => {
  const r = refuseAlias("reports__v2");
  assert.ok(r, "an alias with __ was accepted");
  assert.match(r.because, /contains "__"/);
  /* the documentation's own explanation: it reads as a rule for "reports" */
  assert.match(r.instead, /read as a rule for a server called "reports"/);
  assert.match(r.instead, /mcp__reports__v2__\*/);
  assert.ok(isRefusal(exportClaudeCode(entry(["t"]), "reports__v2")));
});

test("an alias ending in _ is refused", () => {
  const r = refuseAlias("reports_");
  assert.ok(r);
  assert.match(r.because, /ends in "_"/);
});

test("an alias that only becomes __ after rewriting is still refused", () => {
  /* "a.b" is fine; "a..b" rewrites to "a__b", which is the trap. */
  assert.equal(refuseAlias("a.b"), null);
  const r = refuseAlias("a..b");
  assert.ok(r, "a rewrite that produces __ slipped through");
  assert.match(r.because, /contains "__"/);
});

test("an empty alias is refused with what to pass instead", () => {
  const r = refuseAlias("  ");
  assert.ok(r);
  assert.match(r.instead, /--alias <name>/);
});

/* ── Trap 3: a tool name Claude Code would skip ────────────────────────── */

test("a tool name with a parenthesis is not exported, and is named", () => {
  assert.deepEqual(
    unusableTools(["fine", "bad(tool)"]).map((x) => x.tool),
    ["bad(tool)"],
  );
  const out = ok(exportClaudeCode(entry(["fine", "bad(tool)"]), "mine"));
  assert.deepEqual(out.lines, ['  "mcp__mine__fine",']);
  assert.match(out.text, /NOT EXPORTED \(1\)/);
  assert.match(out.text, /bad\(tool\) — contains a parenthesis/);
  assert.match(out.text, /Claude Code skips any mcp__ rule that has one/);
});

test("the tool count in the header is the count actually emitted", () => {
  const out = ok(exportClaudeCode(entry(["fine", "bad(tool)"]), "mine"));
  assert.equal(out.lines.length, 1);
  assert.match(out.text, /\b1 tool\./, "the header counts a tool it did not emit");
});

/* ── The lines are paste-ready JSON array entries ──────────────────────── */

test("the emitted lines parse as a JSON array when wrapped", () => {
  const out = ok(exportClaudeCode(entry(["a", "b", "c"]), "mine"));
  const body = out.lines.join("\n").replace(/,\s*$/, "");
  const parsed = JSON.parse(`[${body}]`);
  assert.deepEqual(parsed, ["mcp__mine__a", "mcp__mine__b", "mcp__mine__c"]);
});

test("every non-comment line is a quoted entry and nothing else", () => {
  const out = ok(exportClaudeCode(entry(["a"]), "mine"));
  for (const l of out.text.split("\n")) {
    if (!l.trim() || l.startsWith("#")) continue;
    assert.match(l, /^ {2}"mcp__[^"]+",$/, `not a paste-ready entry: ${JSON.stringify(l)}`);
  }
});
