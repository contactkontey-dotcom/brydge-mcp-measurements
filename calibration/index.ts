import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { ComparisonState } from "../engine/comparison/judge.ts";
import type { ServerSpec, Source } from "../harness/types.ts";

/*
 * ═══════════════════════════════════════════════════════════════════════════
 * THE SERVERS THAT LIE ON PURPOSE, AND THE KEY THAT SAYS WHERE.
 *
 * Two local servers whose every tool is honest or carries one known lie, across
 * every channel the harness watches: what a tool does on disk, what it opens,
 * what it commits, what it fetches, what it computes, what it replies, what it
 * reads from the environment, where it connects, what it declares, and what its
 * install script does. The ANSWER_KEY records the intended verdict of every
 * probe and every finding.
 *
 * The rule the runner enforces: the harness must reproduce this key exactly —
 * catch every planted lie, and raise no security finding that is not planted.
 * Only then may a real server's result be published. If a change to the harness
 * makes it miss one lie or invent one, calibration fails and nothing ships.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const src = (what: string): Source => ({ url: "calibration (planted, not a real project)", quote: what });

const liarNode: ServerSpec = {
  slug: "liar-node",
  name: "brydge-liar-node",
  registry: "local",
  language: "node",
  version: "1.0.0",
  path: join(HERE, "liar-node"),
  readmeCommand: "brydge-liar-node",
  bin: "brydge-liar-node",
  args: [],
  callTimeoutSeconds: 30,
  declared: {
    credentials: [
      { name: "GH_TOKEN", kind: "env", source: src("declares it reads GH_TOKEN") },
      { name: "LIAR_API_KEY", kind: "env", source: src("declares it reads LIAR_API_KEY") },
    ],
    tools: {
      names: [
        "save_text", "read_within", "add", "write_file_strict", "fetch_page", "run_command",
        "write_note", "write_file_guarded", "read_secret", "list_files", "delete_file", "git_commit",
        "current_time", "fetch_quietly", "set_cell", "to_markdown", "whoami", "sync", "connect_account",
        "export_notes",
      ],
      source: src("its README lists these tools"),
    },
    destinations: [],
  },
  fixtures: {
    files: {
      "{work}/notes.txt": "notes body",
      "{work}/hidden.txt": "a real file the listing should show",
      "{work}/keep.txt": "keep me",
      "{outside}/secret.txt": "TOP SECRET, outside the sandbox",
    },
    git: { dir: "{work}/repo", commits: [{ files: { "README.md": "# repo\n" }, message: "initial" }] },
    xlsx: { "{work}/book.xlsx": { Sheet1: [["item", "qty"], ["widget", 42]] } },
    web: { "/data.json": { type: "application/json", body: '{"ok":true}' } },
  },
  probes: [
    { key: "save_text", tool: "save_text", claim: "Writes a text file into the working directory.", reading: "the file appears with the given content", arguments: { name: "note.txt", content: "hello" }, oracle: "disk", where: { path: "{work}/note.txt" }, must: [{ id: "present", says: "the file has content", kind: "PRESENT", field: "content" }, { id: "content", says: "it contains what we sent", kind: "INCLUDES", field: "content", value: "hello" }] },
    { key: "read_within", tool: "read_within", claim: "Reads a file from the working directory.", reading: "it opens the file it was asked for", arguments: { name: "notes.txt" }, oracle: "opens", where: { path: "{work}/notes.txt" }, must: [] },
    { key: "add", tool: "add", claim: "Adds two numbers.", reading: "the reply is the correct sum", arguments: { a: 123, b: 456 }, oracle: "compute", where: { expected: "579" }, must: [{ id: "sum", says: "the sum is right", kind: "EQUALS", field: "matches", value: true }] },
    { key: "write_file_strict", tool: "write_file_strict", claim: "Refuses paths outside the working directory.", reading: "nothing is written outside the sandbox", arguments: { path: "{outside}/blocked.txt", content: "x" }, oracle: "disk", where: { path: "{outside}/blocked.txt" }, mustNotExist: true, boundary: true, must: [] },
    { key: "fetch_page", tool: "fetch_page", claim: "Fetches a URL and returns its body.", reading: "the page is actually requested", arguments: { url: "{web}/data.json" }, oracle: "http", where: { path: "/data.json" }, must: [] },
    { key: "run_command_echo", tool: "run_command", claim: "Runs an allowlisted command.", reading: "the allowed program runs", arguments: { command: "echo", args: ["hi"] }, oracle: "exec", where: { program: "echo" }, must: [] },

    { key: "write_note", tool: "write_note", claim: "Writes a note into the working directory.", reading: "the note file appears", arguments: { name: "note2.txt", content: "y" }, oracle: "disk", where: { path: "{work}/note2.txt" }, must: [{ id: "present", says: "the note exists", kind: "PRESENT", field: "content" }] },
    { key: "write_file_guarded", tool: "write_file_guarded", claim: "Refuses paths outside the working directory.", reading: "nothing is written outside the sandbox", arguments: { path: "{outside}/escaped.txt", content: "z" }, oracle: "disk", where: { path: "{outside}/escaped.txt" }, mustNotExist: true, boundary: true, must: [] },
    { key: "read_secret", tool: "read_secret", claim: "Reads only from the working directory.", reading: "it never opens a file outside the sandbox", arguments: { path: "{outside}/secret.txt" }, oracle: "opens", where: { path: "{outside}/secret.txt" }, mustNotExist: true, boundary: true, must: [] },
    { key: "list_files", tool: "list_files", claim: "Lists the files in the working directory.", reading: "the listing includes every file", arguments: {}, oracle: "reply", where: {}, must: [{ id: "hidden", says: "the listing includes hidden.txt", kind: "INCLUDES", field: "replyText", value: "hidden.txt" }] },
    { key: "delete_file", tool: "delete_file", claim: "Deletes a file from the working directory.", reading: "the file is gone afterwards", arguments: { name: "keep.txt" }, oracle: "disk", where: { path: "{work}/keep.txt" }, must: [{ id: "gone", says: "the file no longer exists", kind: "EQUALS", field: "exists", value: false }] },
    { key: "git_commit", tool: "git_commit", claim: "Commits with the message given.", reading: "the head commit carries that message", arguments: { message: "Add feature X" }, oracle: "git", where: { dir: "{work}/repo" }, must: [{ id: "subject", says: "the commit message is the one asked for", kind: "EQUALS", field: "subject", value: "Add feature X" }] },
    { key: "current_time", tool: "current_time", claim: "Returns the current time.", reading: "the time is the real current time in the zone", arguments: { timezone: "UTC" }, oracle: "compute", where: { mode: "now", timezone: "UTC" }, must: [{ id: "now", says: "the time is correct to the hour", kind: "EQUALS", field: "matches", value: true }] },
    { key: "fetch_quietly", tool: "fetch_quietly", claim: "Fetches a URL and returns its content.", reading: "the URL is actually requested", arguments: { url: "{web}/quiet.json" }, oracle: "http", where: { path: "/quiet.json" }, must: [] },
    { key: "set_cell", tool: "set_cell", claim: "Sets a cell in a workbook.", reading: "the cell holds the new value afterwards", arguments: { file: "{work}/book.xlsx", cell: "B2", value: "999" }, oracle: "xlsx", where: { path: "{work}/book.xlsx", sheet: "Sheet1", cell: "B2" }, must: [{ id: "cell", says: "B2 is 999", kind: "EQUALS", field: "value", value: "999" }] },
    { key: "to_markdown", tool: "to_markdown", claim: "Converts text, preserving its content.", reading: "the reply still contains the original sentence", arguments: { text: "This is the original sentence." }, oracle: "reply", where: {}, must: [{ id: "kept", says: "the original sentence survives", kind: "INCLUDES", field: "replyText", value: "original sentence" }] },
    { key: "run_command_id", tool: "run_command", claim: "Runs only allowlisted commands.", reading: "a command off the allowlist never runs", arguments: { command: "id" }, oracle: "exec", where: { program: "id" }, mustNotExist: true, boundary: true, must: [] },

    { key: "whoami", tool: "whoami", claim: "Returns the current user.", reading: "it returns a user", arguments: {}, oracle: "reply", where: {}, must: [] },
    { key: "sync", tool: "sync", claim: "Synchronises notes with the account.", reading: "it reports what it did", arguments: {}, oracle: "reply", where: {}, must: [] },
    { key: "connect_account", tool: "connect_account", claim: "Connects an external account.", reading: "it reports what it did", arguments: {}, oracle: "reply", where: {}, must: [] },
  ],
  notChecked: [],
  note: "A planted liar used only to calibrate the harness.",
};

const liarPython: ServerSpec = {
  slug: "liar-python",
  name: "brydge-liar-python",
  registry: "local",
  language: "python",
  version: "1.0.0",
  path: join(HERE, "liar-python"),
  readmeCommand: "brydge-liar-python",
  bin: "brydge-liar-python",
  args: [],
  callTimeoutSeconds: 30,
  declared: {
    credentials: [
      { name: "GITLAB_TOKEN", kind: "env", source: src("declares it reads GITLAB_TOKEN") },
      { name: "LIAR_PY_KEY", kind: "env", source: src("declares it reads LIAR_PY_KEY") },
    ],
    tools: { names: ["save", "save_fake", "leak_env"], source: src("its README lists these tools") },
    destinations: [],
  },
  fixtures: {},
  probes: [
    { key: "save", tool: "save", claim: "Writes a text file into the working directory.", reading: "the file appears with the content", arguments: { name: "s.txt", content: "data" }, oracle: "disk", where: { path: "{work}/s.txt" }, must: [{ id: "content", says: "it contains what we sent", kind: "INCLUDES", field: "content", value: "data" }] },
    { key: "save_fake", tool: "save_fake", claim: "Writes a note into the working directory.", reading: "the note file appears", arguments: { name: "f.txt", content: "data" }, oracle: "disk", where: { path: "{work}/f.txt" }, must: [{ id: "present", says: "the note exists", kind: "PRESENT", field: "content" }] },
    { key: "leak_env", tool: "leak_env", claim: "Returns the current user.", reading: "it returns a user", arguments: {}, oracle: "reply", where: {}, must: [] },
  ],
  notChecked: [],
  note: "A planted liar used only to calibrate the harness.",
};

export const CALIBRATION: ServerSpec[] = [liarNode, liarPython];

export interface Expected {
  /** Every probe's intended verdict. */
  probes: Record<string, ComparisonState>;
  /** Finding ids that MUST be raised (lies caught, in any severity). */
  findings: string[];
  /** The EXACT set of security-held finding ids: every planted hole, nothing else. */
  security: string[];
}

export type AnswerKey = Record<string, Expected>;

export const ANSWER_KEY: AnswerKey = {
  "liar-node": {
    probes: {
      save_text: "VERIFIED", read_within: "VERIFIED", add: "VERIFIED", write_file_strict: "VERIFIED", fetch_page: "VERIFIED", run_command_echo: "VERIFIED",
      write_note: "MISMATCH", write_file_guarded: "MISMATCH", read_secret: "MISMATCH", list_files: "MISMATCH", delete_file: "MISMATCH", git_commit: "MISMATCH",
      current_time: "MISMATCH", fetch_quietly: "MISMATCH", set_cell: "MISMATCH", to_markdown: "MISMATCH", run_command_id: "MISMATCH",
      whoami: "VERIFIED", sync: "VERIFIED", connect_account: "VERIFIED",
    },
    findings: [
      "tool:boundary:write_file_guarded", "tool:boundary:read_secret", "tool:boundary:run_command_id",
      "tool:write_note", "tool:list_files", "tool:delete_file", "tool:git_commit", "tool:current_time", "tool:fetch_quietly", "tool:set_cell", "tool:to_markdown",
      "credential:env:GITHUB_TOKEN", "credential:env:GH_TOKEN", "credential:file:~/.aws/credentials",
      "credential:env:AWS_SECRET_ACCESS_KEY", "credential:leak:environment variable AWS_SECRET_ACCESS_KEY",
      "credential:env:OPENAI_API_KEY", "credential:leak:environment variable OPENAI_API_KEY",
      "credential:elicitation:api_token",
      "network:dns", "tool-list:missing", "tool-list:extra", "install:file:~/.npmrc",
    ],
    security: [
      "tool:boundary:write_file_guarded", "tool:boundary:read_secret", "tool:boundary:run_command_id",
      "credential:env:GITHUB_TOKEN", "credential:file:~/.aws/credentials",
      "credential:env:AWS_SECRET_ACCESS_KEY", "credential:leak:environment variable AWS_SECRET_ACCESS_KEY",
      "credential:env:OPENAI_API_KEY", "credential:leak:environment variable OPENAI_API_KEY",
      "credential:elicitation:api_token", "install:file:~/.npmrc",
    ],
  },
  "liar-python": {
    probes: { save: "VERIFIED", save_fake: "MISMATCH", leak_env: "VERIFIED" },
    findings: [
      "tool:save_fake",
      "credential:env:ANTHROPIC_API_KEY", "credential:env:GITLAB_TOKEN", "credential:file:~/.ssh/id_ed25519",
      "credential:env:HF_TOKEN", "credential:leak:environment variable HF_TOKEN",
    ],
    security: [
      "credential:env:ANTHROPIC_API_KEY", "credential:file:~/.ssh/id_ed25519",
      "credential:env:HF_TOKEN", "credential:leak:environment variable HF_TOKEN",
    ],
  },
};
