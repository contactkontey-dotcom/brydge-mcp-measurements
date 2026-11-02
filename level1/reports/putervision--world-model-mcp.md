# @putervision/world-model-mcp 0.6.1 — Level 1 measurement

Measured 2026-11-02. Asked for `@putervision/world-model-mcp@0.6.1`. Instrument fingerprint `ca9170dfaeae`.

Published on npm as `@putervision/world-model-mcp`. Its own manifest points at https://github.com/putervision/world-model-mcp, which is what the package says about itself and is not checked here.

**This is not a ranking of the most-used servers.** This package was measured because it appeared in a candidate list built from registry searches, and the order of those searches is not a measure of use.

**Level 1, and not calibration-backed.** No tool was called, so this report makes no claim about any tool doing what it says. The calibration that backs the ten curated measurements proves the instrument catches planted claims about what a tool *did*; Level 1 runs no such checks, and reads the package's own documentation by a stated rule rather than by a person, so nothing in that calibration speaks to this page.

## In plain words

We installed `@putervision/world-model-mcp 0.6.1` from the npm registry, started it in a room with no route to the internet, where every website name answers to this machine and every credential is fake, and asked it to list its tools without calling any of them. Before any tool was used it offered 15 tools, looked up 0 websites, started 2 programs and wrote 0 files; of those, 0 tools and 0 websites are not named in its own README. From starting to answering with that list took about 336 ms, measured once and while being watched, which makes it slower than it would be otherwise. We called no tool and read the contents of no encrypted connection, so this page says nothing about whether any of its tools does what it says.

## The standard this report uses

**A website counts as declared only if the README names it.**

A sentence about connecting somewhere, without the address, names no website. A tool counts as documented only if its name appears in the README as a whole word. Each question is asked once per thing observed, so what the README documents is never worked out from what the program offered — which is the only way "offered but not documented" can be found at all.

The host rule is loose in one direction, and it is better to say so: it reads any dotted name whose last part is two or more letters, so a filename written in prose can read as a website. That can only make the declared list longer and leave something out of the findings below. It cannot put something in.

## What it did at startup, before any tool was used

It started and identified itself as `io.github.putervision/world-model-mcp 0.6.1`.

| | |
| --- | --- |
| Websites it looked up | none |
| Encrypted connections it opened | none |
| Other addresses it tried | none |
| Programs it started | `node`, `setpriv`, `world-model-mcp` |
| Files it wrote | none |
| Package-manager commands it ran | none |
| Tools it offered | 15 |
| Time to answer (approximate) | 336 ms |

**Time to answer is approximate.** It is 336 ms measured once, from the moment this harness handed the process to an unprivileged user to the timestamp on its reply listing its tools; 333 ms of that was reaching the end of the opening handshake, and listing the tools took the remaining 3 ms. The process ran under a kernel tracer that stops it at every file it opens, so this is slower than the same start untraced, by an amount not measured and not estimated here. It includes whatever runtime the package brings with it. One run, one version, one machine: there is no second run, so there is no spread to quote and the figure carries no error bar.

`setpriv` in that list is the harness's own launcher, not the package's doing.

## Tools it offers, against its own README

It offered 15 tools. 15 of them are named in `README.md`.

Every tool it offered is named in the README.

## Websites it reached for, against its own README

It reached for no website at startup.

The README uses the word "telemetry" — README.md line 173; it reads `- **Local Storage Guarantee**: All spatial coordinates, bounding volumes, and entity history remain 100% local in your workspace. No telemetry or project data is ever transmitted.`. Stated here because it is in the document. This report does not decide whether it accounts for the websites above.

## Names in the README that it did not offer

6 names written in backticks in the README look like a tool name and were not among the tools it offered. A README mentions plenty of things that are not tools, so this is a weaker signal than the two above and is listed rather than counted as a finding:

- `blackboard_items` — README.md line 134: `| 🗄️ **[Database Schema](docs/database-schema.md)** | SQLite tables ('entities', 'spatial_relations', 'entity_history', 'spatial_specs', 'blackboard_items', 'evidence_packs'). |`
- `compact_slice` — README.md line 69: `…us/tags filter, history lookup), 'set_relation' (topological graph links: 'on', 'inside', 'near', 'contains'), 'get_spatial_map' (JSON, GeoJSON, glTF 2.0, OBJ, summary, and 'format: "compact_slice"').`
- `entity_history` — README.md line 134: `| 🗄️ **[Database Schema](docs/database-schema.md)** | SQLite tables ('entities', 'spatial_relations', 'entity_history', 'spatial_specs', 'blackboard_items', 'evidence_packs'). |`
- `evidence_packs` — README.md line 134: `| 🗄️ **[Database Schema](docs/database-schema.md)** | SQLite tables ('entities', 'spatial_relations', 'entity_history', 'spatial_specs', 'blackboard_items', 'evidence_packs'). |`
- `spatial_relations` — README.md line 134: `| 🗄️ **[Database Schema](docs/database-schema.md)** | SQLite tables ('entities', 'spatial_relations', 'entity_history', 'spatial_specs', 'blackboard_items', 'evidence_packs'). |`
- `spatial_specs` — README.md line 134: `| 🗄️ **[Database Schema](docs/database-schema.md)** | SQLite tables ('entities', 'spatial_relations', 'entity_history', 'spatial_specs', 'blackboard_items', 'evidence_packs'). |`

## What this report does not say

- **It judges no tool.** Level 1 calls none, so no claim any tool makes is tested here.
- **It is one run, once.** A program that behaves one way while being watched and another way otherwise would produce this same page.
- **It ran with no route off the machine**, so anything that only happens after a connection succeeds did not happen.
- **Encrypted traffic was not read.** The name it asked for is recorded; the contents are not, and would not be even with a route.
- **"Declared" means named in the README**, nothing more. Only the README file that shipped in the package was read. A package that documents its tools or its destinations somewhere else — a reference file beside the README, a privacy policy, a wiki, its source — will show every one of them above as not named, which is a fact about this rule and not about the package.
- **It is not calibration-backed**, for the reason at the top.
- **It is not a ranking.** No page here says a server is more used, better or worse than another, and the set measured is whatever the candidate searches returned.
- **The harness is BRYDGE's own**, and BRYDGE has an interest in the question of whether tools do what they say.

Evidence: `README.md` (175 lines, sha256 `cad25db33c29`), package integrity `sha512-il4BxMo4URrhj3anl…`.
