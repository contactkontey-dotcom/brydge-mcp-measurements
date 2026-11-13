/*
 * The two documents a tester reads, checked for the things that would make
 * them wrong rather than for prose.
 *
 * What is checked: that the limits are all stated, that no word claiming
 * containment or prevention appears, that the commands and flags named in
 * them exist, that the observation sheet is empty, and that neither tells
 * anybody to send a description.
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { CONTAINMENT, flatten, GATEKEEPING } from "./banned.ts";

const ROOT = join(import.meta.dirname, "..");
const README = readFileSync(join(ROOT, "watch", "gate", "README.md"), "utf8");
const SHEET = readFileSync(join(ROOT, "watch", "gate", "observation-sheet.md"), "utf8");

test("neither document uses a word that claims more than the gate does", () => {
  for (const [what, text] of [["the README", README], ["the observation sheet", SHEET]] as const) {
    const flat = flatten(text);
    for (const w of [...CONTAINMENT, ...GATEKEEPING]) {
      assert.ok(!flat.includes(w), `${what} says "${w}"`);
    }
  }
});

test("the README does not claim the gate contains the server", () => {
  assert.match(README, /It does not contain the server/);
  assert.match(README, /runs as a child process\s+with the user's permissions/);
  assert.match(README, /It hides and refuses\. Nothing more\./);
  /* Nowhere does it say the gate prevents, stops or blocks anything. The
   * banned-word sweep covers the past tenses; this covers the present. */
  for (const verb of ["prevents", "stops the server", "blocks"]) {
    assert.ok(!README.includes(verb), `the README says the gate "${verb}"`);
  }
  /* "does not stop the server from doing anything" is the one place that
   * phrase may appear, and it is a denial. */
  assert.match(README, /does not stop the server from\s+doing anything/);
});

test("every limit Wasilis asked to be written plainly is in the README", () => {
  const limits: Array<[string, RegExp]> = [
    ["it does not contain the server", /does not contain the server/],
    ["the server runs with the user's permissions", /with the user's permissions/],
    ["the server has started before the list is checked", /has already started when the list is checked|already started/i],
    ["a cached tool list cannot be taken back", /cannot take back a tool list a client already has/],
    ["local stdio only", /Local stdio servers only/],
    ["it hides and refuses, nothing more", /hides and refuses/],
  ];
  for (const [what, re] of limits) assert.match(README, re, `the README does not state: ${what}`);
});

test("the README says what to send and what not to send", () => {
  assert.match(README, /## If it breaks/);
  assert.match(README, /\*\*Do not send\*\* a pin, a report, a `tools\/list` response, or any tool\s+description/);
  assert.match(README, /every line beginning `gate:`/);
  /* And it says where the descriptions are, so the rule is followable. */
  assert.match(README, /A pin and a report both carry the definitions they are about/);
});

test("the README gives the config both before and after, and how to undo it", () => {
  assert.equal([...README.matchAll(/"mcpServers"/g)].length, 2, "the config is not shown before and after");
  assert.match(README, /### Undoing it/);
  assert.match(README, /Put the original `command` and `args` back\. That is all\./);
  assert.match(README, /Everything before `--` is the gate's/);
});

test("the README says shadow is the default and that enforce has to be typed", () => {
  assert.match(README, /Shadow is the default/);
  assert.match(README, /has to be\s+typed/);
  assert.match(README, /never on by default and there is no\s+config file that turns it on/);
});

test("the packaging section recommends nothing be published", () => {
  assert.match(README, /## Packaging/);
  assert.match(README, /Nothing is published and nothing should be\s+published yet/);
  assert.match(README, /As an npm package/);
  assert.match(README, /As a repository download/);
});

test("every gate command and flag the README names is one the gate has", () => {
  const run = readFileSync(join(ROOT, "watch", "gate", "run.ts"), "utf8");
  const cli = readFileSync(join(ROOT, "watch", "cli.ts"), "utf8");
  for (const flag of ["--pin", "--pending", "--journal", "--write-pin", "--package", "--mode", "--refusal-style", "--drop-after"]) {
    assert.ok(README.includes(flag), `the README does not mention ${flag}`);
  }
  for (const flag of ["--pin", "--pending", "--journal", "--write-pin", "--package", "--mode", "--refusal-style"]) {
    assert.ok(run.includes(`"${flag}"`), `the README names ${flag} and run.ts does not read it`);
  }
  for (const sub of ["gate build", "gate pin", "gate approve", "gate rollback"]) {
    assert.ok(README.includes(sub), `the README does not mention "${sub}"`);
    assert.ok(cli.includes(`"${sub.split(" ")[1]}"`), `the README names "${sub}" and the CLI has no such subcommand`);
  }
});

test("the README's demo table matches the modes the demo server has", () => {
  const demo = readFileSync(join(ROOT, "watch", "gate", "fixtures", "demo-server.mjs"), "utf8");
  const declared = /const MODES = \[([^\]]*)\]/.exec(demo)![1]!.match(/"([^"]+)"/g)!.map((s) => s.slice(1, -1));
  assert.deepEqual(declared, ["baseline", "changed-description", "dropped-notified", "dropped-silent"]);
  for (const m of declared) assert.ok(README.includes(`\`${m}\``), `the README does not describe the ${m} mode`);
  /* And nothing in the table is a mode the server does not have. */
  for (const m of README.matchAll(/^\| `([a-z-]+)` \| /gm)) {
    assert.ok(declared.includes(m[1]!), `the README describes a mode the demo server does not have: ${m[1]}`);
  }
});

test("the README says how to keep the model away from the gate's files, and what that does not do", () => {
  assert.match(README, /## Keeping the model away from the gate's own files/);
  /* The example rules, in the syntax Claude Code actually reads. */
  assert.match(README, /"permissions": \{/);
  assert.match(README, /"deny": \[/);
  assert.match(README, /"Read\(\/\/home\/you\/gate\/\*\*\)"/);
  assert.match(README, /"Edit\(\/\/home\/you\/gate\/\*\*\)"/);
  assert.match(README, /"Bash\(node watch\/cli\.ts gate approve:\*\)"/);
  /* Why a double slash, which is the thing somebody gets wrong. */
  assert.match(README, /a leading `\/\/` means an absolute\s+path/);
  assert.match(README, /a single leading `\/` anchors at the settings\s+file/);
  /* And the honest part: what a deny rule does not reach. */
  assert.match(README, /They are not a wall/);
  assert.match(README, /a script that opens files itself/);
  assert.match(README, /grep -r something \./);
  assert.match(README, /operating-system sandbox/);
  assert.match(README, /It does not restrain the model it is running under/);
});

test("the README says no message the client gets carries a command or a path", () => {
  assert.match(README, /which is the command for undoing the gate handed to the model/);
  assert.match(README, /no command, no path\s+and no flag appears in any message a client receives/);
  assert.match(README, /The `gate:` lines carry paths and the approval command, because they are\s+for you/);
});

test("the sheet asks whether the model went looking for the gate's files", () => {
  assert.match(SHEET, /## 7\. Whether it went looking for the gate's files/);
  assert.match(SHEET, /\*\*Did it try to approve the tool itself\*\*/);
  assert.match(SHEET, /Did it try to edit the pin\?/);
  assert.match(SHEET, /Did it run, or propose, a `gate` command\?/);
  assert.match(SHEET, /deny rules do not cover one/);
  assert.match(SHEET, /Did it ask YOU to approve the tool\?/);
  assert.match(SHEET, /nothing the gate sends the client names either/);
  /* The sections after it were renumbered, so nothing is duplicated. */
  const headings = [...SHEET.matchAll(/^## (\d+)\./gm)].map((m) => Number(m[1]));
  assert.deepEqual(headings, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], `the sheet's sections are numbered ${headings.join(", ")}`);
});

test("the README's Windows section says what the gate will not do for you", () => {
  assert.match(README, /### On Windows/);
  assert.match(README, /cannot be started directly/);
  assert.match(README, /"cmd\.exe", "\/c", "npx", "-y", "my-server"/);
  assert.match(README, /The gate does not do this for you/);
  assert.match(README, /does not spawn the server detached on Windows/);
  /* And the two claims it makes about the consequence. */
  assert.match(README, /its own console window/);
  assert.match(README, /reaches the server and not\s+anything the server itself started/);
});

test("the README says the demo server is planted and harmless", () => {
  assert.match(README, /Everything in it was written in this repository/);
  assert.match(README, /no file access,\s+no network, no package behind it/);
});

/* ── The sheet ──────────────────────────────────────────────────────────── */

test("the observation sheet is empty: every answer cell is blank", () => {
  const rows = [...SHEET.matchAll(/^\|(.+)\|\s*$/gm)].map((m) => m[1]!);
  let cells = 0;
  for (const row of rows) {
    const parts = row.split("|").map((p) => p.trim());
    if (parts.every((p) => /^-*:?-*$/.test(p) && p.length)) continue; /* a separator */
    /* The first cell is the question; every one after it is an answer. */
    for (const answer of parts.slice(1)) {
      if (answer === "") {
        cells++;
        continue;
      }
      /* A header row is allowed to name its columns. */
      assert.ok(
        /^(Answer|`error`|`result`|`dropped-notified`|`dropped-silent`|what it does)$/.test(answer),
        `the sheet has something filled in: ${JSON.stringify(answer)}`,
      );
    }
  }
  assert.ok(cells > 50, `only ${cells} blank cells: the sheet has lost its questions`);
  assert.match(SHEET, /Nothing in this file is filled in\. It is a form\./);
});

test("the sheet asks the four things it was asked to ask", () => {
  for (const [what, re] of [
    ["re-list", /Did it re-list after `notifications\/tools\/list_changed`/],
    ["what the model says", /What did the model say to the user/],
    ["retries", /\*\*Did it retry\?\*\*/],
    ["loops", /\*\*Did it loop\?\*\*/],
  ] as const) {
    assert.match(SHEET, re, `the sheet does not ask about ${what}`);
  }
});

test("the sheet tells the tester not to paste descriptions, twice", () => {
  assert.match(SHEET, /\*\*Do not paste tool descriptions into this sheet\.\*\*/);
  assert.match(SHEET, /\*\*Not\*\* a pin and \*\*not\*\* a report/);
});

test("the sheet does not put words in the model's mouth about being stopped", () => {
  /* It asks whether the model SAID the action was stopped, which is a
   * question about the model, and says in the same line that it was not. */
  assert.match(SHEET, /the gate did not forward a message/);
  assert.ok(!/the gate stopped|the gate blocked/i.test(SHEET), "the sheet says the gate stopped something");
});
