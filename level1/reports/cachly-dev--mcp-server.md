# @cachly-dev/mcp-server 0.10.218 — Level 1 measurement

Measured 2026-10-31. Asked for `@cachly-dev/mcp-server@0.10.218`. Instrument fingerprint `ca9170dfaeae`.

Published on npm as `@cachly-dev/mcp-server`. Its own manifest points at https://github.com/cachly-dev/cachly-mcp, which is what the package says about itself and is not checked here.

**This is not a ranking of the most-used servers.** This package was measured because it appeared in a candidate list built from registry searches, and the order of those searches is not a measure of use.

**Level 1, and not calibration-backed.** No tool was called, so this report makes no claim about any tool doing what it says. The calibration that backs the ten curated measurements proves the instrument catches planted claims about what a tool *did*; Level 1 runs no such checks, and reads the package's own documentation by a stated rule rather than by a person, so nothing in that calibration speaks to this page.

## In plain words

We installed `@cachly-dev/mcp-server 0.10.218` from the npm registry, started it in a room with no route to the internet, where every website name answers to this machine and every credential is fake, and asked it to list its tools without calling any of them. Before any tool was used it offered 27 tools, looked up 2 websites, started 2 programs and wrote 0 files; of those, 8 tools and 1 website are not named in its own README. We called no tool and read the contents of no encrypted connection, so this page says nothing about whether any of its tools does what it says.

## The standard this report uses

**A website counts as declared only if the README names it.**

A sentence about connecting somewhere, without the address, names no website. A tool counts as documented only if its name appears in the README as a whole word. Each question is asked once per thing observed, so what the README documents is never worked out from what the program offered — which is the only way "offered but not documented" can be found at all.

The host rule is loose in one direction, and it is better to say so: it reads any dotted name whose last part is two or more letters, so a filename written in prose can read as a website. That can only make the declared list longer and leave something out of the findings below. It cannot put something in.

## What it did at startup, before any tool was used

It started and identified itself as `cachly-mcp 0.10.218`.

| | |
| --- | --- |
| Websites it looked up | `api.cachly.dev`, `registry.npmjs.org` |
| Encrypted connections it opened | `registry.npmjs.org` |
| Other addresses it tried | none |
| Programs it started | `cachly-mcp`, `node`, `setpriv` |
| Files it wrote | none |
| Package-manager commands it ran | none |
| Tools it offered | 27 |

`setpriv` in that list is the harness's own launcher, not the package's doing.

Nothing left the machine. The room it runs in has no route off the host, so every name resolved to the loopback address and no connection completed. What it would have sent is therefore unknown — and what it would have sent over an encrypted connection would be unknown even with a route, which is a limit of the method rather than of this run.

## Tools it offers, against its own README

It offered 27 tools. 19 of them are named in `README.md`.

8 tools it offered are not:

- **brain_doctor**
  - offered in tools/list by @cachly-dev/mcp-server@0.10.218
  - absent from README.md (504 lines, sha256 529996528a0c…): no whole-word match for "brain_doctor"
- **brain_search**
  - offered in tools/list by @cachly-dev/mcp-server@0.10.218
  - absent from README.md (504 lines, sha256 529996528a0c…): no whole-word match for "brain_search"
- **forget_context**
  - offered in tools/list by @cachly-dev/mcp-server@0.10.218
  - absent from README.md (504 lines, sha256 529996528a0c…): no whole-word match for "forget_context"
- **list_remembered**
  - offered in tools/list by @cachly-dev/mcp-server@0.10.218
  - absent from README.md (504 lines, sha256 529996528a0c…): no whole-word match for "list_remembered"
- **recall_context**
  - offered in tools/list by @cachly-dev/mcp-server@0.10.218
  - absent from README.md (504 lines, sha256 529996528a0c…): no whole-word match for "recall_context"
- **roadmap_list**
  - offered in tools/list by @cachly-dev/mcp-server@0.10.218
  - absent from README.md (504 lines, sha256 529996528a0c…): no whole-word match for "roadmap_list"
- **roadmap_update**
  - offered in tools/list by @cachly-dev/mcp-server@0.10.218
  - absent from README.md (504 lines, sha256 529996528a0c…): no whole-word match for "roadmap_update"
- **session_handoff**
  - offered in tools/list by @cachly-dev/mcp-server@0.10.218
  - absent from README.md (504 lines, sha256 529996528a0c…): no whole-word match for "session_handoff"

## Websites it reached for, against its own README

It reached for 2 websites. 1 of them is not named anywhere in `README.md`:

- **registry.npmjs.org**
  - looked up "registry.npmjs.org" during the run; answered 127.0.0.1, so nothing left the machine
  - opened TLS with SNI "registry.npmjs.org"; the bytes are encrypted and were not seen
  - absent from README.md (504 lines, sha256 529996528a0c…): the README does not contain this hostname

## Names in the README that it did not offer

42 names written in backticks in the README look like a tool name and were not among the tools it offered. A README mentions plenty of things that are not tools, so this is a weaker signal than the two above and is listed rather than counted as a finding:

- `brain_collab_pairs` — README.md line 180: `| **'brain_collab_pairs'** | Who works with whom, with bus-factor alerts |`
- `brain_coverage` — README.md line 183: `| **'brain_coverage'** | A 0–100 health score for the knowledge of your codebase |`
- `brain_discover` — README.md line 217: `| **'brain_discover'** | Search the Brain marketplace for ready-made knowledge bases |`
- `brain_file_map` — README.md line 178: `| **'brain_file_map'** | Experts and lessons per file, before you touch it |`
- `brain_from_ci` — README.md line 195: `| **'brain_from_ci'** | Bulk-ingest CI outcomes: red→green becomes a fix lesson with a causal 'fixes' edge, green→red a 'causes' edge |`
- `brain_import` — README.md line 215: `| **'brain_import'** | Import a shared Brain into yours: 'topic_prefix', 'min_confidence', 'dry_run' |`
- `brain_install` — README.md line 224: `| 'brain_marketplace' / 'brain_install' | Browse and install curated Domain Brains (Kubernetes, Auth, databases) |`
- `brain_marketplace` — README.md line 224: `| 'brain_marketplace' / 'brain_install' | Browse and install curated Domain Brains (Kubernetes, Auth, databases) |`
- `brain_portability` — README.md line 181: `| **'brain_portability'** | Config snippets for 7 MCP clients, so the same Brain serves any model |`
- `brain_predict_failures` — README.md line 193: `| **'brain_predict'** / 'brain_predict_failures' | Predict likely failures before they happen |`
- `brain_seed_starter` — README.md line 213: `| **'brain_seed_starter'** | Seed 16 universal lessons so your first 'smart_recall' finds something; runs on a fresh repo |`
- `brain_share` — README.md line 214: `| **'brain_share'** | Publish a Brain snapshot as a link (public or unlisted). For your own data, run 'npx @cachly-dev/mcp-server export' |`
- `brain_share_list` — README.md line 216: `| 'brain_share_list' / 'brain_unshare' | List your shares; revoke one so the link goes dead |`
- `brain_unshare` — README.md line 216: `| 'brain_share_list' / 'brain_unshare' | List your shares; revoke one so the link goes dead |`
- `brain_who_knows` — README.md line 177: `| **'brain_who_knows'** | Find your team's experts on a topic, ranked from authorship |`
- `cache_org_stats` — README.md line 226: `| 'cache_stats' / 'cache_org_stats' | Hits, estimated USD saved and a monthly projection, per instance or across your org |`
- `cache_stats` — README.md line 226: `| 'cache_stats' / 'cache_org_stats' | Hits, estimated USD saved and a monthly projection, per instance or across your org |`
- `ckg_inspect` — README.md line 197: `| 'ckg_inspect' | Inspect the causal graph around a concept |`
- `cky_live_xxx` — README.md line 359: `| 'CACHLY_JWT=cky_live_xxx npx ... autosetup' | Skips the sign-in step and uses the key you pass |`
- `compact_recover` — README.md line 167: `| **'compact_recover'** | Recover your context after you hit the context-window limit |`
- …and 22 more

## What this report does not say

- **It judges no tool.** Level 1 calls none, so no claim any tool makes is tested here.
- **It is one run, once.** A program that behaves one way while being watched and another way otherwise would produce this same page.
- **It ran with no route off the machine**, so anything that only happens after a connection succeeds did not happen.
- **Encrypted traffic was not read.** The name it asked for is recorded; the contents are not, and would not be even with a route.
- **"Declared" means named in the README**, nothing more. Only the README file that shipped in the package was read. A package that documents its tools or its destinations somewhere else — a reference file beside the README, a privacy policy, a wiki, its source — will show every one of them above as not named, which is a fact about this rule and not about the package.
- **It is not calibration-backed**, for the reason at the top.
- **It is not a ranking.** No page here says a server is more used, better or worse than another, and the set measured is whatever the candidate searches returned.
- **The harness is BRYDGE's own**, and BRYDGE has an interest in the question of whether tools do what they say.

Evidence: `README.md` (504 lines, sha256 `529996528a0c`), package integrity `sha512-/wjnxdUNCgcWUOWYZ…`.
