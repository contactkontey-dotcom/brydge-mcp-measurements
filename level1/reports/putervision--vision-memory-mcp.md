# @putervision/vision-memory-mcp 1.4.2 — Level 1 measurement

Measured 2026-10-31. Asked for `@putervision/vision-memory-mcp@1.4.2`. Instrument fingerprint `ca9170dfaeae`.

Published on npm as `@putervision/vision-memory-mcp`. Its own manifest points at https://github.com/putervision/vision-memory-mcp, which is what the package says about itself and is not checked here.

**This is not a ranking of the most-used servers.** This package was measured because it appeared in a candidate list built from registry searches, and the order of those searches is not a measure of use.

**Level 1, and not calibration-backed.** No tool was called, so this report makes no claim about any tool doing what it says. The calibration that backs the ten curated measurements proves the instrument catches planted claims about what a tool *did*; Level 1 runs no such checks, and reads the package's own documentation by a stated rule rather than by a person, so nothing in that calibration speaks to this page.

## In plain words

We installed `@putervision/vision-memory-mcp 1.4.2` from the npm registry, started it in a room with no route to the internet, where every website name answers to this machine and every credential is fake, and asked it to list its tools without calling any of them. Before any tool was used it offered 15 tools, looked up 1 website, started 2 programs and wrote 0 files; of those, 0 tools and 1 website are not named in its own README. We called no tool and read the contents of no encrypted connection, so this page says nothing about whether any of its tools does what it says.

## The standard this report uses

**A website counts as declared only if the README names it.**

A sentence about connecting somewhere, without the address, names no website. A tool counts as documented only if its name appears in the README as a whole word. Each question is asked once per thing observed, so what the README documents is never worked out from what the program offered — which is the only way "offered but not documented" can be found at all.

The host rule is loose in one direction, and it is better to say so: it reads any dotted name whose last part is two or more letters, so a filename written in prose can read as a website. That can only make the declared list longer and leave something out of the findings below. It cannot put something in.

## What it did at startup, before any tool was used

It started and identified itself as `vision-memory-mcp 1.4.2`.

| | |
| --- | --- |
| Websites it looked up | `huggingface.co` |
| Encrypted connections it opened | `huggingface.co` |
| Other addresses it tried | none |
| Programs it started | `node`, `setpriv`, `vision-memory-mcp` |
| Files it wrote | none |
| Package-manager commands it ran | none |
| Tools it offered | 15 |

`setpriv` in that list is the harness's own launcher, not the package's doing.

Nothing left the machine. The room it runs in has no route off the host, so every name resolved to the loopback address and no connection completed. What it would have sent is therefore unknown — and what it would have sent over an encrypted connection would be unknown even with a route, which is a limit of the method rather than of this run.

## Tools it offers, against its own README

It offered 15 tools. 15 of them are named in `README.md`.

Every tool it offered is named in the README.

## Websites it reached for, against its own README

It reached for 1 website. 1 of them is not named anywhere in `README.md`:

- **huggingface.co**
  - looked up "huggingface.co" during the run; answered 127.0.0.1, so nothing left the machine
  - opened TLS with SNI "huggingface.co"; the bytes are encrypted and were not seen
  - absent from README.md (186 lines, sha256 cbcbd104fa1d…): the README does not contain this hostname

The README uses the words "telemetry" — README.md lines 98 and 184; the first reads `- **🛡️ 100% Local-First Privacy**: Local LanceDB vector store, local CLIP model, zero cloud telemetry, and PII redaction guarantees.`; and "analytics" — README.md line 184; it reads `…ots, perceptual hashes, vector embeddings, and transition graphs are stored locally unencrypted at the application level in '.vision-memory-mcp/'. Zero telemetry or analytics data is ever transmitted.`. Stated here because it is in the document. This report does not decide whether it accounts for the websites above.

## Names in the README that it did not offer

1 name written in backticks in the README looks like a tool name and was not among the tools it offered. A README mentions plenty of things that are not tools, so this is a weaker signal than the two above and is listed rather than counted as a finding:

- `compact_slice` — README.md line 90: `- **👁️ Perceptual Visual Caching & Compact Slices**: Sub-5ms L1/L2 dHash zero-token fast-path layout recognition and sub-1KB 'compact_slice' export for Pentad System 1 StatePack assembly.`

## What this report does not say

- **It judges no tool.** Level 1 calls none, so no claim any tool makes is tested here.
- **It is one run, once.** A program that behaves one way while being watched and another way otherwise would produce this same page.
- **It ran with no route off the machine**, so anything that only happens after a connection succeeds did not happen.
- **Encrypted traffic was not read.** The name it asked for is recorded; the contents are not, and would not be even with a route.
- **"Declared" means named in the README**, nothing more. Only the README file that shipped in the package was read. A package that documents its tools or its destinations somewhere else — a reference file beside the README, a privacy policy, a wiki, its source — will show every one of them above as not named, which is a fact about this rule and not about the package.
- **It is not calibration-backed**, for the reason at the top.
- **It is not a ranking.** No page here says a server is more used, better or worse than another, and the set measured is whatever the candidate searches returned.
- **The harness is BRYDGE's own**, and BRYDGE has an interest in the question of whether tools do what they say.

Evidence: `README.md` (186 lines, sha256 `cbcbd104fa1d`), package integrity `sha512-s8MZZNdiK4prWF2L3…`.
