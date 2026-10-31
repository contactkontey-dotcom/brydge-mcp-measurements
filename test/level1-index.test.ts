import { test } from "node:test";
import assert from "node:assert/strict";
import { renderIndex } from "../level1/index.ts";
import type { Level1Evidence } from "../level1/run.ts";

/*
 * ═══════════════════════════════════════════════════════════════════════════
 * AN INDEX IS WHERE A MEASUREMENT IS MOST TEMPTED TO FLATTER ITSELF.
 *
 * It is the page people read instead of the reports. Two ways it could lie
 * without a single wrong number: by leaving out the packages that refused to
 * start, so the table reads as a clean sweep of everything tried; and by
 * letting a row with nothing found read as a verdict rather than as a
 * comparison that had little to compare. Both are tested here.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const FORBIDDEN = /\b(safe|unsafe|dangerous)\b/i;

function ran(slug: string, over: Partial<Level1Evidence> = {}): Level1Evidence {
  return {
    level: 1,
    notCalibrationBacked: true,
    asked: `${slug}@1.0.0`,
    slug,
    package: { name: slug, version: "1.0.0", tarball: "t", integrity: "sha512-A", repository: `https://github.com/x/${slug}`, homepage: null },
    measuredAt: "2026-10-30T00:00:00.000Z",
    instrumentFingerprint: "ca9170df",
    standard: {},
    readme: { file: "README.md", digest: "a".repeat(64), lines: 10, bytes: 100 },
    readmeNotes: [],
    declaration: { hosts: [], identifiers: [] },
    couldNotStart: null,
    serverInfo: null,
    observed: {
      offered: ["a_tool", "b_tool"],
      dnsNames: ["one.example", "two.example"],
      tlsHosts: ["two.example"],
      connectAttempts: [],
      programsStarted: ["node"],
      filesWritten: [],
      installedDuringRun: [],
    },
    comparison: {
      tools: { rule: "r", documented: [{ name: "a_tool", at: { line: 1, text: "`a_tool`" } }], undocumented: [{ name: "b_tool", evidence: ["absent"] }] },
      hosts: { rule: "r", declared: [], undeclared: [{ host: "two.example", evidence: ["absent"] }] },
    },
    findings: [],
    limits: [],
    ...over,
  };
}

function stuck(slug: string, stage: string, because: string): Level1Evidence {
  return {
    ...ran(slug),
    couldNotStart: { stage, because },
    observed: null,
    comparison: null,
  };
}

test("every package measured gets a row, including the ones that did not start", () => {
  const md = renderIndex([ran("alpha"), stuck("beta", "initialize", "BETA_TOKEN is required"), ran("gamma")]);

  for (const name of ["alpha", "beta", "gamma"]) assert.match(md, new RegExp(`\\| \`${name}\` \\|`), `${name} is missing a row`);
  /* The row itself says so, so a reader skimming the table cannot miss it. */
  assert.match(md, /\| `beta` \| `1\.0\.0` \| github\.com\/x\/beta \| — \| — \| \*\*could not start\*\* — initialize \|/);
});

test("a package that did not start is explained in the tooling's own words", () => {
  const md = renderIndex([stuck("beta", "initialize", "BETA_TOKEN is required")]);
  assert.match(md, /## Could not start/);
  assert.match(md, /BETA_TOKEN is required/);
  assert.ok(md.includes("not a diagnosis"), "the message is quoted, never interpreted");
});

test("the counts in a row are the evidence's own", () => {
  const md = renderIndex([ran("alpha")]);
  /* Two tools offered, two distinct websites reached for (one looked up, one
   * both looked up and connected to), one tool and one website unnamed. */
  assert.match(md, /\| `alpha` \| `1\.0\.0` \| github\.com\/x\/alpha \| 2 \| 2 \| 1 tool, 1 website \|/);
});

test('a row with nothing found says "none", and the page says what that is not', () => {
  const clean = ran("quiet", {
    observed: { offered: ["a_tool"], dnsNames: [], tlsHosts: [], connectAttempts: [], programsStarted: [], filesWritten: [], installedDuringRun: [] },
    comparison: {
      tools: { rule: "r", documented: [{ name: "a_tool", at: { line: 1, text: "`a_tool`" } }], undocumented: [] },
      hosts: { rule: "r", declared: [], undeclared: [] },
    },
  });
  const md = renderIndex([clean]);
  assert.match(md, /\| `quiet` \| `1\.0\.0` \| github\.com\/x\/quiet \| 1 \| 0 \| none \|/);
  assert.ok(md.includes("An empty row is not a clean sweep"), "a quiet row must not read as a verdict");
});

test("the index never calls anything safe, unsafe or dangerous", () => {
  const md = renderIndex([ran("alpha"), stuck("beta", "start", "no executable")]);
  assert.doesNotMatch(md, FORBIDDEN);
});

test("the index says it is not calibration-backed and states the standard", () => {
  const md = renderIndex([ran("alpha")]);
  assert.match(md, /not calibration-backed/i);
  assert.ok(md.includes("A website counts as declared only if the README names it."));
});

test("row order does not depend on the order the files were read", () => {
  const a = renderIndex([ran("gamma"), ran("alpha"), stuck("beta", "start", "x")]);
  const b = renderIndex([stuck("beta", "start", "x"), ran("alpha"), ran("gamma")]);
  assert.equal(a, b);
});

test("the index says it is not a ranking, in those words", () => {
  const md = renderIndex([ran("alpha"), ran("beta")]);
  assert.ok(md.includes("not a ranking of the most-used servers"));
  /* And the order it claims is the order it uses. */
  assert.ok(md.indexOf("| `alpha` |") < md.indexOf("| `beta` |"));
});

test("each row names where the package says it is published", () => {
  const md = renderIndex([ran("alpha")]);
  assert.ok(md.includes("github.com/x/alpha"));
  assert.ok(md.includes("is not verified"), "and the page says it is not verified");
});
