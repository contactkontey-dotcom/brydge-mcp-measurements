import { test } from "node:test";
import assert from "node:assert/strict";
import { shapeOf } from "../watch/fields.ts";
import { checkAgainst, deserialize, entryFrom, keyOf, renderCheck, serialize, NEW_LABEL, ABSENT_LABEL } from "../watch/approved.ts";
import { compareVersions, npmReason, parseLines, pollOne, renderPoll, type Result } from "../watch/poll.ts";
import { renderAlert } from "../watch/alert.ts";
import { versiondiff } from "../watch/versiondiff.ts";

const JUDGING = /\b(safe|unsafe|suspicious|malicious|dangerous)\b/i;

const ev = (over: Record<string, any> = {}) => ({
  package: { name: "thing-mcp", version: "1.0.0" },
  readme: { digest: "a".repeat(64) },
  couldNotStart: null,
  startup: { toToolListMs: 1234 },
  findings: [{ id: "install:integrity", evidence: ["npm thing-mcp@1.0.0"] }],
  observed: {
    offered: ["read", "write"], dnsNames: [], tlsHosts: [], connectAttempts: [],
    programsStarted: ["node", "setpriv", "thing-mcp"], filesWritten: [], installedDuringRun: [],
    ...(over.observed ?? {}),
  },
  ...Object.fromEntries(Object.entries(over).filter(([k]) => k !== "observed")),
});
const both = (version: string, e: Record<string, any>) => ({ version, runs: [shapeOf(e), shapeOf(e)] as [any, any] });

/* ── the approved list ──────────────────────────────────────────────────── */

test("an approved entry is three lists and the version they belong to", () => {
  const e = entryFrom("thing-mcp", "1.0.0", shapeOf(ev()), "2026-11-06", "an-approver");
  assert.deepEqual(e.tools, ["read", "write"]);
  assert.deepEqual(e.programs, ["thing-mcp"], "the harness launcher got onto an approved list");
  assert.deepEqual(e.hosts, []);
  assert.equal(e.approvedBy, "an-approver");
  assert.equal(keyOf("thing-mcp", "1.0.0"), "thing-mcp@1.0.0", "the key must carry the version");
});

test("anything the run shows that the list does not have is labelled, in all three categories", () => {
  const entry = entryFrom("thing-mcp", "1.0.0", shapeOf(ev()), "2026-11-06");
  const ran = shapeOf(ev({ observed: { offered: ["read", "write", "exec"], dnsNames: ["t.test"], programsStarted: ["node", "setpriv", "thing-mcp", "curl"] } }));
  const c = checkAgainst(entry, "1.1.0", ran);
  assert.deepEqual(c.newItems.tools, ["exec"]);
  assert.deepEqual(c.newItems.hosts, ["t.test"]);
  assert.deepEqual(c.newItems.programs, ["curl"]);
  assert.equal(c.allOnList, false);
  const text = renderCheck(c);
  for (const w of ["exec", "t.test", "curl"]) assert.ok(text.includes(`${w} — ${NEW_LABEL}`), `${w} not labelled`);
  assert.equal(JUDGING.exec(text), null);
});

test("a run matching the list says so, and claims nothing else", () => {
  const entry = entryFrom("thing-mcp", "1.0.0", shapeOf(ev()), "2026-11-06");
  const c = checkAgainst(entry, "1.0.1", shapeOf(ev()));
  assert.equal(c.allOnList, true);
  assert.match(renderCheck(c), /Everything this run showed is on your list\./);
});

test("something on the list and absent from the run is not called a removal", () => {
  /* One run is not a removal: the tool may be there under a configuration
   * this run did not have. The label says only what was seen. */
  const entry = entryFrom("thing-mcp", "1.0.0", shapeOf(ev()), "2026-11-06");
  const c = checkAgainst(entry, "1.1.0", shapeOf(ev({ observed: { offered: ["read"] } })));
  assert.deepEqual(c.absent.tools, ["write"]);
  assert.equal(c.allOnList, true, "an absence is not something new");
  const text = renderCheck(c);
  assert.ok(text.includes(`write — ${ABSENT_LABEL}`));
  assert.ok(!/removed|deleted|dropped/i.test(text), "an absence was described as a removal");
});

/* ── the poller ─────────────────────────────────────────────────────────── */

test("version ordering, including the cases it refuses to order", () => {
  assert.equal(compareVersions("2.1.0", "2.0.0"), 1);
  assert.equal(compareVersions("2.0.0", "2.1.0"), -1);
  assert.equal(compareVersions("2.0.0", "2.0.0"), 0);
  assert.equal(compareVersions("2.0.10", "2.0.9"), 1, "versions are numbers, not text");
  assert.equal(compareVersions("1.0.0", "1.0.0-rc.1"), 1, "a release is ahead of its prerelease");
  /* Null, never a guess: an unorderable version becomes "could not check". */
  assert.equal(compareVersions("2.0", "2.0.0"), null);
  assert.equal(compareVersions("latest", "1.0.0"), null);
  assert.equal(compareVersions("1.0.0+build.5", "1.0.0"), null);
});

test("lines are parsed scope-safely, and a bad line is named rather than dropped", () => {
  const { lines, bad } = parseLines("# a comment\n\n@scope/pkg@1.2.3\nplain@0.1.0\nnoversion\n");
  assert.deepEqual(lines, [
    { package: "@scope/pkg", approved: "1.2.3" },
    { package: "plain", approved: "0.1.0" },
  ]);
  assert.equal(bad.length, 1);
  assert.match(bad[0]!.because, /package@version/);
});

test("the poll reports each state separately and never files an error as up to date", () => {
  const fake = (map: Record<string, { stdout?: string; error?: string }>) => (p: string) => map[p] ?? { error: "unknown" };
  const run = fake({
    "a-mcp": { stdout: "2.1.0\n" },
    "b-mcp": { stdout: "1.0.0\n" },
    "c-mcp": { error: "404 Not Found - GET https://registry.npmjs.org/c-mcp" },
    "d-mcp": { stdout: "weird\n" },
  });
  const results: Result[] = [
    pollOne({ package: "a-mcp", approved: "2.0.0" }, run),
    pollOne({ package: "b-mcp", approved: "1.0.0" }, run),
    pollOne({ package: "c-mcp", approved: "1.0.0" }, run),
    pollOne({ package: "d-mcp", approved: "1.0.0" }, run),
  ];
  assert.equal(results[0]!.status, "newer available");
  assert.equal(results[1]!.status, "approved is latest");
  assert.equal(results[2]!.status, "could not check");
  assert.equal(results[3]!.status, "could not check", "an unorderable version was treated as orderable");

  const text = renderPoll(results, [{ raw: "oops", because: "no version: a line is package@version" }]);
  assert.match(text, /Newer version published: 1/);
  assert.match(text, /Still the latest: 1/);
  assert.match(text, /Could not check: 3/);
  assert.match(text, /Nothing is blocked and nothing needs to be\./);
  assert.equal(JUDGING.exec(text), null);
});

test("one unreachable package does not decide the others", () => {
  const run = (p: string) => (p === "down-mcp" ? { error: "network" } : { stdout: "9.9.9\n" });
  const rs = [
    pollOne({ package: "down-mcp", approved: "1.0.0" }, run),
    pollOne({ package: "up-mcp", approved: "1.0.0" }, run),
  ];
  assert.equal(rs[0]!.status, "could not check");
  assert.equal(rs[1]!.status, "newer available");
});

/* ── the alert ──────────────────────────────────────────────────────────── */

test("the alert carries the facts, says nothing is blocked, and ends with its limits", () => {
  const a = both("1.0.0", ev());
  const b = both("1.1.0", ev({ observed: { offered: ["read", "write", "exec"], dnsNames: ["t.test"] }, readme: { digest: "b".repeat(64) } }));
  const entry = entryFrom("thing-mcp", "1.0.0", a.runs[0], "2026-11-06");
  const text = renderAlert({
    package: "thing-mcp",
    approved: "1.0.0",
    found: "1.1.0",
    measuredOn: "2026-11-06",
    diff: versiondiff("thing-mcp", a, b),
    check: checkAgainst(entry, "1.1.0", b.runs[0]),
    reportUrl: "https://mcp.brydge-ai.com/s/thing-mcp.html",
  });

  assert.match(text, /^thing-mcp: version 1\.1\.0 published\. You approved 1\.0\.0\./);
  assert.match(text, new RegExp(`2 items ${NEW_LABEL}`));
  assert.match(text, /tool: exec/);
  assert.match(text, /website reached: t\.test/);
  assert.match(text, /\+ exec/);
  assert.match(text, /README: the text differs/);
  assert.match(text, /NOTHING IS BLOCKED\./);
  assert.match(text, /WHAT THIS DOES NOT SAY:/);
  assert.match(text, /no tool was called in any run/);
  assert.match(text, /no connection completed/);
  assert.match(text, /one configuration/);
  assert.equal(JUDGING.exec(text), null);
  /* Nothing that differs on every bump by construction. */
  for (const leak of ["1234", "install:integrity", "sha512"]) assert.ok(!text.includes(leak), `"${leak}" reached the alert`);
});

test("the alert never recommends, scores or rates", () => {
  const a = both("1.0.0", ev());
  const b = both("2.0.0", ev({ observed: { offered: ["read", "write", "exec"] } }));
  const text = renderAlert({ package: "thing-mcp", approved: "1.0.0", found: "2.0.0", measuredOn: "2026-11-06", diff: versiondiff("thing-mcp", a, b), check: null });
  for (const w of ["recommend", "should", "must", "urgent", "critical", "risk", "severity", "score", "warning"]) {
    assert.ok(!new RegExp(`\\b${w}`, "i").test(text), `the alert uses "${w}"`);
  }
});

test("an alert for a version that could not start says that, and reports no changes", () => {
  const a = both("1.0.0", ev());
  const stuck = both("2.0.0", ev({ couldNotStart: { stage: "initialize", because: "exited" }, observed: null }));
  const text = renderAlert({ package: "thing-mcp", approved: "1.0.0", found: "2.0.0", measuredOn: "2026-11-06", diff: versiondiff("thing-mcp", a, stuck), check: null });
  assert.match(text, /Version 2\.0\.0 could not start, nothing compared\./);
  assert.ok(!/\+ /.test(text), "changes were listed for a version that never ran");
});

test("the list survives a round trip through a file, with everything still in it", () => {
  /* The bug this exists for: sorted keys passed as JSON.stringify's REPLACER
   * rather than as an ordering. Every entry serialised as `{}`. It wrote the
   * file, printed a cheerful count, and lost the lot — and no unit test saw it
   * because no unit test went through a file. */
  const list = {
    [keyOf("b-mcp", "1.0.0")]: entryFrom("b-mcp", "1.0.0", shapeOf(ev()), "2026-11-06"),
    [keyOf("a-mcp", "2.0.0")]: entryFrom("a-mcp", "2.0.0", shapeOf(ev({ observed: { offered: ["x"] } })), "2026-11-05", "an-approver"),
  };
  const back = deserialize(serialize(list));
  assert.deepEqual(back, list, "the list did not survive being written and read");
  assert.deepEqual(Object.keys(back), ["a-mcp@2.0.0", "b-mcp@1.0.0"], "keys are not sorted");
  assert.deepEqual(back["b-mcp@1.0.0"]!.tools, ["read", "write"]);
  assert.equal(back["a-mcp@2.0.0"]!.approvedBy, "an-approver");
});

test("an emptied or malformed entry is refused rather than read as an empty list", () => {
  /* Had this existed, the replacer bug would have failed loudly on the next
   * read instead of looking like "nothing approved for this package". */
  assert.throws(() => deserialize('{"a-mcp@1.0.0":{}}'), /is not an entry/);
  assert.throws(() => deserialize('{"a-mcp@1.0.0":{"package":"a-mcp","version":"1.0.0"}}'), /is not an entry/);
  assert.deepEqual(deserialize("{}"), {});
});

test("a registry failure is reported by its cause, not by our log path", () => {
  /* npm's last stderr line is "A complete log of this run can be found in:
   * /root/.npm/_logs/...", which says nothing about the package and puts a
   * path from our machine into somebody's report. */
  const real = [
    "npm error code E404",
    "npm error 404 Not Found - GET https://registry.npmjs.org/nope-mcp - Not found",
    "npm error 404  'nope-mcp@*' is not in this registry.",
    "npm error A complete log of this run can be found in: /root/.npm/_logs/2026-11-06T06_28_17_205Z-debug-0.log",
  ].join("\n");
  const reason = npmReason(real, 1);
  assert.match(reason, /404 Not Found/);
  assert.ok(!reason.includes("_logs/"), "a path from our machine reached the report");
  assert.ok(!/complete log/i.test(reason));
  assert.equal(npmReason("", 1), "npm exited 1");
  assert.match(npmReason("npm error network ETIMEDOUT\n", 1), /ETIMEDOUT/);
});
