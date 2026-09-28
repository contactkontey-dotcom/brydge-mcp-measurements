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
    { tool: "get_file_info", reason: "Returns stat metadata; overlaps get_file_info reporting, not independently judged here." },
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
    { tool: "git_init", reason: "Would create a repository; the fixture already provides one." },
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

export const SERVERS: ServerSpec[] = [filesystem, memory, time, git, fetch];
