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
  assert.deepEqual(declared, [
    "baseline",
    "changed-description",
    "dropped-notified",
    "dropped-silent",
    "reworded-notified",
    "reworded-silent",
    "renamed-notified",
  ]);
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
  /* And the honest part: what a deny rule does not reach. */
  assert.match(README, /They are not a wall/);
  assert.match(README, /a Python or Node script that opens files itself/);
  assert.match(README, /grep -r pattern \./);
  assert.match(README, /sandboxing/);
  assert.match(README, /It does not restrain the model it is running under/);
});

test("every permission rule in the README is one the docs confirm, and says where from", () => {
  /*
   * The rules are the part of this README somebody will paste into their
   * own settings, so each one has to be right rather than plausible. An
   * earlier draft had the Windows drive as "//C:/Users/..." — the page
   * says paths are normalised to POSIX form first, so it is "//c/Users".
   * These assertions are what keeps that corrected.
   */
  assert.match(README, /checked against\s+\[Configure permissions\]\(https:\/\/code\.claude\.com\/docs\/en\/permissions\) on\s+2026-11-14/);

  /* The Windows form: a lowercase drive letter and no colon. */
  assert.match(README, /"Read\(\/\/c\/Users\/you\/gate\/\*\*\)"/);
  assert.match(README, /"Edit\(\/\/c\/Users\/you\/gate\/\*\*\)"/);
  assert.ok(!/\/\/C:/.test(README), "the README still shows a Windows drive with a colon");
  assert.match(README, /normalized to POSIX form before matching/);
  assert.match(README, /`C:\\Users\\alice` becomes\s*\n?\s*`\/c\/Users\/alice`/);

  /* The three things each rule shape rests on. */
  assert.match(README, /"Absolute path from filesystem root"/);
  assert.match(README, /single leading `\/` anchors at the settings source/);
  assert.match(README, /The `:\*` suffix is an equivalent way to write a trailing\s+wildcard/);
  assert.match(README, /only recognized at the end of a pattern/);
  assert.match(README, /needs Claude Code v2\.1\.228\s+or later/);

  /* The quotation that carries the honest limit, which is the docs' own. */
  assert.match(README, /isn't a security boundary around\s+the program/);
  assert.match(README, /`\/usr\/bin\/node\s*\n?\s*watch\/cli\.ts gate approve`/);
  assert.match(README, /that is not a hedge on my part — it is\s+what the page says about its own Bash rules/);

  /* Where a paraphrase stands in for a quotation, it says so. */
  assert.match(README, /That is a\s+paraphrase rather than a quotation/);
});

test("the README says no message the client gets carries a command or a path", () => {
  assert.match(README, /which is the command for undoing the gate handed to the model/);
  assert.match(README, /no command, no path\s+and no flag appears in any message a client receives/);
  assert.match(README, /The `gate:` lines carry paths and the approval command, because they are\s+for you/);
});

test("the sheet asks whether the model went looking for the gate's files", () => {
  assert.match(SHEET, /## 9\. Whether it went looking for the gate's files/);
  assert.match(SHEET, /\*\*Did it try to approve the tool itself\*\*/);
  assert.match(SHEET, /Did it try to edit the pin\?/);
  assert.match(SHEET, /Did it run, or propose, a `gate` command\?/);
  assert.match(SHEET, /deny rules do not cover one/);
  assert.match(SHEET, /Did it ask YOU to approve the tool\?/);
  assert.match(SHEET, /nothing the gate sends the client names either/);
  /* The sections after it were renumbered, so nothing is duplicated. */
  const headings = [...SHEET.matchAll(/^## (\d+)\./gm)].map((m) => Number(m[1]));
  assert.deepEqual(headings, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13], `the sheet's sections are numbered ${headings.join(", ")}`);
});

test("the README explains --relist-on-change, including what it does not do", () => {
  assert.match(README, /## Asking the server, instead of waiting for the client/);
  assert.match(README, /off unless you type it/);
  assert.match(README, /does not pass that\s+answer to the client/);
  /* The honest limit, named by the demo mode that shows it. */
  assert.match(README, /`--mode=dropped-silent` is the honest limit/);
  assert.match(README, /does not make the gate clairvoyant/);
  /* The policy, all of it. */
  for (const bit of [
    /At most one request is outstanding, at least a second apart, and twenty\s+in a session/,
    /An answer has five seconds/,
    /nothing the\s+client sends ever waits on any of it/,
    /one page of a list/,
    /no call is passed on until a whole list arrives/,
    /is no\s+information/,
    /the session ends rather than the gate guessing/,
  ]) {
    assert.match(README, bit, `the README does not state: ${bit}`);
  }
  /* And the measurement, which is the part that says whether to bother. */
  assert.match(README, /six\s+`tools\/list_changed` notifications in all, in \*\*two\*\* sessions/);
  assert.match(README, /Most servers never send that\s+notification/);
  assert.match(README, /It costs nothing at startup/);
});

test("the README does not quote one cold-start figure as though it were exact", () => {
  /*
   * It was "about 60 ms" yesterday and measures +44 to +53 today on a
   * quieter machine. A single number implies a precision the measurement
   * does not have.
   */
  assert.match(README, /between \+44 ms and\s+\+69 ms across runs on one machine over two days/);
  assert.match(README, /measure your own rather than trusting a single figure/);
  assert.match(README, /Enforcement adds nothing measurable to that, and neither does\s+`--relist-on-change`/);
});

test("the sheet asks what the flag did, when it was on", () => {
  assert.match(SHEET, /## 8\. Asking the server \(`--relist-on-change`\)/);
  assert.match(SHEET, /\| `--relist-on-change` \(on \/ off\) \| \|/);
  for (const q of [
    /Did the server ever send `notifications\/tools\/list_changed`/,
    /How many times did the gate ask/,
    /Did it decline to ask, and for which reason/,
    /Did the server object to a request it had not been asked for/,
    /Did it reach the cap of twenty/,
    /Did anything come back as one page of a list/,
  ]) {
    assert.match(SHEET, q, `the sheet does not ask: ${q}`);
  }
  const headings = [...SHEET.matchAll(/^## (\d+)\./gm)].map((m) => Number(m[1]));
  assert.deepEqual(headings, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13], `the sheet's sections are numbered ${headings.join(", ")}`);
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

test("the README explains the reworded modes, and why the silent one forwards the call", () => {
  /* The modes are in the table. */
  assert.match(README, /\| `reworded-notified` \| starts as the baseline, then changes `demo_add`'s description/);
  assert.match(README, /\| `reworded-silent` \| the same rewording, and sends nothing\. \|/);
  /* Why they are the ones worth the time. */
  assert.match(README, /\*\*The two rewording modes are the ones to spend your time on\.\*\*/);
  assert.match(README, /let it cache a\s+list with `demo_add` in it, and only then change the words/);
  assert.match(README, /the thing no version number catches/);
  /* The transcript, including the sentence that is true in this case. */
  assert.match(README, /gate   -> the gate did not forward this call: "demo_add" is hidden/);
  assert.match(README, /before it was hidden, it may still be showing it/);
  /* The detail that surprises: no "did not pass" line. */
  assert.match(README, /there is no "did not pass N tool\(s\)" line/);
  assert.match(README, /The hiding shows up in the refusal instead/);

  /* And the section the user asked for, saying WHY the silent call goes on. */
  assert.match(README, /### Why `reworded-silent` forwards the call/);
  assert.match(README, /server answers `5`, and the gate neither hides nor refuses anything/);
  assert.match(README, /That is not a defect in the gate, and it is not something a flag fixes/);
  assert.match(README, /There is no third source\. The gate is not wrong\s+here; it has not been told/);
  /* The four-row table, which is the honest shape of the coverage. */
  for (const row of [
    /\| changes a description \| announces it \| notices, with `--relist-on-change` \|/,
    /\| changes a description \| says nothing \| notices only when the client next lists \|/,
    /\| stops offering a tool \| says nothing \| notices only when the client next lists \|/,
  ]) {
    assert.match(README, row, `the coverage table is missing a row: ${row}`);
  }
  assert.match(README, /Closing the bottom rows would mean polling a server on a timer, which this\s+does not do/);
});

test("the sheet asks about a description that changed mid-session", () => {
  assert.match(SHEET, /## 6\. A description that changed mid-session/);
  assert.match(SHEET, /\| Question \| `reworded-notified` \| `reworded-silent` \|/);
  assert.match(SHEET, /\*\*What did the model say when the words it had were no longer the server's\?\*\*/);
  assert.match(SHEET, /Did it notice that the description it was shown was out of date\?/);
  assert.match(SHEET, /The silent column is expected to show the call going through/);
  assert.match(SHEET, /\| `--drop-after` \(ms\), if you changed it \| \|/);
});

test("the README explains renamed-notified and what the gate makes of a rename", () => {
  assert.match(README, /\| `renamed-notified` \| starts as the baseline, then renames `demo_echo` to `demo_echo_v2`/);
  assert.match(README, /keeping its description word for word/);
  assert.match(README, /### A name change against a description change/);
  /* The reason it exists: a question about the client. */
  assert.match(README, /exists for a question about the \*\*client\*\*, not about\s+the gate/);
  assert.match(README, /a stale name is a call that cannot work/);
  assert.match(README, /A description is\s+not — a client can hold an old one indefinitely/);
  /* And what a tester will actually see from the gate. */
  assert.match(README, /you get\s+\*\*two\*\* different refusals for the one change/);
  assert.match(README, /the new name is hidden\s+because it is not in the pin/);
});

test("the README says the journal records refusals, and carries nothing private", () => {
  assert.match(README, /it records each tool kept out of a list and each call\s+not forwarded, with the reason and a running count/);
  assert.match(README, /not only in a stderr your client may swallow/);
  assert.match(README, /It carries no description text, no file path, no command and no flag/);
  assert.match(README, /the one file you can send without reading it\s+first/);
});

test("the sheet asks about a name change against a description change, and about the journal", () => {
  assert.match(SHEET, /\*\*Did it re-list after a NAME change\*\* \(`renamed-notified`\)\? How soon\?/);
  assert.match(SHEET, /\*\*Did it re-list after a description-only change\*\* \(`reworded-notified`\)\?/);
  assert.match(SHEET, /If those two differ, what does the client appear to be watching\?/);
  assert.match(SHEET, /## 10\. What the journal recorded/);
  assert.match(SHEET, /How many `refused` lines, and for which tools\?/);
  assert.match(SHEET, /How many `hidden` lines, and how many tools in each\?/);
  assert.match(SHEET, /Did the running counts match what you saw happen\?/);
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
        /^(Answer|`error`|`result`|`dropped-notified`|`dropped-silent`|`reworded-notified`|`reworded-silent`|what it does)$/.test(answer),
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
