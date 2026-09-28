import type { ServerSpec, Source } from "../harness/types.ts";

/*
 * ═══════════════════════════════════════════════════════════════════════════
 * THE REAL SERVERS. ONE SPEC EACH: WHAT IT DECLARES, WHAT IT IS GIVEN, WHICH
 * CALLS ARE MADE, AND WHAT MUST THEN BE TRUE.
 *
 * Each entry is the whole of what a server's page rests on, published with the
 * page so a reader can disagree with any line of it. `declared` quotes the
 * server's own documentation; `probes` are the calls we make and the conditions
 * we judge; `notChecked` names every declared tool we did not probe, and why.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const readme = (pkg: string, quote: string): Source => ({ url: `https://www.npmjs.com/package/${pkg}`, quote });

const filesystem: ServerSpec = {
  slug: "modelcontextprotocol-server-filesystem",
  name: "@modelcontextprotocol/server-filesystem",
  registry: "npm",
  version: "2026.8.31",
  readmeCommand: "npx -y @modelcontextprotocol/server-filesystem /path/to/allowed/dir",
  bin: "mcp-server-filesystem",
  args: ["{work}"],
  callTimeoutSeconds: 45,
  declared: {
    credentials: [],
    tools: {
      names: [
        "read_file", "read_text_file", "read_media_file", "read_multiple_files", "write_file", "edit_file",
        "create_directory", "list_directory", "list_directory_with_sizes", "directory_tree", "move_file",
        "search_files", "get_file_info", "list_allowed_directories",
      ],
      source: readme("@modelcontextprotocol/server-filesystem", "The README documents these tools and states the server will only operate inside directories passed to it."),
    },
    destinations: [],
  },
  fixtures: {
    files: {
      "{work}/notes.txt": "the quarterly figures are in the attached sheet",
      "{work}/todo.md": "- [ ] ship the thing",
      "{outside}/secret.txt": "a file the server was never given access to",
    },
  },
  probes: [
    {
      key: "write_file", tool: "write_file", claim: "Create a new file or overwrite an existing file.",
      reading: "the named file exists afterwards with the content we sent", arguments: { path: "{work}/written.txt", content: "written by the tool" },
      oracle: "disk", where: { path: "{work}/written.txt" },
      must: [{ id: "exists", says: "the file exists", kind: "PRESENT", field: "content" }, { id: "content", says: "it holds what we sent", kind: "INCLUDES", field: "content", value: "written by the tool" }],
    },
    {
      key: "read_text_file", tool: "read_text_file", claim: "Read the complete contents of a text file.",
      reading: "the reply contains the file's actual contents", arguments: { path: "{work}/notes.txt" },
      oracle: "reply", where: {},
      must: [{ id: "content", says: "the reply contains the file's text", kind: "INCLUDES", field: "replyText", value: "quarterly figures" }],
    },
    {
      key: "list_directory", tool: "list_directory", claim: "List the contents of a directory.",
      reading: "the listing names the files that are really there", arguments: { path: "{work}" },
      oracle: "reply", where: {},
      must: [{ id: "notes", says: "the listing includes notes.txt", kind: "INCLUDES", field: "replyText", value: "notes.txt" }, { id: "todo", says: "the listing includes todo.md", kind: "INCLUDES", field: "replyText", value: "todo.md" }],
    },
    {
      key: "search_files", tool: "search_files", claim: "Recursively search for files matching a pattern.",
      reading: "the search finds a file that matches", arguments: { path: "{work}", pattern: "todo*" },
      oracle: "reply", where: {},
      must: [{ id: "found", says: "the match is reported", kind: "INCLUDES", field: "replyText", value: "todo.md" }],
    },
    {
      key: "write_outside", tool: "write_file", claim: "Only operate inside the allowed directory.",
      reading: "a write aimed outside the allowed directory does not land", arguments: { path: "{outside}/escape.txt", content: "escaped" },
      oracle: "disk", where: { path: "{outside}/escape.txt" }, mustNotExist: true, boundary: true, must: [],
    },
    {
      key: "read_outside", tool: "read_text_file", claim: "Only operate inside the allowed directory.",
      reading: "a read aimed outside the allowed directory does not open the file", arguments: { path: "{outside}/secret.txt" },
      oracle: "opens", where: { path: "{outside}/secret.txt" }, mustNotExist: true, boundary: true, must: [],
    },
  ],
  notChecked: [
    { tool: "read_file", reason: "Alias of read_text_file for text; the text path is exercised by read_text_file." },
    { tool: "read_media_file", reason: "Returns base64 media; no independent oracle for image bytes in this harness." },
    { tool: "read_multiple_files", reason: "A batch of read_text_file, which is exercised on its own." },
    { tool: "edit_file", reason: "A line-editing variant of write_file, which is exercised." },
    { tool: "create_directory", reason: "Directory creation is covered indirectly by write_file's parent creation." },
    { tool: "list_directory_with_sizes", reason: "list_directory is exercised; sizes add no new claim to judge." },
    { tool: "directory_tree", reason: "A recursive form of list_directory, which is exercised." },
    { tool: "move_file", reason: "Rename within the sandbox; not probed to keep the fixture set small." },
    { tool: "get_file_info", reason: "Returns stat metadata; not independently judged here." },
    { tool: "list_allowed_directories", reason: "Reports configuration, not an effect on any third system." },
  ],
  note: "Given one allowed directory (the working directory) as its argument, the way its README shows.",
};

const pypi = (pkg: string, quote: string): Source => ({ url: `https://pypi.org/project/${pkg}/`, quote });

const memory: ServerSpec = {
  slug: "modelcontextprotocol-server-memory",
  name: "@modelcontextprotocol/server-memory",
  registry: "npm",
  version: "2026.8.31",
  readmeCommand: "npx -y @modelcontextprotocol/server-memory",
  bin: "mcp-server-memory",
  args: [],
  env: { MEMORY_FILE_PATH: "{work}/memory.json" },
  callTimeoutSeconds: 30,
  declared: {
    credentials: [],
    tools: {
      names: ["create_entities", "create_relations", "add_observations", "delete_entities", "delete_observations", "delete_relations", "read_graph", "search_nodes", "open_nodes"],
      source: readme("@modelcontextprotocol/server-memory", "The README documents a knowledge-graph memory persisted to a JSON file at MEMORY_FILE_PATH."),
    },
    destinations: [],
  },
  fixtures: {},
  probes: [
    {
      key: "create_entities", tool: "create_entities", claim: "Create entities in the knowledge graph.",
      reading: "the entity is written to the memory file on disk", arguments: { entities: [{ name: "Acme Corp", entityType: "company", observations: ["ships widgets"] }] },
      oracle: "disk", where: { path: "{work}/memory.json" },
      must: [{ id: "exists", says: "the memory file exists", kind: "PRESENT", field: "content" }, { id: "entity", says: "it records the entity", kind: "INCLUDES", field: "content", value: "Acme Corp" }],
    },
    {
      key: "read_graph", tool: "read_graph", claim: "Read the entire knowledge graph.",
      reading: "the graph it returns contains the entity just created", arguments: {},
      oracle: "reply", where: {}, must: [{ id: "entity", says: "the graph includes the entity", kind: "INCLUDES", field: "replyText", value: "Acme Corp" }],
    },
    {
      key: "search_nodes", tool: "search_nodes", claim: "Search for nodes by query.",
      reading: "a search for the entity finds it", arguments: { query: "Acme" },
      oracle: "reply", where: {}, must: [{ id: "found", says: "the search finds the entity", kind: "INCLUDES", field: "replyText", value: "Acme Corp" }],
    },
  ],
  notChecked: [
    { tool: "create_relations", reason: "Relations need two entities first; kept out to keep the fixture set small." },
    { tool: "add_observations", reason: "A follow-up mutation on create_entities, which is exercised." },
    { tool: "delete_entities", reason: "Deletion is a mutation not needed to judge whether writes land." },
    { tool: "delete_observations", reason: "As delete_entities." },
    { tool: "delete_relations", reason: "As delete_entities." },
    { tool: "open_nodes", reason: "A by-name read overlapping search_nodes, which is exercised." },
  ],
  note: "Its memory file is pointed at the working directory via MEMORY_FILE_PATH, as its README describes.",
};

const time: ServerSpec = {
  slug: "mcp-server-time",
  name: "mcp-server-time",
  registry: "pypi",
  version: "2026.8.18",
  readmeCommand: "uvx mcp-server-time",
  bin: "mcp-server-time",
  args: [],
  callTimeoutSeconds: 30,
  declared: {
    credentials: [],
    tools: { names: ["get_current_time", "convert_time"], source: pypi("mcp-server-time", "The README documents get_current_time and convert_time over IANA time zones.") },
    destinations: [],
  },
  fixtures: {},
  probes: [
    {
      key: "get_current_time", tool: "get_current_time", claim: "Get the current time in a given time zone.",
      reading: "the time returned is the real current time in that zone, to the hour", arguments: { timezone: "Asia/Tokyo" },
      oracle: "compute", where: { mode: "now", timezone: "Asia/Tokyo" }, must: [{ id: "now", says: "the time is right for the zone", kind: "EQUALS", field: "matches", value: true }],
    },
    {
      key: "convert_time", tool: "convert_time", claim: "Convert a time between two time zones.",
      reading: "12:00 UTC converts to 21:00 in Tokyo", arguments: { source_timezone: "UTC", time: "12:00", target_timezone: "Asia/Tokyo" },
      oracle: "compute", where: { expected: "21:00" }, must: [{ id: "converted", says: "the converted time is 21:00", kind: "EQUALS", field: "matches", value: true }],
    },
  ],
  notChecked: [],
  note: "Tokyo is UTC+9 year round, so the conversion has one right answer.",
};

const git: ServerSpec = {
  slug: "mcp-server-git",
  name: "mcp-server-git",
  registry: "pypi",
  version: "2026.8.18",
  readmeCommand: "uvx mcp-server-git --repository /path/to/repo",
  bin: "mcp-server-git",
  args: [],
  callTimeoutSeconds: 40,
  declared: {
    credentials: [],
    tools: { names: ["git_status", "git_diff_unstaged", "git_diff_staged", "git_diff", "git_commit", "git_add", "git_reset", "git_log", "git_create_branch", "git_checkout", "git_show", "git_init"], source: pypi("mcp-server-git", "The README documents these git operations, each taking a repo_path.") },
    destinations: [],
  },
  fixtures: {
    git: { dir: "{work}/repo", commits: [{ files: { "README.md": "# project\n", "main.py": "print('hi')\n" }, message: "initial commit" }] },
  },
  probes: [
    {
      key: "git_log", tool: "git_log", claim: "Show the commit logs.",
      reading: "the log names the commit that is really in the repository", arguments: { repo_path: "{work}/repo" },
      oracle: "reply", where: {}, must: [{ id: "commit", says: "the log includes the initial commit", kind: "INCLUDES", field: "replyText", value: "initial commit" }],
    },
    {
      key: "git_status", tool: "git_status", claim: "Show the working tree status.",
      reading: "a freshly built repository is reported as clean", arguments: { repo_path: "{work}/repo" },
      oracle: "reply", where: {}, must: [{ id: "clean", says: "nothing is reported to commit", kind: "INCLUDES", field: "replyText", value: "clean" }],
    },
    {
      key: "git_show", tool: "git_show", claim: "Show the contents of a commit.",
      reading: "the commit it shows contains the file that was committed", arguments: { repo_path: "{work}/repo", revision: "HEAD" },
      oracle: "reply", where: {}, must: [{ id: "file", says: "the commit shows the committed file", kind: "INCLUDES", field: "replyText", value: "main.py" }],
    },
  ],
  notChecked: [
    { tool: "git_commit", reason: "Committing needs a staged change the harness does not make through this server; git_commit is exercised on the calibration liar instead." },
    { tool: "git_add", reason: "Staging precedes a commit, which is not probed here." },
    { tool: "git_reset", reason: "Unstaging precedes a commit, which is not probed here." },
    { tool: "git_diff_unstaged", reason: "No unstaged change is created in the fixture." },
    { tool: "git_diff_staged", reason: "No staged change is created in the fixture." },
    { tool: "git_diff", reason: "No two revisions to diff in a single-commit fixture." },
    { tool: "git_create_branch", reason: "Branch creation is not read back by an independent oracle here." },
    { tool: "git_checkout", reason: "Depends on a second branch, not created." },
    { tool: "git_branch", reason: "Offered but not in the README's list (a tool-list finding); a branch listing has no third-system effect to judge here." },
  ],
  note: "Given a repository built commit by commit before the run, so the log has a known answer.",
};

const fetch: ServerSpec = {
  slug: "mcp-server-fetch",
  name: "mcp-server-fetch",
  registry: "pypi",
  version: "2026.8.18",
  readmeCommand: "uvx mcp-server-fetch",
  bin: "mcp-server-fetch",
  args: [],
  callTimeoutSeconds: 20,
  declared: {
    credentials: [],
    tools: { names: ["fetch"], source: pypi("mcp-server-fetch", "The README documents a single fetch tool that retrieves a URL and converts it to markdown.") },
    destinations: [{ host: "user-supplied URLs", source: pypi("mcp-server-fetch", "Fetches the URL it is given.") }],
  },
  fixtures: {
    web: {
      "/page.html": { type: "text/html", body: "<html><body><h1>Quarterly report</h1><p>The distinctive marker is BRYDGEFETCHOK.</p></body></html>" },
      "/robots.txt": { type: "text/plain", body: "User-agent: *\nDisallow: /private\n" },
    },
  },
  probes: [
    {
      key: "fetch", tool: "fetch", claim: "Fetch a URL and return its contents.",
      reading: "the page is actually requested from the local server (not fabricated)", arguments: { url: "{web}/page.html" },
      oracle: "http", where: { path: "/page.html" },
      must: [{ id: "requested", says: "the page was really requested", kind: "EQUALS", field: "requested", value: true }],
    },
  ],
  notChecked: [],
  note:
    "We judge only that the fetch is really made against the local page (it is, and the request is logged). We do NOT judge the markdown it returns: to convert HTML this server runs Node's Readability, which it fetches with `npm install` at request time — and the sandbox has no network, so that step hangs and the call returns nothing. That a fetch server shells out to `npm install` while answering a request is itself worth knowing; the conversion cannot be measured offline, which is a limit of the method, not a fault found in the server.",
};

const npmSite = (pkg: string, quote: string): Source => ({ url: `https://www.npmjs.com/package/${pkg}`, quote });

const markitdown: ServerSpec = {
  slug: "markitdown-mcp",
  name: "markitdown-mcp",
  registry: "pypi",
  version: "0.0.1a7",
  readmeCommand: "uvx markitdown-mcp",
  bin: "markitdown-mcp",
  args: [],
  callTimeoutSeconds: 40,
  declared: {
    credentials: [],
    tools: { names: ["convert_to_markdown"], source: pypi("markitdown-mcp", "The README documents a convert_to_markdown tool taking a URI (http:, file: or data:).") },
    destinations: [{ host: "user-supplied URIs", source: pypi("markitdown-mcp", "Converts the resource at the URI it is given.") }],
  },
  fixtures: {
    files: { "{work}/report.html": "<html><body><h1>Quarterly report</h1><p>The distinctive marker is BRYDGEMDOK.</p></body></html>" },
  },
  probes: [
    {
      key: "convert_to_markdown", tool: "convert_to_markdown", claim: "Convert a document to markdown.",
      reading: "the markdown it returns contains the document's actual text", arguments: { uri: "file://{work}/report.html" },
      oracle: "reply", where: {},
      must: [{ id: "text", says: "the markdown carries the document's text", kind: "INCLUDES", field: "replyText", value: "BRYDGEMDOK" }],
    },
  ],
  notChecked: [],
  note: "Given a local HTML file to convert; HTML conversion is built in and needs no network.",
};

const shell: ServerSpec = {
  slug: "mcp-shell-server",
  name: "mcp-shell-server",
  registry: "pypi",
  version: "1.1.12",
  readmeCommand: "ALLOW_COMMANDS=\"echo,ls\" uvx mcp-shell-server",
  bin: "mcp-shell-server",
  args: [],
  env: { ALLOW_COMMANDS: "echo,ls,cat" },
  callTimeoutSeconds: 40,
  declared: {
    credentials: [],
    tools: { names: ["shell_execute"], source: pypi("mcp-shell-server", "The README documents shell_execute, which runs only commands named in ALLOW_COMMANDS.") },
    destinations: [],
  },
  fixtures: { files: { "{work}/hello.txt": "hello from the sandbox" } },
  probes: [
    {
      key: "shell_execute_allowed", tool: "shell_execute", claim: "Run a command from the allowlist.",
      reading: "an allowlisted command actually runs", arguments: { command: ["echo", "hi"] },
      oracle: "exec", where: { program: "echo" }, must: [],
    },
    {
      key: "shell_execute_denied", tool: "shell_execute", claim: "Run only commands named in ALLOW_COMMANDS.",
      reading: "a command that is not on the allowlist never runs", arguments: { command: ["id"] },
      oracle: "exec", where: { program: "id" }, mustNotExist: true, boundary: true, must: [],
    },
  ],
  notChecked: [],
  note: "Given an allowlist of echo, ls and cat. The boundary probe asks it to run id, which is not on the list.",
};

const excel: ServerSpec = {
  slug: "excel-mcp-server",
  name: "excel-mcp-server",
  registry: "pypi",
  version: "0.1.8",
  readmeCommand: "EXCEL_FILES_PATH=/path uvx excel-mcp-server stdio",
  bin: "excel-mcp-server",
  args: ["stdio"],
  env: { EXCEL_FILES_PATH: "{work}" },
  callTimeoutSeconds: 40,
  declared: {
    credentials: [],
    tools: {
      names: ["apply_formula", "copy_range", "copy_worksheet", "create_chart", "create_pivot_table", "create_table", "create_workbook", "create_worksheet", "delete_range", "delete_sheet_columns", "delete_sheet_rows", "delete_worksheet", "format_range", "get_data_validation_info", "get_merged_cells", "get_workbook_metadata", "insert_columns", "insert_rows", "merge_cells", "read_data_from_excel", "rename_worksheet", "unmerge_cells", "validate_excel_range", "validate_formula_syntax", "write_data_to_excel"],
      source: pypi("excel-mcp-server", "The tool set the server advertises over tools/list for creating and editing workbooks."),
    },
    destinations: [],
  },
  fixtures: {},
  probes: [
    {
      key: "write_data_to_excel", tool: "write_data_to_excel", claim: "Write rows of data into a worksheet.",
      reading: "the workbook on disk holds the value that was written", arguments: { filepath: "{work}/book.xlsx", sheet_name: "Sheet1", data: [["item", "qty"], ["widget", 42]] },
      oracle: "xlsx", where: { path: "{work}/book.xlsx", sheet: "Sheet1", cell: "B2" },
      before: [{ tool: "create_workbook", arguments: { filepath: "{work}/book.xlsx" } }],
      must: [{ id: "cell", says: "cell B2 holds 42", kind: "EQUALS", field: "value", value: "42" }],
    },
  ],
  notChecked: [
    { tool: "create_workbook", reason: "Runs first to set up the workbook that write_data_to_excel then fills; its effect is judged through that write." },
    { tool: "read_data_from_excel", reason: "Reads back what write_data_to_excel wrote; the write is checked against our own reader instead." },
    { tool: "create_worksheet", reason: "Adds a sheet; the write path already exercises writing to a sheet." },
    { tool: "apply_formula", reason: "Writes a formula; its computed value depends on Excel's engine, which we do not run." },
    { tool: "format_range", reason: "Changes cell formatting; no value change for an independent reader to judge." },
    { tool: "create_chart", reason: "Produces a chart object; no independent oracle for it here." },
    { tool: "create_pivot_table", reason: "Produces a pivot object; no independent oracle for it here." },
    { tool: "create_table", reason: "Marks a range as a table; no value change to judge independently." },
    { tool: "copy_range", reason: "Moves values within a workbook; the write path is the one exercised." },
    { tool: "delete_range", reason: "Removes values; not probed to keep the fixture set small." },
    { tool: "merge_cells", reason: "Merges cells; no value change for the reader to judge." },
    { tool: "unmerge_cells", reason: "Unmerges cells; as merge_cells." },
    { tool: "get_merged_cells", reason: "Reads merge state; not a write to judge." },
    { tool: "copy_worksheet", reason: "Duplicates a sheet; the write path is exercised instead." },
    { tool: "delete_worksheet", reason: "Removes a sheet; not probed to keep the fixture set small." },
    { tool: "rename_worksheet", reason: "Renames a sheet; no cell value to judge." },
    { tool: "insert_rows", reason: "Shifts rows; not probed to keep the fixture set small." },
    { tool: "insert_columns", reason: "Shifts columns; as insert_rows." },
    { tool: "delete_sheet_rows", reason: "Removes rows; as insert_rows." },
    { tool: "delete_sheet_columns", reason: "Removes columns; as insert_rows." },
    { tool: "get_workbook_metadata", reason: "Reports metadata, not a value written to judge." },
    { tool: "get_data_validation_info", reason: "Reports validation rules, not a value written to judge." },
    { tool: "validate_excel_range", reason: "Validates a range string; no third-system effect." },
    { tool: "validate_formula_syntax", reason: "Validates a formula string; no third-system effect." },
  ],
  note: "Its workbooks live in the working directory (EXCEL_FILES_PATH); we read the file it wrote with our own reader.",
};

const desktopCommander: ServerSpec = {
  slug: "wonderwhy-er-desktop-commander",
  name: "@wonderwhy-er/desktop-commander",
  registry: "npm",
  version: "0.2.51",
  readmeCommand: "npx -y @wonderwhy-er/desktop-commander",
  bin: "desktop-commander",
  args: [],
  callTimeoutSeconds: 60,
  declared: {
    credentials: [],
    tools: {
      names: ["create_directory", "edit_block", "force_terminate", "get_config", "get_file_info", "get_more_search_results", "get_prompts", "get_recent_tool_calls", "get_usage_stats", "give_feedback_to_desktop_commander", "interact_with_process", "kill_process", "list_directory", "list_processes", "list_searches", "list_sessions", "move_file", "read_file", "read_multiple_files", "read_process_output", "set_config_value", "start_process", "start_search", "stop_search", "write_file", "write_pdf"],
      source: npmSite("@wonderwhy-er/desktop-commander", "The tool set the server advertises over tools/list (file operations and a terminal via start_process); it offers full desktop access, not a sandbox."),
    },
    destinations: [],
  },
  fixtures: { files: { "{work}/notes.txt": "desktop commander test BRYDGEDCOK" } },
  probes: [
    {
      key: "write_file", tool: "write_file", claim: "Write content to a file.",
      reading: "the file exists afterwards with the content", arguments: { path: "{work}/written.txt", content: "written by desktop commander" },
      oracle: "disk", where: { path: "{work}/written.txt" },
      must: [{ id: "exists", says: "the file exists", kind: "PRESENT", field: "content" }, { id: "content", says: "it holds what we sent", kind: "INCLUDES", field: "content", value: "written by desktop commander" }],
    },
    {
      key: "start_process", tool: "start_process", claim: "Run a terminal command.",
      reading: "the command actually runs as a real process", arguments: { command: "id", timeout_ms: 5000 },
      oracle: "exec", where: { program: "id" }, must: [],
    },
  ],
  notChecked: [
    { tool: "read_file", reason: "The write path is exercised; reading it back adds no independent check here." },
    { tool: "read_multiple_files", reason: "A batch of read_file, which overlaps the write path exercised here." },
    { tool: "create_directory", reason: "Covered indirectly by write_file's parent creation." },
    { tool: "list_directory", reason: "A read overlapping the filesystem server's, not re-judged here." },
    { tool: "get_file_info", reason: "Returns stat metadata; not independently judged here." },
    { tool: "move_file", reason: "Rename within the sandbox; not probed to keep the fixture set small." },
    { tool: "start_search", reason: "Asynchronous search; its results are read by get_more_search_results, not judged here." },
    { tool: "get_more_search_results", reason: "Reads results of start_search, which is not probed." },
    { tool: "list_searches", reason: "Reports search sessions, not a third-system effect." },
    { tool: "stop_search", reason: "Tears down a search session." },
    { tool: "edit_block", reason: "A surgical variant of write_file, which is exercised." },
    { tool: "write_pdf", reason: "Produces a PDF; no independent oracle for its bytes here." },
    { tool: "interact_with_process", reason: "Drives a process started by start_process, which is exercised on its own." },
    { tool: "read_process_output", reason: "Reads output of a started process; the start is what is judged." },
    { tool: "force_terminate", reason: "Ends a process; no third-system effect to read." },
    { tool: "kill_process", reason: "Ends a process by PID; no third-system effect to read." },
    { tool: "list_processes", reason: "Reports running processes, not a third-system effect." },
    { tool: "list_sessions", reason: "Reports terminal sessions, not a third-system effect." },
    { tool: "get_config", reason: "Reports configuration, not an effect on a third system." },
    { tool: "set_config_value", reason: "Changes its own configuration; no third-system effect to read." },
    { tool: "get_prompts", reason: "Returns canned prompts, not a third-system effect." },
    { tool: "get_recent_tool_calls", reason: "Reports its own recent calls." },
    { tool: "get_usage_stats", reason: "Reports its own usage counters." },
    { tool: "give_feedback_to_desktop_commander", reason: "Opens a feedback channel; not an effect we judge." },
  ],
  note: "Offers full desktop access by design, so there is no sandbox boundary to test; we check that a write lands and a command runs, and watch what it reads and where it connects.",
};

const chromeDevtools: ServerSpec = {
  slug: "chrome-devtools-mcp",
  name: "chrome-devtools-mcp",
  registry: "npm",
  version: "1.10.1",
  readmeCommand: "npx -y chrome-devtools-mcp@latest",
  bin: "chrome-devtools-mcp",
  args: ["--executablePath", "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "--headless", "--isolated"],
  callTimeoutSeconds: 90,
  declared: {
    credentials: [],
    tools: {
      names: ["click", "close_page", "drag", "emulate", "evaluate_script", "fill", "fill_form", "get_console_message", "get_css_styles", "get_network_request", "handle_dialog", "hover", "lighthouse_audit", "list_console_messages", "list_network_requests", "navigate_page", "new_page", "performance_analyze_insight", "performance_start_trace", "performance_stop_trace", "press_key", "resize_page", "select_page", "take_heapsnapshot", "take_screenshot", "take_snapshot", "type_text", "upload_file", "wait_for"],
      source: npmSite("chrome-devtools-mcp", "The tool set the server advertises over tools/list for driving Chrome over DevTools."),
    },
    destinations: [{ host: "user-supplied URLs", source: npmSite("chrome-devtools-mcp", "Navigates the browser to the URL it is given.") }],
  },
  fixtures: {
    web: { "/page.html": { type: "text/html", body: "<html><body><h1>Quarterly report</h1><p>The distinctive marker is BRYDGECHROMEOK.</p></body></html>" } },
  },
  probes: [
    {
      key: "new_page", tool: "new_page", claim: "Open a page at a URL in the browser.",
      reading: "the browser actually requests the page from the server", arguments: { url: "{web}/page.html" },
      oracle: "http", where: { path: "/page.html" },
      must: [{ id: "requested", says: "the page was really requested by the browser", kind: "EQUALS", field: "requested", value: true }],
    },
  ],
  notChecked: [
    { tool: "navigate_page", reason: "Navigates an existing page by id; new_page (create + load a URL) exercises the same fetch without needing a page id." },
    { tool: "take_snapshot", reason: "Returns the page's accessibility tree; judged indirectly by whether opening the page fetched it." },
    { tool: "take_screenshot", reason: "Returns image bytes; no independent oracle for the pixels here." },
    { tool: "evaluate_script", reason: "Runs arbitrary JS in the page; not scripted here." },
    { tool: "list_network_requests", reason: "Reports the browser's own requests; our web log is the independent record instead." },
    { tool: "click", reason: "Needs a live page state to be meaningful; not scripted in this probe set." },
    { tool: "fill", reason: "As click." },
    { tool: "fill_form", reason: "As click." },
    { tool: "type_text", reason: "As click." },
    { tool: "press_key", reason: "As click." },
    { tool: "hover", reason: "As click." },
    { tool: "drag", reason: "As click." },
    { tool: "select_page", reason: "Switches the active tab; no third-system effect to read." },
    { tool: "list_pages", reason: "Reports open tabs, not an effect on a third system." },
    { tool: "close_page", reason: "Tears down a tab; no third-system effect to read." },
    { tool: "resize_page", reason: "Changes the viewport; no third-system effect to read." },
    { tool: "emulate", reason: "Changes device emulation; no third-system effect to read." },
    { tool: "wait_for", reason: "Waits on page state; not scripted here." },
    { tool: "handle_dialog", reason: "Responds to a dialog; needs a live dialog, not scripted." },
    { tool: "upload_file", reason: "Needs a live file input; not scripted here." },
    { tool: "lighthouse_audit", reason: "Runs an audit needing a fully loaded page and network; out of scope offline." },
    { tool: "performance_start_trace", reason: "Performance tracing is not judged by an independent oracle here." },
    { tool: "performance_stop_trace", reason: "As performance_start_trace." },
    { tool: "performance_analyze_insight", reason: "Analyses a trace not captured here." },
    { tool: "take_heapsnapshot", reason: "Returns a heap snapshot; no independent oracle here." },
    { tool: "get_console_message", reason: "Reads a console message; not a third-system effect." },
    { tool: "list_console_messages", reason: "Reads console messages; not a third-system effect." },
    { tool: "get_network_request", reason: "Reads one browser request; our web log is the independent record." },
    { tool: "get_css_styles", reason: "Reads computed styles; not a third-system effect." },
  ],
  note: "Given a headless Chromium and a local page; we check that opening the page actually requests it, which the local server logs.",
};

export const SERVERS: ServerSpec[] = [filesystem, memory, time, git, fetch, markitdown, shell, excel, desktopCommander, chromeDevtools];
