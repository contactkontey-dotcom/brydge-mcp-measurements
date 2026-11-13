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

Drop `--mode enforce` to watch first. That is the suggested order.

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

The drop happens two seconds after the first tool list; `--drop-after=<ms>`
moves it.

Take a pin from `baseline`, then point your client at the gate in front of
one of the other three. `changed-description` is the case the whole thing is
about: a description changing with no version bump. The two dropping modes
are there because the interesting difference is in the **client** — does it
re-list when it is told, and what does it do when it is not told?

`observation-sheet.md` in this directory is for writing down what you see.

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
  at startup and never again gives the gate one look. This is why
  `dropped-silent` is one of the demo modes.

* **Local stdio servers only.** It is a process in a pipe. A remote server
  over HTTP or SSE does not go through it.

* **It hides and refuses. Nothing more.** It does not stop the server from
  doing anything, inspect what a tool does when it runs, or examine the
  arguments of a call it forwards.

* **A pin written with `--write-pin` or `gate pin --from-current` is
  adopted, not reviewed.** It records what a server was saying at one
  moment. If the server was already saying something worth holding, that is
  now the baseline. Reviewing is a separate act.

* **A batch ends the session under enforcement.** A JSON-RPC batch can
  carry a `tools/list` or a `tools/call` inside an array, where the gate
  does not reach them. In shadow it is noted; under enforcement the session
  stops, saying so. No server this project has measured has sent one.

* **Measured cost.** About 60 ms added to a session's first answer, almost
  all of it being a second Node process. Enforcement itself costs nothing
  measurable. Per message, the gate copies bytes and parses a copy to
  decide; tool lists are the only messages it ever rewrites.

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
4. The `--journal` file, if you used one. It is counts and tool names.
5. What the client did: the wording of any error it showed, and whether the
   session continued.

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
