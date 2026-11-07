/*
 * The audit log: the refusal, the four states, and the two things the
 * renderer must never say.
 */
import { strict as assert } from "node:assert";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { folderOf, RUNS } from "../watch/store.ts";
import { edgesOf, orderOf, pathFor, read, recordFor, renderTimeline, stateOf, write, type LogRecord } from "../watch/log.ts";
import { versiondiff, type Diff, type Outcome } from "../watch/versiondiff.ts";
import { shapeOf } from "../watch/fields.ts";

/* ── A run file, written by hand, so the refusal can be provoked ───────── */

function plantRun(pkg: string, version: string, n: 1 | 2, fingerprint: string, tools: string[]): void {
  const dir = folderOf(pkg, version);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `run-${n}.json`),
    JSON.stringify({
      measuredAt: "2026-11-06T00:00:00.000Z",
      instrumentFingerprint: fingerprint,
      notCalibrationBacked: true,
      package: { name: pkg, version, integrity: `sha512-${version}` },
      readme: { digest: "same-digest" },
      couldNotStart: null,
      observed: { offered: tools, dnsNames: [], tlsHosts: [], programsStarted: ["node"], filesWritten: [], installedDuringRun: [], connectAttempts: [] },
      findings: [],
    }),
  );
}

const PKG = "__audit-log-test";
function clean(): void {
  for (const d of ["1.0.0", "1.1.0", "1.2.0"]) rmSync(folderOf(PKG, d), { recursive: true, force: true });
  rmSync(join(RUNS, "..", "log", PKG), { recursive: true, force: true });
}

test("a record is refused when the four runs come from different instruments", () => {
  clean();
  try {
    plantRun(PKG, "1.0.0", 1, "aaaa1111", ["one"]);
    plantRun(PKG, "1.0.0", 2, "aaaa1111", ["one"]);
    plantRun(PKG, "1.1.0", 1, "aaaa1111", ["one"]);
    plantRun(PKG, "1.1.0", 2, "bbbb2222", ["one"]); /* one run, a different instrument */
    assert.throws(() => recordFor(PKG, "1.0.0", "1.1.0"), /different instruments/);
    /* and the message names the file, so the reader can go and look */
    try {
      recordFor(PKG, "1.0.0", "1.1.0");
      assert.fail("should have thrown");
    } catch (e) {
      const m = String((e as Error).message);
      assert.match(m, /run-2\.json/);
      assert.match(m, /bbbb2222/);
    }
  } finally {
    clean();
  }
});

test("one instrument across all four runs records, and nothing is refused", () => {
  clean();
  try {
    for (const n of [1, 2] as const) plantRun(PKG, "1.0.0", n, "cccc3333", ["one", "two"]);
    for (const n of [1, 2] as const) plantRun(PKG, "1.1.0", n, "cccc3333", ["one", "two"]);
    const rec = recordFor(PKG, "1.0.0", "1.1.0");
    assert.equal(rec.instrumentFingerprint, "cccc3333");
    assert.equal(rec.state, "no change");
    assert.equal(rec.calibrationBacked, false);
    assert.equal(Object.keys(rec.runFiles).length, 4);
  } finally {
    clean();
  }
});

test("the gap is the string unknown, never a number, and never zero", () => {
  clean();
  try {
    for (const n of [1, 2] as const) plantRun(PKG, "1.0.0", n, "dddd4444", ["one"]);
    for (const n of [1, 2] as const) plantRun(PKG, "1.1.0", n, "dddd4444", ["one", "two"]);
    const rec = recordFor(PKG, "1.0.0", "1.1.0");
    assert.equal(rec.gap, "unknown");
    assert.equal(typeof rec.gap, "string");
    assert.equal(rec.publishedAt.a, null);
    const text = renderTimeline(PKG, [rec]);
    assert.match(text, /not measured: unknown number of versions between/);
    assert.ok(!/0 versions/.test(text), "must never print a count of zero versions between");
  } finally {
    clean();
  }
});

/* ── The four states ───────────────────────────────────────────────────── */

const fakeDiff = (outcome: Outcome, changes: Diff["changes"] = []): Diff =>
  ({ package: "p", a: "1", b: "2", outcome, says: "s", changes, cannotTell: [], readme: "same", counts: [], sound: {} as any }) as Diff;

test("every outcome maps to exactly one of the four states", () => {
  assert.equal(stateOf(fakeDiff("compared", [{ field: "tools offered", added: ["x"], removed: [] }])), "changed");
  assert.equal(stateOf(fakeDiff("compared", [])), "no change");
  assert.equal(stateOf(fakeDiff("cannot-tell")), "can't tell");
  assert.equal(stateOf(fakeDiff("not-comparable")), "can't tell");
  assert.equal(stateOf(fakeDiff("could-not-start-a")), "can't tell");
  assert.equal(stateOf(fakeDiff("could-not-start-b")), "can't tell");
  assert.equal(stateOf(fakeDiff("could-not-start-both")), "can't tell");
});

test("a version that could not start is can't tell, and is never read as no change", () => {
  clean();
  try {
    for (const n of [1, 2] as const) plantRun(PKG, "1.0.0", n, "eeee5555", ["one"]);
    for (const n of [1, 2] as const) {
      const dir = folderOf(PKG, "1.1.0");
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, `run-${n}.json`),
        JSON.stringify({
          measuredAt: "2026-11-06T00:00:00.000Z",
          instrumentFingerprint: "eeee5555",
          notCalibrationBacked: true,
          package: { name: PKG, version: "1.1.0", integrity: "sha512-x" },
          couldNotStart: { stage: "initialize", said: "it exited before answering" },
          observed: null,
          findings: [],
        }),
      );
    }
    const rec = recordFor(PKG, "1.0.0", "1.1.0");
    assert.equal(rec.state, "can't tell");
    const text = renderTimeline(PKG, [rec]);
    assert.match(text, /can't tell/);
    assert.ok(!/no change/.test(text), "a version that could not start must not read as no change");
    /* the specific reason survives the fold into can't tell */
    assert.match(text, /could not start/);
  } finally {
    clean();
  }
});

test("a no-change row states the evidence it rests on", () => {
  clean();
  try {
    for (const n of [1, 2] as const) plantRun(PKG, "1.0.0", n, "ffff6666", ["a", "b", "c"]);
    for (const n of [1, 2] as const) plantRun(PKG, "1.1.0", n, "ffff6666", ["a", "b", "c"]);
    const text = renderTimeline(PKG, [recordFor(PKG, "1.0.0", "1.1.0")]);
    assert.match(text, /no change/);
    assert.match(text, /- tool names: 3 in both, 0 added, 0 removed/);
    assert.match(text, /Compared, no differences:/);
    assert.match(text, /Not compared:/);
    /* no captures were planted, so neither of these was looked at */
    assert.match(text, /- tool descriptions \(/);
    assert.match(text, /- tool input schemas \(/);
    assert.ok(!text.includes("could be compared"), "the phrase survived in the timeline");
    /* the two bare totals are no longer offered as the evidence */
    assert.ok(!/3 tools, then 3/.test(text), "the row still prints the totals as the comparison");
  } finally {
    clean();
  }
});

/* ── What the renderer may not say ─────────────────────────────────────── */

test("the timeline carries no judging word and no trend claim", () => {
  clean();
  try {
    for (const n of [1, 2] as const) plantRun(PKG, "1.0.0", n, "7777aaaa", ["one"]);
    for (const n of [1, 2] as const) plantRun(PKG, "1.1.0", n, "7777aaaa", ["one", "two"]);
    for (const n of [1, 2] as const) plantRun(PKG, "1.2.0", n, "7777aaaa", ["one", "two", "three"]);
    const recs = [recordFor(PKG, "1.0.0", "1.1.0"), recordFor(PKG, "1.1.0", "1.2.0")];
    const text = renderTimeline(PKG, recs).toLowerCase();
    for (const word of ["safe", "unsafe", "suspicious", "malicious", "dangerous", "risky", "harmless", "legitimate"]) {
      assert.ok(!new RegExp(`\\b${word}\\b`).test(text), `the timeline must not say "${word}"`);
    }
    for (const claim of ["increasingly", "trend", "trending", "pattern of", "escalating", "more and more", "getting worse"]) {
      assert.ok(!text.includes(claim), `the timeline must not claim "${claim}"`);
    }
    assert.match(text, /what this does not say/);
  } finally {
    clean();
  }
});

test("an empty log says nothing is known, rather than nothing changed", () => {
  const text = renderTimeline("@nobody/measured-this", []);
  assert.match(text, /No saved records/);
  assert.ok(!/no change/.test(text));
});

test("records read back oldest edge first, whatever order the files are in", () => {
  clean();
  try {
    for (const n of [1, 2] as const) plantRun(PKG, "1.0.0", n, "8888bbbb", ["one"]);
    for (const n of [1, 2] as const) plantRun(PKG, "1.1.0", n, "8888bbbb", ["one"]);
    for (const n of [1, 2] as const) plantRun(PKG, "1.2.0", n, "8888bbbb", ["one"]);
    write(recordFor(PKG, "1.1.0", "1.2.0"));
    write(recordFor(PKG, "1.0.0", "1.1.0"));
    const back = read(PKG);
    assert.deepEqual(
      back.map((r) => `${r.a}..${r.b}`),
      ["1.0.0..1.1.0", "1.1.0..1.2.0"],
    );
    assert.ok(existsSync(pathFor(PKG, "1.0.0", "1.1.0")));
  } finally {
    clean();
  }
});

test("a run file holding another package is refused, not recorded under this one", () => {
  clean();
  try {
    for (const n of [1, 2] as const) plantRun(PKG, "1.0.0", n, "9999cccc", ["one"]);
    const dir = folderOf(PKG, "1.1.0");
    mkdirSync(dir, { recursive: true });
    for (const n of [1, 2]) {
      writeFileSync(
        join(dir, `run-${n}.json`),
        JSON.stringify({
          instrumentFingerprint: "9999cccc",
          package: { name: "somebody-else", version: "1.1.0" },
          couldNotStart: null,
          observed: { offered: [] },
          findings: [],
        }),
      );
    }
    assert.throws(() => recordFor(PKG, "1.0.0", "1.1.0"), /holds somebody-else@1\.1\.0/);
  } finally {
    clean();
  }
});

/* ── Edge direction ────────────────────────────────────────────────────── */

test("two prereleases of one release get no edge, because the order is not known", () => {
  /* Commit hashes. `3` sorts before `f` in ASCII, which says nothing about
   * which was published first, and an edge prints additions and removals. */
  assert.equal(orderOf("1.1.2-rc.33f45c4d7", "1.1.2-rc.faa269337"), null);
  assert.equal(orderOf("0.0.0-canary-20261105100153", "0.0.0-canary-20261105200211"), null);
  assert.equal(orderOf("1.6.5-next.738.1", "1.6.5-next.739.1"), null);
});

test("an order the release numbers settle is still known, tags or no tags", () => {
  assert.equal(orderOf("1.13.0", "1.14.0-next.4"), -1);
  assert.equal(orderOf("1.14.0-next.4", "1.13.0"), 1);
  assert.equal(orderOf("1.128.0", "1.131.1"), -1);
  assert.equal(orderOf("2.0.0", "2.1.0"), -1);
  /* a release is ahead of its own prerelease */
  assert.equal(orderOf("1.0.0", "1.0.0-rc.1"), 1);
  assert.equal(orderOf("1.0.0", "1.0.0"), 0);
  /* a version this does not parse is not ordered against anything */
  assert.equal(orderOf("1.0", "1.0.0"), null);
});

test("edgesOf reports an unorderable pair rather than inventing a direction", () => {
  clean();
  try {
    for (const n of [1, 2] as const) plantRun(PKG, "1.0.0-rc.aaa", n, "order1111", ["one"]);
    for (const n of [1, 2] as const) plantRun(PKG, "1.0.0-rc.bbb", n, "order1111", ["one", "two"]);
    const { edges, unordered } = edgesOf(PKG);
    assert.equal(edges.length, 0);
    assert.equal(unordered.length, 1);
  } finally {
    rmSync(folderOf(PKG, "1.0.0-rc.aaa"), { recursive: true, force: true });
    rmSync(folderOf(PKG, "1.0.0-rc.bbb"), { recursive: true, force: true });
    clean();
  }
});
