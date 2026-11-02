# @wonderwhy-er/desktop-commander 0.3.1 — Level 1 measurement

Measured 2026-11-02. Asked for `@wonderwhy-er/desktop-commander@0.3.1`. Instrument fingerprint `ca9170dfaeae`.

Published on npm as `@wonderwhy-er/desktop-commander`. Its own manifest points at https://github.com/wonderwhy-er/DesktopCommanderMCP, which is what the package says about itself and is not checked here.

**This is not a ranking of the most-used servers.** This package was measured because it appeared in a candidate list built from registry searches, and the order of those searches is not a measure of use.

**Level 1, and not calibration-backed.** No tool was called, so this report makes no claim about any tool doing what it says. The calibration that backs the ten curated measurements proves the instrument catches planted claims about what a tool *did*; Level 1 runs no such checks, and reads the package's own documentation by a stated rule rather than by a person, so nothing in that calibration speaks to this page.

## In plain words

We installed `@wonderwhy-er/desktop-commander 0.3.1` from the npm registry, started it in a room with no route to the internet, where every website name answers to this machine and every credential is fake, and asked it to list its tools without calling any of them. Before any tool was used it offered 25 tools, looked up 4 websites, started 3 programs and wrote 0 files; of those, 0 tools and 3 websites are not named in its own README. From starting to answering with that list took about 2.0 s, measured once and while being watched, which makes it slower than it would be otherwise. We called no tool and read the contents of no encrypted connection, so this page says nothing about whether any of its tools does what it says.

## The standard this report uses

**A website counts as declared only if the README names it.**

A sentence about connecting somewhere, without the address, names no website. A tool counts as documented only if its name appears in the README as a whole word. Each question is asked once per thing observed, so what the README documents is never worked out from what the program offered — which is the only way "offered but not documented" can be found at all.

The host rule is loose in one direction, and it is better to say so: it reads any dotted name whose last part is two or more letters, so a filename written in prose can read as a website. That can only make the declared list longer and leave something out of the findings below. It cannot put something in.

## What it did at startup, before any tool was used

It started and identified itself as `desktop-commander 0.3.1`.

| | |
| --- | --- |
| Websites it looked up | `dc-telemetry-proxy-83847352264.europe-west1.run.app`, `desktopcommander.app`, `googlechromelabs.github.io`, `telemetry.desktopcommander.app` |
| Encrypted connections it opened | `dc-telemetry-proxy-83847352264.europe-west1.run.app`, `desktopcommander.app`, `googlechromelabs.github.io`, `telemetry.desktopcommander.app` |
| Other addresses it tried | none |
| Programs it started | `desktop-commander`, `node`, `python3`, `setpriv` |
| Files it wrote | none |
| Package-manager commands it ran | none |
| Tools it offered | 25 |
| Time to answer (approximate) | 2.0 s |

**Time to answer is approximate.** It is 2.0 s measured once, from the moment this harness handed the process to an unprivileged user to the timestamp on its reply listing its tools; 1.9 s of that was reaching the end of the opening handshake, and listing the tools took the remaining 98 ms. The process ran under a kernel tracer that stops it at every file it opens, so this is slower than the same start untraced, by an amount not measured and not estimated here. It includes whatever runtime the package brings with it. One run, one version, one machine: there is no second run, so there is no spread to quote and the figure carries no error bar.

`setpriv` in that list is the harness's own launcher, not the package's doing.

Nothing left the machine. The room it runs in has no route off the host, so every name resolved to the loopback address and no connection completed. What it would have sent is therefore unknown — and what it would have sent over an encrypted connection would be unknown even with a route, which is a limit of the method rather than of this run.

## Tools it offers, against its own README

It offered 25 tools. 25 of them are named in `README.md`.

Every tool it offered is named in the README.

## Websites it reached for, against its own README

It reached for 4 websites. 3 of them are not named anywhere in `README.md`:

- **dc-telemetry-proxy-83847352264.europe-west1.run.app**
  - looked up "dc-telemetry-proxy-83847352264.europe-west1.run.app" during the run; answered 127.0.0.1, so nothing left the machine
  - opened TLS with SNI "dc-telemetry-proxy-83847352264.europe-west1.run.app"; the bytes are encrypted and were not seen
  - absent from README.md (1153 lines, sha256 f812befad126…): the README does not contain this hostname
- **googlechromelabs.github.io**
  - looked up "googlechromelabs.github.io" during the run; answered 127.0.0.1, so nothing left the machine
  - opened TLS with SNI "googlechromelabs.github.io"; the bytes are encrypted and were not seen
  - absent from README.md (1153 lines, sha256 f812befad126…): the README does not contain this hostname
- **telemetry.desktopcommander.app**
  - looked up "telemetry.desktopcommander.app" during the run; answered 127.0.0.1, so nothing left the machine
  - opened TLS with SNI "telemetry.desktopcommander.app"; the bytes are encrypted and were not seen
  - absent from README.md (1153 lines, sha256 f812befad126…): the README does not contain this hostname

The README uses the words "telemetry" — README.md lines 576, 787, 818, 1139 and 1143; the first reads `…'fileReadLineLimit': Maximum lines to read at once (default: 1000)<br>• 'fileWriteLineLimit': Maximum lines to write at once (default: 50)<br>• 'telemetryEnabled': Enable/disable telemetry (boolean) |`; and "analytics" — README.md line 597; it reads `| **Analytics** | 'get_usage_stats' | Get usage statistics for your own insight |`. Stated here because it is in the document. This report does not decide whether it accounts for the websites above.

## Names in the README that it did not offer

9 names written in backticks in the README look like a tool name and were not among the tools it offered. A README mentions plenty of things that are not tools, so this is a weaker signal than the two above and is listed rather than counted as a finding:

- `claude_desktop_config` — README.md line 149: `- On Mac: '~/Library/Application Support/Claude/claude_desktop_config.json'`
- `claude_tool_call` — README.md line 789: `### 'claude_tool_call.log' — local argument log`
- `claude_tool_call_2026` — README.md line 793: `…ive file rotates when it reaches 10 MB. The previous file is renamed using a timestamp, for example 'claude_tool_call_2026-09-07_14-32-10.log', and a new 'claude_tool_call.log' is created. Rotated fil…`
- `execute_command` — README.md line 945: `1. 'execute_command' returns after timeout with initial output`
- `expected_replacements` — README.md line 647: `4. **Multiple Occurrence Support**: Can replace multiple instances with 'expected_replacements' parameter`
- `mcp_config` — README.md line 337: `Add to '~/.codeium/windsurf/mcp_config.json'. See [Windsurf MCP docs](https://docs.windsurf.com/windsurf/cascade/mcp) for more info.`
- `mcp_remote_calls` — README.md line 816: `… files above. The Remote Desktop Commander service temporarily stores tool arguments and results in 'mcp_remote_calls' so calls can be routed and completed. Terminal rows are automatically swept short…`
- `read_output` — README.md line 947: `3. Use 'read_output' with PID to get new output`
- `track_ui_event` — README.md line 808: `- 'get_recent_tool_calls' and 'track_ui_event' are excluded from this JSONL history.`

## What this report does not say

- **It judges no tool.** Level 1 calls none, so no claim any tool makes is tested here.
- **It is one run, once.** A program that behaves one way while being watched and another way otherwise would produce this same page.
- **It ran with no route off the machine**, so anything that only happens after a connection succeeds did not happen.
- **Encrypted traffic was not read.** The name it asked for is recorded; the contents are not, and would not be even with a route.
- **"Declared" means named in the README**, nothing more. Only the README file that shipped in the package was read. A package that documents its tools or its destinations somewhere else — a reference file beside the README, a privacy policy, a wiki, its source — will show every one of them above as not named, which is a fact about this rule and not about the package.
- **It is not calibration-backed**, for the reason at the top.
- **It is not a ranking.** No page here says a server is more used, better or worse than another, and the set measured is whatever the candidate searches returned.
- **The harness is BRYDGE's own**, and BRYDGE has an interest in the question of whether tools do what they say.

Evidence: `README.md` (1153 lines, sha256 `f812befad126`), package integrity `sha512-cx7KTscLF951adHmD…`.
