/*
 * A bare command that several measured packages install.
 *
 * `command: "mcp"` with no package argument used to resolve by stripping the
 * scope off every measured package and keeping the LAST one to claim the
 * tail. 18 of the 67 are scoped packages whose tail is `mcp`, so the page
 * showed @thallylabs/mcp's report — linked, with its tool count and startup
 * time — when it could as easily have been @kolbo/mcp. It was not a hedge:
 * the page asserted it, and the figures fed the totals and the share card.
 */
import { strict as assert } from "node:assert";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { match, packageOf, totals, uncountedLine } from "../site/paste-client.js";

const ROOT = join(import.meta.dirname, "..");
const EV = join(ROOT, "level1", "evidence");

/** The index exactly as site/build.ts builds it. */
function buildIndex() {
  const items = readdirSync(EV)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(EV, f), "utf8")))
    .filter((e) => e.observed && e.comparison);
  const index: Record<string, any> = {};
  for (const e of items) {
    index[e.package.name] = {
      name: e.package.name, slug: e.slug, version: e.package.version,
      measuredAt: e.measuredAt.slice(0, 10), offered: e.observed.offered.length,
      undocumentedTools: e.comparison.tools.undocumented.length,
      undeclaredHosts: e.comparison.hosts.undeclared.length,
      websites: [...new Set([...e.observed.dnsNames, ...e.observed.tlsHosts])].length,
      startupMs: e.startup?.toToolListMs ?? null,
    };
  }
  const byTail: Record<string, Array<{ name: string; slug: string }>> = {};
  for (const e of items) {
    const tail = e.package.name.replace(/^@[^/]+\//, "");
    (byTail[tail] ??= []).push({ name: e.package.name, slug: e.slug });
  }
  for (const [tail, names] of Object.entries(byTail)) {
    index[`bin:${tail}`] = names.length === 1
      ? index[names[0]!.name]
      : { ambiguous: true, command: tail, names: names.sort((a, b) => a.name.localeCompare(b.name)) };
  }
  return index;
}

const index = buildIndex();
const row = (command: string) =>
  match({ label: command, command, args: [], url: null, type: null, envKeys: [], found: packageOf({ command }) }, index);

test('{"command":"mcp"} names all 18 and resolves to none of them', () => {
  const m = row("mcp");
  assert.equal(m.state, "ambiguous-command");
  assert.equal(m.command, "mcp");
  assert.equal(m.candidates!.length, 18);
  assert.equal(m.record, undefined, "an ambiguous row still carries a record");
  /* the one it used to pick, and one it could as easily have picked */
  assert.ok(m.candidates!.some((c: any) => c.name === "@thallylabs/mcp"));
  assert.ok(m.candidates!.some((c: any) => c.name === "@kolbo/mcp"));
  /* sorted, so the list does not depend on directory order */
  assert.deepEqual(m.candidates!.map((c: any) => c.name), [...m.candidates!.map((c: any) => c.name)].sort());
});

test('{"command":"mcp-server"} names all 6 and resolves to none of them', () => {
  const m = row("mcp-server");
  assert.equal(m.state, "ambiguous-command");
  assert.equal(m.candidates!.length, 6);
  assert.ok(m.candidates!.some((c: any) => c.name === "@ui5/mcp-server"));
  assert.equal(m.record, undefined);
});

test("a tail only one package claims still resolves", () => {
  for (const cmd of ["wikipedia-mcp", "ssh-mcp", "package-registry-mcp"]) {
    const m = row(cmd);
    assert.equal(m.state, "measured", `${cmd} stopped resolving`);
    assert.equal(m.record!.name, cmd);
  }
});

test("an unknown command is still unmeasured, not ambiguous", () => {
  assert.equal(row("nothing-like-this").state, "unmeasured");
});

/* ── Never counted ─────────────────────────────────────────────────────── */

const rowsFor = (commands: string[]) =>
  commands.map((c) => ({
    server: { label: c, command: c, args: [], url: null, type: null, envKeys: [], found: packageOf({ command: c }) },
    result: row(c),
  }));

test("an ambiguous row counts for nothing in the totals", () => {
  const t = totals(rowsFor(["mcp", "mcp-server", "wikipedia-mcp"]));
  assert.equal(t.servers, 3);
  assert.equal(t.counted, 1, "an ambiguous row was counted as measured");
  assert.equal(t.ambiguous, 2);
  /* its tools and its startup time are not in the sums */
  const alone = totals(rowsFor(["wikipedia-mcp"]));
  assert.equal(t.tools, alone.tools, "an ambiguous row added tools to the total");
  assert.equal(t.startupMs, alone.startupMs, "an ambiguous row added time to the total");
});

test("it is not lumped in with entries that could not be read", () => {
  const t = totals(rowsFor(["mcp"]));
  assert.equal(t.unreadable, 0, "an ambiguous command was called unreadable");
  assert.equal(t.noPage, 0, "an ambiguous command was called unmeasured");
  assert.equal(t.ambiguous, 1);
});

test("the uncounted line names the reason in its own words", () => {
  const line = uncountedLine(totals(rowsFor(["mcp", "wikipedia-mcp"])));
  assert.match(line, /covers 1 of your 2 servers/);
  assert.match(line, /1 naming a command that several measured packages install/);
  assert.match(line, /not knowable from the config/);
  assert.ok(!/could not be read/.test(line), "it used the unreadable wording");
});

/* ── The built page ────────────────────────────────────────────────────── */

const PAGE = join(ROOT, "site", "dist", "paste.html");
const built = existsSync(PAGE);

test("the built index carries the ambiguity, not one arbitrary winner", { skip: !built }, () => {
  const html = readFileSync(PAGE, "utf8");
  assert.match(html, /"bin:mcp":\{"ambiguous":true,"command":"mcp","names":\[/);
  assert.match(html, /"bin:mcp-server":\{"ambiguous":true/);
  /* a single-claim tail is still a plain record */
  assert.match(html, /"bin:wikipedia-mcp":\{"name":"wikipedia-mcp"/);
});

test("the page says it cannot tell, and links no one of them as the answer", { skip: !built }, () => {
  const html = readFileSync(PAGE, "utf8");
  assert.match(html, /Several measured packages install a command called/);
  assert.match(html, /this cannot tell which one you run/);
  assert.match(html, /It is not counted in the totals below/);
  assert.match(html, /Put the package in the config to get an answer/);
});
