/*
 * What the pin used to be.
 *
 * Every pin here is built from planted tools. Nothing reads a capture, a
 * transcript or a real pin, and no description text is printed: the history
 * listing carries names, counts, dates and hashes.
 */
import { strict as assert } from "node:assert";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { archive, historyDir, list, NoSuchArchive, renderHistory, rollback } from "../watch/gate/history.ts";
import { ADOPTED, adopt, NotAPin, pathFor, read as readPin, serialize, write as writePin } from "../watch/gate/pin.ts";
import { enforcingLine } from "../watch/gate/enforce.ts";
import { recordOf } from "../watch/tools.ts";
import { CONTAINMENT, flatten, GATEKEEPING } from "./banned.ts";

const A = "FIXTURE A: adds its two numbers and returns the sum.";
const B = "FIXTURE B: adds the two numbers it is given and returns the total.";
const schema = { type: "object", properties: { a: { type: "number" } }, required: ["a"] };

const tool = (name: string, description: string) => recordOf({ name, description, inputSchema: schema });
const pinOf = (names: Array<[string, string]>, at = "2026-11-13") =>
  adopt("fixture-mcp", "1.0.0", names.map(([n, d]) => tool(n, d)), at);

/** A pins directory with a pin already in it. */
function fixture(names: Array<[string, string]> = [["demo_add", A]]) {
  const dir = mkdtempSync(join(tmpdir(), "gate-history-"));
  const file = pathFor(dir, "fixture-mcp", "1.0.0");
  writePin(file, pinOf(names));
  return { dir, file };
}

/* A clock that moves, so two copies in one test do not collide. */
function clock(from = Date.parse("2026-11-13T07:00:00.000Z")) {
  let n = from;
  return () => new Date((n += 60_000));
}

test("archiving a pin that is not there is not a failure", () => {
  const dir = mkdtempSync(join(tmpdir(), "gate-history-"));
  assert.equal(archive(join(dir, "nothing.json")), null);
  assert.equal(list(join(dir, "nothing.json")).length, 0);
});

test("a copy is the bytes on disk, not a re-serialisation of them", () => {
  const { file } = fixture();
  /* The pin is rewritten with different spacing but the same content, so a
   * copy that re-serialised would come back with the canonical spacing and
   * the sha256 in the index would be of something nobody had. */
  const odd = serialize(pinOf([["demo_add", A]])).replace(/\n/g, "\n ");
  writeFileSync(file, odd);
  const r = archive(file, clock());
  assert.ok(r);
  assert.equal(readFileSync(r.file, "utf8"), odd, "the archived bytes are not the bytes that were there");
  const rows = list(file);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.sha256, r.sha256);
  assert.equal(rows[0]!.bytes, Buffer.byteLength(odd));
});

test("the pin it copied is left exactly as it was", () => {
  const { file } = fixture();
  const before = readFileSync(file);
  const inode = statSync(file).ino;
  archive(file, clock());
  assert.ok(readFileSync(file).equals(before), "archiving changed the pin");
  assert.equal(statSync(file).ino, inode, "archiving replaced the pin file");
});

test("the copies live beside the pin, in a directory of their own", () => {
  const { dir, file } = fixture();
  const r = archive(file, clock());
  assert.ok(r!.file.startsWith(historyDir(file)), `${r!.file} is not under ${historyDir(file)}`);
  assert.ok(historyDir(file).startsWith(join(dir, "history")), "the history is not beside the pin");
  /* A second pin in the same directory keeps its own history. */
  const other = pathFor(dir, "other-mcp", "2.0.0");
  assert.notEqual(historyDir(other), historyDir(file));
});

test("archiving the same bytes twice in the same moment keeps one copy", () => {
  const { file } = fixture();
  const at = () => new Date("2026-11-13T07:00:00.000Z");
  const first = archive(file, at);
  const second = archive(file, at);
  assert.equal(first!.file, second!.file);
  assert.equal(list(file).length, 1, "the same bytes were archived twice");
});

test("every replacement is kept, newest first", () => {
  const { file } = fixture();
  const at = clock();
  archive(file, at);
  writePin(file, pinOf([["demo_add", B]]));
  archive(file, at);
  writePin(file, pinOf([["demo_add", B], ["demo_echo", A]]));
  archive(file, at);
  const rows = list(file);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => r.tools), [2, 1, 1], "the newest copy is not first");
  for (const r of rows) {
    assert.equal(r.package, "fixture-mcp");
    assert.equal(r.unreadable, null);
    assert.match(r.archivedAt, /^2026-11-13T07:0\d:00\.000Z$/);
  }
});

test("a file in the history that is not a copy is left alone", () => {
  const { file } = fixture();
  archive(file, clock());
  mkdirSync(historyDir(file), { recursive: true });
  writeFileSync(join(historyDir(file), "notes.txt"), "a person put this here");
  writeFileSync(join(historyDir(file), "pin.json"), "{}");
  const rows = list(file);
  assert.equal(rows.length, 1, "something that is not a copy was listed as one");
  assert.ok(existsSync(join(historyDir(file), "notes.txt")), "a file that was not ours was removed");
});

test("a copy that cannot be read is listed as unreadable, not dropped", () => {
  const { file } = fixture();
  const r = archive(file, clock());
  writeFileSync(r!.file, '{"format":"brydge-gate-pin","version":1,"package":"p"}');
  const rows = list(file);
  assert.equal(rows.length, 1);
  assert.match(rows[0]!.unreadable!, /names no packageVersion/);
  assert.equal(rows[0]!.tools, null);
  /* And it is shown as such rather than offered as something to go back to. */
  assert.match(renderHistory(file, rows), /CANNOT BE READ/);
});

/* ── Going back ─────────────────────────────────────────────────────────── */

test("rolling back puts the chosen version in place, byte for byte", () => {
  const { file } = fixture();
  const at = clock();
  const original = readFileSync(file);
  archive(file, at);
  writePin(file, pinOf([["demo_add", B]]));
  assert.ok(!readFileSync(file).equals(original), "the pin did not change");

  const r = rollback(file, 1, at);
  assert.ok(readFileSync(file).equals(original), "the pin is not what was archived");
  assert.equal(Object.keys(r.pin.tools).length, 1);
  assert.equal(readPin(file).tools["demo_add"]!.descriptionHash, tool("demo_add", A).descriptionHash);
});

test("a rollback archives what it replaced, so it can be rolled back", () => {
  const { file } = fixture();
  const at = clock();
  archive(file, at);
  const second = pinOf([["demo_add", B]]);
  writePin(file, second);
  const r = rollback(file, 1, at);
  assert.ok(r.archivedCurrent, "the version that was in place was not archived");
  /* The one just replaced is now the newest copy, so 1 goes forward again. */
  rollback(file, 1, at);
  assert.equal(readPin(file).tools["demo_add"]!.descriptionHash, tool("demo_add", B).descriptionHash);
});

test("a copy can be chosen by name as well as by number", () => {
  const { file } = fixture();
  const at = clock();
  const first = archive(file, at)!;
  writePin(file, pinOf([["demo_add", B]]));
  archive(file, at);
  writePin(file, pinOf([["demo_echo", A]]));
  const r = rollback(file, list(file).find((x) => x.file === first.file)!.name, at);
  assert.equal(r.installed.file, first.file);
  assert.deepEqual(Object.keys(readPin(file).tools), ["demo_add"]);
});

test("asking for a version that is not there changes nothing", () => {
  const { file } = fixture();
  const at = clock();
  archive(file, at);
  const before = readFileSync(file);
  assert.throws(() => rollback(file, 9, at), (e: Error) => e instanceof NoSuchArchive && /and no number 9/.test(e.message));
  assert.throws(() => rollback(file, "nope.json", at), (e: Error) => e instanceof NoSuchArchive);
  assert.ok(readFileSync(file).equals(before), "a failed rollback changed the pin");
  assert.equal(list(file).length, 1, "a failed rollback archived something");
});

test("with no history at all, nothing is changed and it says so", () => {
  const { file } = fixture();
  const before = readFileSync(file);
  assert.throws(() => rollback(file, 1), (e: Error) => e instanceof NoSuchArchive && /no history/.test(e.message));
  assert.ok(readFileSync(file).equals(before));
});

test("a copy that is not a pin is never put where a gate would read it", () => {
  const { file } = fixture();
  const at = clock();
  const r = archive(file, at)!;
  const good = readFileSync(file);
  writeFileSync(r.file, "{ not a pin");
  assert.throws(() => rollback(file, 1, at), (e: Error) => e instanceof NotAPin);
  assert.ok(readFileSync(file).equals(good), "a file that is not a pin was installed over the pin");
  assert.equal(list(file).length, 1, "the failed rollback archived the pin anyway");
});

/* ── What it says ───────────────────────────────────────────────────────── */

test("the listing carries no description, and no word that claims more than it does", () => {
  const { file } = fixture([["demo_add", A], ["demo_echo", B]]);
  const at = clock();
  archive(file, at);
  writePin(file, pinOf([["demo_add", B]]));
  archive(file, at);
  const text = renderHistory(file, list(file));
  assert.ok(!text.includes(A) && !text.includes(B), "the listing printed a description");
  assert.ok(!text.includes("FIXTURE"), "the listing printed description text");
  assert.match(text, /2 archived version\(s\), newest first/);
  assert.match(text, /gate rollback/);
  const flat = flatten(text);
  for (const w of [...CONTAINMENT, ...GATEKEEPING]) assert.ok(!flat.includes(w), `the listing says "${w}"`);
});

test("an empty history says what would fill it", () => {
  const { file } = fixture();
  const text = renderHistory(file, []);
  assert.match(text, /No previous version has been archived/);
  assert.match(text, /each time the pin is replaced/);
});

/* ── Driven through the command line ────────────────────────────────────── */

/*
 * `gate approve` and `gate rollback`, run as a person runs them.
 *
 * Every fixture here is planted and the reviewer is `example-approver`. The
 * report is built by the same code the gate writes one with, so what is
 * approved is what a gate would have reported.
 */
import { spawnSync } from "node:child_process";
import { pendingOf } from "../watch/gate/report.ts";
import { FORMAT, FORMAT_VERSION } from "../watch/review.ts";
import type { WouldHide } from "../watch/gate/router.ts";

const CLI = join(import.meta.dirname, "..", "watch", "cli.ts");
const WHO = "example-approver";
const DAY = "2026-11-13";

interface Shell {
  out: string;
  err: string;
  code: number;
}

function cli(args: string[]): Shell {
  /* spawnSync, not execFileSync: the throwing form hands back stderr only
   * on failure, and the lines this has to check are written on success. */
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return { out: r.stdout ?? "", err: r.stderr ?? "", code: r.status ?? 1 };
}

/** A pins directory, a pin, a report against it and a decision file. */
function approvable() {
  const dir = mkdtempSync(join(tmpdir(), "gate-approve-cli-"));
  const pins = join(dir, "pins");
  const file = pathFor(pins, "fixture-mcp", "1.0.0");
  const pin = pinOf([["demo_add", A], ["demo_echo", A]], "2026-11-01");
  writePin(file, pin);

  /* The live surface: one description moved. */
  const liveTools = [tool("demo_add", B), tool("demo_echo", A)];
  const hide: WouldHide[] = [{ tool: "demo_add", because: "its description differs from the baseline" }];
  const pending = pendingOf(pin, liveTools, hide, DAY);
  const report = join(dir, "report.json");
  writeFileSync(report, JSON.stringify(pending, null, 2));

  const item = pending.prepared.items.find((i) => i.tool === "demo_add")!;
  const decisionsOut = join(dir, "decisions.json");
  const exported = join(dir, "export.json");
  writeFileSync(
    exported,
    JSON.stringify({
      format: FORMAT,
      version: FORMAT_VERSION,
      package: "fixture-mcp",
      fromVersion: "pinned 2026-11-01",
      toVersion: `offered ${DAY}`,
      decisions: [{ kind: item.kind, name: "demo_add", decision: "approve", by: WHO, at: DAY, itemHash: item.itemHash }],
    }),
  );
  return { dir, pins, file, report, exported, decisionsOut };
}

test("gate approve archives the pin it replaces, and says where", () => {
  const f = approvable();
  const was = readFileSync(f.file);
  const r = cli(["gate", "approve", "--pending", f.report, "--decisions-from", f.exported, "--pins", f.pins, "--decisions", f.decisionsOut]);
  assert.equal(r.code, 0, `${r.err}\n${r.out}`);
  assert.ok(!readFileSync(f.file).equals(was), "the approval did not change the pin");

  const rows = list(f.file);
  assert.equal(rows.length, 1, "the pin that was replaced was not archived");
  assert.ok(readFileSync(rows[0]!.file).equals(was), "what was archived is not what was there");
  assert.match(r.err, /the pin that was in place ->/);
  assert.match(r.err, /gate rollback fixture-mcp@1\.0\.0 --to 1/);
});

test("gate rollback with no --to lists and changes nothing", () => {
  const f = approvable();
  cli(["gate", "approve", "--pending", f.report, "--decisions-from", f.exported, "--pins", f.pins, "--decisions", f.decisionsOut]);
  const after = readFileSync(f.file);
  const r = cli(["gate", "rollback", "fixture-mcp@1.0.0", "--pins", f.pins]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /1 archived version\(s\), newest first/);
  assert.ok(readFileSync(f.file).equals(after), "listing the history changed the pin");
  assert.ok(!r.out.includes(A) && !r.out.includes(B), "the listing printed a description");
});

test("gate rollback --to 1 puts the approved-over pin back", () => {
  const f = approvable();
  const was = readFileSync(f.file);
  cli(["gate", "approve", "--pending", f.report, "--decisions-from", f.exported, "--pins", f.pins, "--decisions", f.decisionsOut]);
  const r = cli(["gate", "rollback", "fixture-mcp@1.0.0", "--to", "1", "--pins", f.pins]);
  assert.equal(r.code, 0, r.err);
  assert.ok(readFileSync(f.file).equals(was), "the pin is not what it was before the approval");
  assert.match(r.out, /is now the version archived at/);
  assert.match(r.out, /so this can be rolled back too/);
  /* The decisions are not undone: the record of who decided what stands. */
  assert.match(r.out, /still records every decision that was made/);
  assert.ok(existsSync(f.decisionsOut), "the decisions file went away");
  assert.match(readFileSync(f.decisionsOut, "utf8"), /example-approver/);
});

test("gate rollback to a version that is not there exits non-zero and changes nothing", () => {
  const f = approvable();
  cli(["gate", "approve", "--pending", f.report, "--decisions-from", f.exported, "--pins", f.pins, "--decisions", f.decisionsOut]);
  const after = readFileSync(f.file);
  const r = cli(["gate", "rollback", "fixture-mcp@1.0.0", "--to", "7", "--pins", f.pins]);
  assert.notEqual(r.code, 0, "it exited zero having changed nothing");
  assert.match(r.err, /Nothing was changed/);
  assert.ok(readFileSync(f.file).equals(after));
});

test("gate rollback for a pin with no history says so", () => {
  const f = approvable();
  const r = cli(["gate", "rollback", "fixture-mcp@1.0.0", "--pins", f.pins]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /No previous version has been archived/);
});

test("the commands are in the usage, so somebody can find them", () => {
  const r = cli([]);
  assert.match(r.err + r.out, /gate rollback <package@version> \[--to <number\|name>\]/);
});

/* ── The page a gate's report makes, and the loop it closes ─────────────── */

/*
 * `review --page <pkg> <a> <b>` reads two stored measurement captures,
 * which a server this project has never measured does not have — so there
 * was no way from a gate's own report to the review page at all, and a
 * reviewer had to hand-write the export file by reading item hashes out of
 * JSON. `--from-pending` renders the same page from the report's own
 * prepared queue.
 *
 * Every fixture here is planted. The page is read as bytes and searched;
 * no description is printed.
 */

test("review --page --from-pending renders the report's own queue", () => {
  const f = approvable();
  const r = cli(["review", "--page", "--from-pending", f.report]);
  assert.equal(r.code, 0, `${r.err}\n${r.out}`);
  assert.match(r.err, /1 item\(s\) -> /);
  assert.match(r.err, /makes no network request/);
  /* It says what to do next, with the report it was made from. */
  assert.match(r.err, new RegExp(`gate approve --pending ${f.report.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}`));

  const file = /-> (\S+\.html)/.exec(r.err)![1]!;
  const page = readFileSync(file, "utf8");
  /* The same page as the other command makes: no network, and a CSP that
   * allows none. */
  assert.match(page, /<title>Review fixture-mcp/);
  assert.match(page, /default-src 'none'/);
  assert.match(page, /connect-src 'none'/);
  assert.equal([...page.matchAll(/https?:\/\//g)].length, 0, "the page references a URL");
  assert.equal([...page.matchAll(/\ssrc=/g)].length, 0, "the page loads something");
  /* And the item is there, by name and by hash, so a decision can be made. */
  assert.ok(page.includes("demo_add"), "the flagged tool is not on the page");
  const hash = (JSON.parse(readFileSync(f.report, "utf8")) as { prepared: { items: Array<{ itemHash: string }> } }).prepared.items[0]!.itemHash;
  assert.ok(page.includes(hash), "the item's hash is not on the page, so a decision could not be tied to it");
});

test("it refuses anything that is not a gate report, by name", () => {
  const f = approvable();
  const dir = mkdtempSync(join(tmpdir(), "gate-page-bad-"));
  const notJson = join(dir, "x.json");
  writeFileSync(notJson, "{ this is not json");
  const wrongFormat = join(dir, "y.json");
  writeFileSync(wrongFormat, JSON.stringify({ format: "something-else" }));
  const noQueue = join(dir, "z.json");
  writeFileSync(noQueue, JSON.stringify({ format: "brydge-gate-pending" }));

  for (const [file, why] of [
    [join(dir, "missing.json"), /No such report/],
    [notJson, /is not a gate report/],
    [wrongFormat, /its format is "something-else"/],
    [noQueue, /carries no prepared queue/],
  ] as const) {
    const r = cli(["review", "--page", "--from-pending", file]);
    assert.notEqual(r.code, 0, `${file} was accepted`);
    assert.match(r.err, why);
  }
  /* And --from-pending with no value says so rather than guessing. */
  const bare = cli(["review", "--page", "--from-pending"]);
  assert.notEqual(bare.code, 0);
  assert.match(bare.err, /--from-pending needs the report file a gate wrote/);
  void f;
});

test("the loop closes: a tool approved from the report is pinned, and the line says so", () => {
  /*
   * The whole point. Before: one item differs and the pin does not name
   * it. After `gate approve`: the pin carries it, with who decided and
   * when, and the line a person reads at startup counts it.
   */
  const f = approvable();
  const before = readPin(f.file);
  assert.equal(before.tools["demo_add"]!.how, ADOPTED);
  assert.equal(before.tools["demo_add"]!.by, null);
  assert.match(enforcingLine(before, f.file), /adopted, not reviewed\./);
  assert.ok(!/carries a decision/.test(enforcingLine(before, f.file)), "it counted a decision nobody made");

  const r = cli(["gate", "approve", "--pending", f.report, "--decisions-from", f.exported, "--pins", f.pins, "--decisions", f.decisionsOut]);
  assert.equal(r.code, 0, `${r.err}\n${r.out}`);

  const after = readPin(f.file);
  assert.equal(after.tools["demo_add"]!.how, "approve");
  assert.equal(after.tools["demo_add"]!.by, WHO);
  assert.equal(after.tools["demo_add"]!.at, DAY);
  /* The approved description is what is pinned now, so it no longer differs. */
  assert.equal(after.tools["demo_add"]!.descriptionHash, tool("demo_add", B).descriptionHash);
  /* The other tool is untouched: approving one approves one. */
  assert.equal(after.tools["demo_echo"]!.how, ADOPTED);

  /* And the line a person reads counts it, rather than calling the whole
   * pin unreviewed as it did before. */
  const line = enforcingLine(after, f.file);
  assert.match(line, /of which 1 now carries a decision/);
  assert.match(line, /The server is running and this does not change what it can reach/);
});

test("gate approve refuses a file that is not a gate report", () => {
  /*
   * Found by a mutation aimed at the new page command: the same line
   * appears in two functions, the mutation hit the other one, and every
   * test still passed. So `gate approve` has been checking the format of
   * its report since G2 with nothing insisting that it does — and without
   * the check it would read any JSON file as a report and try to carry
   * decisions out of it.
   */
  const f = approvable();
  const dir = mkdtempSync(join(tmpdir(), "gate-approve-bad-"));
  const wrongFormat = join(dir, "y.json");
  writeFileSync(wrongFormat, JSON.stringify({ format: "something-else", package: "fixture-mcp", packageVersion: "1.0.0" }));
  const notJson = join(dir, "x.json");
  writeFileSync(notJson, "{ not json");

  const was = readFileSync(f.file);
  for (const [file, why] of [
    [wrongFormat, /its format is "something-else"/],
    [notJson, /is not a gate report/],
  ] as const) {
    const r = cli(["gate", "approve", "--pending", file, "--decisions-from", f.exported, "--pins", f.pins, "--decisions", f.decisionsOut]);
    assert.notEqual(r.code, 0, `${file} was accepted as a report`);
    assert.match(r.err, why);
    assert.match(r.err, /Refusing to read/);
  }
  /* Nothing was written on the way to refusing. */
  assert.ok(readFileSync(f.file).equals(was), "a refused report still changed the pin");
  assert.equal(list(f.file).length, 0, "a refused report archived the pin");
  assert.ok(!existsSync(f.decisionsOut), "a refused report wrote decisions");
});
