# Level 1 measurements

10 npm packages, each measured from its name alone: installed, started in a room with no route to the internet and no real credentials, asked for its list of tools, and compared against its own README. No tool was called. Measured 2026-10-30.

**Not calibration-backed.** The calibration behind the ten curated measurements proves the instrument catches planted claims about what a tool *did*. Level 1 calls no tool and reads each README by a stated rule rather than by a person, so nothing in that calibration speaks to these pages.

**A website counts as declared only if the README names it.** A tool counts as documented only if the README names it as a whole word.

These are widely used npm MCP servers that start without credentials, chosen by hand. The registry's download figures were not reachable from the machine that ran these measurements, so this is not a measured ranking and nothing here says these are the most used. Each version measured is pinned in the table.

| Package | Version | Tools offered | Websites reached for | Not named in the README | Report |
| --- | --- | --: | --: | --- | --- |
| `@antv/mcp-server-chart` | `0.9.10` | 27 | 0 | 1 tool | [report](antv-mcp-server-chart.md) |
| `chrome-devtools-mcp` | `1.12.0` | 32 | 2 | 30 tools, 2 websites | [report](chrome-devtools-mcp.md) |
| `mcp-server-code-runner` | `0.1.8` | 1 | 0 | none | [report](mcp-server-code-runner.md) |
| `@modelcontextprotocol/server-everything` | `2.1.0` | 19 | 0 | 17 tools | [report](modelcontextprotocol-server-everything.md) |
| `@modelcontextprotocol/server-filesystem` | `2.1.0` | 14 | 0 | 1 tool | [report](modelcontextprotocol-server-filesystem.md) |
| `@modelcontextprotocol/server-memory` | `2.0.1` | 9 | 0 | none | [report](modelcontextprotocol-server-memory.md) |
| `@modelcontextprotocol/server-sequential-thinking` | `2.0.0` | 1 | 0 | none | [report](modelcontextprotocol-server-sequential-thinking.md) |
| `@playwright/mcp` | `0.0.83` | 25 | 0 | none | [report](playwright-mcp.md) |
| `@upstash/context7-mcp` | `4.4.4` | 2 | 0 | none | [report](upstash-context7-mcp.md) |
| `@wonderwhy-er/desktop-commander` | `0.2.51` | 26 | 4 | 1 tool, 3 websites | [report](wonderwhy-er-desktop-commander.md) |

## Reading the table

- **Tools offered** is what each server answered to one `tools/list` request. None was called.
- **Websites reached for** counts the distinct names a server looked up or opened an encrypted connection to before any tool was used. Nothing left the machine: every name answered to the loopback address, so no connection completed and no contents were seen.
- **Not named in the README** is the comparison, by the rule above and nothing looser. "none" means every tool it offered and every website it reached for appears in its own README.
- **An empty row is not a clean sweep.** A server that offers few tools and reaches for no website has little for this comparison to find, which is a fact about the measurement as much as about the server.
- **A large count is not a scandal either.** Only the README file that shipped in the package is read. A server that documents its tools in another file — a reference page beside the README, or a website — shows every tool it offers as not named here. Each report cites the README it read, its digest and its line count, and the name it looked for and did not find, so any row can be checked rather than taken.
- **It is one run, once,** with no route off the machine and no tool called. A page here says what a server did at startup while being watched, and where its README was silent about it. It says nothing else.

All 10 packages started, so no row says could not start. Evidence for every row — the full trace, the tool list, the README digest and each citation — is in `level1/evidence/`, one JSON file per package, beside the code that produced it.
