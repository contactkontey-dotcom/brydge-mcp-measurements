# @contentrain/mcp 3.11.21 — Level 1 measurement

Measured 2026-10-31. Asked for `@contentrain/mcp@3.11.21`. Instrument fingerprint `ca9170dfaeae`.

Published on npm as `@contentrain/mcp`. Its own manifest points at https://github.com/Contentrain/ai, which is what the package says about itself and is not checked here.

**This is not a ranking of the most-used servers.** This package was measured because it appeared in a candidate list built from registry searches, and the order of those searches is not a measure of use.

**Level 1, and not calibration-backed.** No tool was called, so this report makes no claim about any tool doing what it says. The calibration that backs the ten curated measurements proves the instrument catches planted claims about what a tool *did*; Level 1 runs no such checks, and reads the package's own documentation by a stated rule rather than by a person, so nothing in that calibration speaks to this page.

## In plain words

We installed `@contentrain/mcp 3.11.21` from the npm registry, started it in a room with no route to the internet, where every website name answers to this machine and every credential is fake, and asked it to list its tools without calling any of them. Before any tool was used it offered 22 tools, looked up 0 websites, started 2 programs and wrote 0 files; of those, 0 tools and 0 websites are not named in its own README. We called no tool and read the contents of no encrypted connection, so this page says nothing about whether any of its tools does what it says.

## The standard this report uses

**A website counts as declared only if the README names it.**

A sentence about connecting somewhere, without the address, names no website. A tool counts as documented only if its name appears in the README as a whole word. Each question is asked once per thing observed, so what the README documents is never worked out from what the program offered — which is the only way "offered but not documented" can be found at all.

The host rule is loose in one direction, and it is better to say so: it reads any dotted name whose last part is two or more letters, so a filename written in prose can read as a website. That can only make the declared list longer and leave something out of the findings below. It cannot put something in.

## What it did at startup, before any tool was used

It started and identified itself as `contentrain-mcp 3.11.21`.

| | |
| --- | --- |
| Websites it looked up | none |
| Encrypted connections it opened | none |
| Other addresses it tried | none |
| Programs it started | `contentrain-mcp`, `node`, `setpriv` |
| Files it wrote | none |
| Package-manager commands it ran | none |
| Tools it offered | 22 |

`setpriv` in that list is the harness's own launcher, not the package's doing.

## Tools it offers, against its own README

It offered 22 tools. 22 of them are named in `README.md`.

Every tool it offered is named in the README.

## Websites it reached for, against its own README

It reached for no website at startup.

## Names in the README that it did not offer

24 names written in backticks in the README look like a tool name and were not among the tools it offered. A README mentions plenty of things that are not tools, so this is a weaker signal than the two above and is listed rather than counted as a finding:

- `base_branch` — README.md line 70: `- every local write's 'git' block names the resolved 'base_branch'; when it is not the checked-out branch, the result's 'warning' says your working tree was left alone`
- `content_delete` — README.md line 82: `…afe subset — 'status', 'describe', 'describe_format', 'model_save', 'model_delete', 'content_save', 'content_delete', 'content_list', 'vocabulary_save', 'vocabulary_delete', 'validate'. The requiremen…`
- `content_list` — README.md line 82: `…us', 'describe', 'describe_format', 'model_save', 'model_delete', 'content_save', 'content_delete', 'content_list', 'vocabulary_save', 'vocabulary_delete', 'validate'. The requirement map lives in 'TO…`
- `content_save` — README.md line 82: `…nly the remote-safe subset — 'status', 'describe', 'describe_format', 'model_save', 'model_delete', 'content_save', 'content_delete', 'content_list', 'vocabulary_save', 'vocabulary_delete', 'validate'…`
- `content_source` — README.md line 67: `…hecked-out feature branch, which writes do not update, '.contentrain/**' is read from the 'contentrain' ref instead (source files still from the working tree); read tools report it as 'content_source'`
- `contentrain_media_delete` — README.md line 112: `| 'contentrain_media_delete' | Delete an asset from the media stack | — | **Yes** |`
- `contentrain_media_get` — README.md line 109: `| 'contentrain_media_get' | Get one media asset by id | Yes | — |`
- `contentrain_media_ingest` — README.md line 80: `… ('readOnlyHint', 'destructiveHint', 'idempotentHint', and 'openWorldHint: false' everywhere except 'contentrain_media_ingest', which fetches a caller-supplied URL server-side) for client safety hints…`
- `contentrain_media_list` — README.md line 108: `| 'contentrain_media_list' | List media assets (search, tag filter, cursor pagination) | Yes | — |`
- `contentrain_media_update` — README.md line 111: `| 'contentrain_media_update' | Update asset metadata (alt, tags, filename) | — | — |`
- `default_branch` — README.md line 65: `- baseBranch = 'CONTENTRAIN_BRANCH' env → 'repository.default_branch' → remote HEAD → 'main' → 'master' → checked-out branch → 'main' (fallback). A write made on a feature branch never merges, moves o…`
- `describe_format` — README.md line 82: `…ovider (GitHub/GitLab, no local checkout) lists only the remote-safe subset — 'status', 'describe', 'describe_format', 'model_save', 'model_delete', 'content_save', 'content_delete', 'content_list', '…`
- `dry_run` — README.md line 105: `| 'contentrain_bulk' | Bulk locale copy, status updates, and deletes ('dry_run' previews) | — | — |`
- `model_delete` — README.md line 82: `…heckout) lists only the remote-safe subset — 'status', 'describe', 'describe_format', 'model_save', 'model_delete', 'content_save', 'content_delete', 'content_list', 'vocabulary_save', 'vocabulary_del…`
- `model_save` — README.md line 82: `…ab, no local checkout) lists only the remote-safe subset — 'status', 'describe', 'describe_format', 'model_save', 'model_delete', 'content_save', 'content_delete', 'content_list', 'vocabulary_save', '…`
- `next_steps` — README.md line 151: `…'s 'git' block reports 'remote_push: "disabled"' with 'remote_note: "not pushed (local mode)"', and 'next_steps' carries a 'LOCAL MODE' line. 'contentrain_submit' returns an error instead of pushing; …`
- `node_modules` — README.md line 155: `…. That keeps existing projects working: these commits are made in a temporary worktree without your 'node_modules', and their '[contentrain] …' subject fails a strict commitlint. Merges still run the …`
- `preserved_blocks` — README.md line 432: `tool does not enable or change them. Its response lists 'preserved_blocks' when`
- `remote_note` — README.md line 151: `It is never a silent success. Each write's 'git' block reports 'remote_push: "disabled"' with 'remote_note: "not pushed (local mode)"', and 'next_steps' carries a 'LOCAL MODE' line. 'contentrain_submi…`
- `remote_push` — README.md line 151: `It is never a silent success. Each write's 'git' block reports 'remote_push: "disabled"' with 'remote_note: "not pushed (local mode)"', and 'next_steps' carries a 'LOCAL MODE' line. 'contentrain_submi…`
- …and 4 more

## What this report does not say

- **It judges no tool.** Level 1 calls none, so no claim any tool makes is tested here.
- **It is one run, once.** A program that behaves one way while being watched and another way otherwise would produce this same page.
- **It ran with no route off the machine**, so anything that only happens after a connection succeeds did not happen.
- **Encrypted traffic was not read.** The name it asked for is recorded; the contents are not, and would not be even with a route.
- **"Declared" means named in the README**, nothing more. Only the README file that shipped in the package was read. A package that documents its tools or its destinations somewhere else — a reference file beside the README, a privacy policy, a wiki, its source — will show every one of them above as not named, which is a fact about this rule and not about the package.
- **It is not calibration-backed**, for the reason at the top.
- **It is not a ranking.** No page here says a server is more used, better or worse than another, and the set measured is whatever the candidate searches returned.
- **The harness is BRYDGE's own**, and BRYDGE has an interest in the question of whether tools do what they say.

Evidence: `README.md` (434 lines, sha256 `fee6156b2cd2`), package integrity `sha512-u3A5dSTS5MIhL3K/s…`.
