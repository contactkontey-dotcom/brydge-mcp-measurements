# sample-aws-pricing-calculator-mcp 1.3.4 — Level 1 measurement

Measured 2026-10-31. Asked for `sample-aws-pricing-calculator-mcp@1.3.4`. Instrument fingerprint `ca9170dfaeae`.

Published on npm as `sample-aws-pricing-calculator-mcp`. Its manifest names no repository or homepage, so this page cannot say who publishes it beyond the npm name.

**This is not a ranking of the most-used servers.** This package was measured because it appeared in a candidate list built from registry searches, and the order of those searches is not a measure of use.

**Level 1, and not calibration-backed.** No tool was called, so this report makes no claim about any tool doing what it says. The calibration that backs the ten curated measurements proves the instrument catches planted claims about what a tool *did*; Level 1 runs no such checks, and reads the package's own documentation by a stated rule rather than by a person, so nothing in that calibration speaks to this page.

## In plain words

We installed `sample-aws-pricing-calculator-mcp 1.3.4` from the npm registry, started it in a room with no route to the internet, where every website name answers to this machine and every credential is fake, and asked it to list its tools without calling any of them. Before any tool was used it offered 10 tools, looked up 0 websites, started 2 programs and wrote 0 files; of those, 0 tools and 0 websites are not named in its own README. We called no tool and read the contents of no encrypted connection, so this page says nothing about whether any of its tools does what it says.

## The standard this report uses

**A website counts as declared only if the README names it.**

A sentence about connecting somewhere, without the address, names no website. A tool counts as documented only if its name appears in the README as a whole word. Each question is asked once per thing observed, so what the README documents is never worked out from what the program offered — which is the only way "offered but not documented" can be found at all.

The host rule is loose in one direction, and it is better to say so: it reads any dotted name whose last part is two or more letters, so a filename written in prose can read as a website. That can only make the declared list longer and leave something out of the findings below. It cannot put something in.

## What it did at startup, before any tool was used

It started and identified itself as `sample-aws-pricing-calculator-mcp 1.3.4`.

| | |
| --- | --- |
| Websites it looked up | none |
| Encrypted connections it opened | none |
| Other addresses it tried | none |
| Programs it started | `node`, `sample-aws-pricing-calculator-mcp`, `setpriv` |
| Files it wrote | none |
| Package-manager commands it ran | none |
| Tools it offered | 10 |

`setpriv` in that list is the harness's own launcher, not the package's doing.

## Tools it offers, against its own README

It offered 10 tools. 10 of them are named in `README.md`.

Every tool it offered is named in the README.

## Websites it reached for, against its own README

It reached for no website at startup.

## Names in the README that it did not offer

15 names written in backticks in the README look like a tool name and were not among the tools it offered. A README mentions plenty of things that are not tools, so this is a weaker signal than the two above and is listed rather than counted as a finding:

- `child_service_codes` — README.md line 74: `… deprecated parent service codes (currently 'amazonS3'), returns a 'redirect_to_parent' status with 'child_service_codes' listing the actual service codes to use instead. Services with an include/excl…`
- `claude_desktop_config` — README.md line 45: `Add this to your MCP client config (e.g. '~/.kiro/settings/mcp.json', Claude Desktop's 'claude_desktop_config.json', Cursor's MCP settings, or the VS Code MCP config). The install badges above generat…`
- `cost_available` — README.md line 81: `…browser — an on-demand dependency NOT installed by default; when either is missing the tool returns 'cost_available:false' with the exact install commands instead of failing. **Runs only on an explici…`
- `free_tier_choice` — README.md line 76: `…'estimateFor' selects a specific pricing template (e.g. 'lambdaWithoutFreeTier' to exclude the AWS Free Tier); Free-Tier-capable services added without a choice return a 'free_tier_choice' advisory. |`
- `lint_services` — README.md line 77: `…t: builds the would-be saved payload and runs a static check, without calling the save API. Returns '{lint_verdict, next_step, lint_services, would_be_payload}'. Use to confirm an estimate would rende…`
- `lint_verdict` — README.md line 77: `…t: builds the would-be saved payload and runs a static check, without calling the save API. Returns '{lint_verdict, next_step, lint_services, would_be_payload}'. Use to confirm an estimate would rende…`
- `monthly_cost` — README.md line 229: `…en reads the resulting saved estimate via the public read API. The response carries 'upfront_cost', 'monthly_cost', 'total_12_months_cost' (derived as upfront + 12×monthly, which is how the calculator…`
- `next_step` — README.md line 77: `…t: builds the would-be saved payload and runs a static check, without calling the save API. Returns '{lint_verdict, next_step, lint_services, would_be_payload}'. Use to confirm an estimate would rende…`
- `priced_estimate_url` — README.md line 81: `… → Share) so AWS persists the costs, then reads them back — this saves a fresh copy under a new id ('priced_estimate_url'; the original is untouched). Requires Playwright and the Chromium browser — an…`
- `pricing_as_of` — README.md line 229: `…hs_cost' (derived as upfront + 12×monthly, which is how the calculator defines the 12-month total), 'pricing_as_of', and 'rows' — every group/line with its own monthly, upfront, and config. There is n…`
- `redirect_to_parent` — README.md line 74: `…required-field hints, traps). For deprecated parent service codes (currently 'amazonS3'), returns a 'redirect_to_parent' status with 'child_service_codes' listing the actual service codes to use inste…`
- `rows_complete` — README.md line 229: `… is how the calculator defines the 12-month total), 'pricing_as_of', and 'rows' — every group/line with its own monthly, upfront, and config. There is no pagination, so 'rows_complete' is always true.`
- `total_12_months_cost` — README.md line 229: `…ulting saved estimate via the public read API. The response carries 'upfront_cost', 'monthly_cost', 'total_12_months_cost' (derived as upfront + 12×monthly, which is how the calculator defines the 12-…`
- `upfront_cost` — README.md line 229: `…e costs — and then reads the resulting saved estimate via the public read API. The response carries 'upfront_cost', 'monthly_cost', 'total_12_months_cost' (derived as upfront + 12×monthly, which is ho…`
- `would_be_payload` — README.md line 77: `…t: builds the would-be saved payload and runs a static check, without calling the save API. Returns '{lint_verdict, next_step, lint_services, would_be_payload}'. Use to confirm an estimate would rende…`

## What this report does not say

- **It judges no tool.** Level 1 calls none, so no claim any tool makes is tested here.
- **It is one run, once.** A program that behaves one way while being watched and another way otherwise would produce this same page.
- **It ran with no route off the machine**, so anything that only happens after a connection succeeds did not happen.
- **Encrypted traffic was not read.** The name it asked for is recorded; the contents are not, and would not be even with a route.
- **"Declared" means named in the README**, nothing more. Only the README file that shipped in the package was read. A package that documents its tools or its destinations somewhere else — a reference file beside the README, a privacy policy, a wiki, its source — will show every one of them above as not named, which is a fact about this rule and not about the package.
- **It is not calibration-backed**, for the reason at the top.
- **It is not a ranking.** No page here says a server is more used, better or worse than another, and the set measured is whatever the candidate searches returned.
- **The harness is BRYDGE's own**, and BRYDGE has an interest in the question of whether tools do what they say.

Evidence: `README.md` (458 lines, sha256 `e95ee834d00e`), package integrity `sha512-M6vB5P3qEZIimI8iK…`.
