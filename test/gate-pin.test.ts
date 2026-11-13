/*
 * The pin: what somebody signed off, by content.
 *
 * Every fixture is planted and every reviewer is `example-approver`. The two
 * description strings read as fixtures so a failure that printed one could
 * not be mistaken for somebody's package.
 */
import { strict as assert } from "node:assert";
import { chmodSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { test } from "node:test";
import { flatten, GATEKEEPING, CONTAINMENT } from "./banned.ts";
import { ADOPTED, NotAPin, adopt, fromDecisions, parse, pathFor, read, recordsOf, serialize, write } from "../watch/gate/pin.ts";
import { definitionOf, recordOf, type ToolRecord } from "../watch/tools.ts";

const A = "FIXTURE A: reads the planted file and returns its planted bytes.";
const B = "FIXTURE B: reads the planted file and says what happens when it is missing.";
const WHO = "example-approver";
const DAY = "2026-11-13";

const tool = (over: Record<string, unknown> = {}): ToolRecord =>
  recordOf({ name: "read_file", description: A, inputSchema: { type: "object" }, ...over });
const dir = () => mkdtempSync(join(tmpdir(), "pin-"));

/* ── Shape ──────────────────────────────────────────────────────────────── */

test("an adopted pin says so on every record and at the top", () => {
  const pin = adopt("fixture-mcp", "1.0.0", [tool(), tool({ name: "list_dir" })], DAY);
  assert.equal(pin.source, ADOPTED);
  assert.equal(ADOPTED, "adopted, not reviewed");
  for (const t of Object.values(pin.tools)) {
    assert.equal(t.how, ADOPTED);
    assert.equal(t.by, null, "a surface nobody reviewed names a reviewer");
    assert.equal(t.itemHash, null, "a surface nobody reviewed points at a decision");
  }
  assert.deepEqual(Object.keys(pin.tools).sort(), ["list_dir", "read_file"]);
});

test("a pinned record carries the definition, not only its hashes", () => {
  const pin = adopt("fixture-mcp", "1.0.0", [tool()], DAY);
  const t = pin.tools["read_file"]!;
  assert.deepEqual(Object.keys(t.definition).sort(), ["description", "inputSchema", "name"]);
  /* Without the definition there is nothing to show a later difference
   * against: a hash says "this differs" and stops. */
  assert.equal(t.definition.description, A);
  assert.equal(t.hash, recordOf(definitionOf(tool())).hash);
});

test("the records come back as the tool records everything else uses", () => {
  const pin = adopt("fixture-mcp", "1.0.0", [tool({ name: "b" }), tool({ name: "a" })], DAY);
  const back = recordsOf(pin);
  assert.deepEqual(back.map((t) => t.name), ["a", "b"]);
  assert.equal(back[0]!.hash, pin.tools["a"]!.hash);
});

/* ── Writing ────────────────────────────────────────────────────────────── */

test("a pin survives a round trip through a file", () => {
  const file = join(dir(), "pin.json");
  const pin = adopt("fixture-mcp", "1.0.0", [tool(), tool({ name: "list_dir", description: B })], DAY);
  write(file, pin);
  assert.deepEqual(read(file), pin);
  assert.match(readFileSync(file, "utf8"), /\n$/);
});

test("a write leaves nothing half-finished behind", () => {
  const d = dir();
  const file = join(d, "pin.json");
  write(file, adopt("fixture-mcp", "1.0.0", [tool()], DAY));
  write(file, adopt("fixture-mcp", "1.0.0", [tool(), tool({ name: "two" })], DAY));
  /* The temporary file is gone, and only the pin is there. */
  assert.deepEqual(readdirSync(d), ["pin.json"]);
  assert.equal(Object.keys(read(file).tools).length, 2, "the second write did not replace the first");
});

test("a pin arrives by rename, so nothing ever reads a partial one", () => {
  /*
   * THE CHECK THIS REPLACES PROVED NOTHING. It looked at the directory
   * afterwards, which is tidy whether the write was atomic or not, and a
   * module that wrote straight over the target passed it. Crashing a process
   * mid-write is not a test anybody can run, but the SIGNATURE of
   * temp-and-rename is exact and deterministic: the pin at that path is a
   * different file afterwards. Writing in place truncates and refills the
   * same one, and the inode stays.
   */
  const file = join(dir(), "pin.json");
  write(file, adopt("fixture-mcp", "1.0.0", [tool()], DAY));
  const before = statSync(file);
  write(file, adopt("fixture-mcp", "1.0.0", [tool(), tool({ name: "two" })], DAY));
  const after = statSync(file);
  assert.notEqual(after.ino, before.ino, "the pin was written over in place, so a reader could see half of it");
  assert.equal(Object.keys(read(file).tools).length, 2);
});

test("a pin is always a file in the directory it was given, whatever the package is called", () => {
  assert.equal(pathFor("/tmp/pins", "@scope/pkg", "1.2.3"), "/tmp/pins/@scope--pkg@1.2.3.json");
  /*
   * The property that matters is not "the name has no dots" — the first
   * version of this asserted that and failed on "..--..--etc", which is a
   * perfectly ordinary filename. It is that the result stays in the
   * directory it was handed.
   */
  for (const [pkg, version] of [["../../etc", "1.0.0"], ["..", "1.0.0"], ["a/b/c", "../.."], ["\u0000odd", "1"]] as const) {
    const file = pathFor("/tmp/pins", pkg, version);
    assert.equal(dirname(file), "/tmp/pins", `${pkg}@${version} landed outside the directory`);
    assert.ok(!basename(file).includes("/"), `${pkg}@${version} produced a name with a separator`);
  }
});

/* ── Reading is strict ──────────────────────────────────────────────────── */

test("anything that is not a pin is refused, and the reason names what is wrong", () => {
  const good = adopt("fixture-mcp", "1.0.0", [tool()], DAY);
  const refuses = (text: string, why: RegExp) =>
    assert.throws(() => parse(text), (e: Error) => e instanceof NotAPin && why.test(e.message), `${why.source}`);
  const altered = (f: (p: any) => void) => {
    const copy = JSON.parse(serialize(good));
    f(copy);
    return JSON.stringify(copy);
  };
  refuses("not json", /not JSON/);
  refuses("[]", /not an object/);
  refuses(altered((p) => (p.format = "something-else")), /its format is "something-else"/);
  refuses(altered((p) => (p.version = 99)), /format version is 99/);
  refuses(altered((p) => delete p.package), /names no package/);
  refuses(altered((p) => (p.pinnedAt = "yesterday")), /is not YYYY-MM-DD/);
  refuses(altered((p) => (p.source = "somewhere")), /its source is "somewhere"/);
  refuses(altered((p) => delete p.tools), /carries no tools/);
  refuses(altered((p) => (p.tools.read_file.hash = "abc")), /has no sha256/);
  refuses(altered((p) => (p.tools.read_file.name = "other")), /filed under a key that is not its name/);
  refuses(altered((p) => delete p.tools.read_file.definition), /carries no definition/);
  refuses(altered((p) => (p.tools.read_file.how = "maybe")), /says it was pinned by "maybe"/);
  refuses(altered((p) => (p.tools.read_file.at = "13\/11\/2026")), /date that is not YYYY-MM-DD/);
  refuses(altered((p) => (p.tools.read_file.itemHash = "zz")), /itemHash that is not a sha256/);
});

test("a pin whose hashes do not match the definitions beside them is refused", () => {
  /*
   * The one a careless edit makes, and the worst one to let through: it
   * would compare against one thing and show a reviewer another.
   */
  const good = adopt("fixture-mcp", "1.0.0", [tool()], DAY);
  const copy = JSON.parse(serialize(good));
  copy.tools.read_file.definition.description = B;
  assert.throws(
    () => parse(JSON.stringify(copy)),
    (e: Error) => e instanceof NotAPin && /hash that is not the hash of the definition beside it/.test(e.message),
  );
});

test("a record that claims an approval nobody made is refused", () => {
  const copy = JSON.parse(serialize(adopt("fixture-mcp", "1.0.0", [tool()], DAY)));
  copy.tools.read_file.how = "approve";
  assert.throws(
    () => parse(JSON.stringify(copy)),
    (e: Error) => e instanceof NotAPin && /names neither a decision nor a reviewer/.test(e.message),
  );
});

test("a missing, empty or unreadable file each say which", () => {
  const d = dir();
  assert.throws(() => read(join(d, "nothing.json")), (e: Error) => e instanceof NotAPin && /no file there/.test(e.message));
  const empty = join(d, "empty.json");
  writeFileSync(empty, "   ");
  assert.throws(() => read(empty), (e: Error) => e instanceof NotAPin && /file is empty/.test(e.message));
  const shut = join(d, "shut.json");
  writeFileSync(shut, serialize(adopt("f", "1", [tool()], DAY)));
  chmodSync(shut, 0o000);
  if (process.getuid?.() !== 0) {
    assert.throws(() => read(shut), (e: Error) => e instanceof NotAPin && /could not be read/.test(e.message));
  }
});

test("a pin truncated mid-write is refused rather than half-read", () => {
  const file = join(dir(), "pin.json");
  const whole = serialize(adopt("fixture-mcp", "1.0.0", [tool(), tool({ name: "two" })], DAY));
  writeFileSync(file, whole.slice(0, Math.floor(whole.length / 2)));
  assert.throws(() => read(file), (e: Error) => e instanceof NotAPin && /not JSON/.test(e.message));
});

/* ── From decisions ─────────────────────────────────────────────────────── */

const decision = (kind: string, name: string, over: Record<string, unknown> = {}) => ({
  [`${kind}:${name}`]: { by: WHO, at: DAY, itemHash: "a".repeat(64), decision: "approve", ...over },
});

test("a pinned tool points at the decision that approved it", () => {
  const r = fromDecisions({
    package: "fixture-mcp",
    version: "1.1.0",
    approved: ["read_file"],
    tools: [tool()],
    decisions: decision("description", "read_file"),
    at: DAY,
  });
  const t = r.pin.tools["read_file"]!;
  assert.equal(t.how, "approve");
  assert.equal(t.by, WHO);
  assert.equal(t.at, DAY);
  assert.equal(t.itemHash, "a".repeat(64));
  assert.equal(r.pin.source, "decisions");
  assert.deepEqual(r.notPinned, []);
  assert.deepEqual(r.missing, []);
  /* And it parses: a record that names a decision is a record `parse` takes. */
  assert.doesNotThrow(() => parse(serialize(r.pin)));
});

test("the newest approval wins where a tool had several items", () => {
  const r = fromDecisions({
    package: "fixture-mcp",
    version: "1.1.0",
    approved: ["read_file"],
    tools: [tool()],
    decisions: {
      ...decision("description", "read_file", { at: "2026-11-01", itemHash: "b".repeat(64) }),
      ...decision("input schema", "read_file", { at: "2026-11-10", itemHash: "c".repeat(64) }),
    },
    at: DAY,
  });
  assert.equal(r.pin.tools["read_file"]!.itemHash, "c".repeat(64));
  assert.equal(r.pin.tools["read_file"]!.at, "2026-11-10");
});

test("a tool carried from an earlier list is pinned, and names no decision", () => {
  const r = fromDecisions({
    package: "fixture-mcp",
    version: "1.1.0",
    approved: ["read_file"],
    tools: [tool()],
    decisions: {},
    at: DAY,
  });
  const t = r.pin.tools["read_file"]!;
  assert.equal(t.how, "approve");
  assert.equal(t.itemHash, null, "a carried tool was given a decision it did not have");
  assert.equal(t.by, null);
});

test("a held tool is not pinned, and is named", () => {
  const r = fromDecisions({
    package: "fixture-mcp",
    version: "1.1.0",
    approved: ["read_file"],
    tools: [tool(), tool({ name: "write_file" })],
    decisions: { ...decision("new tool", "write_file", { decision: "hold" }) },
    at: DAY,
  });
  assert.deepEqual(Object.keys(r.pin.tools), ["read_file"]);
  assert.deepEqual(r.notPinned, ["write_file"]);
});

test("a list naming a tool the capture does not have is reported, not invented", () => {
  const r = fromDecisions({
    package: "fixture-mcp",
    version: "1.1.0",
    approved: ["read_file", "ghost"],
    tools: [tool()],
    decisions: {},
    at: DAY,
  });
  assert.deepEqual(r.missing, ["ghost"]);
  assert.deepEqual(Object.keys(r.pin.tools), ["read_file"]);
});

/* ── What it may not say ────────────────────────────────────────────────── */

test("nothing in the pin module claims the server is contained", () => {
  const src = flatten(readFileSync(join(import.meta.dirname, "..", "watch", "gate", "pin.ts"), "utf8"));
  for (const w of [...CONTAINMENT, ...GATEKEEPING]) assert.ok(!src.includes(w), `watch/gate/pin.ts says "${w}"`);
  assert.ok(flatten(ADOPTED).includes("not reviewed"));
});
