import { test } from "node:test";
import assert from "node:assert/strict";
import { renderReport } from "../level1/report.ts";
import type { Level1Evidence } from "../level1/run.ts";

/*
 * ═══════════════════════════════════════════════════════════════════════════
 * THE PAGE MAY NOT SAY MORE THAN THE FILE IT WAS MADE FROM.
 *
 * `renderReport` is the only place a Level 1 measurement turns into sentences,
 * which makes it the only place a measurement can overstate itself. These
 * tests are the statement of what it is not allowed to do: three words it may
 * never use, a standard it must print in plain words, a telemetry line it
 * states and does not weigh, and a count it cannot invent.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const FORBIDDEN = /\b(safe|unsafe|dangerous)\b/i;

function evidence(over: Partial<Level1Evidence> = {}): Level1Evidence {
  return {
    level: 1,
    notCalibrationBacked: true,
    asked: "thing-mcp@1.0.0",
    slug: "thing-mcp",
    package: {
      name: "thing-mcp",
      version: "1.0.0",
      tarball: "https://registry.npmjs.org/thing-mcp/-/thing-mcp-1.0.0.tgz",
      integrity: "sha512-AAAA",
      repository: "git+https://github.com/someone/thing-mcp.git",
      homepage: null,
    },
    measuredAt: "2026-10-30T00:00:00.000Z",
    instrumentFingerprint: "ca9170dfaeae402f2a812dff431ba1481fb068a3d25fa6b9b231ccdf6e2d6028",
    standard: {},
    readme: { file: "README.md", digest: "a".repeat(64), lines: 40, bytes: 900 },
    startup: null,
    readmeNotes: [],
    declaration: { hosts: [{ host: "thing.example", at: { line: 4, text: "Docs at https://thing.example/" } }], identifiers: [] },
    couldNotStart: null,
    serverInfo: { name: "thing", version: "1.0.0" },
    observed: {
      offered: ["read_file", "get_prompts"],
      dnsNames: ["thing.example", "telemetry.thing.example"],
      tlsHosts: ["telemetry.thing.example"],
      connectAttempts: [],
      programsStarted: ["node", "setpriv", "thing-mcp"],
      filesWritten: [],
      installedDuringRun: [],
    },
    comparison: {
      tools: {
        rule: "whole word",
        documented: [{ name: "read_file", at: { line: 12, text: "- `read_file` reads a file" } }],
        undocumented: [{ name: "get_prompts", evidence: ["offered in tools/list by thing@1.0.0", 'absent from README.md: no whole-word match for "get_prompts"'] }],
      },
      hosts: {
        rule: "named or not declared",
        declared: [{ host: "thing.example", at: { line: 4, text: "Docs at https://thing.example/" } }],
        undeclared: [{ host: "telemetry.thing.example", evidence: ['looked up "telemetry.thing.example" during the run', "absent from README.md"] }],
      },
    },
    findings: [],
    limits: [{ id: "one-run", says: "One run, once." }],
    ...over,
  };
}

test("the report never calls anything safe, unsafe or dangerous", () => {
  /* Level 1 records what a program did and where its README is silent. None of
   * those three words is a conclusion that evidence of that kind supports. */
  for (const e of [
    evidence(),
    evidence({ couldNotStart: { stage: "initialize", because: "ANTHROPIC_API_KEY is not set" } }),
    evidence({ readmeNotes: [{ word: "telemetry", at: { line: 31, text: "We collect limited, pseudonymous telemetry." } }] }),
  ]) {
    const md = renderReport(e);
    assert.doesNotMatch(md, FORBIDDEN, `rendered page used a forbidden word:\n${md.split("\n").filter((l) => FORBIDDEN.test(l)).join("\n")}`);
  }
});

test("the standard is printed in plain words, verbatim", () => {
  const md = renderReport(evidence());
  assert.ok(
    md.includes("A website counts as declared only if the README names it."),
    "the report must state the standard in that sentence, so a reader is never left to infer it",
  );
});

test("a noted word is stated with its line, and nothing is concluded from it", () => {
  const md = renderReport(
    evidence({ readmeNotes: [{ word: "telemetry", at: { line: 31, text: "We collect limited, pseudonymous telemetry." } }] }),
  );
  assert.match(md, /README\.md line 31/);
  assert.match(md, /pseudonymous telemetry/);
  assert.ok(md.includes("does not decide whether it accounts"), "the line must disclaim deciding anything");
  /* And it must not have become a declaration: the host is still a finding. */
  assert.match(md, /\*\*telemetry\.thing\.example\*\*/);
});

test("a README with neither word gets no such line", () => {
  const md = renderReport(evidence());
  assert.ok(!md.includes("uses the word"), "nothing is said about a word the README does not use");
});

test("could not start is the whole report, and concludes nothing", () => {
  const md = renderReport(evidence({ couldNotStart: { stage: "initialize", because: "FIGMA_TOKEN is required" } }));
  assert.match(md, /## Could not start/);
  assert.match(md, /FIGMA_TOKEN is required/);
  assert.ok(!md.includes("## Tools it offers"), "no comparison is printed for a server that did not start");
  assert.ok(md.includes("because it did not run"));
});

test("every count in the page comes from the evidence", () => {
  /* The sandbox once printed "the destination's books are empty" above a table
   * of two records, because the sentence was a lookup and not a function of the
   * data. Nothing here is allowed to be. */
  const clean = evidence({
    observed: { offered: ["read_file"], dnsNames: [], tlsHosts: [], connectAttempts: [], programsStarted: [], filesWritten: [], installedDuringRun: [] },
    comparison: {
      tools: { rule: "whole word", documented: [{ name: "read_file", at: { line: 12, text: "- `read_file`" } }], undocumented: [] },
      hosts: { rule: "named or not declared", declared: [], undeclared: [] },
    },
  });
  const md = renderReport(clean);
  assert.ok(md.includes("It offered 1 tool."), "singular, and the number the evidence carried");
  assert.ok(md.includes("Every tool it offered is named in the README."));
  assert.ok(md.includes("It reached for no website at startup."));

  const dirty = renderReport(evidence());
  assert.ok(dirty.includes("It offered 2 tools."));
  assert.ok(dirty.includes("1 tool it offered is not:"));
});

test("the same evidence renders the same bytes", () => {
  const e = evidence();
  assert.equal(renderReport(e), renderReport(structuredClone(e)));
});

test("the page says it is not calibration-backed", () => {
  assert.match(renderReport(evidence()), /not calibration-backed/i);
});

test("the plain-words paragraph is three sentences of counts off the evidence", () => {
  const md = renderReport(evidence());
  const para = md.split("## In plain words")[1].split("##")[0].trim();

  /* Three sentences, because a fourth is where an opinion goes. */
  assert.equal(para.match(/\.(?:\s|$)/g)?.length, 3, `expected three sentences, got:\n${para}`);

  /* Every number in it is the evidence's own count. The fixture offers two
   * tools, reaches two websites, starts three programs of which one is the
   * harness's, writes nothing, and has one undocumented tool and one
   * undeclared website. */
  assert.ok(para.includes("offered 2 tools"), para);
  assert.ok(para.includes("looked up 2 websites"), para);
  assert.ok(para.includes("started 2 programs"), "the harness's own launcher is not counted as the package's");
  assert.ok(para.includes("wrote 0 files"), para);
  assert.ok(para.includes("1 tool and 1 website are not named in its own README"), para);

  /* And it must say what was not checked, or a reader who stops here has been
   * misinformed about what the measurement covers. */
  assert.ok(para.includes("called no tool"), para);
  assert.ok(para.includes("no encrypted connection"), para);
  assert.doesNotMatch(para, FORBIDDEN);
});

test("plain words for a server that did not start concludes nothing", () => {
  const md = renderReport(evidence({ couldNotStart: { stage: "initialize", because: "FIGMA_TOKEN is required" } }));
  const para = md.split("## In plain words")[1].split("##")[0].trim();
  assert.equal(para.match(/\.(?:\s|$)/g)?.length, 3, para);
  assert.ok(para.includes("It did not start"), para);
  assert.ok(para.includes("because it did not run"), para);
  /* No counts, because there is nothing to count. */
  assert.ok(!para.includes("offered"), para);
});

test("every page names the package in full and where its manifest points", () => {
  /* Two packages on the measured list are called Playwright and are not by the
   * same people; a page that named only the tool would misattribute one. */
  const md = renderReport(evidence());
  assert.ok(md.includes("Published on npm as `thing-mcp`"), md.split("\n").slice(0, 8).join("\n"));
  assert.ok(md.includes("github.com/someone/thing-mcp"), "the manifest's repository is printed");
  assert.ok(md.includes("is not checked here"), "and is not vouched for");

  /* And when the manifest says nothing, the page says that instead of guessing. */
  const bare = renderReport(evidence({ package: { ...evidence().package, repository: null, homepage: null } }));
  assert.ok(bare.includes("names no repository or homepage"), bare.split("\n").slice(0, 8).join("\n"));
});

test("every page says it is not a ranking", () => {
  for (const e of [evidence(), evidence({ couldNotStart: { stage: "start", because: "x" } })]) {
    assert.ok(
      renderReport(e).includes("not a ranking of the most-used servers"),
      "a reader must not take the measured set for a league table",
    );
  }
});

test("a maintainer's response is printed with its link, or not at all", () => {
  const e = evidence();
  /* With a link: the facts and the thread, so a reader can judge it themselves. */
  const withLink = renderReport(e, {
    notifiedAt: "2026-10-31",
    outcome: "closed as not planned",
    outcomeAt: "2026-11-01",
    url: "https://github.com/x/y/issues/12",
  });
  assert.match(withLink, /Raised with the maintainers/);
  assert.match(withLink, /notified on 2026-10-31/);
  assert.match(withLink, /closed as not planned on 2026-11-01/);
  assert.match(withLink, /https:\/\/github\.com\/x\/y\/issues\/12/);

  /* Without one, nothing is said: "they closed it as not planned" with no
   * thread to read is hearsay, and the maintainer is the one it is unfair to. */
  const noLink = renderReport(e, { notifiedAt: "2026-10-31", outcome: "closed as not planned", url: null });
  assert.ok(!noLink.includes("Raised with the maintainers"), noLink.split("\n").slice(0, 12).join("\n"));
  assert.ok(!noLink.includes("not planned"));

  /* And a page with no entry at all is unchanged. */
  assert.equal(renderReport(e), noLink);
});
