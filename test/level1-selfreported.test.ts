/*
 * A server's own version against the one npm installed.
 *
 * 22 of the 67 measured servers report something other than the installed
 * version, in five shapes, and every shape below is taken from the stored
 * evidence rather than invented. The rule throughout: report both strings,
 * say which is the server's claim, conclude nothing.
 */
import { strict as assert } from "node:assert";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { selfReported, selfReportedLine, selfReportedShort } from "../level1/selfreported.ts";

const ev = (version: string, serverInfo: unknown) => ({ package: { version }, serverInfo });

test("the same string is the ordinary case and says nothing", () => {
  const s = selfReported(ev("1.2.3", { name: "x", version: "1.2.3" }));
  assert.equal(s.agreement, "same");
  assert.equal(selfReportedLine(s), null, "a matching version produced a line on 45 of 67 pages");
  assert.equal(selfReportedShort(s), null);
});

/* ── The five shapes, all real ─────────────────────────────────────────── */

test("a default left in place: @kolbo/mcp, npm 1.128.0, says 1.0.0", () => {
  const s = selfReported(ev("1.128.0", { name: "kolbo", version: "1.0.0" }));
  assert.equal(s.agreement, "differs");
  assert.equal(s.stated, "1.0.0");
  const line = selfReportedLine(s)!;
  assert.match(line, /npm installed `1\.128\.0`/);
  assert.match(line, /said `1\.0\.0`/);
});

test("a build string is not reduced to its release: 0.12.0-SNAPSHOT-1ff4340", () => {
  const s = selfReported(ev("0.12.0", { name: "excel", version: "0.12.0-SNAPSHOT-1ff4340" }));
  assert.equal(s.agreement, "differs", "the build string was folded into 0.12.0");
  assert.equal(s.stated, "0.12.0-SNAPSHOT-1ff4340", "the string was altered");
});

test("a truncated version is not read as a semver: 9 is not 9.7.4", () => {
  const s = selfReported(ev("9.7.4", { name: "mantine", version: "9" }));
  assert.equal(s.agreement, "differs");
  assert.equal(s.stated, "9");
});

test("something that is not a version at all is reported as given: 0.8.x", () => {
  const s = selfReported(ev("0.9.10", { name: "chart", version: "0.8.x" }));
  assert.equal(s.agreement, "differs");
  assert.equal(s.stated, "0.8.x");
  assert.match(selfReportedLine(s)!, /said `0\.8\.x`/);
});

test("another product's version is reported as given, with no guess about why", () => {
  const s = selfReported(ev("0.0.83", { name: "playwright", version: "1.64.0-alpha-1790635538000" }));
  assert.equal(s.agreement, "differs");
  const line = selfReportedLine(s)!;
  assert.match(line, /1\.64\.0-alpha-1790635538000/);
  assert.ok(!/playwright core|different product|actually/i.test(line), "it guessed at the cause");
});

/* ── Absent, empty, malformed ──────────────────────────────────────────── */

test("no serverInfo, no version, and an empty string all read as not stated", () => {
  for (const info of [null, undefined, {}, { name: "x" }, { name: "x", version: "" }, { name: "x", version: "   " }, { version: 7 }]) {
    const s = selfReported(ev("1.0.0", info));
    assert.equal(s.agreement, "not stated", `${JSON.stringify(info)} was not read as "not stated"`);
    assert.equal(s.stated, null);
  }
  const line = selfReportedLine(selfReported(ev("1.0.0", null)))!;
  assert.match(line, /did not state a version/);
  assert.match(line, /nothing here to compare it with/);
});

test("a non-object serverInfo does not throw", () => {
  for (const info of ["1.0.0", 42, [], true]) {
    assert.doesNotThrow(() => selfReported(ev("1.0.0", info)));
  }
});

/* ── What it may never say ─────────────────────────────────────────────── */

test("no line judges the difference", () => {
  const lines = [
    selfReportedLine(selfReported(ev("1.128.0", { version: "1.0.0" })))!,
    selfReportedLine(selfReported(ev("1.0.0", null)))!,
  ];
  for (const line of lines.map((l) => l.toLowerCase())) {
    for (const w of ["stale", "wrong", "incorrect", "should", "outdated", "forgot", "failed to", "bug", "mistake", "sloppy", "misleading"]) {
      assert.ok(!line.includes(w), `a line says "${w}"`);
    }
    assert.match(line, /own claim|nothing here to compare/);
  }
});

test("the line says the second string is a claim and not a measurement", () => {
  const line = selfReportedLine(selfReported(ev("2.0.0", { version: "1.0.0" })))!;
  assert.match(line, /the server's own claim about itself, not a measurement/);
  assert.match(line, /does not say which is right or why they differ/);
});

/* ── Against the real 67 ───────────────────────────────────────────────── */

const DIR = join(import.meta.dirname, "..", "level1", "evidence");
const have = existsSync(DIR);

test("the stored evidence splits 45 same / 22 differs / 0 not stated", { skip: !have }, () => {
  const tally = { same: 0, differs: 0, "not stated": 0 } as Record<string, number>;
  for (const f of readdirSync(DIR).filter((x) => x.endsWith(".json"))) {
    tally[selfReported(JSON.parse(readFileSync(join(DIR, f), "utf8"))).agreement]++;
  }
  assert.equal(tally.same + tally.differs + tally["not stated"], 67);
  assert.equal(tally.differs, 22, "the count the index's key prints has moved");
  assert.equal(tally["not stated"], 0);
});
