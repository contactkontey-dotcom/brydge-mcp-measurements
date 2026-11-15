/*
 * I1: the pin can name an `instructions` string, and an old pin still
 * names nothing without that being a change.
 *
 * Nothing on the wire yet — no message is read or rewritten in this stage.
 * These tests are the format and its vocabulary: the hash, the three
 * states, the two writers, and what `parse` refuses.
 *
 * Every string below is planted. The one thing these tests must never do
 * is print instructions text, so each assertion is over a hash, a length,
 * a state, or a sentence written in this repository.
 */
import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { recordOf } from "../watch/tools.ts";
import {
  compare,
  hashedOf,
  seenIn,
  sha256Of,
  UNPINNED_LINE,
  type Seen,
  type State,
} from "../watch/gate/instructions.ts";
import {
  ADOPTED,
  adopt,
  FORMAT,
  FORMAT_VERSION,
  fromDecisions,
  instructionsStateOf,
  NOT_LOOKED,
  NotAPin,
  parse,
  read,
  serialize,
  write,
  type Pin,
} from "../watch/gate/pin.ts";
import { CONTAINMENT, flatten, GATEKEEPING } from "./banned.ts";

/* Planted. Two wordings, and one that differs only in a trailing space. */
const A = "FIXTURE A: planted instructions for a planted server.";
const B = "FIXTURE B: planted instructions, reworded, for the same planted server.";
const A_SPACED = `${A} `;
const DAY = "2026-11-15";
const tool = (name = "read_file") => recordOf({ name, description: "FIXTURE: planted.", inputSchema: { type: "object" } });

/* ── The hash ───────────────────────────────────────────────────────────── */

test("the hash is over the exact bytes: a trailing space is a different string", () => {
  assert.notEqual(sha256Of(A), sha256Of(A_SPACED));
  assert.equal(sha256Of(A), sha256Of(A), "the same string hashed differently");
  /* And it is a sha256, so a pin can be checked against it. */
  assert.match(sha256Of(A), /^[0-9a-f]{64}$/);
});

test("an empty string is a string, and is not nothing", () => {
  const empty = hashedOf("");
  assert.equal(empty.length, 0);
  assert.match(empty.hash, /^[0-9a-f]{64}$/);
  /* The state machine keeps them apart: see the three-state tests below. */
  assert.notEqual(compare({ kind: "text", hash: empty.hash, length: 0 }, { kind: "none" }).kind, "same");
});

test("the length is the one the review renderer already prints", () => {
  /* UTF-16 code units, as `String.prototype.length` gives and as the tool
   * diff prints for a description. A planted astral character, so the
   * number is not accidentally the same as the byte count. */
  const withAstral = "FIXTURE: planted \u{1F300} instructions.";
  assert.equal(hashedOf(withAstral).length, withAstral.length);
  assert.notEqual(hashedOf(withAstral).length, Buffer.byteLength(withAstral, "utf8"));
});

/* ── What a result carries ──────────────────────────────────────────────── */

test("seenIn tells apart no key, a null, a string, and something that is not one", () => {
  assert.deepEqual(seenIn({ protocolVersion: "x" }), { kind: "none" });
  assert.deepEqual(seenIn({ instructions: null }), { kind: "none" });
  assert.deepEqual(seenIn({ instructions: A }), { kind: "text", text: A });
  assert.deepEqual(seenIn({ instructions: "" }), { kind: "text", text: "" });
  assert.deepEqual(seenIn({ instructions: { text: A } }), { kind: "other" });
  assert.deepEqual(seenIn({ instructions: 7 }), { kind: "other" });
  assert.deepEqual(seenIn({ instructions: [A] }), { kind: "other" });
  /* Not an object at all. */
  assert.deepEqual(seenIn(null), { kind: "none" });
  assert.deepEqual(seenIn("instructions"), { kind: "none" });
});

/* ── The three states ───────────────────────────────────────────────────── */

const textState = (t: string): State => ({ kind: "text", hash: sha256Of(t), length: t.length });
const sawText = (t: string): Seen => ({ kind: "text", text: t });

test("an unpinned state compares nothing, whatever the server sent", () => {
  for (const seen of [{ kind: "none" } as Seen, sawText(A), { kind: "other" } as Seen]) {
    const v = compare({ kind: "unpinned" }, seen);
    assert.equal(v.kind, "unpinned", `an unpinned pin returned ${v.kind}`);
  }
});

test("a pin naming none is matched by a server sending none, and not by one sending some", () => {
  assert.equal(compare({ kind: "absent" }, { kind: "none" }).kind, "same");
  const v = compare({ kind: "absent" }, sawText(A));
  assert.equal(v.kind, "differs");
  assert.equal(v.kind === "differs" && v.because, "the server sent instructions and the pin names none");
});

test("a pin naming text is matched only by that text", () => {
  assert.equal(compare(textState(A), sawText(A)).kind, "same");
  assert.equal(compare(textState(A), sawText(B)).kind, "differs");
  assert.equal(compare(textState(A), sawText(A_SPACED)).kind, "differs", "a trailing space passed as the same string");
  const gone = compare(textState(A), { kind: "none" });
  assert.equal(gone.kind, "differs");
  assert.equal(gone.kind === "differs" && gone.because, "the server sent no instructions and the pin names some");
});

test("a field that is present and not a string differs from every pinned state", () => {
  /*
   * The lesson from the field audit, where a non-string description was
   * normalised to null and a change between two of them was invisible.
   * Here it cannot be pinned at all, so it differs from everything.
   */
  for (const state of [{ kind: "absent" } as State, textState(A), textState("")]) {
    const v = compare(state, { kind: "other" });
    assert.equal(v.kind, "differs", `a non-string matched a ${state.kind} pin`);
    assert.equal(v.kind === "differs" && v.because, "the server sent an instructions field that is not a string");
  }
});

test("nothing a verdict carries is the text itself", () => {
  /*
   * A verdict goes to stderr and the journal. Lengths and a sentence
   * written here are allowed; the prose is not.
   */
  const planted = "FIXTURE: UNIQUE-PLANTED-SENTINEL-4417 in the instructions.";
  const states: State[] = [{ kind: "unpinned" }, { kind: "absent" }, textState(planted)];
  const seens: Seen[] = [{ kind: "none" }, sawText(planted), sawText(B), { kind: "other" }];
  for (const state of states) {
    for (const seen of seens) {
      const v = compare(state, seen);
      const said = "because" in v ? v.because : "";
      assert.ok(!said.includes("UNIQUE-PLANTED-SENTINEL-4417"), `a verdict carried the text: ${said}`);
      assert.ok(!said.includes("FIXTURE"), `a verdict carried the text: ${said}`);
    }
  }
  /* And the line said about an old pin says nothing about what it read. */
  assert.ok(!UNPINNED_LINE.includes("FIXTURE"));
  const flat = flatten(UNPINNED_LINE);
  for (const w of [...CONTAINMENT, ...GATEKEEPING]) {
    assert.ok(!flat.includes(w), `the unpinned line says "${w}"`);
  }
});

/* ── Writing and reading a pin ──────────────────────────────────────────── */

test("a caller that did not look writes a pin that names no instructions", () => {
  const pin = adopt("fixture-mcp", "1.0.0", [tool()], DAY);
  assert.ok(!("instructions" in pin), "a pin claimed something about instructions nobody looked at");
  assert.deepEqual(instructionsStateOf(pin), { kind: "unpinned" });
  /* Round trip: still unpinned, not "none". */
  assert.deepEqual(instructionsStateOf(parse(serialize(pin))), { kind: "unpinned" });
});

test("a caller that looked and saw none writes a pin that names none", () => {
  const pin = adopt("fixture-mcp", "1.0.0", [tool()], DAY, { looked: true, text: null });
  assert.ok("instructions" in pin);
  assert.equal(pin.instructions, null);
  assert.deepEqual(instructionsStateOf(pin), { kind: "absent" });
  /* The round trip is the point of this one: JSON keeps an explicit null,
   * so "approved as sending none" survives being written and read. */
  assert.deepEqual(instructionsStateOf(parse(serialize(pin))), { kind: "absent" });
});

test("a caller that looked and saw text writes it, labelled adopted", () => {
  const pin = adopt("fixture-mcp", "1.0.0", [tool()], DAY, { looked: true, text: A });
  const i = pin.instructions!;
  assert.equal(i.how, ADOPTED);
  assert.equal(i.by, null);
  assert.equal(i.at, DAY);
  assert.equal(i.itemHash, null);
  assert.equal(i.hash, sha256Of(A));
  assert.equal(i.length, A.length);
  assert.deepEqual(instructionsStateOf(parse(serialize(pin))), { kind: "text", hash: sha256Of(A), length: A.length });
});

test("the version written is 2, and a version-1 pin is still read", () => {
  assert.equal(FORMAT_VERSION, 2);
  const v1 = {
    format: FORMAT,
    version: 1,
    package: "fixture-mcp",
    packageVersion: "1.0.0",
    pinnedAt: DAY,
    source: ADOPTED,
    tools: {},
  };
  const read = parse(JSON.stringify(v1));
  assert.equal(read.version, 1);
  assert.deepEqual(instructionsStateOf(read), { kind: "unpinned" }, "an old pin was read as naming no instructions");
});

test("a version-1 pin that names instructions is refused rather than read", () => {
  const forged = {
    format: FORMAT,
    version: 1,
    package: "fixture-mcp",
    packageVersion: "1.0.0",
    pinnedAt: DAY,
    source: ADOPTED,
    instructions: { ...hashedOf(A), how: ADOPTED, by: null, at: DAY, itemHash: null },
    tools: {},
  };
  assert.throws(() => parse(JSON.stringify(forged)), (e: unknown) => e instanceof NotAPin && /format version is 1 and it names instructions/.test((e as Error).message));
});

test("a version this cannot read is refused by name", () => {
  const future = { format: FORMAT, version: 3, package: "f", packageVersion: "1", pinnedAt: DAY, source: ADOPTED, tools: {} };
  assert.throws(() => parse(JSON.stringify(future)), (e: unknown) => e instanceof NotAPin && /its format version is 3, and this reads 1 or 2/.test((e as Error).message));
});

test("every way an instructions record can disagree with itself is refused", () => {
  const base = adopt("fixture-mcp", "1.0.0", [tool()], DAY, { looked: true, text: A });
  const bend = (f: (i: Record<string, unknown>) => void): string => {
    const copy = JSON.parse(serialize(base)) as Record<string, any>;
    f(copy.instructions as Record<string, unknown>);
    return JSON.stringify(copy);
  };
  const refuses = (text: string, why: RegExp) =>
    assert.throws(() => parse(text), (e: unknown) => e instanceof NotAPin && why.test((e as Error).message), `not refused: ${why}`);

  refuses(bend((i) => (i.hash = "0".repeat(64))), /hash that is not the hash of the text beside it/);
  refuses(bend((i) => (i.text = B)), /hash that is not the hash of the text beside it/);
  refuses(bend((i) => (i.length = 1)), /state a length of 1 and carry/);
  refuses(bend((i) => delete i.text), /carry no text/);
  refuses(bend((i) => (i.hash = "not a hash")), /have no sha256/);
  refuses(bend((i) => (i.how = "whatever")), /say they were pinned by "whatever"/);
  refuses(bend((i) => (i.at = "15-11-2026")), /have a date that is not YYYY-MM-DD/);
  refuses(bend((i) => (i.itemHash = "xyz")), /have an itemHash that is not a sha256/);
  refuses(bend((i) => (i.by = "")), /have a reviewer that is not a name/);
  refuses(
    bend((i) => {
      i.how = "approve";
      i.by = null;
      i.itemHash = null;
    }),
    /approved and name neither a decision nor a reviewer/,
  );
  /* And a record that is not a record at all. */
  const copy = JSON.parse(serialize(base)) as Record<string, any>;
  copy.instructions = "FIXTURE";
  refuses(JSON.stringify(copy), /are not a record/);
});

test("a pin naming instructions survives a write and a read from disk", () => {
  const file = join(mkdtempSync(join(tmpdir(), "gate-instructions-")), "pin.json");
  const pin = adopt("fixture-mcp", "1.0.0", [tool(), tool("list_dir")], DAY, { looked: true, text: A });
  write(file, pin);
  const back = read(file);
  assert.deepEqual(instructionsStateOf(back), { kind: "text", hash: sha256Of(A), length: A.length });
  assert.equal(back.instructions!.text, A, "the text a reviewer would be shown did not survive");
  /* And the file on disk is the one a person could read, with the text in
   * it — which is why watch/gate/pins is gitignored. */
  assert.ok(readFileSync(file, "utf8").includes('"instructions"'));
});

/* ── From decisions ─────────────────────────────────────────────────────── */

const DECIDED = { by: "planted-reviewer", at: DAY, itemHash: "a".repeat(64) };

test("fromDecisions carries nothing about instructions when nothing looked", () => {
  const r = fromDecisions({ package: "fixture-mcp", version: "1.0.0", approved: ["read_file"], tools: [tool()], decisions: {}, at: DAY });
  assert.ok(!("instructions" in r.pin));
  assert.deepEqual(instructionsStateOf(r.pin), { kind: "unpinned" });
});

test("fromDecisions records who approved the instructions", () => {
  const r = fromDecisions({
    package: "fixture-mcp",
    version: "1.0.0",
    approved: ["read_file"],
    tools: [tool()],
    /* A decision for the TOOL as well: a pin whose tool says "approve"
     * with nothing behind it is refused on the tool's account, which would
     * make this test fail for a reason that is not about instructions.
     * That refusal is a defect of its own and is written up, not fixed
     * here. */
    decisions: { "someitem:read_file": { ...DECIDED, decision: "approve" } },
    at: DAY,
    instructions: { looked: true, text: A },
    instructionsApproval: DECIDED,
  });
  const i = r.pin.instructions!;
  assert.equal(i.how, "approve");
  assert.equal(i.by, "planted-reviewer");
  assert.equal(i.itemHash, DECIDED.itemHash);
  assert.equal(i.hash, sha256Of(A));
  /* And it reads back, which is what parse's approval rule is for. */
  assert.deepEqual(instructionsStateOf(parse(serialize(r.pin))), { kind: "text", hash: sha256Of(A), length: A.length });
});

test("instructions seen but not approved are adopted, not approved", () => {
  const r = fromDecisions({
    package: "fixture-mcp",
    version: "1.0.0",
    approved: ["read_file"],
    tools: [tool()],
    decisions: { "someitem:read_file": { ...DECIDED, decision: "approve" } },
    at: DAY,
    instructions: { looked: true, text: A },
  });
  assert.equal(r.pin.instructions!.how, ADOPTED, "unapproved instructions were recorded as approved");
});

test("approving none is a decision the pin can hold", () => {
  const r = fromDecisions({
    package: "fixture-mcp",
    version: "1.0.0",
    approved: ["read_file"],
    tools: [tool()],
    decisions: {},
    at: DAY,
    instructions: { looked: true, text: null },
    instructionsApproval: DECIDED,
  });
  assert.equal(r.pin.instructions, null);
  assert.deepEqual(instructionsStateOf(r.pin), { kind: "absent" });
  /* A server that then sends some differs from this pin. */
  assert.equal(compare(instructionsStateOf(r.pin), sawText(A)).kind, "differs");
});

test("NOT_LOOKED is what it says, so a caller cannot pass it by accident", () => {
  assert.deepEqual(NOT_LOOKED, { looked: false });
  const pin: Pin = adopt("f", "1", [], DAY, NOT_LOOKED);
  assert.deepEqual(instructionsStateOf(pin), { kind: "unpinned" });
});

/* ── Nothing on the wire yet ────────────────────────────────────────────── */

test("I2 moved the stage boundary: the router, the enforcer and the gate now read the field", () => {
  /*
   * In I1 this test asserted the opposite — that none of these three files
   * touched the field — so that the move would have to be made on purpose.
   * This is the move. The three places are named so a later refactor that
   * drops one of them is noticed here, not in a client.
   */
  const uses = (src: string) => /instructions\.ts/.test(src);
  for (const file of ["run.ts", "enforce.ts", "router.ts"]) {
    const src = readFileSync(join(import.meta.dirname, "..", "watch", "gate", file), "utf8");
    assert.ok(uses(src), `${file} no longer uses the instructions module`);
  }
});

/* ── The upgrade path, through the built gate ───────────────────────────── */

test("a version-1 pin still enforces, and nothing about it reads as changed", { timeout: 120_000 }, async () => {
  /*
   * The property the whole format bump turns on. A pin written before any
   * of this existed must keep working exactly as it did: the server
   * starts, the tools that match are passed on, and nothing is hidden on
   * account of a field the pin was never asked about.
   *
   * Driven through the BUILT gate, because that is what a client launches.
   */
  const { spawn } = await import("node:child_process");
  const { build } = (await import("../watch/gate/build.mjs")) as unknown as { build: (o: { out: string }) => unknown };
  const out = mkdtempSync(join(tmpdir(), "gate-instructions-build-"));
  build({ out });
  const gate = join(out, "gate", "run.js");
  const demo = join(import.meta.dirname, "..", "watch", "gate", "fixtures", "demo-server.mjs");

  const drive = (args: string[], messages: unknown[]): Promise<{ answers: Array<Record<string, any>>; stderr: string }> =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, args, { stdio: ["pipe", "pipe", "pipe"] });
      const answers: Array<Record<string, any>> = [];
      let err = "";
      let buf = "";
      let i = 0;
      child.stdin.on("error", () => {});
      child.stderr.on("data", (c: Buffer) => (err += c.toString("utf8")));
      const next = () => {
        if (i >= messages.length) {
          setTimeout(() => {
            try {
              child.stdin.end();
            } catch {
              /* gone */
            }
          }, 60);
          return;
        }
        child.stdin.write(JSON.stringify(messages[i++]) + "\n");
      };
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (c: string) => {
        buf += c;
        let nl: number;
        while ((nl = buf.indexOf("\n")) !== -1) {
          const l = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (!l.trim()) continue;
          const m = JSON.parse(l) as Record<string, any>;
          if (m.id === undefined) continue;
          answers.push(m);
          next();
        }
      });
      child.on("exit", () => setTimeout(() => resolve({ answers, stderr: err }), 150));
      setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          /* gone */
        }
      }, 60_000);
      next();
    });

  const init = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "planted", version: "1" } } };
  const dir = mkdtempSync(join(tmpdir(), "gate-instructions-v1-"));
  const file = join(dir, "pin.json");

  /* Take a pin, then make it a version-1 file: what an earlier build wrote. */
  await drive([gate, "--write-pin", file, "--package", "brydge-demo-server@1.0.0", "--", process.execPath, demo, "--mode=baseline"], [init, { jsonrpc: "2.0", id: 2, method: "tools/list" }]);
  const asV2 = JSON.parse(readFileSync(file, "utf8")) as Record<string, any>;
  assert.equal(asV2.version, 2, "the writer did not write the current version");
  /* Since I2 the writer looks, so the pin names the demo's instructions
   * (it sends none, so: null). A version-1 file cannot carry the key at
   * all, so making one means removing it as well as changing the number. */
  assert.ok("instructions" in asV2, "the writer no longer looks at the handshake");
  delete asV2.instructions;
  asV2.version = 1;
  const v1 = join(dir, "v1.json");
  writeFileSync(v1, JSON.stringify(asV2, null, 2) + "\n");

  const r = await drive(
    [gate, "--pin", v1, "--mode", "enforce", "--", process.execPath, demo, "--mode=baseline"],
    [init, { jsonrpc: "2.0", id: 2, method: "tools/list" }, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "demo_add", arguments: { a: 2, b: 3 } } }],
  );
  const names = (r.answers.find((m) => m.id === 2)?.result?.tools ?? []).map((t: { name: string }) => t.name);
  assert.deepEqual(names, ["demo_add", "demo_subtract", "demo_echo", "demo_now"], `an old pin hid something: ${r.stderr}`);
  assert.equal(r.answers.find((m) => m.id === 3)?.result?.content?.[0]?.text, "5", "a call against an old pin was not forwarded");
  assert.ok(!/did not pass/.test(r.stderr), `something was hidden against a version-1 pin:\n${r.stderr}`);
  /*
   * And the gate says nothing about instructions yet: that line arrives in
   * the stage that compares them.
   *
   * The paths are taken out first. The gate prints the pin's path, and
   * these temporary directories are named after this very test, so a
   * naive search found the word in a directory name and not in anything
   * the gate said.
   */
  const said = r.stderr.split(/\s+/).filter((w) => !w.includes("/")).join(" ");
  /* Since I2 the gate says exactly one thing about instructions against a
   * version-1 pin: that the pin does not cover them. Once. */
  const times = r.stderr.split(UNPINNED_LINE).length - 1;
  assert.equal(times, 1, `the unpinned line was said ${times} time(s), not once:\n${said}`);
  assert.ok(!/did not pass the server's instructions/.test(said), "something was hidden against a version-1 pin");
});
