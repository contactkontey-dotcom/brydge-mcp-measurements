# What the servers on every best-of list do at startup

## 7 of 67 servers reached for a website their own README does not name

Each of those 7 servers is recorded with the name it asked for and the line of its README that does not contain it. Nothing left the machine: the room has no route off the host, so every name answered to the loopback address and no connection completed.

**24 servers offered a tool their README does not name** — 1,143 tools were offered in total and **none was called**. Read that second figure with the caveat attached: this rule reads only the README that shipped in the package, so a server documenting its tools in a reference file beside it shows every tool as unnamed, and 10 of those servers have a README under three kilobytes. A large count here is a fact about the rule as much as about the package.

2 did both. The remaining 38 had nothing found, which is not the same as a clean sweep — see below.

67 npm packages, each measured from its name alone: installed, started in a room with no route to the internet and no real credentials, asked for its list of tools, and compared against its own README. No tool was called. Measured 2026-10-31 to 2026-11-02.

**Not calibration-backed.** The calibration behind the ten curated measurements proves the instrument catches planted claims about what a tool *did*. Level 1 calls no tool and reads each README by a stated rule rather than by a person, so nothing in that calibration speaks to these pages.

**A website counts as declared only if the README names it.** A tool counts as documented only if the README names it as a whole word.

**This is not a ranking of the most-used servers.** The set measured is whatever two registry searches returned, read by hand for whether each package is a server that starts without a credential. Download figures decided nothing about the order of this table, which is alphabetical by package, and four widely used servers are measured here that neither search returned at all. Nothing on this page says one server is more used, better or worse than another.

| Package | Version | Published at | Tools offered | Websites reached for | Not named in the README | Report |
| --- | --- | --- | --: | --: | --- | --- |
| `@agentistics/mcp` | `2.173.1` | github.com/agentistics/agentistics | 45 | 0 | 30 tools | [report](agentistics--mcp.md) |
| `@agentmemory/mcp` | `0.9.31` | github.com/rohitg00/agentmemory | 7 | 0 | 7 tools | [report](agentmemory--mcp.md) |
| `@ai-dossier/mcp-server` | `1.6.5` | github.com/imboard-ai/ai-dossier | 10 | 0 | none | [report](ai-dossier--mcp-server.md) |
| `@algomap/mcp` | `0.1.0` | github.com/Marvellye/algomap | 11 | 0 | 2 tools | [report](algomap--mcp.md) |
| `@antv/mcp-server-chart` | `0.9.10` | github.com/antvis/mcp-server-chart | 27 | 0 | 1 tool | [report](antv--mcp-server-chart.md) |
| `@aws/nx-plugin-mcp` | `1.3.2` | github.com/awslabs/nx-plugin-for-aws | 7 | 0 | 7 tools | [report](aws--nx-plugin-mcp.md) |
| `@cachly-dev/mcp-server` | `0.10.218` | github.com/cachly-dev/cachly-mcp | 27 | 2 | 8 tools, 1 website | [report](cachly-dev--mcp-server.md) |
| `@cap-js/mcp-server` | `0.1.0` | github.com/cap-js/mcp-server | 2 | 1 | none | [report](cap-js--mcp-server.md) |
| `@contentrain/mcp` | `3.11.21` | github.com/Contentrain/ai | 22 | 0 | none | [report](contentrain--mcp.md) |
| `@cyanheads/pubmed-mcp-server` | `2.11.1` | github.com/cyanheads/pubmed-mcp-server | 12 | 0 | none | [report](cyanheads--pubmed-mcp-server.md) |
| `@drawio/mcp` | `1.10.1` | github.com/jgraph/drawio-mcp | 8 | 0 | none | [report](drawio--mcp.md) |
| `@ehrocks/fe-mcp-server` | `1.0.10` | github.com/thinkei/fe-mcp-service | 1 | 0 | 1 tool | [report](ehrocks--fe-mcp-server.md) |
| `@ericthered926/duckduckgo-mcp-server` | `0.6.0` | github.com/ericthered926/duckduckgo-mcp-server | 2 | 0 | none | [report](ericthered926--duckduckgo-mcp-server.md) |
| `@eslint/mcp` | `0.3.16` | github.com/eslint/rewrite | 1 | 0 | 1 tool | [report](eslint--mcp.md) |
| `@godxjp/ui-mcp` | `33.26.0` | github.com/godx-jp/godxjp-ui | 28 | 0 | 2 tools | [report](godxjp--ui-mcp.md) |
| `@heroui/react-mcp` | `1.1.3` | github.com/heroui-inc/heroui-mcp | 6 | 1 | 1 website | [report](heroui--react-mcp.md) |
| `@hisma/server-puppeteer` | `0.6.5` | github.com/Hisma/servers-archived | 7 | 0 | none | [report](hisma--server-puppeteer.md) |
| `@jpisnice/shadcn-ui-mcp-server` | `3.0.0` | github.com/Jpisnice/shadcn-ui-mcp-server | 10 | 0 | 10 tools | [report](jpisnice--shadcn-ui-mcp-server.md) |
| `@knip/mcp` | `0.0.37` | github.com/webpro-nl/knip | 2 | 0 | none | [report](knip--mcp.md) |
| `@kolbo/mcp` | `1.128.0` | github.com/Zoharvan12/kolbo-mcp | 278 | 0 | 66 tools | [report](kolbo--mcp.md) |
| `@kubb/mcp` | `5.15.3` | github.com/kubb-labs/kubb | 3 | 0 | none | [report](kubb--mcp.md) |
| `@magicuidesign/mcp` | `2.0.0` | github.com/magicuidesign/mcp | 3 | 0 | none | [report](magicuidesign--mcp.md) |
| `@maildev/mcp` | `3.0.0` | github.com/maildev/maildev | 5 | 0 | 5 tools | [report](maildev--mcp.md) |
| `@mantine/mcp-server` | `9.7.4` | github.com/mantinedev/mantine | 5 | 0 | none | [report](mantine--mcp-server.md) |
| `@mastra/mcp-docs-server` | `1.3.11` | github.com/mastra-ai/mastra | 13 | 0 | 13 tools | [report](mastra--mcp-docs-server.md) |
| `@mastra/mcp-registry-registry` | `1.1.7` | github.com/mastra-ai/mastra | 2 | 0 | none | [report](mastra--mcp-registry-registry.md) |
| `@modelcontextprotocol/server-everything` | `2.1.0` | github.com/modelcontextprotocol/servers | 19 | 0 | 17 tools | [report](modelcontextprotocol--server-everything.md) |
| `@modelcontextprotocol/server-filesystem` | `2.1.0` | github.com/modelcontextprotocol/servers | 14 | 0 | 1 tool | [report](modelcontextprotocol--server-filesystem.md) |
| `@modelcontextprotocol/server-memory` | `2.0.1` | github.com/modelcontextprotocol/servers | 9 | 0 | none | [report](modelcontextprotocol--server-memory.md) |
| `@modelcontextprotocol/server-sequential-thinking` | `2.0.0` | github.com/modelcontextprotocol/servers | 1 | 0 | none | [report](modelcontextprotocol--server-sequential-thinking.md) |
| `@mozilla/firefox-devtools-mcp` | `0.10.7` | github.com/mozilla/firefox-devtools-mcp | 35 | 0 | 25 tools | [report](mozilla--firefox-devtools-mcp.md) |
| `@mui/mcp` | `0.1.9` | github.com/mui/mui-x | 2 | 1 | none | [report](mui--mcp.md) |
| `@negokaz/excel-mcp-server` | `0.12.0` | not stated | 6 | 0 | none | [report](negokaz--excel-mcp-server.md) |
| `@next-ai-drawio/mcp-server` | `0.4.7` | github.com/DayuanJiang/next-ai-draw-io | 16 | 0 | none | [report](next-ai-drawio--mcp-server.md) |
| `@ooples/token-optimizer-mcp` | `7.7.1` | github.com/ooples/token-optimizer-mcp | 19 | 0 | 2 tools | [report](ooples--token-optimizer-mcp.md) |
| `@playwright/mcp` | `0.0.83` | github.com/microsoft/playwright-mcp | 25 | 0 | none | [report](playwright--mcp.md) |
| `@primer/mcp` | `1.1.2` | github.com/primer/react | 20 | 0 | 20 tools | [report](primer--mcp.md) |
| `@procedures/mcp-dev-tools` | `0.46.0` | github.com/mark1russell7/client | 93 | 0 | 72 tools | [report](procedures--mcp-dev-tools.md) |
| `@putervision/behavior-mcp` | `0.4.1` | github.com/putervision/behavior-mcp | 10 | 0 | none | [report](putervision--behavior-mcp.md) |
| `@putervision/state-memory-mcp` | `1.4.1` | github.com/putervision/state-memory-mcp | 13 | 0 | none | [report](putervision--state-memory-mcp.md) |
| `@putervision/vision-memory-mcp` | `1.4.2` | github.com/putervision/vision-memory-mcp | 15 | 1 | 1 website | [report](putervision--vision-memory-mcp.md) |
| `@putervision/world-model-mcp` | `0.6.1` | github.com/putervision/world-model-mcp | 15 | 0 | none | [report](putervision--world-model-mcp.md) |
| `@react-aria/mcp` | `1.2.1` | github.com/adobe/react-spectrum | 3 | 1 | 1 website | [report](react-aria--mcp.md) |
| `@superdoc/mcp` | `1.12.0` | github.com/superdoc/docx-editor | 13 | 0 | none | [report](superdoc--mcp.md) |
| `@sylphx/pdf-reader-mcp` | `8.5.7` | github.com/SylphxAI/anymd | 4 | 0 | 4 tools | [report](sylphx--pdf-reader-mcp.md) |
| `@taiga-ui/mcp` | `0.4.1` | github.com/taiga-family/taiga-ui-mcp | 4 | 0 | none | [report](taiga-ui--mcp.md) |
| `@thallylabs/mcp` | `0.10.130` | github.com/thallylabs/thally | 18 | 0 | 1 tool | [report](thallylabs--mcp.md) |
| `@tokenizin/mcp-npx-fetch` | `1.0.0` | github.com/tokenizin-agency/mcp-npx-fetch | 4 | 0 | none | [report](tokenizin--mcp-npx-fetch.md) |
| `@transcend-io/mcp-server-docs` | `0.4.16` | github.com/transcend-io/tools | 2 | 0 | none | [report](transcend-io--mcp-server-docs.md) |
| `@ui5/mcp-server` | `0.3.2` | github.com/UI5/mcp-server | 10 | 0 | none | [report](ui5--mcp-server.md) |
| `@upstash/context7-mcp` | `4.4.4` | github.com/upstash/context7 | 2 | 0 | none | [report](upstash--context7-mcp.md) |
| `@wonderwhy-er/desktop-commander` | `0.3.1` | github.com/wonderwhy-er/DesktopCommanderMCP | 25 | 4 | 3 websites | [report](wonderwhy-er--desktop-commander.md) |
| `agent-comms` | `8.15.22` | github.com/ExaDev/agent-comms | 1 | 1 | 1 website | [report](agent-comms.md) |
| `ai-model-advisor-mcp` | `2.3.0` | github.com/Semicolon-D/model-advisor-mcp | 9 | 0 | none | [report](ai-model-advisor-mcp.md) |
| `chrome-devtools-mcp` | `1.12.0` | github.com/ChromeDevTools/chrome-devtools-mcp | 32 | 2 | 30 tools, 2 websites | [report](chrome-devtools-mcp.md) |
| `excalidraw-mcp` | `1.0.0` | not stated | 11 | 0 | none | [report](excalidraw-mcp.md) |
| `hourei-mcp-server` | `1.0.6` | github.com/groundcobra009/hourei-mcp-server | 3 | 0 | none | [report](hourei-mcp-server.md) |
| `mcp-server-code-runner` | `0.1.8` | github.com/formulahendry/mcp-server-code-runner | 1 | 0 | none | [report](mcp-server-code-runner.md) |
| `package-registry-mcp` | `2.1.0` | github.com/artmann/package-registry-mcp | 16 | 0 | none | [report](package-registry-mcp.md) |
| `playwright-mcp` | `0.0.19` | github.com/Ashish-Bansal/playwright-mcp | 7 | 0 | none | [report](playwright-mcp.md) |
| `pptx-viewer-mcp` | `2.9.0` | github.com/ChristopherVR/ooxml | 74 | 0 | 72 tools | [report](pptx-viewer-mcp.md) |
| `puppeteer-mcp-server` | `0.7.2` | github.com/merajmehrabi/puppeteer-mcp-server | 8 | 0 | none | [report](puppeteer-mcp-server.md) |
| `sample-aws-pricing-calculator-mcp` | `1.3.4` | not stated | 10 | 0 | none | [report](sample-aws-pricing-calculator-mcp.md) |
| `scryfall-mcp-server` | `0.1.1` | modelcontextprotocol.io | 7 | 0 | none | [report](scryfall-mcp-server.md) |
| `smart-web-mcp` | `1.10.19` | github.com/jojo-labs/smart-web | 6 | 0 | none | [report](smart-web-mcp.md) |
| `ssh-mcp` | `2.22.0` | github.com/tufantunc/ssh-mcp | 15 | 0 | none | [report](ssh-mcp.md) |
| `wikipedia-mcp` | `1.0.3` | github.com/timjuenemann/wikipedia-mcp | 2 | 0 | 1 tool | [report](wikipedia-mcp.md) |

## Reading the table

- **Published at** is the repository or homepage the package's own manifest points at, printed because two packages measured here are called Playwright and are not by the same people. It is what each package says about itself and is not verified.
- **Tools offered** is what each server answered to one `tools/list` request. None was called.
- **Websites reached for** counts the distinct names a server looked up or opened an encrypted connection to before any tool was used. Nothing left the machine: every name answered to the loopback address, so no connection completed and no contents were seen.
- **Not named in the README** is the comparison, by the rule above and nothing looser. "none" means every tool it offered and every website it reached for appears in its own README.
- **An empty row is not a clean sweep.** A server that offers few tools and reaches for no website has little for this comparison to find, which is a fact about the measurement as much as about the server.
- **A large count is not a scandal either.** Only the README file that shipped in the package is read. A server that documents its tools in another file — a reference page beside the README, or a website — shows every tool it offers as not named here. Each report cites the README it read, its digest and its line count, and the name it looked for and did not find, so any row can be checked rather than taken.
- **It is one run, once,** with no route off the machine and no tool called. A page here says what a server did at startup while being watched, and where its README was silent about it. It says nothing else.

All 67 packages started, so no row says could not start. Evidence for every row — the full trace, the tool list, the README digest and each citation — is in `level1/evidence/`, one JSON file per package, beside the code that produced it.
