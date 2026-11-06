import { test } from "node:test";
import assert from "node:assert/strict";
import { shapeOf, agree, BEHAVIOUR } from "../watch/fields.ts";
import { versiondiff, renderDiff, type Measured } from "../watch/versiondiff.ts";

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
  assert.match(d.says, /Nothing changed/);
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
  assert.match(d.says, /Nothing changed/);
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
