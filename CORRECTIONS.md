# Corrections

Every correction to a published page, what was wrong, and what changed. Where a
page said something about a server that was not true, the error was ours.

## 2026-09-28 — declarations and claims re-read from each server's own documents

Before opening issues with maintainers, we checked every finding against the
documentation shipped with the exact version measured. Several published
statements came from our own summaries of that documentation, not from the
documentation itself:

- **mcp-server-git** — the page said it "documents git_init, which it did not
  offer" and "offers git_branch, which its documentation does not list". Both
  were wrong: the README of 2026.8.18 lists exactly the twelve tools it offers,
  including `git_branch`. Our list was out of date. No tool-list finding remains.
- **chrome-devtools-mcp** — the page said `list_pages` is offered but not
  documented. It is in its tool reference (`docs/tool-reference.md` at
  `chrome-devtools-mcp-v1.10.1`). No tool-list finding remains. Its usage
  statistics and update check, which reached `play.googleapis.com` and the npm
  registry, are documented in its README.
- **@wonderwhy-er/desktop-commander** — the page listed its telemetry hosts as
  "not in its declared destinations". Its README and PRIVACY.md declare opt-out
  telemetry; the hosts are now counted as declared. What remains undocumented,
  as far as we can find, is a remote feature-flag fetch from
  `desktopcommander.app` and a background Chrome download at startup
  (`googlechromelabs.github.io`), plus `get_prompts`, which it offers but its
  README's tool table does not list.
- **@modelcontextprotocol/server-filesystem** — our list of its documented
  tools included `read_file`, which its README does not list; it is offered,
  and describes itself as deprecated in favour of `read_text_file`. The page
  now says so.
- **excel-mcp-server** — its tool list is now compared against `TOOLS.md`, the
  document its README points to (it matches); before, our "documented" list was
  copied from what the server advertised.
- **mcp-shell-server** — its README documents the allowlist but never names
  its tool, so there is no documented tool list to compare; the page had
  claimed one.
- **Every server** — each "It says:" line is now quoted verbatim from the
  description the tool gives of itself (`tools/list`, kept in the raw record),
  and every declaration links the documentation of the version measured and
  quotes it word for word. Several "How to run it" commands were ours rather
  than the README's; they now match the README.

All ten servers were measured again under the same calibrated harness
(`ca9170dfaeae`). New checks in `test/published.test.ts` fail if a claim is not
in the tool's own words, if a declaration's source is not pinned to the measured
version, or if a result no longer matches `servers/index.ts`.

## 2026-09-28 — "not probed" lists

`mcp-server-git`'s page listed `git_init` among tools we did not probe, and
desktop-commander's listed `search_files` (not one of its tools) and
`get_file_info` twice. Corrected, re-measured, and checked by test since.
