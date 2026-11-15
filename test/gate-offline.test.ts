/*
 * THE GATE REACHES NO NETWORK.
 *
 * Today this is true by accident of what nobody wrote. The notifier that
 * would read a journal and post to a webhook makes it a thing worth
 * holding on purpose: the notifier is to be a SEPARATE program, and the
 * whole value of that arrangement is that the gate itself stays a program
 * in a pipe. A test is what keeps the arrangement from eroding one import
 * at a time.
 *
 * What this checks is the SOURCE, which is a weaker thing than the
 * syscalls: a module could reach the network through something this
 * pattern does not name. The sealed room is where the stronger check
 * lives — watch/gate/room-enforce.mjs counts the connect() calls an
 * enforce run makes and compares them with a run of the server alone. This
 * one runs in the ordinary suite, on every change, which the room cannot.
 */
import { strict as assert } from "node:assert";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { SOURCES as BUILD_ROOTS } from "../watch/gate/build.mjs";

const ROOT = join(import.meta.dirname, "..");

/** The network modules a gate has no business importing. */
const NETWORK = "http|https|net|dns|tls|http2|dgram";

const PATTERNS: Array<[string, RegExp]> = [
  ["an import of a network module", new RegExp(`from\\s*["']node:(${NETWORK})["']`)],
  ["a require of one", new RegExp(`require\\(\\s*["'](node:)?(${NETWORK})["']`)],
  ["a dynamic import of one", new RegExp(`import\\(\\s*["'](node:)?(${NETWORK})["']`)],
  /* Not `x.fetch(`, which is somebody's own method, and not `prefetch(`. */
  ["a fetch call", /(^|[^.\w])fetch\s*\(/],
  ["a socket object", /new\s+(WebSocket|XMLHttpRequest)\b/],
];

/** Every source the built gate is made of, plus every module beside it. */
function sources(): string[] {
  const beside = readdirSync(join(ROOT, "watch", "gate"))
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts"))
    .map((f) => join(ROOT, "watch", "gate", f));
  return [...new Set([...(BUILD_ROOTS as string[]), ...beside])].sort();
}

test("nothing the gate is made of imports a network module, or calls fetch", () => {
  const files = sources();
  assert.ok(files.length >= 20, `only ${files.length} sources found, so this test is not reading them`);
  const found: string[] = [];
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    for (const [what, re] of PATTERNS) {
      if (re.test(src)) found.push(`${relative(ROOT, f)}: ${what}`);
    }
  }
  assert.deepEqual(found, [], `the gate reaches the network:\n  ${found.join("\n  ")}`);
});

test("the built gate carries none of it either", () => {
  /*
   * The second net. tsc compiles what it is given and what that imports,
   * so a module pulled in transitively would land in the build even if the
   * list above had not named it.
   */
  const built = join(ROOT, "watch", "gate", "built");
  if (!existsSync(built)) return; /* not built here; the suite builds its own elsewhere */
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith(".js") ? [join(dir, e.name)] : [],
    );
  const files = walk(built);
  assert.ok(files.length >= 15, `only ${files.length} built files, so this test is not reading them`);
  const found: string[] = [];
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    for (const [what, re] of PATTERNS) {
      if (re.test(src)) found.push(`${relative(ROOT, f)}: ${what}`);
    }
  }
  assert.deepEqual(found, [], `the built gate reaches the network:\n  ${found.join("\n  ")}`);
});

test("the patterns bite: a planted line matching each one is found", () => {
  /*
   * A test that reports a file clean is believed, so the patterns are put
   * through lines that must match and lines that must not. The second list
   * is the one that matters: a pattern that flagged `this.fetch(` or a
   * Content-Security-Policy string would be deleted within a week.
   */
  const matches = [
    'import { request } from "node:https";',
    'const http = require("http");',
    'const m = await import("node:net");',
    "const r = await fetch(url);",
    "const s = new WebSocket(url);",
  ];
  for (const line of matches) {
    assert.ok(PATTERNS.some(([, re]) => re.test(line)), `nothing matched: ${line}`);
  }
  const clean = [
    'const CSP = "default-src \'none\'; connect-src \'none\'";',
    "const r = this.fetch(url);",
    "await client.fetch(thing);",
    "function prefetch(x) { return x; }",
    '/* it does not fetch anything */ const x = 1;',
    'const url = "https://example.invalid/";',
    'import { readFileSync } from "node:fs";',
  ];
  for (const line of clean) {
    const hit = PATTERNS.find(([, re]) => re.test(line));
    assert.ok(!hit, `${hit?.[0]} matched something it should not: ${line}`);
  }
});
