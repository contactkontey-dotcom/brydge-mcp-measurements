# brydge-mcp-measurements

Do an MCP server's tools do what they say, and does it ask for credentials it
never declared? This is the code that answers those two questions for a fixed
set of servers, the way BRYDGE answers them about itself: **published method,
published code, limits stated as data.** The per-server write-ups live at
<https://www.brydge-ai.com/mcp>. This repository is the instrument behind them,
so you can read it, disagree with it, and run it yourself.

It is free to install and free to run. There is no BRYDGE account, no network
service, and no model in the loop — a tool is called with fixed arguments and an
independent system is asked what actually happened.

## What it does

For each server, in a sealed sandbox with no route off the machine:

1. **Installs** it from its registry, under a kernel trace, with fake secrets
   planted in a fake home — so an install script that reaches for a credential
   is caught.
2. **Starts** it as an unprivileged user, again under a trace, with in-process
   probes that record every environment variable its own code reads and every
   file it opens under `$HOME`.
3. **Calls** each declared tool with fixed arguments and checks the result
   against an **independent oracle** — the files on disk, the kernel's syscall
   trace, a git repository read with `git`, a local web server's request log, an
   arithmetic done here, a workbook read by our own reader. The server's own
   reply never decides its own verdict; it is judged *against* the oracle, for
   honesty, on a separate axis.
4. **Reports** what it found, and whether any of it is a security hole.

Every server is data (`servers/`), not code. The one harness (`harness/`) is the
same for all of them, and it reuses BRYDGE's own comparison engine (`engine/`,
published byte-for-byte from the private repository) to turn each observation
into one of five verdicts — `VERIFIED`, `MISMATCH`, `FAILED`, `UNKNOWN`,
`PENDING` — the same five, with the same meanings, the accuracy harness uses.

## What it can and cannot establish

Stated in full in `harness/limits.ts`, and printed on every page. The short
version:

- **It cannot show a server is safe.** It shows whether particular claims held,
  on the calls made, this once. A server that behaves while watched and
  misbehaves otherwise would pass.
- **Nothing runs against a real network.** The sandbox has only loopback. Code
  that only runs after a real connection succeeds never runs here, and the
  contents of anything sent over TLS are never seen — only the destination.
- **A credential read means the reading of a *planted* secret.** Not a variable
  whose name looks scary. Reads by native code or a subprocess are seen as file
  opens and process starts, but the individual environment variable a native
  read touched is not always visible.
- **The servers were chosen, not sampled**, and skew toward ones that install
  cleanly and need no account. There is no ranking and no score.
- **The harness is ours, and BRYDGE is an interested party.** The calibration
  below catches planted lies of the kinds we thought of; it cannot catch a kind
  we never planted.

## The calibration gate

The harness is pointed at two servers whose every tool is honest or carries one
**known, planted lie** — across every channel it watches: what a tool does on
disk, what it opens, what it commits, what it fetches, what it computes, what it
replies, what it reads from the environment, where it connects, what it
declares, and what its install script does. The lies and their intended verdicts
are written down in `calibration/`.

**No real server's result is published unless the harness reproduces that answer
key exactly** — catches every planted lie and accuses nothing honest — under a
fingerprint (`harness/fingerprint.ts`) taken over the engine, the harness and
the runner. Change a line of the detector and the old calibration no longer
vouches for anything. The gate is enforced in `measure.ts` before any real run.

## Run it yourself

Requires Node ≥ 22.18 (it runs the TypeScript directly, no build step), and, for
the sandbox, a Linux host where you can create namespaces (`unshare`, `strace`,
`setpriv`) and an unprivileged `brydge-measure` user. The pure parts need none of
that.

```sh
node --test test/*.test.ts     # the parts that need no sandbox
node measure.ts calibrate      # prove the harness catches the planted lies
node measure.ts                # measure the real servers (needs the sandbox)
node measure.ts <slug>         # measure one
```

A real run refuses to start until a calibration has passed under the current
fingerprint.

## Layout

| Path | What |
| --- | --- |
| `engine/` | BRYDGE's comparison engine, byte-for-byte from the private repo: the judge and the five verdicts. |
| `harness/` | The instrument: MCP client, sandbox, oracles, credential and network analysis, limits. |
| `servers/` | One data spec per real server — what it declares, what it is given, which calls are made, what must then be true. |
| `calibration/` | The two lying servers and the answer key that must be reproduced exactly. |
| `measure.ts` | Installs, launches the sealed session, folds in the findings, writes the result — and enforces the gate. |

## Disclosure

Two kinds of finding are held back: a **security boundary that failed** (a folder
escape, an allowlist bypass) and an **undeclared credential read**. When one
turns up, the maintainer is told privately and the page for that server is held
for thirty days before it publishes. Everything else — a server that phones
home, a tool that is offered but not documented, a reply that overstates what
happened — publishes the day the page goes up, with an open invitation to the
maintainer to respond.

**Maintainers:** if a page reads your server wrong, or you want to answer a
finding, [open an issue](https://github.com/contactkontey-dotcom/brydge-mcp-measurements/issues/new) here. Every server page links to
one. Responses stay public, next to the code and the raw records the page was
built from; where we are wrong, the spec is corrected and the server is measured
again, and the page follows.

## Licence

MIT. The measurements are BRYDGE's; the method and the code are yours to check.
