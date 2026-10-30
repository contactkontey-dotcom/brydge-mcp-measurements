# @upstash/context7-mcp 4.4.4 — Level 1 measurement

Measured 2026-10-30. Asked for `@upstash/context7-mcp@4.4.4`. Instrument fingerprint `ca9170dfaeae`.

**Level 1, and not calibration-backed.** No tool was called, so this report makes no claim about any tool doing what it says. The calibration that backs the ten curated measurements proves the instrument catches planted claims about what a tool *did*; Level 1 runs no such checks, and reads the package's own documentation by a stated rule rather than by a person, so nothing in that calibration speaks to this page.

## In plain words

We installed `@upstash/context7-mcp 4.4.4` from the npm registry, started it in a room with no route to the internet, where every website name answers to this machine and every credential is fake, and asked it to list its tools without calling any of them. Before any tool was used it offered 2 tools, looked up 0 websites, started 2 programs and wrote 0 files; of those, 0 tools and 0 websites are not named in its own README. We called no tool and read the contents of no encrypted connection, so this page says nothing about whether any of its tools does what it says.

## The standard this report uses

**A website counts as declared only if the README names it.**

A sentence about connecting somewhere, without the address, names no website. A tool counts as documented only if its name appears in the README as a whole word. Each question is asked once per thing observed, so what the README documents is never worked out from what the program offered — which is the only way "offered but not documented" can be found at all.

The host rule is loose in one direction, and it is better to say so: it reads any dotted name whose last part is two or more letters, so a filename written in prose can read as a website. That can only make the declared list longer and leave something out of the findings below. It cannot put something in.

## What it did at startup, before any tool was used

It started and identified itself as `Context7 4.4.4`.

| | |
| --- | --- |
| Websites it looked up | none |
| Encrypted connections it opened | none |
| Other addresses it tried | none |
| Programs it started | `context7-mcp`, `node`, `setpriv` |
| Files it wrote | none |
| Package-manager commands it ran | none |
| Tools it offered | 2 |

`setpriv` in that list is the harness's own launcher, not the package's doing.

## Tools it offers, against its own README

It offered 2 tools. 2 of them are named in `README.md`.

Every tool it offered is named in the README.

## Websites it reached for, against its own README

It reached for no website at startup.

The README uses the word "telemetry" — README.md lines 1496, 1498 and 1506; the first reads `dispatch remain visible in normal HTTP/gateway telemetry, but are not reported as MCP operations.`. Stated here because it is in the document. This report does not decide whether it accounts for the websites above.

## Names in the README that it did not offer

21 names written in backticks in the README look like a tool name and were not among the tools it offered. A README mentions plenty of things that are not tools, so this is a weaker signal than the two above and is listed rather than counted as a finding:

- `claude_desktop_config` — README.md line 580: `Open Claude Desktop developer settings and edit your 'claude_desktop_config.json' file to add the following configuration. See [Claude Desktop MCP docs](https://modelcontextprotocol.io/quickstart/user…`
- `context7_mcp_authentication_active` — README.md line 1548: `- 'context7_mcp_upstream_requests_active' and 'context7_mcp_authentication_active'`
- `context7_mcp_authentication_attempts_total` — README.md line 1544: `- 'context7_mcp_authentication_attempts_total' and 'context7_mcp_authentication_duration'`
- `context7_mcp_authentication_duration` — README.md line 1544: `- 'context7_mcp_authentication_attempts_total' and 'context7_mcp_authentication_duration'`
- `context7_mcp_authentication_events_total` — README.md line 1545: `- 'context7_mcp_authentication_events_total' for bounded authentication lifecycle events such as`
- `context7_mcp_operations_active` — README.md line 1541: `- 'context7_mcp_operations_active'`
- `context7_mcp_subscription_duration` — README.md line 1542: `- 'context7_mcp_subscriptions_active' and 'context7_mcp_subscription_duration'`
- `context7_mcp_subscriptions_active` — README.md line 1542: `- 'context7_mcp_subscriptions_active' and 'context7_mcp_subscription_duration'`
- `context7_mcp_tool_outcome` — README.md line 1538: `series include the 'context7_mcp_tool_outcome' label)`
- `context7_mcp_upstream_request_duration` — README.md line 1543: `- 'context7_mcp_upstream_requests_total' and 'context7_mcp_upstream_request_duration'`
- `context7_mcp_upstream_requests_active` — README.md line 1548: `- 'context7_mcp_upstream_requests_active' and 'context7_mcp_authentication_active'`
- `context7_mcp_upstream_requests_total` — README.md line 1543: `- 'context7_mcp_upstream_requests_total' and 'context7_mcp_upstream_request_duration'`
- `https_proxy` — README.md line 1410: `If you are behind an HTTP proxy, Context7 uses the standard 'https_proxy' / 'HTTPS_PROXY' environment variables.`
- `mcp_server_operation_duration` — README.md line 1537: `- 'mcp_server_operation_duration' (its '_count' series is the MCP operation count, and tool-call`
- `mcp_server_operation_duration_count` — README.md line 1573: `Do not treat 'mcp_server_operation_duration_count' as another HTTP request counter. An Envoy`
- `mcp_server_session_duration` — README.md line 1539: `- 'mcp_server_session_duration' for real stateful stdio sessions (stateless HTTP request transports`
- `mcp_settings` — README.md line 358: `- **Global MCP Configuration** — stored in 'mcp_settings.json'`
- `not_found` — README.md line 1552: `Tool outcomes on the standard MCP operation metric distinguish 'success', 'not_found', and`
- `startup_timeout_ms` — README.md line 657: `> - First try: increase 'startup_timeout_ms' to '40_000' and retry.`
- `v8js_gc_duration` — README.md line 1549: `- 'nodejs_eventloop_*', 'v8js_gc_duration', 'v8js_memory_heap_*', and`
- …and 1 more

## What this report does not say

- **It judges no tool.** Level 1 calls none, so no claim any tool makes is tested here.
- **It is one run, once.** A program that behaves one way while being watched and another way otherwise would produce this same page.
- **It ran with no route off the machine**, so anything that only happens after a connection succeeds did not happen.
- **Encrypted traffic was not read.** The name it asked for is recorded; the contents are not, and would not be even with a route.
- **"Declared" means named in the README**, nothing more. Only the README file that shipped in the package was read. A package that documents its tools or its destinations somewhere else — a reference file beside the README, a privacy policy, a wiki, its source — will show every one of them above as not named, which is a fact about this rule and not about the package.
- **It is not calibration-backed**, for the reason at the top.
- **The harness is BRYDGE's own**, and BRYDGE has an interest in the question of whether tools do what they say.

Evidence: `README.md` (1789 lines, sha256 `1a17a51b1812`), package integrity `sha512-T2DkjhweDnC2mRAcl…`.
