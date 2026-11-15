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
    "instructions-changed",
    "instructions-silent",
  ]);
  for (const m of declared) assert.ok(README.includes(`\`${m}\``), `the README does not describe the ${m} mode`);
  /*
   * And nothing in the DEMO table is a mode the server does not have.
   *
   * Scoped to that section rather than the whole file: the README has other
   * tables, and a sweep over all of them read the first column of each as a
   * claimed demo mode.
   */
  const from = README.indexOf("## Trying it without your own server");
  assert.ok(from > 0, "the demo section is not in the README");
  const end = README.indexOf("\n## ", from + 1);
  const section = README.slice(from, end === -1 ? undefined : end);
  const rows = [...section.matchAll(/^\| `([a-z-]+)` \| /gm)];
  assert.ok(rows.length >= declared.length - 1, `the demo table has ${rows.length} rows, so this test is not reading it`);
  for (const m of rows) {
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
  assert.match(SHEET, /## 11\. Whether it went looking for the gate's files/);
  assert.match(SHEET, /\*\*Did it try to approve the tool itself\*\*/);
  assert.match(SHEET, /Did it try to edit the pin\?/);
  assert.match(SHEET, /Did it run, or propose, a `gate` command\?/);
  assert.match(SHEET, /deny rules do not cover one/);
  assert.match(SHEET, /Did it ask YOU to approve the tool\?/);
  assert.match(SHEET, /nothing the gate sends the client names either/);
  /* The sections after it were renumbered, so nothing is duplicated. */
  const headings = [...SHEET.matchAll(/^## (\d+)\./gm)].map((m) => Number(m[1]));
  assert.deepEqual(headings, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], `the sheet's sections are numbered ${headings.join(", ")}`);
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
  assert.deepEqual(headings, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], `the sheet's sections are numbered ${headings.join(", ")}`);
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
  assert.match(README, /server answers `5`, and\s+the gate neither hides nor refuses anything/);
  assert.match(README, /That is not a defect in the gate\./);
  assert.match(README, /The gate is not wrong here; it has not\s+been told/);

  /*
   * And that the section does not still say a flag cannot fix it. It said
   * exactly that until --verify-on-call existed, and a README carrying a
   * claim its own flag disproves is worse than one that never made it.
   */
  const flat = flatten(README);
  for (const stale of ["it is not something a flag fixes", "there is no third source"]) {
    assert.ok(!flat.includes(stale), `the README still says "${stale}", which --verify-on-call makes untrue`);
  }
  assert.match(README, /\*\*There is a third way, and it is `--verify-on-call`\.\*\*/);

  /* The coverage table: four rows, and the column the flag adds. */
  for (const row of [
    /\| changes a description \| announces it \| notices, with `--relist-on-change` \| refused at call time, within the window \|/,
    /\| changes a description \| says nothing \| notices only when the client next lists \| refused at call time, within the window \|/,
    /\| stops offering a tool \| announces it \| notices, with `--relist-on-change` \| refused at call time, within the window \|/,
    /\| stops offering a tool \| says nothing \| notices only when the client next lists \| refused at call time, within the window \|/,
  ]) {
    assert.match(README, row, `the coverage table is missing a row: ${row}`);
  }
  /* The column is not left to speak for itself. */
  assert.match(README, /"Within the window" is the whole of the fourth column's modesty/);
  assert.match(README, /Closing the third column's bottom rows any further would mean polling a\s+server on a timer, which this does not do/);
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
  assert.match(SHEET, /## 12\. What the journal recorded/);
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
        /^(Answer|`error`|`result`|`dropped-notified`|`dropped-silent`|`reworded-notified`|`reworded-silent`|`instructions-changed`|`instructions-silent`, second session|flag off|flag on|what it does)$/.test(answer),
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

test("the README says which fields a pin compares, and names the one it does not", () => {
  assert.match(README, /## What a pin compares, and what the gate never reads/);

  /*
   * Tied to the fixture rather than to a list typed twice: every field
   * watch/gate/fixtures/fields-server.mjs can change on its own has to
   * appear in the README's table, so a field added to the audit cannot be
   * audited without being written down.
   */
  const fixture = readFileSync(join(ROOT, "watch", "gate", "fixtures", "fields-server.mjs"), "utf8");
  const changed = /const CHANGED = \{([\s\S]*?)\n\};/.exec(fixture)![1]!;
  const fields = [...changed.matchAll(/^  "?([A-Za-z_][A-Za-z-]*)"?: /gm)].map((m) => m[1]!);
  for (const f of fields) {
    if (["none", "key-order", "unknown", "nonstring-description"].includes(f)) continue;
    assert.ok(README.includes(`\`${f}\``), `the README's table does not name ${f}, which the audit varies`);
  }
  assert.ok(fields.length >= 8, `only ${fields.length} fields in the fixture, so this test is not reading it`);

  /* Key order is not a change, and the README has to say so: a reader who
   * assumed otherwise would read a quiet day as a suspicious one. */
  assert.match(README, /sorted at every depth/);
  assert.match(README, /another order\s+has not changed anything/); /* the README wraps; the claim must not depend on where */

  /* The exception, said rather than left out. */
  assert.match(README, /`description` that is not a string/);
  assert.match(README, /test\/gate-fields\.test\.ts/, "the README does not say where the exception is recorded");
});

test("the README lists what passes through without being read", () => {
  for (const m of [
    "resources/list",
    "resources/read",
    "prompts/list",
    "prompts/get",
    "sampling/createMessage",
    "roots/list",
    "elicitation/create",
    "completion/complete",
    "notifications/progress",
    "ping",
  ]) {
    assert.ok(README.includes(m), `the README does not say ${m} passes through`);
  }
  /*
   * The tool-call result is still not read. The initialize result's
   * `instructions` string no longer belongs on this list: since I2 it is
   * pinned, and the README has to say so where it used to say the
   * opposite. This assertion used to require the opposite sentence.
   */
  assert.match(README, /the result of a `tools\/call`/);
  assert.match(README, /everything in its result \*\*except\s+`instructions`\*\*/);
  assert.ok(!flatten(README).includes("the gate does not look at it, compare it, or pin it"), "the README still says instructions are not looked at");
  assert.ok(!flatten(README).includes("**tools only.**"), "the README still says tools only");
  /* And what it does read, so the two lists are both in one place. */
  assert.match(README, /the answer to `initialize`/);
  assert.match(README, /Five things are looked at/);
});

/** One README section, from its heading to the next one at the same level. */
function section(name: string): string {
  const from = README.indexOf(`## ${name}`);
  assert.ok(from > 0, `the README has no section "${name}"`);
  const end = README.indexOf("\n## ", from + 1);
  return README.slice(from, end === -1 ? undefined : end);
}

test("the README says what this is: an allow-list over a tool list, and what that leaves alone", () => {
  const s = section("Allow-list, not a filter");

  /* It hides and refuses — and says which of the two is which. */
  assert.match(s, /It is an allow-list over a tool list/);
  assert.match(s, /the model never\s+sees it on the menu/);
  assert.match(s, /answered by the gate instead of\s+being forwarded to the server/);
  /* And is not a filter over content, which is what the title denies. */
  assert.match(s, /it does\s+not scan descriptions for anything, score them, or look for patterns/);

  /* The server's own code is not touched. */
  assert.match(s, /It does nothing about the server's own code/);
  assert.match(s, /child\s+process holding your user's permissions/);
  assert.match(s, /already started by the time there is a tool list to\s+compare/);

  /* The first pin is not an approval. */
  assert.match(s, /The first pin is "adopted, not reviewed"/);
  assert.match(s, /Reviewing is a\s+separate act/);

  /* What is pinned — tool definitions and, since I2, the instructions
   * string — and what passes through. This used to assert "Tools only",
   * which I2 made untrue. */
  assert.match(s, /\*\*Tool definitions and the `instructions` string\. Nothing else\.\*\*/);
  assert.match(s, /it was measured arriving there/);
  assert.match(s, /\*\*Everything else passes through\.\*\*/);
  assert.match(s, /byte for byte\s+what it reads with no gate at all/);

  /*
   * And it never says the gate stops a tool from running. It does not: a
   * tool absent from a list is absent from it, and a call not forwarded is
   * a call the server never heard — neither is the server being unable to
   * run anything. The global sweep catches "refuses to run"; this catches
   * the rest of the family, in the one section most likely to reach for it.
   */
  const flat = flatten(s);
  for (const phrase of ["doesn't run", "does not run", "cannot run", "can't run", "from running", "stop it running"]) {
    assert.ok(!flat.includes(phrase), `the allow-list section says "${phrase}"`);
  }
});

test("the README says where a client's message waits, and what the window does not do", () => {
  const s = section("Asking before the call: the one place a client's message waits");

  /* The exception, named as one. */
  assert.match(s, /\*\*This is the one deliberate exception to "nothing the client sends\s+waits"\.\*\*/);
  assert.match(s, /anything the client sends behind it is held too/);
  assert.match(s, /because\s+releasing a later message first would reorder the conversation/);

  /* The window narrows the gap and does not close it. */
  assert.match(README, /### The window narrows the gap\. It does not close it/);
  assert.match(s, /A picture that is 9 seconds old passes a 10-second window/);
  assert.match(s, /There is no setting at which the gate\s+knows the list is current at the instant the server runs the call/);

  /* A hostile server need not be consistent. */
  assert.match(README, /### A hostile server is not obliged to be consistent/);
  assert.match(s, /can answer it slowly, differently\s+each time, or differently from what it would answer the client/);
  assert.match(s, /Nothing\s+here makes a server tell the truth twice/);

  /* And what it cannot see at all. */
  assert.match(README, /### What it cannot see at all/);
  assert.match(s, /\*\*Behaviour that changes while the text stays the same\.\*\*/);
  assert.match(s, /matches its pin perfectly\s+and always will/);
  assert.match(s, /Nothing here runs a tool, reads its arguments, or looks at\s+what it returns/);

  /* The cost, as a spread rather than one figure, and whose it is. */
  assert.match(s, /0\.9 ms at the median and 1\.4 ms at the ninetieth\s+percentile/);
  assert.match(s, /\*\*A hold lasts as\s+long as the server takes to answer\*\*/);
  assert.match(s, /measure it rather than trusting these/);
});

test("the sheet asks about the call that waited", () => {
  assert.match(SHEET, /## 9\. Asking before the call \(`--verify-on-call`\)/);
  /* It names the run to make, which is the one the flag exists for. */
  assert.match(SHEET, /\*\*Run `reworded-silent` with it\*\*/);
  assert.match(SHEET, /--mode=reworded-silent/);
  assert.match(SHEET, /\| Question \| flag off \| flag on \|/);
  for (const q of [
    /Was the call refused, or did the server answer it\?/,
    /How long did the call appear to take\? Did you notice a pause\?/,
    /Did the client time out, retry, or complain about a slow answer\?/,
    /How many checks did the gate make\?/,
    /Did it reach the budget of twenty\?/,
    /Would you leave this flag on, given the wait\?/,
  ]) {
    assert.match(SHEET, q, `the sheet does not ask: ${q}`);
  }
  /* And it says what the flag-off column is for, so a tester does not read
   * a forwarded call as a fault. */
  assert.match(SHEET, /The flag-off column is expected to show the call going through/);
});

test("the README says both rewrites are byte-level cuts, and no longer says a list is re-serialised", () => {
  /*
   * I3 added one sentence saying a rewritten tool list was re-serialised,
   * because it was. I3b made it a cut like the instructions field, and the
   * sentence has to go with it: a README that understates its own gate is
   * better than one that overstates it, but neither is the goal.
   */
  const flat = flatten(README);
  assert.ok(!flat.includes("re-serialised from the parsed copy"), "the README still says a tool list is re-serialised");
  assert.match(README, /both are rewritten the same way/);
  assert.match(README, /each hidden element, is cut out of the server's bytes with the one\s+comma that joined it/);
  assert.match(README, /`0`, `-0`, a number past 2\^53 and `1\.0` all reach the client exactly as\s+the server sent them/);
  assert.match(README, /the session ends saying why, rather than\s+forwarding a message that was supposed to be changed/);
});

test("the README says what is pinned and what is not, and why the instructions row is there", () => {
  assert.match(README, /### What is pinned, and what is not/);
  for (const row of [
    /\| every field of a tool definition \| yes \|/,
    /\| the `instructions` string in the `initialize` result \| yes \|/,
    /\| `serverInfo`, `protocolVersion`, `capabilities` \| no \|/,
    /\| prompts \(`prompts\/list`, `prompts\/get`\) \| no \|/,
    /\| resources \(`resources\/list`, `resources\/read`\) \| no \|/,
    /\| what a tool call returns \| no \|/,
  ]) {
    assert.match(README, row, `the pinned table is missing a row: ${row}`);
  }
  /* The measured fact, so the row is not an opinion. */
  assert.match(README, /came back out of Claude Code 2\.1\.325\s+when the model was asked/);
  assert.match(README, /pinned as "none" when a reviewer approves its absence/);
  /* And the limits bullet no longer says tools only. */
  assert.ok(!flatten(README).includes("tools are the only surface it pins"), "the limits bullet still says tools only");
  assert.match(README, /Tool definitions and the `instructions` string are the only surface it\s+pins/);
});

test("the README describes the two instructions demo modes, and why they have no notified pair", () => {
  assert.match(README, /\| `instructions-changed` \| the tools are the baseline's; the `instructions` string/);
  assert.match(README, /\| `instructions-silent` \| serves the baseline's wording on its first spawn and the second wording on its second/);
  assert.match(README, /\*\*Why the instructions modes have no notified\/silent pair\.\*\*/);
  assert.match(README, /every change to it is silent,\s+and reaches a client only when it reconnects/);
});

test("the sheet asks about the instructions string, in two sessions", () => {
  assert.match(SHEET, /## 10\. The instructions string/);
  assert.match(SHEET, /--mode=instructions-silent --state=<a new file>/);
  assert.match(SHEET, /\| Question \| `instructions-changed` \| `instructions-silent`, second session \|/);
  assert.match(SHEET, /\*\*Does the model behave as if it had the server's instructions, or as if it had none\?\*\*/);
  assert.match(SHEET, /Did `gate approve` carry your decision into the pin\?/);
  assert.match(SHEET, /Nothing is expected in the last row: that is what "silent" means here/);
});

test("the README says the journal's first line is a header, and why the mode is in it", () => {
  assert.match(README, /Its first line is a header: the\s+package and version the session was about, which mode it ran in/);
  assert.match(README, /The\s+mode is in it because the rest of the file depends on it/);
});

test("the README explains --held, and says a hash is not privacy next to it", () => {
  const s = section("The calls that waited and did not go");
  assert.match(s, /--held <file>`\s+records the ones that were not/); /* the README wraps; the claim must not depend on where */
  assert.match(s, /the tool, the time, and a \*\*fingerprint\*\* of the\s+arguments/);
  assert.match(s, /"arguments":"sha256:/);
  /* The limit, in the same section rather than in a footnote. */
  assert.match(s, /\*\*A hash is not privacy, and this is the place to say so\.\*\*/);
  assert.match(s, /a label for a \*small set\* is as good as the thing/);
  assert.match(s, /Twelve\s+guesses is not an attack/);
  assert.match(s, /\*\*And it is not a way to run the call again\.\*\*/);
  /* And what it refuses, so a tester is not left with an empty file. */
  assert.match(s, /refused where the file could only ever be empty/);
  /* The deny-rules section knows about it too. */
  assert.match(README, /\*\*The held-call report\*\*, if you use `--held`, decides nothing/);
});

test("the README's offline claim says what was measured, not that it is impossible", () => {
  assert.match(README, /\*\*It reaches no network itself\.\*\*/);
  assert.match(README, /Nothing the gate is made of imports a\s+network module or calls `fetch`/);
  assert.match(README, /the same\s+`connect\(\)` calls as the server with no gate at all/);
  /* The thing it must not be read as claiming. */
  assert.match(README, /What the\s+server it wraps reaches is the server's business/);
});
