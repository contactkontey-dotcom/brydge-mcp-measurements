import { test } from "node:test";
import assert from "node:assert/strict";
import { shapeOf, agree, BEHAVIOUR } from "../watch/fields.ts";
import { versiondiff, renderDiff, soundnessOf, type Measured } from "../watch/versiondiff.ts";

/*
 * ═══════════════════════════════════════════════════════════════════════════
 * THE WAYS A DIFF REPORTS A CHANGE NOBODY MEASURED.
 *
 * Every test here is one of them: counting a README edit as behaviour, reading
 * a failed start as "everything removed", attributing the harness's own
 * launcher to the package, reporting a field whose two runs disagreed, or
 * letting a timestamp through as news.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const ev = (over: Record<string, any> = {}) => ({
  package: { name: "thing-mcp", version: "1.0.0" },
  measuredAt: "2026-11-06T00:00:00.000Z",
  readme: { digest: "a".repeat(64) },
  couldNotStart: null,
  startup: { toToolListMs: 1234 },
  findings: [{ id: "install:integrity", evidence: ["npm thing-mcp@1.0.0", "integrity sha512-AAA"] }],
  observed: {
    offered: ["read", "write"],
    dnsNames: [],
    tlsHosts: [],
    connectAttempts: [],
    programsStarted: ["node", "setpriv", "thing-mcp"],
    filesWritten: [],
    installedDuringRun: [],
  },
  ...over,
});

const both = (version: string, e: Record<string, any>): Measured => ({ version, runs: [shapeOf(e), shapeOf(e)] });

test("the harness's own launcher is not the package's doing", () => {
  const s = shapeOf(ev());
  assert.deepEqual(s.sets["programs started"], ["thing-mcp"], "node or setpriv reached the comparison");
});

test("websites reached is DNS and TLS together, deduplicated", () => {
  const s = shapeOf(ev({ observed: { ...ev().observed, dnsNames: ["b.test", "a.test"], tlsHosts: ["a.test"] } }));
  assert.deepEqual(s.sets["websites reached"], ["a.test", "b.test"]);
});

test("identical versions produce no changes and no can't-tells", () => {
  const d = versiondiff("thing-mcp", both("1.0.0", ev()), both("1.0.1", ev()));
  assert.equal(d.outcome, "compared");
  assert.deepEqual(d.changes, []);
  assert.deepEqual(d.cannotTell, []);
  assert.equal(d.readme, "same");
  /* versiondiff never looks at a description or a schema, and its no-change
   * line has to say so rather than read as a clean bill. */
  assert.match(d.says, /No change in what could be compared\./);
  assert.match(d.says, /Descriptions: not compared\. Input schemas: not compared\./);
});

test("a tool added and a website reached for are reported with their direction", () => {
  const b = ev({ observed: { ...ev().observed, offered: ["read", "write", "exec"], dnsNames: ["telemetry.test"] } });
  const d = versiondiff("thing-mcp", both("1.0.0", ev()), both("1.1.0", b));
  const tools = d.changes.find((c) => c.field === "tools offered")!;
  assert.deepEqual(tools.added, ["exec"]);
  assert.deepEqual(tools.removed, []);
  const sites = d.changes.find((c) => c.field === "websites reached")!;
  assert.deepEqual(sites.added, ["telemetry.test"]);
  assert.equal(d.changes.length, 2);
});

test("a README edit is its own line and is never counted as behaviour", () => {
  const b = ev({ readme: { digest: "b".repeat(64) } });
  const d = versiondiff("thing-mcp", both("1.0.0", ev()), both("1.0.1", b));
  assert.equal(d.readme, "changed");
  assert.deepEqual(d.changes, [], "a README edit was counted as a behaviour change");
  assert.match(d.says, /No change in what could be compared\./);
  assert.match(renderDiff(d), /means the text differs and nothing more/);
});

test("a version that could not start is an outcome, not an empty measurement", () => {
  /* The trap: its sets are empty, so an unguarded diff reports every tool and
   * every host as removed — a finding nobody made. */
  const stuck = ev({
    couldNotStart: { stage: "initialize", because: "the server process exited" },
    observed: null,
    comparison: null,
  });
  const d = versiondiff("thing-mcp", both("1.0.0", ev()), both("2.0.0", stuck));
  assert.equal(d.outcome, "could-not-start-b");
  assert.equal(d.says, "Version 2.0.0 could not start, nothing compared.");
  assert.deepEqual(d.changes, [], "a failed start was read as removals");
  assert.equal(d.readme, "not compared");

  const back = versiondiff("thing-mcp", both("2.0.0", stuck), both("2.0.1", ev()));
  assert.equal(back.outcome, "could-not-start-a");
  assert.deepEqual(back.changes, []);

  const neither = versiondiff("thing-mcp", both("2.0.0", stuck), both("2.0.1", stuck));
  assert.equal(neither.outcome, "could-not-start-both");
});

test("when a version's own two runs disagree, that field says can't tell and claims no change", () => {
  const r1 = shapeOf(ev());
  const r2 = shapeOf(ev({ observed: { ...ev().observed, offered: ["read"] } }));
  const shaky: Measured = { version: "1.0.0", runs: [r1, r2] };
  const steady = both("1.1.0", ev({ observed: { ...ev().observed, offered: ["read", "write", "exec"] } }));

  const d = versiondiff("thing-mcp", shaky, steady);
  assert.ok(d.cannotTell.includes("tools offered"));
  assert.ok(!d.changes.some((c) => c.field === "tools offered"), "a change was reported for an unstable field");
  assert.match(renderDiff(d), /Can't tell, and no change is reported/);
});

test("instability in B is as disqualifying as instability in A", () => {
  const steady = both("1.0.0", ev());
  const shaky: Measured = {
    version: "1.1.0",
    runs: [shapeOf(ev({ observed: { ...ev().observed, filesWritten: ["/tmp/x"] } })), shapeOf(ev())],
  };
  const d = versiondiff("thing-mcp", steady, shaky);
  assert.ok(d.cannotTell.includes("files written"));
  assert.ok(!d.changes.some((c) => c.field === "files written"));
});

test("disagreeing about whether it started stops the comparison outright", () => {
  const stuck = ev({ couldNotStart: { stage: "initialize", because: "x" }, observed: null });
  const shaky: Measured = { version: "2.0.0", runs: [shapeOf(ev()), shapeOf(stuck)] };
  const d = versiondiff("thing-mcp", both("1.0.0", ev()), shaky);
  assert.equal(d.outcome, "cannot-tell");
  assert.deepEqual(d.changes, []);
  assert.match(d.says, /disagreed about whether it started/);
});

test("timing, measuredAt and the integrity finding are never a change", () => {
  /* Each of these differs on every single version bump by construction. */
  const b = ev({
    measuredAt: "2026-12-25T00:00:00.000Z",
    startup: { toToolListMs: 99999 },
    findings: [{ id: "install:integrity", evidence: ["npm thing-mcp@9.9.9", "integrity sha512-ZZZ"] }],
  });
  const d = versiondiff("thing-mcp", both("1.0.0", ev()), both("9.9.9", b));
  assert.deepEqual(d.changes, []);
  assert.deepEqual(d.cannotTell, []);
  const text = renderDiff(d);
  for (const leak of ["99999", "2026-12-25", "integrity", "sha512"]) {
    assert.ok(!text.includes(leak), `"${leak}" reached the diff`);
  }
});

test("the rendered diff never judges, and says what it does not say", () => {
  const b = ev({ observed: { ...ev().observed, offered: ["read", "write", "exec"], dnsNames: ["x.test"] } });
  const text = renderDiff(versiondiff("thing-mcp", both("1.0.0", ev()), both("1.1.0", b)));
  assert.equal(/\b(safe|unsafe|suspicious|malicious|dangerous)\b/i.exec(text), null);
  assert.match(text, /What this does not say/);
  assert.match(text, /no tool was called/);
  assert.match(text, /no connection completed/);
});

test("agree names every field the two runs differ on", () => {
  const a = shapeOf(ev());
  const b = shapeOf(ev({ readme: { digest: "c".repeat(64) }, observed: { ...ev().observed, offered: ["read"] } }));
  const r = agree(a, b);
  assert.equal(r.ok, false);
  assert.deepEqual(r.disagreed.sort(), ["README digest", "tools offered"]);
  assert.equal(agree(a, a).ok, true);
  assert.equal(BEHAVIOUR.length, 6);
});

/*
 * ═══════════════════════════════════════════════════════════════════════════
 * "NOTHING CHANGED" IS THE MOST REASSURING THING THIS CAN SAY, SO IT HAS TO
 * BE THE HARDEST TO GET.
 *
 * Until the soundness gate, the sentence read identically whether both
 * versions offered 311 identical tools or whether neither was ever observed.
 * The second is not a finding; it is the absence of one in the first one's
 * clothes.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** Started, but nothing was observed: `observed` null in the evidence. */
const unobserved = (v: string) => {
  const e = ev({ observed: null });
  return { version: v, runs: [shapeOf(e), shapeOf(e)] as [any, any] };
};

test("two unobserved versions are not comparable, and no change is claimed", () => {
  const d = versiondiff("thing-mcp", unobserved("1.0.0"), unobserved("1.1.0"));
  assert.equal(d.outcome, "not-comparable");
  assert.deepEqual(d.changes, []);
  assert.match(d.says, /started but no tool list was observed/);
  assert.match(d.says, /No change is reported either way/);
  assert.ok(!/Nothing changed/.test(d.says), "an absence of evidence was reported as a no-change");
});

test("one side unobserved is enough to stop the comparison", () => {
  const d = versiondiff("thing-mcp", both("1.0.0", ev()), unobserved("1.1.0"));
  assert.equal(d.outcome, "not-comparable");
  assert.match(d.says, /1\.1\.0 started but no tool list was observed/);
  assert.ok(!d.says.includes("1.0.0 "), "a sound version was blamed for the other's gap");
});

test("a could-not-start keeps its own sentence rather than becoming not-comparable", () => {
  /* "Version 2.0.0 could not start" tells a reader more than "not
   * comparable", so the specific answer wins where there is one. */
  const stuck = ev({ couldNotStart: { stage: "initialize", because: "exited" }, observed: null });
  const d = versiondiff("thing-mcp", both("1.0.0", ev()), both("2.0.0", stuck));
  assert.equal(d.outcome, "could-not-start-b");
  assert.match(d.says, /could not start, nothing compared/);
});

test("a no-change names each thing compared and never offers the totals as the comparison", () => {
  /*
   * "46 and 46" is also what a one-for-one swap looks like, and a count of
   * names says nothing at all about a description or an input schema. So the
   * line states the names WITH their added and removed, and says for each of
   * the other two whether anything looked.
   */
  const d = versiondiff("thing-mcp", both("1.0.0", ev()), both("1.0.1", ev()));
  assert.equal(d.outcome, "compared");
  assert.match(d.says, /Tool names: 2 in both, 0 added, 0 removed\./);
  assert.match(d.says, /Descriptions: not compared\./);
  assert.match(d.says, /Input schemas: not compared\./);
  assert.match(d.says, /both versions were measured twice with their runs agreeing/);
  /* and the bare pair of totals is gone */
  assert.ok(!/\(2 and 2 tools\)/.test(d.says), "the two totals are still offered as the comparison");
});

test("a server that genuinely offers nothing is comparable, and says zero out loud", () => {
  /* Answering "no tools" is a real answer and must not be confused with not
   * being observed — but the reader has to be able to see which it was. */
  const none = ev({ observed: { ...ev().observed, offered: [] } });
  const d = versiondiff("thing-mcp", both("1.0.0", none), both("1.0.1", none));
  assert.equal(d.outcome, "compared");
  assert.match(d.says, /Tool names: 0 in both, 0 added, 0 removed\./);
  const text = renderDiff(d);
  assert.match(text, /tools offered\s+0\s+0/);
});

test("every field's count is printed for both versions, comparable or not", () => {
  for (const d of [
    versiondiff("thing-mcp", both("1.0.0", ev()), both("1.1.0", ev())),
    versiondiff("thing-mcp", both("1.0.0", ev()), unobserved("1.1.0")),
  ]) {
    assert.equal(d.counts.length, 6);
    const text = renderDiff(d);
    for (const f of ["tools offered", "websites reached", "programs started", "files written", "packages installed while running", "connection attempts"]) {
      assert.ok(text.includes(f), `${f} count missing from the output`);
    }
  }
});

test("soundness reports what is missing, not merely that something is", () => {
  const s = soundnessOf(unobserved("1.0.0"));
  assert.equal(s.answered, false);
  assert.equal(s.started, true);
  assert.equal(s.reproduced, true);
  assert.deepEqual(s.missing, ["1.0.0 started but no tool list was observed"]);
  const ok = soundnessOf(both("1.0.0", ev()));
  assert.deepEqual(ok.missing, []);
  assert.equal(ok.toolCount, 2);
});
