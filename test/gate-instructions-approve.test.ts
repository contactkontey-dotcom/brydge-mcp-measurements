/*
 * I3: the instructions string as a review item, and a decision about it
 * carried into the pin.
 *
 * Every string is planted; every reviewer is `example-approver`. Nothing
 * here prints the text — the assertions are over hashes, kinds, names, a
 * marker this project writes, and sentences written in this repository.
 */
import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { INSTRUCTIONS_LABEL, carry, renderCarried } from "../watch/gate/approve.ts";
import { compare, sha256Of, type Seen } from "../watch/gate/instructions.ts";
import { adopt, instructionsStateOf, parse, serialize } from "../watch/gate/pin.ts";
import { instructionsItemOf, pendingOf, stderrLine } from "../watch/gate/report.ts";
import { INSTRUCTIONS_TOOL, ITEM_KINDS, itemHashOf, itemKeyOf, keyOf } from "../watch/decisions.ts";
import { FORMAT, FORMAT_VERSION, KIND_ORDER, type Exported } from "../watch/review.ts";
import { recordOf } from "../watch/tools.ts";
import { CONTAINMENT, flatten, GATEKEEPING } from "./banned.ts";

const ROOT = join(import.meta.dirname, "..");
const WHO = "example-approver";
const DAY = "2026-11-15";
const PKG = "fixture-mcp";
const A = "FIXTURE A: planted instructions for a planted server. Token APPR-A-1101.";
/* B carries a zero-width space after "server", so the visible-character
 * rendering has something to show. */
const B = `FIXTURE B: planted instructions, reworded, for the same planted server​. Token APPR-B-2202.`;
const tool = (name = "read_file") => recordOf({ name, description: "FIXTURE: planted.", inputSchema: { type: "object" } });
const live = [tool()];

const pinWith = (text: string | null) => adopt(PKG, "1.0.0", [tool()], "2026-11-01", { looked: true, text });
const sawText = (t: string): Seen => ({ kind: "text", text: t });
const exportOf = (decisions: Exported["decisions"]): Exported => ({
  format: FORMAT,
  version: FORMAT_VERSION,
  package: PKG,
  fromVersion: "pinned 2026-11-01",
  toVersion: `offered ${DAY}`,
  decisions,
});
const decisionOn = (p: ReturnType<typeof pendingOf>, decision: "approve" | "hold") => {
  const item = p.prepared.items.find((i) => i.kind === "instructions")!;
  assert.ok(item, "the report has no instructions item");
  return { kind: item.kind, name: item.tool, decision, by: WHO, at: DAY, itemHash: item.itemHash };
};
const noText = (s: string, where: string) => {
  assert.ok(!s.includes("APPR-A-1101") && !s.includes("APPR-B-2202"), `${where} carries the instructions text`);
  assert.ok(!s.includes("FIXTURE A:") && !s.includes("FIXTURE B:"), `${where} carries the instructions text`);
};

/* ── The kind ───────────────────────────────────────────────────────────── */

test("instructions is a kind of item, read last, filed under a name no tool can have", () => {
  assert.ok(ITEM_KINDS.includes("instructions"));
  assert.equal(KIND_ORDER.at(-1), "instructions");
  assert.equal(INSTRUCTIONS_TOOL, "(server)");
  assert.equal(itemKeyOf({ kind: "instructions", tool: INSTRUCTIONS_TOOL }), "instructions:(server)");
  /* A tool literally named "instructions" is filed under its own kind. */
  assert.notEqual(itemKeyOf({ kind: "description", tool: "instructions" }), itemKeyOf({ kind: "instructions", tool: INSTRUCTIONS_TOOL }));
});

test("the review page's client lists the same kinds in the same order as KIND_ORDER", () => {
  /* The client hardcodes the list; this is what keeps it from drifting. */
  const client = readFileSync(join(ROOT, "watch", "review-client.js"), "utf8");
  const m = /var kinds = (\[[^\]]*\]);/.exec(client);
  assert.ok(m, "the client no longer has a kinds array");
  assert.deepEqual(JSON.parse(m![1]!), KIND_ORDER);
});

/* ── The report carries the item ────────────────────────────────────────── */

test("a report against a pin naming text carries an instructions item when the text differs", () => {
  const p = pendingOf(pinWith(A), live, [], DAY, sawText(B));
  const item = p.prepared.items.find((i) => i.kind === "instructions");
  assert.ok(item, "no item");
  assert.equal(item!.tool, INSTRUCTIONS_TOOL);
  assert.ok(item!.words, "the item has no word diff");
  assert.equal(item!.schema, null);
  assert.equal(item!.parameters, null);
  assert.ok(item!.words!.wordsAdded > 0 || item!.words!.wordsRemoved > 0, "the word diff shows nothing moved");
  assert.equal(item!.words!.before.characters, A.length);
  assert.equal(item!.words!.after.characters, B.length);
  /* The hash is the one a decision will be checked against. */
  assert.equal(item!.itemHash, itemHashOf({ kind: "instructions", tool: INSTRUCTIONS_TOOL, before: A, after: B }));
  /* And the seen text is in the report so approving has something to pin. */
  assert.deepEqual(p.instructions, { seen: B });
  /* The stderr line says so, without the text. */
  const line = stderrLine(p, "/planted/report.json");
  assert.match(line, /and the server's instructions differ from the pin/);
  noText(line, "the stderr line");
  noText(JSON.stringify(p.notes), "the notes");
});

test("the invisible character in the new wording is made visible, and named in the legend", () => {
  const p = pendingOf(pinWith(A), live, [], DAY, sawText(B));
  const words = p.prepared.items.find((i) => i.kind === "instructions")!.words!;
  const text = words.runs.map((r) => r.text).join("");
  assert.ok(text.includes("⟦U+200B⟧"), "the zero-width space is not marked");
  assert.ok(!text.includes("​"), "a real zero-width space reached the rendered runs");
  assert.ok(words.legend.some((l) => /U\+200B/.test(l)), `the legend does not name it: ${JSON.stringify(words.legend)}`);
});

test("no item when nothing differs, when the pin does not cover instructions, or when nothing was seen", () => {
  const same = pendingOf(pinWith(A), live, [], DAY, sawText(A));
  assert.ok(!same.prepared.items.some((i) => i.kind === "instructions"));
  assert.equal(same.instructions, undefined);
  const uncovered = pendingOf(adopt(PKG, "1.0.0", [tool()], "2026-11-01"), live, [], DAY, sawText(B));
  assert.ok(!uncovered.prepared.items.some((i) => i.kind === "instructions"), "an item against a pin that does not cover instructions");
  const unseen = pendingOf(pinWith(A), live, [], DAY);
  assert.ok(!unseen.prepared.items.some((i) => i.kind === "instructions"));
});

test("a pin naming none and a server sending some: an item with nothing before", () => {
  const p = pendingOf(pinWith(null), live, [], DAY, sawText(A));
  const item = p.prepared.items.find((i) => i.kind === "instructions")!;
  assert.ok(item);
  assert.equal(item.words!.before.present, false);
  assert.equal(item.words!.after.characters, A.length);
});

test("a pin naming text and a server sending none: an item with nothing after", () => {
  const p = pendingOf(pinWith(A), live, [], DAY, { kind: "none" });
  const item = p.prepared.items.find((i) => i.kind === "instructions")!;
  assert.ok(item);
  assert.equal(item.words!.after.present, false);
  assert.deepEqual(p.instructions, { seen: null });
});

test("a non-string field is a note, not an item", () => {
  const r = instructionsItemOf(pinWith(A), { kind: "other" });
  assert.ok(r && "note" in r, "a non-string became an item");
  const p = pendingOf(pinWith(A), live, [], DAY, { kind: "other" });
  assert.ok(!p.prepared.items.some((i) => i.kind === "instructions"));
  assert.ok(p.notes.some((n) => /not a string/.test(n)));
  assert.equal(p.instructions, undefined);
});

/* ── Approving, holding, and approving none ─────────────────────────────── */

test("approving pins the seen wording, with who and when, and the next run has nothing to show", () => {
  const pin = pinWith(A);
  const p = pendingOf(pin, live, [], DAY, sawText(B));
  const a = carry({ pin, pending: p, incoming: exportOf([decisionOn(p, "approve")]), decisions: {} });

  assert.equal(a.pinChanged, true);
  assert.deepEqual(a.carried.approved.map((x) => x.kind), ["instructions"]);
  const i = a.pin.instructions!;
  assert.equal(i.how, "approve");
  assert.equal(i.by, WHO);
  assert.equal(i.at, DAY);
  assert.equal(i.hash, sha256Of(B));
  assert.equal(i.length, B.length);
  assert.match(i.itemHash!, /^[0-9a-f]{64}$/);
  assert.deepEqual(a.carried.stillFlagged, []);
  /* The pin reads back, and the decision is filed under the kind. */
  assert.doesNotThrow(() => parse(serialize(a.pin)));
  assert.ok(a.decisions[keyOf(PKG, `offered ${DAY}`)]!["instructions:(server)"]);
  /* Against the new pin, the same server has nothing to report. */
  assert.equal(compare(instructionsStateOf(a.pin), sawText(B)).kind, "same");
  const again = pendingOf(a.pin, live, [], DAY, sawText(B));
  assert.ok(!again.prepared.items.some((x) => x.kind === "instructions"));
  noText(renderCarried(a, "/planted/pin.json"), "renderCarried");
});

test("approving none: the pin then names none, and instructions that appear differ from it", () => {
  const pin = pinWith(A);
  const p = pendingOf(pin, live, [], DAY, { kind: "none" });
  const a = carry({ pin, pending: p, incoming: exportOf([decisionOn(p, "approve")]), decisions: {} });
  assert.equal(a.pinChanged, true);
  assert.ok("instructions" in a.pin, "the key was dropped, which would read as unpinned");
  assert.equal(a.pin.instructions, null);
  assert.deepEqual(instructionsStateOf(a.pin), { kind: "absent" });
  assert.equal(compare(instructionsStateOf(a.pin), sawText(A)).kind, "differs");
  assert.doesNotThrow(() => parse(serialize(a.pin)));
});

test("holding records the decision, leaves the pin as it was, and the item is still flagged", () => {
  const pin = pinWith(A);
  const p = pendingOf(pin, live, [], DAY, sawText(B));
  const a = carry({ pin, pending: p, incoming: exportOf([decisionOn(p, "hold")]), decisions: {} });
  assert.equal(a.pinChanged, false);
  assert.equal(a.pin.instructions!.hash, sha256Of(A), "a hold changed the pin");
  assert.deepEqual(a.carried.held.map((x) => x.kind), ["instructions"]);
  assert.deepEqual(a.carried.stillFlagged, [INSTRUCTIONS_LABEL]);
  assert.ok(a.decisions[keyOf(PKG, `offered ${DAY}`)]!["instructions:(server)"]!.decision === "hold");
  assert.match(renderCarried(a, "/p"), /instructions — the server's instructions, by example-approver/);
});

test("a decision about different instructions is refused by name", () => {
  const pin = pinWith(A);
  const p = pendingOf(pin, live, [], DAY, sawText(B));
  const d = decisionOn(p, "approve");
  const wrong = carry({ pin, pending: p, incoming: exportOf([{ ...d, itemHash: "f".repeat(64) }]), decisions: {} });
  assert.equal(wrong.pinChanged, false);
  assert.equal(wrong.carried.refused.length, 1);
  assert.match(wrong.carried.refused[0]!.because, /made about a different instructions/);
  assert.equal(wrong.pin.instructions!.hash, sha256Of(A));
});

test("the instructions changing since the report was written refuses the decision", () => {
  const pin = pinWith(A);
  const p = pendingOf(pin, live, [], DAY, sawText(B));
  const d = decisionOn(p, "approve");
  /* The report's seen text edited after the reviewer read it. */
  const edited = { ...p, instructions: { seen: `${B} (edited)` } };
  const a = carry({ pin, pending: edited, incoming: exportOf([d]), decisions: {} });
  assert.equal(a.pinChanged, false);
  assert.match(a.carried.refused[0]!.because, /instructions have changed since that report was written/);
});

test("a decision naming the kind with no item in the report applies to nothing", () => {
  const pin = pinWith(A);
  const p = pendingOf(pin, live, [], DAY, sawText(A)); /* nothing differs: no item */
  const a = carry({ pin, pending: p, incoming: exportOf([{ kind: "instructions", name: INSTRUCTIONS_TOOL, decision: "approve", by: WHO, at: DAY, itemHash: "a".repeat(64) }]), decisions: {} });
  assert.equal(a.pinChanged, false);
  assert.match(a.carried.refused[0]!.because, /carries no instructions/);
});

test("a tool decision and an instructions decision in one export each land where they belong", () => {
  const pin = pinWith(A);
  const B_TOOL = recordOf({ name: "read_file", description: "FIXTURE: planted, reworded.", inputSchema: { type: "object" } });
  const p = pendingOf(pin, [B_TOOL], [{ tool: "read_file", because: "its description differs from the baseline" }], DAY, sawText(B));
  const toolItem = p.prepared.items.find((i) => i.kind === "description")!;
  const a = carry({
    pin,
    pending: p,
    incoming: exportOf([
      { kind: "description", name: "read_file", decision: "approve", by: WHO, at: DAY, itemHash: toolItem.itemHash },
      decisionOn(p, "approve"),
    ]),
    decisions: {},
  });
  assert.equal(a.carried.approved.length, 2);
  assert.equal(a.pin.tools.read_file!.how, "approve");
  assert.equal(a.pin.instructions!.hash, sha256Of(B));
  assert.deepEqual(a.carried.stillFlagged, []);
});

test("nothing in what a reviewer is told carries the text or a word the gate must not use", () => {
  const pin = pinWith(A);
  const p = pendingOf(pin, live, [], DAY, sawText(B));
  const a = carry({ pin, pending: p, incoming: exportOf([decisionOn(p, "hold")]), decisions: {} });
  const said = [renderCarried(a, "/p"), stderrLine(p, "/r"), ...p.notes].join("\n");
  noText(said, "what the reviewer is told");
  const flat = flatten(said);
  for (const w of [...CONTAINMENT, ...GATEKEEPING]) assert.ok(!flat.includes(w), `says "${w}"`);
});

/* ── Through the built gate ─────────────────────────────────────────────── */

test("the gate writes a report carrying the instructions item, and approving it moves the pin forward", { timeout: 120_000 }, async () => {
  const { build } = (await import("../watch/gate/build.mjs")) as unknown as { build: (o: { out: string }) => unknown };
  const out = mkdtempSync(join(tmpdir(), "gate-approve-build-"));
  build({ out });
  const GATE = join(out, "gate", "run.js");
  const FIELDS = join(ROOT, "watch", "gate", "fixtures", "fields-server.mjs");
  const INIT = { jsonrpc: "2.0", id: 0, method: "initialize", params: {} };
  const LIST = { jsonrpc: "2.0", id: 1, method: "tools/list" };

  const dir = mkdtempSync(join(tmpdir(), "gate-approve-e2e-"));
  const pinFile = join(dir, "pin.json");
  const pending = join(dir, "pending");
  await new Promise<void>((resolve) => {
    const c = spawn(process.execPath, [GATE, "--write-pin", pinFile, "--package", "brydge-fields-server@1.0.0", "--", process.execPath, FIELDS, "--instructions=a"], { stdio: ["pipe", "ignore", "ignore"] });
    c.stdin.on("error", () => {});
    c.on("exit", () => resolve());
    c.stdin.write(JSON.stringify(INIT) + "\n");
    setTimeout(() => c.stdin.write(JSON.stringify(LIST) + "\n"), 150);
    setTimeout(() => c.stdin.end(), 500);
  });
  assert.ok(existsSync(pinFile));

  const err = await new Promise<string>((resolve) => {
    const c = spawn(process.execPath, [GATE, "--pin", pinFile, "--pending", pending, "--", process.execPath, FIELDS, "--instructions=b"], { stdio: ["pipe", "ignore", "pipe"] });
    let e = "";
    c.stdin.on("error", () => {});
    c.stderr.on("data", (d: Buffer) => (e += d.toString("utf8")));
    c.on("exit", () => setTimeout(() => resolve(e), 150));
    c.stdin.write(JSON.stringify(INIT) + "\n");
    setTimeout(() => c.stdin.write(JSON.stringify(LIST) + "\n"), 150);
    setTimeout(() => c.stdin.end(), 600);
  });
  assert.match(err, /0 tool\(s\) differ from the pin.*and the server's instructions differ from the pin; written to/);
  const files = readdirSync(pending);
  assert.equal(files.length, 1, `reports written: ${files.length}\n${err}`);
  const report = JSON.parse(readFileSync(join(pending, files[0]!), "utf8")) as ReturnType<typeof pendingOf>;
  const item = report.prepared.items.find((i) => i.kind === "instructions");
  assert.ok(item, "the report the gate wrote has no instructions item");
  assert.ok(report.instructions && typeof report.instructions.seen === "string");

  /* Approve it, the way `gate approve` does, and the pin moves forward. */
  const pin = parse(readFileSync(pinFile, "utf8"));
  const a = carry({ pin, pending: report, incoming: { ...exportOf([{ kind: "instructions", name: INSTRUCTIONS_TOOL, decision: "approve", by: WHO, at: DAY, itemHash: item!.itemHash }]), package: pin.package, fromVersion: `pinned ${pin.pinnedAt}`, toVersion: `offered ${report.seenAt}` }, decisions: {} });
  assert.equal(a.pinChanged, true);
  assert.equal(a.pin.instructions!.hash, sha256Of(report.instructions!.seen!));
  assert.equal(a.pin.instructions!.how, "approve");
  noText(err, "the gate's stderr");
});
