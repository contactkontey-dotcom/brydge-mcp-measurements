/*
 * ═══════════════════════════════════════════════════════════════════════════
 * 46 AND 46 CAN HIDE A SWAP.
 *
 * Every "no change" in this project has to rest on members, never on totals.
 * One tool removed and one added leaves both counts at 46; a tool that keeps
 * its name while its input schema or its description is rewritten leaves even
 * the name list untouched.
 *
 * These are the three swaps, through versiondiff, through the soundness gate,
 * and through the alert. The first two were already answered by comparing
 * sets rather than counts. The third was not: versiondiff never looks at a
 * description or a schema, and used to say "Nothing changed in the 6 fields
 * that could be compared", which reads as a clean bill. These tests pin the
 * line that replaced it.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { agree, shapeOf } from "../watch/fields.ts";
import { NO_CHANGE_CAVEAT, noChangeLine, noChangeParts, soundnessOf, versiondiff } from "../watch/versiondiff.ts";
import { diffTools, recordOf } from "../watch/tools.ts";
import { renderAlert } from "../watch/alert.ts";

const ev = (offered: string[]) => ({
  couldNotStart: null,
  observed: { offered, dnsNames: [], tlsHosts: [], programsStarted: ["node"], filesWritten: [], installedDuringRun: [], connectAttempts: [] },
  readme: { digest: "same" },
});
const V = (version: string, offered: string[]) => ({ version, runs: [shapeOf(ev(offered)), shapeOf(ev(offered))] as [any, any] });
const recs = (xs: Array<Record<string, unknown>>) => xs.map(recordOf);

/** 46 names; with `swap`, one of them is a different name. Count never moves. */
const n46 = (swap: boolean) => Array.from({ length: 46 }, (_, i) => (i === 20 && swap ? "swapped_in" : `tool_${i}`));

/* ── 1. A name swapped, totals unchanged ───────────────────────────────── */

test("versiondiff: 46 and 46 with one name swapped is one added and one removed", () => {
  const d = versiondiff("p", V("1.0.0", n46(false)), V("1.1.0", n46(true)));
  const counts = d.counts.find((c) => c.field === "tools offered")!;
  assert.equal(counts.a, 46);
  assert.equal(counts.b, 46, "the totals are equal, which is the whole point");

  const tools = d.changes.find((c) => c.field === "tools offered");
  assert.ok(tools, "a swap behind equal totals was reported as no change");
  assert.deepEqual(tools.added, ["swapped_in"]);
  assert.deepEqual(tools.removed, ["tool_20"]);
  assert.ok(!/No change/.test(d.says), `a swap said: "${d.says}"`);
});

test("the soundness gate: a swap BETWEEN one version's two runs is a disagreement", () => {
  /* The same trap one level down: if the gate compared counts, two runs that
   * disagree about which 46 tools exist would read as reproduced. */
  const mixed = { version: "1.0.0", runs: [shapeOf(ev(n46(false))), shapeOf(ev(n46(true)))] as [any, any] };
  const a = agree(mixed.runs[0], mixed.runs[1]);
  assert.equal(a.ok, false, "two runs differing by a swap were called identical");
  assert.deepEqual(a.disagreed, ["tools offered"]);

  const s = soundnessOf(mixed);
  assert.equal(s.reproduced, false);
  assert.equal(s.toolCount, 46, "the count is unchanged, which is why it cannot be the test");

  const d = versiondiff("p", mixed, V("1.1.0", n46(false)));
  assert.equal(d.outcome, "not-comparable");
  assert.deepEqual(d.changes, [], "a change was reported from runs that disagree");
  /*
   * It says "No change is reported either way", which is the honest form:
   * the refusal, then the consequence. What it must never do is open with a
   * no-change, which is what a reader skimming the first clause would take
   * away.
   */
  assert.match(d.says, /^Not comparable: /);
  assert.match(d.says, /the two runs of 1\.0\.0 disagree about tools offered/);
  assert.ok(!/^No change/.test(d.says), `it opens with a no-change: "${d.says}"`);
});

test("the alert: a swap behind equal totals is reported, not smoothed over", () => {
  const tools = diffTools(
    recs(n46(false).map((name) => ({ name }))),
    recs(n46(true).map((name) => ({ name }))),
  );
  const text = renderAlert({
    package: "p", approved: "1.0.0", found: "1.1.0", measuredOn: "2026-11-07",
    diff: versiondiff("p", V("1.0.0", n46(false)), V("1.1.0", n46(true))),
    tools,
  });
  assert.match(text, /TOOLS ADDED: 1/);
  assert.match(text, /\+ swapped_in/);
  assert.match(text, /TOOLS REMOVED: 1/);
  assert.match(text, /- tool_20/);
  assert.ok(!/No change/.test(text), "the alert called a swap no change");
});

/* ── 2. Same name, the input schema rewritten ──────────────────────────── */

test("versiondiff alone cannot see a schema change, and its no-change says so", () => {
  const d = versiondiff("p", V("1.0.0", ["keep", "other"]), V("1.1.0", ["keep", "other"]));
  assert.equal(d.outcome, "compared");
  assert.deepEqual(d.changes, []);
  /* It is true that nothing it compared moved. It must not read as more. */
  assert.match(d.says, /No change in what could be compared\./);
  assert.match(d.says, /Input schemas: not compared\./);
  assert.match(d.says, /Descriptions: not compared\./);
});

test("the tool comparison catches a schema change behind an unchanged name list", () => {
  const d = diffTools(
    recs([{ name: "keep", inputSchema: { type: "object" } }, { name: "other" }]),
    recs([{ name: "keep", inputSchema: { type: "string" } }, { name: "other" }]),
  );
  assert.deepEqual(d.added, []);
  assert.deepEqual(d.removed, []);
  assert.deepEqual(d.changed.map((c) => `${c.name}:${c.what.join(",")}`), ["keep:input schema"]);
  assert.equal(d.unchanged, 1);
});

test("the alert with captures reports a schema change behind an unchanged name list", () => {
  const tools = diffTools(
    recs([{ name: "keep", inputSchema: { type: "object" } }, { name: "other" }]),
    recs([{ name: "keep", inputSchema: { type: "string" } }, { name: "other" }]),
  );
  const text = renderAlert({
    package: "p", approved: "1.0.0", found: "1.1.0", measuredOn: "2026-11-07",
    diff: versiondiff("p", V("1.0.0", ["keep", "other"]), V("1.1.0", ["keep", "other"])),
    tools,
  });
  assert.match(text, /INPUT SCHEMAS CHANGED/);
  assert.match(text, /keep: the input schema changed\./);
  assert.ok(!/No change/.test(text), "the alert called a schema rewrite no change");
});

test("the alert WITHOUT captures refuses to call a schema change no change", () => {
  const text = renderAlert({
    package: "p", approved: "1.0.0", found: "1.1.0", measuredOn: "2026-11-07",
    diff: versiondiff("p", V("1.0.0", ["keep", "other"]), V("1.1.0", ["keep", "other"])),
    tools: null,
    toolsWhy: "no tool captures stored for 1.1.0",
  });
  assert.match(text, /No change in what could be compared\./);
  assert.match(text, /Descriptions: not compared\. Input schemas: not compared\./);
  assert.match(text, /no tool captures stored for 1\.1\.0/);
  assert.ok(!/^BETWEEN 1\.0\.0 AND 1\.1\.0: No change\./m.test(text), "an unqualified no-change was printed");
});

/* ── 3. Same name, the description rewritten ───────────────────────────── */

test("the tool comparison catches a description change behind an unchanged name list", () => {
  const d = diffTools(
    recs([{ name: "keep", description: "before" }, { name: "other" }]),
    recs([{ name: "keep", description: "after" }, { name: "other" }]),
  );
  assert.deepEqual(d.added, []);
  assert.deepEqual(d.removed, []);
  assert.deepEqual(d.changed.map((c) => `${c.name}:${c.what.join(",")}`), ["keep:description"]);
});

test("the alert reports a description change behind an unchanged name list", () => {
  const tools = diffTools(
    recs([{ name: "keep", description: "before" }, { name: "other" }]),
    recs([{ name: "keep", description: "after" }, { name: "other" }]),
  );
  const text = renderAlert({
    package: "p", approved: "1.0.0", found: "1.1.0", measuredOn: "2026-11-07",
    diff: versiondiff("p", V("1.0.0", ["keep", "other"]), V("1.1.0", ["keep", "other"])),
    tools,
  });
  assert.match(text, /DESCRIPTIONS CHANGED: 1 tool\./);
  assert.match(text, /keep: the description changed\./);
  assert.ok(!/No change/.test(text), "the alert called a description rewrite no change");
});

/* ── The wording of a no-change ────────────────────────────────────────── */

test("a no-change states each thing separately and never the totals alone", () => {
  const all = noChangeLine({ namesA: 46, namesB: 46, added: 0, removed: 0, descriptionsChanged: 0, schemasChanged: 0 });
  assert.equal(
    all,
    "No change. Tool names: 46 in both, 0 added, 0 removed. " +
      "Descriptions: compared, none changed. Input schemas: compared, none changed. " +
      NO_CHANGE_CAVEAT,
  );

  const part = noChangeLine({ namesA: 46, namesB: 46, added: 0, removed: 0, descriptionsChanged: null, schemasChanged: null });
  assert.ok(part.startsWith("No change in what could be compared."), `the qualification is not first: "${part}"`);
  assert.match(part, /Descriptions: not compared\. Input schemas: not compared\./);

  /* One compared and one not is still a qualified no-change. */
  const half = noChangeLine({ namesA: 2, namesB: 2, added: 0, removed: 0, descriptionsChanged: 0, schemasChanged: null });
  assert.ok(half.startsWith("No change in what could be compared."));
  assert.match(half, /Descriptions: compared, none changed\. Input schemas: not compared\./);
});

test("a no-change line never claims equal totals mean an unchanged list", () => {
  /* Added and removed sit beside the totals in every form of the line. */
  for (const c of [
    { namesA: 46, namesB: 46, added: 0, removed: 0, descriptionsChanged: 0, schemasChanged: 0 },
    { namesA: 46, namesB: 46, added: 0, removed: 0, descriptionsChanged: null, schemasChanged: null },
  ]) {
    const line = noChangeLine(c);
    assert.match(line, /0 added, 0 removed/, `"${line}" states a total without its added and removed`);
  }
});


/* ── The limit travels with every no-change ───────────────────────────── */

test("the caveat is the last sentence of every no-change, in every shape", () => {
  for (const c of [
    { namesA: 46, namesB: 46, added: 0, removed: 0, descriptionsChanged: 0, schemasChanged: 0 },
    { namesA: 46, namesB: 46, added: 0, removed: 0, descriptionsChanged: null, schemasChanged: null },
    { namesA: 2, namesB: 2, added: 0, removed: 0, descriptionsChanged: 0, schemasChanged: null },
    { namesA: 0, namesB: 0, added: 0, removed: 0, descriptionsChanged: 0, schemasChanged: 0 },
  ]) {
    const parts = noChangeParts(c);
    assert.equal(parts[parts.length - 1], NO_CHANGE_CAVEAT, `the caveat is not last for ${JSON.stringify(c)}`);
    assert.ok(noChangeLine(c).endsWith(NO_CHANGE_CAVEAT));
  }
});

test("the caveat says both halves, and does not overclaim", () => {
  assert.match(NO_CHANGE_CAVEAT, /what the server says about itself and what it did at startup/);
  assert.match(NO_CHANGE_CAVEAT, /does not test what any tool does when called/);
  assert.match(NO_CHANGE_CAVEAT, /can match here and still behave differently/);
});

test("no no-change output anywhere omits the caveat", () => {
  /*
   * The three renderers, each through its own path. A no-change is the most
   * quotable line this produces; one that travels without its boundary is
   * the failure this test exists to catch.
   */
  const V2 = (version: string) => ({ version, runs: [shapeOf(ev(["keep", "other"])), shapeOf(ev(["keep", "other"]))] as [any, any] });
  const diff = versiondiff("p", V2("1.0.0"), V2("1.1.0"));

  /* versiondiff's own sentence */
  assert.ok(diff.says.includes(NO_CHANGE_CAVEAT), "versiondiff's no-change omits the caveat");

  /* the alert, with captures and without */
  const quiet = diffTools(recs([{ name: "keep" }, { name: "other" }]), recs([{ name: "keep" }, { name: "other" }]));
  for (const input of [
    { tools: quiet, toolsWhy: null },
    { tools: null, toolsWhy: "no tool captures stored for 1.1.0" },
  ]) {
    const text = renderAlert({ package: "p", approved: "1.0.0", found: "1.1.0", measuredOn: "2026-11-07", diff, ...input });
    assert.ok(/No change/.test(text), "this fixture is meant to be a no-change");
    /* wrapped across lines in the alert, so compare on collapsed whitespace */
    const flat = text.replace(/\s+/g, " ");
    assert.ok(flat.includes(NO_CHANGE_CAVEAT), `the alert's no-change omits the caveat (captures: ${!!input.tools})`);
  }
});
