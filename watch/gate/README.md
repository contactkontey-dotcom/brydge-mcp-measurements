# The gate — notes for a tester

A small program that sits between an MCP client and a local stdio MCP
server. The client launches the gate; the gate launches the server. Every
byte goes through in both directions.

It compares the tool list the server answers against a pin — a file naming
the tools somebody signed off, by content. In its default mode it writes
down what differs and changes nothing. Told to enforce, it takes tools that
differ out of the list the client receives and answers calls to them itself
instead of forwarding them.

**What it is not.** It does not contain the server. Read [limits](#the-limits)
before you decide what this is worth.

---

## Allow-list, not a filter

What this is, in five lines, because the name people reach for is usually
the wrong one.

* **It is an allow-list over a tool list.** A pin names the tools somebody
  signed off, by content. A tool that is not in the pin, or that is in it
  and now reads differently, is not passed to the client — the model never
  sees it on the menu — and a call to it is answered by the gate instead of
  being forwarded to the server. It is not a filter over content: it does
  not scan descriptions for anything, score them, or look for patterns.
  Either a tool matches what was signed off or it does not.

* **It does nothing about the server's own code.** The server is a child
  process holding your user's permissions: your files, your network, your
  credentials. It has already started by the time there is a tool list to
  compare. The gate reads and writes the messages between the client and
  the server, and that is the whole of its reach.

* **The first pin is "adopted, not reviewed".** `--write-pin` and `gate pin
  --from-current` record what a server was saying at one moment. If it was
  already saying something worth holding, that is now your baseline. Every
  record carries the label and so does every report. Reviewing is a
  separate act, by a person, and nothing here does it for you.

* **Tool definitions and the `instructions` string. Nothing else.** The
  `instructions` field of the `initialize` result is server-authored text
  that a client puts in front of a model — it was measured arriving there —
  so it is pinned like a tool and, under enforcement, taken out of the
  result when it differs. Resources, prompts, `serverInfo` and everything a
  tool call returns are carried between the client and the server without
  being read.

* **Everything else passes through.** The gate reads five kinds of message
  and forwards the rest as they arrived — [the list is
  here](#what-a-pin-compares-and-what-the-gate-never-reads). With
  everything in the pin approved, what the client reads is byte for byte
  what it reads with no gate at all, and there is a test that holds it to
  that.

---

## Steps

Node 22 or later. No network access is needed and nothing is installed.

### 1. Build it

```
node watch/cli.ts gate build
```

This compiles the gate to `watch/gate/built/`, which is gitignored. It
prints the path the client will launch. The gate refuses to start from a
build older than its sources, so run this again after any change.

Running it from TypeScript source works and costs about 135 ms more per
session. Build it.

### 2. Take a pin

A pin is what the gate compares against. Two ways to get one.

**From a live server**, which is the way to start:

```
node watch/gate/built/gate/run.js \
  --write-pin ~/gate/pins/my-server.json \
  --package my-server@1.2.3 \
  -- npx -y my-server
```

Send it one `initialize` and one `tools/list` — or just let your client
connect once and then close it. The gate writes the pin from the first tool
list the server answers and says so on stderr. The pin is labelled
**adopted, not reviewed**: nobody approved those tools, and that label is on
every record in it and in every report the gate writes. It is a starting
point, not a sign-off.

`--package` is required. A pin names what it is a pin of, and a command line
is not a name.

**From a review**, once there is something to review: `node watch/cli.ts
gate pin <package@version>` builds one from the approved list and the
decisions behind it. That path needs this project to have measured the
package.

### 3. Run it in shadow mode

Shadow is the default. Nothing is hidden and no call is stopped.

```
node watch/gate/built/gate/run.js \
  --pin ~/gate/pins/my-server.json \
  --pending ~/gate/pending \
  --journal ~/gate/journal.ndjson \
  -- npx -y my-server
```

Use it like this for a while. When the live list differs from the pin, a
report lands in `--pending` and one line goes to stderr. The report holds
the diff: changed descriptions first, with inserted and removed words
marked and invisible characters made visible.

`--journal` writes one line per thing the gate noticed. It is counts and
tool names, not message contents.

### 4. Review and approve

Open the report, decide per item, and carry the decisions into the pin:

```
node watch/cli.ts gate approve \
  --pending ~/gate/pending/my-server-1763000000000.json \
  --decisions-from ~/gate/decisions-export.json
```

An approved change is pinned and is not flagged again. A held one is
recorded and **not** pinned, so it is flagged again next time — holding
means "looked at, not added to the list, not in the allow rules", and it is
the absence of an approval rather than a state to store.

A decision is tied to the exact content it was made about. Change the
description again and the old decision does not carry over.

Every approve archives the pin it replaces. See
[going back](#going-back).

### 5. Then enforce, if you want to

```
node watch/gate/built/gate/run.js \
  --pin ~/gate/pins/my-server.json \
  --pending ~/gate/pending \
  --mode enforce \
  -- npx -y my-server
```

`--mode enforce` has to be typed. It is never on by default and there is no
config file that turns it on.

With everything approved, what the client receives under enforcement is
byte for byte what it receives with no gate at all. That is a test, not a
claim: `test/gate-enforce.test.ts`, and a sealed-room run against a real
server.

When something does differ:

* it is not in the tool list the client receives;
* a call to it is answered by the gate with
  `the gate did not forward this call: "<tool>" is hidden, because …`,
  plus how to approve it;
* a call to a tool the **server** has stopped offering says that instead,
  so the two cases are not confused;
* one line goes to stderr each time something is not passed on.

---

## Asking the server, instead of waiting for the client

`--relist-on-change` is off unless you type it. With it on, the gate sends
a `tools/list` of its own when the server says
`notifications/tools/list_changed`, reads the answer, and does not pass that
answer to the client — the client never asked for it.

It exists because of one case. A client typically lists the tools once, at
startup. If the server changes a description or stops offering a tool after
that, the gate only finds out when the client next lists, which may be
never. With the flag, the gate finds out when the server says so:

```
client -> tools/list                        answered, four tools
server -> notifications/tools/list_changed
gate   -> tools/list (brydge-gate/1)        not the client's, never shown to it
client -> tools/call demo_subtract
gate   -> the gate did not forward this call: the server is no longer
          offering "demo_subtract"
```

Without the flag, that last call goes through to a server that no longer
has the tool. Try it both ways with the demo server: `--mode=dropped-notified`
is the case above, and `--mode=dropped-silent` is the honest limit — no
notification means nothing to ask on, so the call is forwarded. The flag
does not make the gate clairvoyant.

**What it does to your session.**

* It adds requests the client did not make. That is the one thing the gate
  otherwise never does, which is why the flag is off by default and why it
  says so on stderr when it is on.
* Those requests use ids beginning `brydge-gate/`. Nothing the server sends
  under such an id reaches the client, whether the gate asked under it or
  not. If your client ever sends a request with an id in that namespace,
  the session ends rather than the gate guessing whose answer is whose —
  with the flag off it reserves nothing and the same id is left alone.
* At most one request is outstanding, at least a second apart, and twenty
  in a session. At twenty it says so once and goes back to comparing the
  lists the client asks for. An answer has five seconds, and nothing the
  client sends ever waits on any of it.
* An answer carrying a cursor is one page of a list, so a tool that changed
  may be on a page the gate did not get. It is not compared at all, and
  under enforcement no call is passed on until a whole list arrives.
* An error, or an answer to an id this session never sent, is no
  information: noted, and nothing changes.

**How often it will matter, measured.** Replayed over the 75 recorded
sessions this project has kept, from 70-odd real servers: six
`tools/list_changed` notifications in all, in **two** sessions, and the
policy would have sent two requests. Most servers never send that
notification, so for most servers this flag changes nothing — which is
worth knowing before you turn it on and expect it to earn its keep. The one
server that sent three in a burst would have been asked once, the rest
declined because a request was already outstanding.

It costs nothing at startup: it sends nothing until the server speaks, so
the cold-start figures below are the same with it and without.

---

## Asking before the call: the one place a client's message waits

`--relist-on-change` depends on the server saying something changed. Most
servers never do. `--verify-on-call` does not wait to be told: before a
`tools/call` goes through, if the last list the gate read is older than
`--verify-window` (10 s by default), it asks for a current one, waits up to
`--verify-timeout` (3 s), compares it with the pin, and only then forwards
the call or answers it itself.

```
gate --pin <pin> --mode enforce --verify-on-call -- <your server command>
```

**This is the one deliberate exception to "nothing the client sends
waits".** Everywhere else the gate copies bytes straight through and parses
a copy to decide, so a message is never delayed by the deciding. Here it
is: the call is held, and anything the client sends behind it is held too,
because releasing a later message first would reorder the conversation. The
exception is written in the code at the point where it happens, and it is
the only one.

The hold ends when the answer arrives, when `--verify-timeout` runs out, or
when the session's budget of 20 checks is spent — the last of which behaves
exactly like a timeout. On a timeout, under enforcement, the call is not
forwarded; `--on-verify-timeout=forward` is the explicit opt-out, and it
says what it does. In shadow mode nothing is ever refused: the gate checks,
updates its picture and writes its reports, and the announcement on stderr
says so.

**What it costs.** Measured against the planted demo server on one machine,
per call: 0.8 ms median with no flag, 0.8 ms with the flag on and the
picture fresh — inside the noise — and 1.7 ms with every call held, so a
hold adds about **0.9 ms at the median and 1.4 ms at the ninetieth
percentile**. A session of twelve calls 60 ms apart against a 200 ms window
made three checks and held **3–5 ms in total**.

Those figures are the gate's own share and nothing else. **A hold lasts as
long as the server takes to answer**, up to the timeout: against the
planted hostile server's slow case, which sits on the answer for 1200 ms,
the client waited 1204–1205 ms. Your server's answer is your number;
measure it rather than trusting these.

### The window narrows the gap. It does not close it

A picture that is 9 seconds old passes a 10-second window, so a change
inside the window is forwarded on an out-of-date picture. Narrowing the
window narrows that interval and buys more checks — a window of zero means
every call is checked, until the budget of 20 is spent, after which calls
are treated as having timed out. There is no setting at which the gate
knows the list is current at the instant the server runs the call: the
answer it compared was true when it arrived, and the call goes afterwards.

### A hostile server is not obliged to be consistent

A server answering the gate's question can answer it slowly, differently
each time, or differently from what it would answer the client. Nothing
here makes a server tell the truth twice. The planted hostile server has a
case for each shape — no answer, an error, one page of a list, an answer to
an id nobody sent, a slow answer, and exiting mid-question — and the gate's
behaviour for each is in the tests, but the shape of the limit is the
point: this compares what a server *says*, and a server chooses what to
say.

### What it cannot see at all

**Behaviour that changes while the text stays the same.** A tool whose
description, schema, title and annotations are byte for byte what was
signed off, and which now does something else, matches its pin perfectly
and always will. Nothing here runs a tool, reads its arguments, or looks at
what it returns. Every comparison in this directory is over the text a
server publishes about itself, and a server that changes nothing it
publishes has nothing for the gate to notice.

## The client's config

Wherever your client lists its MCP servers, the gate goes in front of the
command that is already there. Before:

```json
{
  "mcpServers": {
    "my-server": {
      "command": "npx",
      "args": ["-y", "my-server"]
    }
  }
}
```

After:

```json
{
  "mcpServers": {
    "my-server": {
      "command": "node",
      "args": [
        "/path/to/brydge-mcp-measurements/watch/gate/built/gate/run.js",
        "--pin", "/home/you/gate/pins/my-server.json",
        "--pending", "/home/you/gate/pending",
        "--journal", "/home/you/gate/journal.ndjson",
        "--mode", "enforce",
        "--",
        "npx", "-y", "my-server"
      ]
    }
  }
}
```

Everything before `--` is the gate's. Everything after it is the command
that was there before, unchanged — including its own flags, and including
`env` if your client supports it, which stays where it was and reaches the
server as before.

Drop `--mode enforce` to watch first. That is the suggested order. Add
`--relist-on-change` after that, when you want the gate to ask rather than
wait; see [asking the server](#asking-the-server-instead-of-waiting-for-the-client).

### On Windows

Two things differ, and both are about the command after `--`.

**A command that is a `.cmd` file cannot be started directly.** `npx`,
`npm` and `yarn` on Windows are `.cmd` files, so the entry that works
everywhere else — `-- npx -y my-server` — fails there, and the gate exits
127 saying the command did not start. Run that command through `cmd.exe`
yourself:

```json
"args": [
  "C:/path/to/watch/gate/built/gate/run.js",
  "--pin", "C:/Users/you/gate/my-server.json",
  "--mode", "enforce",
  "--",
  "cmd.exe", "/c", "npx", "-y", "my-server"
]
```

The gate does not do this for you. It prints the `cmd.exe` form of the
command it was given and leaves the editing to you: the command is the one
you wrote, and a gate that quietly ran something else would be worth less
than no gate. A command that is a real program — `node`, or a path to an
`.exe` — needs none of this, which is why the planted demo server does not.

**Forward slashes in paths.** Windows Node accepts them and they need no
escaping in JSON. `C:\\Users\\you\\...` works too if you double every
backslash; `C:/Users/you/...` is less to get wrong.

The gate does not spawn the server detached on Windows, where that flag
would give it its own console window and let it outlive the gate. One
consequence: ending the session on a batch reaches the server and not
anything the server itself started. On POSIX it reaches the whole group.

### Undoing it

Put the original `command` and `args` back. That is all. The gate is not
installed anywhere, writes nothing into your client, and changes nothing
about the server: remove it from the config and the next session is exactly
the session you had before. The pins, reports and journal are files you
chose the paths of; delete them or keep them.

---

## Going back

Every approve keeps a copy of the pin it replaced, beside it.

```
node watch/cli.ts gate rollback my-server@1.2.3
```

lists what has been kept, newest first, and changes nothing. Then:

```
node watch/cli.ts gate rollback my-server@1.2.3 --to 1
```

puts that one back. The pin in place is archived first, so a rollback can be
rolled back. Rolling back does not undo decisions: `watch/decisions.json`
still records who decided what, including about tools the pin no longer
names.

---

## Trying it without your own server

There is a planted demo server in `watch/gate/fixtures/demo-server.mjs`.
Everything in it was written in this repository: four tools that do
arithmetic and echo text, no file access, no network, no package behind it.
It exists so you can watch a client meet a hidden tool without pointing the
gate at somebody else's server.

```
node watch/gate/fixtures/demo-server.mjs --mode=<mode>
```

| mode | what it does |
| --- | --- |
| `baseline` | four tools, never changes. Pin this one. |
| `changed-description` | one description differs from the baseline, from the first list on. Nothing announces it. |
| `dropped-notified` | starts as the baseline, then stops offering `demo_subtract` and sends `notifications/tools/list_changed`. |
| `dropped-silent` | the same drop, and sends nothing. |
| `reworded-notified` | starts as the baseline, then changes `demo_add`'s description to a second planted wording and sends `notifications/tools/list_changed`. |
| `reworded-silent` | the same rewording, and sends nothing. |
| `renamed-notified` | starts as the baseline, then renames `demo_echo` to `demo_echo_v2`, keeping its description word for word, and sends `notifications/tools/list_changed`. |

The change happens two seconds after the first tool list, in all four modes
that change something mid-session; `--drop-after=<ms>` moves it, whatever
the change is.

Take a pin from `baseline`, then point your client at the gate in front of
one of the other six. The two dropping modes are there because the
interesting difference is in the **client** — does it re-list when it is
told, and what does it do when it is not told?

**The two rewording modes are the ones to spend your time on.**
`changed-description` differs from the pin before the client has listed even
once, so the first list it gets is already filtered and it never saw the
tool. The rewording modes give the client the baseline first, let it cache a
list with `demo_add` in it, and only then change the words — so what the
client has on screen and what the server is offering have come apart, which
is the thing no version number catches.

With `--mode enforce --relist-on-change` in front of `reworded-notified`,
the client lists **once** and then:

```
client -> tools/list                        answered, four tools, demo_add among them
server -> notifications/tools/list_changed  (after --drop-after ms)
gate   -> tools/list (brydge-gate/1)        not the client's, never shown to it
client -> tools/call demo_add
gate   -> the gate did not forward this call: "demo_add" is hidden, because its
          description differs from the baseline. If your client listed the tools
          before it was hidden, it may still be showing it.
```

A report lands in `--pending` about a change the client never saw. Note what
does *not* happen: there is no "did not pass N tool(s)" line, because no
tool list went to the client after the change — nothing was filtered on the
way out. The hiding shows up in the refusal instead.

### A name change against a description change

`renamed-notified` exists for a question about the **client**, not about
the gate. A name is something a client has to care about: it is what a
model calls, and a stale name is a call that cannot work. A description is
not — a client can hold an old one indefinitely and never find out.

So a client may well re-list on a name change and not on a
description-only one, and the two notified modes put that question side by
side. `reworded-notified` changes the words; `renamed-notified` changes
the name and keeps the description word for word. Run both, with and
without `--relist-on-change`, and the difference in what the client does
next is the answer. Section 2 of the observation sheet is where it goes.

What the gate makes of a rename is worth knowing before you read the
stderr: on the wire a rename is one name gone and one arrived, so you get
**two** different refusals for the one change — a call to the old name is
refused because the server no longer offers it, and the new name is hidden
because it is not in the pin.

### Why `reworded-silent` forwards the call

Run the same thing against `reworded-silent` with `--mode enforce
--relist-on-change` and the call goes through: the server answers `5`, and
the gate neither hides nor refuses anything.

That is not a defect in the gate. The gate learns what a tool looks like
from a `tools/list` answer, and with those two flags it gets one in exactly
two ways: the client asks, or the server says something changed and the
gate asks. In `reworded-silent` the client has already listed and will not
again, and the server says nothing. The gate is not wrong here; it has not
been told.

**There is a third way, and it is `--verify-on-call`.** Add it and the same
run ends in a refusal instead: the gate asks for a list of its own before
passing the call on, finds a description that no longer matches the pin,
and does not forward it. What that costs, and the three things it still
cannot do, are in [asking before the
call](#asking-before-the-call-the-one-place-a-clients-message-waits). It is
worth running `reworded-silent` both ways, because the pair is the clearest
demonstration of what each flag is for.

So the honest shape of what this covers:

| the server… | and it… | by default | with `--verify-on-call` |
| --- | --- | --- | --- |
| changes a description | announces it | notices, with `--relist-on-change` | refused at call time, within the window |
| changes a description | says nothing | notices only when the client next lists | refused at call time, within the window |
| stops offering a tool | announces it | notices, with `--relist-on-change` | refused at call time, within the window |
| stops offering a tool | says nothing | notices only when the client next lists | refused at call time, within the window |

"Within the window" is the whole of the fourth column's modesty: the gate
asks when the picture it holds is older than `--verify-window`, so a change
that lands inside the window is still forwarded on an out-of-date picture,
and nothing it learns is current at the instant the server runs the call.

Closing the third column's bottom rows any further would mean polling a
server on a timer, which this does not do and which would be a different
thing to agree to. `--verify-on-call` is the nearest thing that is not
polling: it asks when a call is about to go, not on a clock, so a session
that makes no calls asks nothing. Measured over the recorded sessions, only
two of 75 servers ever sent `tools/list_changed` at all — so for most
servers the third column is the second row, and the two things that
actually help are a client that lists more than once and this flag.

`observation-sheet.md` in this directory is for writing down what you see.

---

## Keeping the model away from the gate's own files

The gate's value depends on one thing: that the person decides what is
approved, not the model. Two files decide that, and they sit in a directory
the client can see.

**The pin** is what the gate compares against. A model that can edit it can
approve anything.

**The report** in `--pending` carries the live definitions of what differs,
which is the server's prose, and `gate approve` turns a report plus a
decisions file into a new pin.

Nothing the gate sends a client names any of this. A refusal used to end
with "To approve it: run `node watch/cli.ts gate approve --pending <report>
…`", which is the command for undoing the gate handed to the model that just
met it, path and flag and all. That sentence is gone: no command, no path
and no flag appears in any message a client receives, and a test builds
every one of those messages and refuses any that does. The instructions go
to stderr and into the report, which a person reads.

That is the gate's side of it. Your side is to put the files out of reach.
In Claude Code, add `deny` rules to `.claude/settings.json` in the project,
or to `~/.claude/settings.json` for every project.

Everything in this section was checked against
[Configure permissions](https://code.claude.com/docs/en/permissions) on
2026-11-14. Each claim below says which part of that page it comes from, so
you can check it again rather than trust this file.

**On macOS and Linux:**

```json
{
  "permissions": {
    "deny": [
      "Read(//home/you/gate/**)",
      "Edit(//home/you/gate/**)",
      "Bash(node watch/cli.ts gate approve:*)",
      "Bash(node watch/cli.ts gate pin:*)",
      "Bash(node watch/cli.ts gate rollback:*)"
    ]
  }
}
```

**On Windows**, the drive is spelled differently, and an earlier draft of
this file had it wrong. From *How path patterns match*: "On Windows, paths
are normalized to POSIX form before matching. `C:\Users\alice` becomes
`/c/Users/alice`, so use `//c/**/.env` to match `.env` files anywhere on
that drive." So it is a lowercase drive letter with no colon:

```json
{
  "permissions": {
    "deny": [
      "Read(//c/Users/you/gate/**)",
      "Edit(//c/Users/you/gate/**)",
      "Bash(node watch/cli.ts gate approve:*)",
      "Bash(node watch/cli.ts gate pin:*)",
      "Bash(node watch/cli.ts gate rollback:*)"
    ]
  }
}
```

Keep the pins, the reports and the journal in one directory outside the
repository — `~/gate` above — so one pair of rules covers all of them.

**Why each part is written the way it is.**

* **`//path`** is "Absolute path from filesystem root", per the four pattern
  types under *How path patterns match*, which use gitignore syntax. A
  single leading `/` anchors at the settings source instead — in user
  settings that is `~/.claude/path`, which is not what you want.
* **`Edit` as well as `Read`**: under *What `Read` and `Edit` rules cover*,
  a `Read` deny rule covers the Edit and Write tools on the same path too,
  including creating a new file there — but not NotebookEdit, and the page
  says to add an `Edit` deny rule for paths no tool may change. That is a
  paraphrase rather than a quotation: the page's own sentence uses a word
  this repository does not print, because nothing here is allowed to say
  the gate stops anything. The Write part of it needs Claude Code v2.1.228
  or later.
* **`:*`**: "The `:*` suffix is an equivalent way to write a trailing
  wildcard, so `Bash(ls:*)` matches the same commands as `Bash(ls *)`." It
  is "only recognized at the end of a pattern", which is where these rules
  have it. `Bash(node watch/cli.ts gate approve *)` is the same rule.

**What those rules do not do.** Two separate limits, both the docs' own.

*The file rules reach the tools Claude Code knows about, and no further.*
From the warning under *What `Read` and `Edit` rules cover*: they apply to
the built-in file tools, to "file commands Claude Code recognizes in Bash,
such as `cat`, `head`, `tail`, `sed`, and `tee`", and to redirection
targets — and "They don't apply to a command that reads files without
naming them, such as `grep -r pattern .` run from the directory that holds
the file, or to arbitrary subprocesses that read or write files indirectly,
like a Python or Node script that opens files itself."

*The Bash rules are weaker than they look, and the docs say so outright.*
From *What a Bash rule doesn't match*: a Bash rule "doesn't match the same
program invoked in a different form, so a deny or ask rule covers the
invocation Claude usually produces and **isn't a security boundary around
the program**." Its own examples: `Bash(curl *)` stops `curl …` and not
`/usr/bin/curl …` or `sh -c 'curl …'`. The same applies here — a deny rule
on `node watch/cli.ts gate approve` does not stop `/usr/bin/node
watch/cli.ts gate approve`, or `cd watch && node cli.ts gate approve`, or a
script that does the same work.

For enforcement that does not depend on the command text, the docs point at
[sandboxing](https://code.claude.com/docs/en/sandboxing), which is
operating-system level and is not something the gate provides.

So: the deny rules raise the effort and make an attempt visible in the
transcript. They are not a wall, and that is not a hedge on my part — it is
what the page says about its own Bash rules. If the model can run arbitrary
code as your user, it can reach these files, and the honest answer is that
the gate is for watching a server you are unsure about — not for
restraining the model you are running it with.

Whether a model tries is worth knowing, and there is a question for it on
the observation sheet.

## What a pin compares, and what the gate never reads

Two questions worth answering exactly, because a gate that watched the
wrong fields would be one a server could walk straight past.

### Every field of a tool definition, not a chosen few

A pin stores each tool as the server declared it, and compares by a
sha256 over the whole definition, canonically serialised — object keys
sorted at every depth, so a server that emits its keys in another order
has not changed anything. Any difference in any field makes that tool a
changed tool: it is reported in shadow mode, and under enforcement it is
taken out of the list the client gets and calls to it are not forwarded.

| Field | In the comparison | Named in a report as |
| --- | --- | --- |
| `name` | yes | a tool added or removed |
| `description` | yes | `description` |
| `inputSchema` | yes | `input schema` |
| `title` | yes | differs in some other field |
| `outputSchema` | yes | differs in some other field |
| `annotations` | yes | differs in some other field |
| `_meta` | yes | differs in some other field |
| anything else the server sends | yes | differs in some other field |

`description` and `inputSchema` have hashes of their own as well, which is
only so a report can say which of the two moved. Everything else lands in
the third column: the tool is a changed tool either way, and the report
says a field moved without reading it aloud.

`annotations` is in there deliberately. It carries `readOnlyHint` and
`destructiveHint`, and a client may decide whether to ask you before
running a tool by reading them. A gate that let those turn over quietly
would be missing the point.

**One exception, and it is written down rather than quietly left out.** A
`description` that is not a string — an object, a number — is dropped
before the comparison, so a server that changed one non-string
description for another would not be seen to have changed anything. The
specification says a description is a string, so a well-formed server
never reaches this. It is recorded in `test/gate-fields.test.ts`, with the
fix named there, and it has not been changed: closing it alters what every
pin written so far hashes, which is a format change and not a patch.

### Five things are looked at. Everything else is carried

The gate reads:

* the answer to `initialize` (and to `server/discover`, should a server
  answer one) — for its `instructions` string, and nothing else in it
* `tools/list`, to know an answer is on its way
* the answer to it — compared against the pin, and the one kind of message
  the gate ever rewrites
* `tools/call` from the client — the name is compared against what is
  hidden, and with `--verify-on-call` the call may wait
* `notifications/tools/list_changed` from the server — counted, and with
  `--relist-on-change` it prompts a list of the gate's own
* `notifications/initialized` from the client — a marker only, so the gate
  sends nothing of its own before the client has finished starting up

Anything carrying an id in the gate's reserved namespace belongs to the
gate, in either direction, and does not reach the other side.

**Everything else is passed on as it arrived and is not read.** That is:

* the `initialize` request, and everything in its result **except
  `instructions`**: `protocolVersion`, `capabilities`, `serverInfo`. The
  `instructions` string is pinned — see [what a pin
  compares](#every-field-of-a-tool-definition-not-a-chosen-few) — and when
  it differs from the pin, under enforcement, that one field is cut out of
  the result and every other byte of the message is forwarded as the
  server wrote it.
* `resources/list`, `resources/templates/list`, `resources/read`,
  `resources/subscribe`, and the resource notifications
* `prompts/list`, `prompts/get`, and `notifications/prompts/list_changed`
  — prompt text is server-authored too, and is not pinned
* `sampling/createMessage`, `elicitation/create` and `roots/list`, which a
  server sends to the client
* `logging/setLevel`, `notifications/message`, `completion/complete`,
  `ping`, `notifications/progress`, `notifications/cancelled`
* **the result of a `tools/call`.** The gate decides about the call. What
  comes back is the server's, and the gate does not read it — which is
  why a journal never carries anything out of one.
* any method that does not exist yet

A test holds this to the bytes: with everything approved, a run of those
messages through the gate reaches the server as the same lines it receives
with no gate at all, and the client gets the same bytes back.

---

## The limits

Plainly, because the value of this depends on them.

* **It does not contain the server.** The server runs as a child process
  with the user's permissions. It can read the same files, reach the same
  network and spend the same credentials as anything else the user runs. The
  gate reads and writes the messages between the client and the server, and
  that is the whole of it.

* **The server has already started when the list is checked.** The gate
  launches it, the client sends `initialize`, the server answers, and only
  then is there a tool list to compare. Whatever a server does at startup —
  this project's own measurements found servers reading credentials at
  startup — has happened before the first comparison. The two things the
  gate refuses to start for (a build older than its sources, a pin it cannot
  read) are refused *before* the server is spawned, which is the only point
  at which that is possible.

* **It cannot take back a tool list a client already has.** If the client
  listed the tools and then something changed, the client's menu is its own.
  Under enforcement the gate refuses the call and says the tool was hidden
  and that your client may still be showing it — but the client showed it,
  and a model may have already decided to use it.

* **It only knows what the lists tell it.** A changed or withdrawn tool is
  noticed when the server answers a `tools/list`. A client that lists once
  at startup and never again gives the gate one look.
  `--relist-on-change` narrows this: the gate asks for a list of its own
  when the server says one changed. It does not close it — a server that
  changes a description and says nothing is not noticed, which is what the
  `dropped-silent` demo mode is, and measured over the recorded sessions
  only two of 75 ever sent that notification at all.

* **Local stdio servers only.** It is a process in a pipe. A remote server
  over HTTP or SSE does not go through it.

* **It hides and refuses. Nothing more.** It does not stop the server from
  doing anything, inspect what a tool does when it runs, or examine the
  arguments of a call it forwards.

* **Tools are the only surface it pins.** Resources, prompts, the
  `instructions` field of the `initialize` result and everything a tool
  call returns are carried between the client and the server without being
  read. A server with nothing worth noting in its tool list and something
  worth noting in a prompt is a server this gate has nothing to say about.
  See [what a pin compares, and what the gate never
  reads](#what-a-pin-compares-and-what-the-gate-never-reads).

* **It does not restrain the model it is running under.** The pin and the
  reports are ordinary files belonging to your user. Nothing the gate sends
  a client names them or says how to change them, and the deny rules above
  raise the effort — but a model that can run code as you can reach them.
  See [keeping the model away from the gate's own
  files](#keeping-the-model-away-from-the-gates-own-files).

* **A pin written with `--write-pin` or `gate pin --from-current` is
  adopted, not reviewed.** It records what a server was saying at one
  moment. If the server was already saying something worth holding, that is
  now the baseline. Reviewing is a separate act.

* **A batch ends the session under enforcement.** A JSON-RPC batch can
  carry a `tools/list` or a `tools/call` inside an array, where the gate
  does not reach them. In shadow it is noted; under enforcement the session
  stops, saying so. No server this project has measured has sent one.

* **Measured cost.** Tens of milliseconds added to a session's first
  answer, almost all of it being a second Node process: between +44 ms and
  +69 ms across runs on one machine over two days, so take it as "tens of
  milliseconds" and measure your own rather than trusting a single figure.
  Enforcement adds nothing measurable to that, and neither does
  `--relist-on-change`. Per message, the gate copies bytes and parses a
  copy to decide. Two kinds of message are ever rewritten — an `initialize`
  result whose `instructions` differ from the pin, and a tool list with a
  hidden tool in it — and both are rewritten the same way: the one field,
  or each hidden element, is cut out of the server's bytes with the one
  comma that joined it, and every other byte is forwarded as the server
  wrote it. The id token in particular is never read and never rebuilt, so
  `0`, `-0`, a number past 2^53 and `1.0` all reach the client exactly as
  the server sent them. When the bytes cannot be cut without doubt — two
  members of the same name, say — the session ends saying why, rather than
  forwarding a message that was supposed to be changed.

---

## The shape of a refusal

`--refusal-style error` (the default) answers a refused call with a JSON-RPC
error, code `-32000`. That is the honest shape: the request was not carried
out. The code is deliberately not `-32601` or `-32602`, and the message
never says there is no such tool — the gate must not be mistaken for the
server saying the tool does not exist.

`--refusal-style result` puts the same sentence in a tool result with
`isError` true, the shape a server uses to tell a model a call went wrong.
Some clients turn a protocol error into a transport failure or a retry loop
and the model never sees the sentence. Which shape your client handles
better is exactly what the observation sheet is for. The two differ in no
other byte.

The style applies only to a refused `tools/call`. A tool list the gate
cannot read is a failure of `tools/list`, which has no result shape that can
carry an error, so that one is always an error.

---

## If it breaks

Send:

1. The gate's stderr — every line beginning `gate:`. These are counts, tool
   names, file paths and times.
2. The exit code.
3. Which mode, and the exact command line (with your own paths redacted if
   you like).
4. The `--journal` file, if you used one. It is counts and tool names. Under
   `--mode enforce` it records each tool kept out of a list and each call
   not forwarded, with the reason and a running count — so the journal is
   where the refusals are, not only in a stderr your client may swallow.
   With `--relist-on-change` it also records each list the gate asked for,
   each time it decided not to ask and why, and any message the server
   sent under the gate's ids.

   It carries no description text, no file path, no command and no flag,
   which is what makes it the one file you can send without reading it
   first. A test asserts each of those.
5. What the client did: the wording of any error it showed, and whether the
   session continued.

The `gate:` lines carry paths and the approval command, because they are
for you. Nothing the client was sent does.

**Do not send** a pin, a report, a `tools/list` response, or any tool
description. A pin and a report both carry the definitions they are about,
which is the server's prose; the journal and the stderr lines do not. If
something seems to need a description to explain it, say which tool and
which field and leave the text out.

Useful reproductions use the planted demo server above, which has no
descriptions worth withholding.

---

## Packaging — not done, and here is the thinking

It is a repository download today: clone, `gate build`, point the client at
`watch/gate/built/gate/run.js`. Nothing is published and nothing should be
published yet.

**As an npm package** a tester would write `npx -y @brydge/gate --pin … --
npx -y my-server` and be done. The cost is the part that matters: a
published package is a thing people install, and this one would sit in the
path of every message between a client and its servers. That means a name
somebody could typo-squat, a release process, a signing story, a version
anyone can pin, an answer for what happens when the package updates under a
client that is mid-session, and a support surface for a program whose whole
value is that it is predictable. It also makes the gate itself a supply
chain dependency of the thing it is meant to help somebody look at, which
deserves a straight answer before anyone types `npx`.

**As a repository download** the cost is on the tester: clone, build, absolute
paths in a config, and `git pull` to update. For the number of people who
should be testing this right now, that is the right trade, and it keeps the
gate out of any registry until somebody has watched it in front of a real
client and filled in an observation sheet.

The middle option, when there is a reason to move: a tagged tarball with a
checksum, installed by hand. It gives a version to refer to without putting
a name in a registry.
