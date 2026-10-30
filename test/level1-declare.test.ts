import { test } from "node:test";
import assert from "node:assert/strict";
import { readDeclaration, whereNamed } from "../level1/declare.ts";
import { slugOf } from "../level1/run.ts";

/*
 * ═══════════════════════════════════════════════════════════════════════════
 * THE ONE PART OF LEVEL 1 THAT DECIDES ANYTHING.
 *
 * Level 1 writes no probe and calls no tool, so there is nothing to test about
 * what a server did — the instrument does that, and the calibration proves the
 * instrument. What is new is the rule that reads a README, and a rule that
 * decides findings has to be pinned: these tests are the statement of what it
 * does, including where it is deliberately loose and in which direction.
 * ═══════════════════════════════════════════════════════════════════════════
 */

test("a host is declared only when the README names it, exactly", () => {
  const d = readDeclaration(
    [
      "# Thing",
      "Visit [our site](https://example.app/#download) for more.",
      "We collect limited, pseudonymous telemetry to improve the tool.",
    ].join("\n"),
  );
  const hosts = d.hosts.map((h) => h.host);

  assert.ok(hosts.includes("example.app"), "a hostname inside a URL is named");
  /* The sentence about telemetry names no host, so it declares none. This is
   * the whole standard: prose is not a declaration. */
  assert.equal(
    hosts.filter((h) => h.startsWith("telemetry.")).length,
    0,
    "prose about telemetry must not declare a telemetry host",
  );
});

test("a subdomain is not its parent", () => {
  const d = readDeclaration("See https://example.app/ for docs.");
  const hosts = d.hosts.map((h) => h.host);
  assert.deepEqual(hosts, ["example.app"]);
  assert.ok(!hosts.includes("telemetry.example.app"));
});

test("every host carries the line it was found on, verbatim", () => {
  const d = readDeclaration(["# Title", "", "Docs at https://docs.example.com/start here."].join("\n"));
  const found = d.hosts.find((h) => h.host === "docs.example.com");
  assert.ok(found);
  assert.equal(found.at.line, 3);
  assert.equal(found.at.text, "Docs at https://docs.example.com/start here.");
});

test("the host rule is loose in the direction that suppresses findings, not invents them", () => {
  /* `capture.js` is a filename, and the rule reads it as a host. Recorded here
   * because it is the one way Level 1 can under-report: a README that mentions
   * a filename matching a host the server contacts. It can never accuse. */
  const d = readDeclaration("Telemetry is sent from dist/utils/capture.js at startup.");
  assert.ok(d.hosts.map((h) => h.host).includes("capture.js"));
});

test("a version string is not a host", () => {
  const d = readDeclaration("Install v0.2.51 or 1.2.3 from the registry.");
  assert.deepEqual(d.hosts.map((h) => h.host), [], "numeric last labels are not hostnames");
});

test("documented tools are backticked snake_case, and nothing looser", () => {
  const d = readDeclaration(
    ["### Available Tools", "", "- `read_file` — read a file", "- `write_file`, `edit_block`", "", "It can also read your files."].join("\n"),
  );
  const names = d.identifiers.map((i) => i.name);
  assert.deepEqual(names, ["edit_block", "read_file", "write_file"]);
  /* Prose words are not tool names, or every README would "document" dozens of
   * tools the server never offered. */
  assert.ok(!names.includes("read"));
});

test("whereNamed is a whole-word lookup, so one tool name is not found inside another", () => {
  const readme = ["# Tools", "The `read_file` tool reads a file.", "There is also read_file_chunk mentioned here."].join("\n");

  const at = whereNamed(readme, "read_file");
  assert.ok(at);
  assert.equal(at.line, 2);

  /* The point: a server offering `read_file_chunk` is not excused by a README
   * that only mentions `read_file`. */
  assert.equal(whereNamed(readme, "write_file"), null);
});

test("whereNamed finds a name in plain prose, not only in backticks", () => {
  /* The generous half, on purpose: the tool comparison must not accuse a
   * server whose README lists its tools in a table without backticks. */
  const readme = "| get_config | reports configuration |";
  assert.ok(whereNamed(readme, "get_config"));
});

test("a name absent from the README is absent, and that is the finding", () => {
  const readme = ["### Available Tools", "- `read_file`", "- `write_file`"].join("\n");
  assert.equal(whereNamed(readme, "get_prompts"), null);
});

test("the same README gives the same reading, digest included", () => {
  const readme = "# A\nSee https://a.example.com/ and `do_thing`.\n";
  const a = readDeclaration(readme);
  const b = readDeclaration(readme);
  assert.deepEqual(a, b);
  assert.equal(a.digest, b.digest);
  assert.match(a.digest, /^[0-9a-f]{64}$/);
});

test("slugs match the shape the curated results already use", () => {
  assert.equal(slugOf("@wonderwhy-er/desktop-commander"), "wonderwhy-er-desktop-commander");
  assert.equal(slugOf("@modelcontextprotocol/server-filesystem"), "modelcontextprotocol-server-filesystem");
  assert.equal(slugOf("mcp-server-fetch"), "mcp-server-fetch");
});
