/*
 * Whether a runner entry names one version, or whatever is current.
 *
 * Three states, never two: having a version is not being pinned, and some
 * specs are not an npm version at all.
 */
import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { packageOf, pinLine, pinState } from "../site/paste-client.js";

const spec = (s: string) => packageOf({ command: "npx", args: ["-y", s] });
const stateOf = (s: string) => pinState(spec(s).spec ?? spec(s).version);

test("an exact version is pinned, prerelease and build metadata included", () => {
  for (const s of ["pkg@1.2.3", "pkg@1.2.3-rc.1", "pkg@1.2.3+build.5", "@scope/pkg@1.2.3", "pkg@0.0.0"]) {
    assert.equal(stateOf(s), "pinned", `${s} was not read as pinned`);
  }
});

test("no version, a dist-tag and a range are all not pinned", () => {
  for (const s of ["pkg", "@scope/pkg", "pkg@latest", "pkg@next", "pkg@beta", "pkg@^1.0.0", "pkg@~1.2", "pkg@1.x", "pkg@>=1", "pkg@*", "pkg@1.2"]) {
    assert.equal(stateOf(s), "not pinned", `${s} was not read as unpinned`);
  }
});

test("a spec that is not an npm version reads as can't tell, never as pinned", () => {
  /*
   * The alias is the one that matters. splitSpec cuts at the LAST "@", so
   * foo@npm:bar@1.2.3 has version "1.2.3" and the npm: that makes it an
   * alias sits in the NAME. Reading only the version calls this pinned to
   * 1.2.3, when what is pinned is a package the page has not identified.
   */
  for (const s of ["foo@npm:bar@1.2.3", "pkg@github:org/repo", "pkg@file:../x", "pkg@link:../x", "pkg@workspace:*", "foo@https://host/x.tgz", "pkg@git+ssh://git@host/x.git"]) {
    assert.equal(stateOf(s), "can't tell", `${s} was not read as can't tell`);
  }
});

test("the three states each have the line they should", () => {
  assert.equal(pinLine("pinned"), null);
  assert.match(pinLine("not pinned")!, /^No version pinned: this can run a different version than the one measured\./);
  assert.match(pinLine("can't tell")!, /^Can't tell whether a version is pinned/);
});

test("the unpinned line says a pinned package is not a pinned dependency tree", () => {
  /* @cyanheads/pubmed-mcp-server@2.11.1 is exactly pinned and stopped
   * starting when ^0.13.18 resolved to a release that raised its Node
   * requirement. A pin removes one way the running code differs, not all. */
  const line = pinLine("not pinned")!;
  assert.match(line, /does not pin what the package installs/);
  assert.match(line, /dependency range can still resolve to something new/);
});

test("a state that is not one of the three produces no line", () => {
  /*
   * The remote and other-ecosystem branches return before a pin state is
   * computed, so `state` arrives undefined. A fall-through default told a
   * reader their uvx entry and their remote URL had no version pinned,
   * neither of which has an npm spec to pin.
   */
  for (const v of [null, undefined, "", "unknown", 0, false]) {
    assert.equal(pinLine(v as never), null, `${JSON.stringify(v)} produced a line`);
  }
});

test("only an npm runner entry carries a pin state at all", () => {
  const kinds: Array<[Record<string, unknown>, string]> = [
    [{ command: "npx", args: ["-y", "pkg"] }, "npm"],
    [{ command: "bunx", args: ["pkg"] }, "npm"],
    [{ command: "some-mcp-server" }, "binary"],
    [{ command: "uvx", args: ["mcp-server-git"] }, "other"],
    [{ command: "docker", args: ["run", "x"] }, "other"],
    [{ url: "https://example.test/mcp" }, "remote"],
  ];
  for (const [entry, kind] of kinds) {
    assert.equal(packageOf(entry).kind, kind, `${JSON.stringify(entry)} classified wrong`);
  }
});

/* ── The built page ────────────────────────────────────────────────────── */

const PAGE = join(import.meta.dirname, "..", "site", "dist", "paste.html");
const built = existsSync(PAGE);

test("the inlined script parses as JavaScript", { skip: !built }, () => {
  /*
   * Three times now a generated artifact has been broken by its own
   * punctuation: a stray backtick in a comment ending the template literal,
   * an apostrophe in "each tool's" ending a single-quoted string, and a
   * duplicate const. tsc catches the first, nothing caught the second until
   * a browser test timed out with no explanation.
   *
   * Parsing the emitted script says which character and where.
   */
  const html = readFileSync(PAGE, "utf8");
  const from = html.indexOf('<script type="module">');
  const code = html.slice(from + '<script type="module">'.length, html.indexOf("</script>", from));
  assert.ok(code.length > 1000, "the inlined script is missing or tiny");
  assert.doesNotThrow(() => new Function(code.replace(/\bexport\s+/g, "")), "the page's inlined script does not parse");
});
