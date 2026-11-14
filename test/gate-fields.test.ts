/*
 * ═══════════════════════════════════════════════════════════════════════════
 * WHICH FIELDS OF A TOOL DEFINITION THE PIN ACTUALLY COVERS.
 *
 * The pin compares by content, and "content" has to mean every field the
 * server sent — not the three this project happens to have names for. A
 * gate that watched `description` and `inputSchema` and let `annotations`
 * move would be a gate a server could walk straight past: `annotations`
 * carries readOnlyHint, and a client may decide whether to ask a person
 * before calling a tool by reading it.
 *
 * So each field gets its own planted server, differing from the first list
 * it served in EXACTLY ONE field, and each is put through both modes:
 * shadow has to say it would have hidden the tool, and enforce has to take
 * it out of the list and refuse a call to it.
 *
 * The fixture is planted: watch/gate/fixtures/fields-server.mjs was written
 * in this repository, its prose included. Nothing here reads a real
 * server's description, and no description is printed by any assertion
 * below — the tests assert on hashes, tool names and the gate's own words.
 *
 * ── TWO NEGATIVE CONTROLS, BECAUSE A TEST THAT CANNOT FAIL PROVES NOTHING ─
 *
 *   `none`       the second list is identical, so nothing may be hidden.
 *   `key-order`  the same tool with its keys in another order. A server is
 *                free to do that at any moment and it is not a change; a
 *                gate that called it one would hide every tool on a day
 *                somebody upgraded a JSON serialiser.
 *
 * ── AND ONE RECORDED GAP ──────────────────────────────────────────────────
 *
 * A description that is not a string is normalised away before the
 * comparison, so a change from one non-string description to another is not
 * seen. That is recorded here as what the code does today, with the fix
 * named in the comment. Nothing in this commit changes the behaviour.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { normalise, recordOf } from "../watch/tools.ts";
import { CONTAINMENT, GATEKEEPING } from "./banned.ts";

const ROOT = join(import.meta.dirname, "..");
const FIELDS = join(ROOT, "watch", "gate", "fixtures", "fields-server.mjs");

const { build } = (await import("../watch/gate/build.mjs")) as unknown as {
  build: (o: { out: string }) => { files: string[] };
};
const BUILD_DIR = mkdtempSync(join(tmpdir(), "gate-fields-build-"));
build({ out: BUILD_DIR });
const GATE = join(BUILD_DIR, "gate", "run.js");

const PKG = "brydge-fields-server@1.0.0";
const INIT = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "planted", version: "1" } } };
const listMsg = (id: number) => ({ jsonrpc: "2.0", id, method: "tools/list" });
const callMsg = (id: number, name = "probe") => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: { n: 1 } } });

interface Answer { id?: unknown; result?: Record<string, any>; error?: Record<string, any>; method?: string }
interface Ran { answers: Answer[]; stdout: Buffer; stderr: string; code: number | null }

/** One message at a time, each sent once the previous answer came back. */
function drive(args: string[], messages: unknown[], capMs = 30_000): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { stdio: ["pipe", "pipe", "pipe"] });
    const answers: Answer[] = [];
    const chunks: Buffer[] = [];
    let err = "";
    let buf = "";
    let i = 0;
    let settled = false;
    child.stdin.on("error", () => {});
    child.stderr.on("data", (c: Buffer) => (err += c.toString("utf8")));
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      resolve({ answers, stdout: Buffer.concat(chunks), stderr: err, code });
    };
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
      const m = messages[i++];
      child.stdin.write(JSON.stringify(m) + "\n");
    };
    child.stdout.on("data", (c: Buffer) => {
      chunks.push(c);
      buf += c.toString("utf8");
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        let m: Answer;
        try {
          m = JSON.parse(line) as Answer;
        } catch {
          continue;
        }
        if (m.id === undefined) continue;
        answers.push(m);
        next();
      }
    });
    child.on("exit", (code) => setTimeout(() => finish(code), 150));
    setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* gone */
      }
      finish(null);
    }, capMs);
    next();
  });
}

const namesIn = (r: Ran, id: number) => (r.answers.find((m) => m.id === id)?.result?.tools ?? []).map((t: { name: string }) => t.name);
const answerTo = (r: Ran, id: number) => r.answers.find((m) => m.id === id)!;

/** The pin this server's first list produces, taken in its own session. */
async function pinned(change: string): Promise<string> {
  const pin = join(mkdtempSync(join(tmpdir(), "gate-fields-pin-")), "pin.json");
  const r = await drive([GATE, "--write-pin", pin, "--package", PKG, "--", process.execPath, FIELDS, `--change=${change}`], [INIT, listMsg(2)]);
  assert.ok(existsSync(pin), `the pin was not written: ${r.stderr}`);
  return pin;
}

/* ── What the hash covers, field by field ───────────────────────────────── */

/*
 * The same question as the end-to-end tests below, asked of the hashing
 * directly, so a failure says whether the fault is in what is hashed or in
 * what the gate does with it.
 *
 * `normalise(recordOf(x))` is what both sides of every comparison in the
 * gate go through, so it is what is compared here.
 */
const hashOf = (t: Record<string, unknown>) => normalise(recordOf(t)).hash;
const probe = (extra: Record<string, unknown> = {}) => ({
  name: "probe",
  description: "FIXTURE: planted.",
  inputSchema: { type: "object" as const },
  ...extra,
});

const COVERED: Array<[string, Record<string, unknown>, Record<string, unknown>]> = [
  ["name", { name: "probe" }, { name: "probe_two" }],
  ["description", { description: "FIXTURE: one." }, { description: "FIXTURE: two." }],
  ["inputSchema", { inputSchema: { type: "object" } }, { inputSchema: { type: "string" } }],
  ["title", { title: "One" }, { title: "Two" }],
  ["outputSchema", { outputSchema: { type: "object" } }, { outputSchema: { type: "string" } }],
  ["annotations", { annotations: { readOnlyHint: true } }, { annotations: { readOnlyHint: false } }],
  ["_meta", { _meta: { "brydge/f": 1 } }, { _meta: { "brydge/f": 2 } }],
  ["a field no specification names", { plantedUnknownField: { shape: "a" } }, { plantedUnknownField: { shape: "b" } }],
  ["a field being added at all", {}, { somethingNew: true }],
];

for (const [field, a, b] of COVERED) {
  test(`the hash covers ${field}`, () => {
    assert.notEqual(hashOf(probe(a)), hashOf(probe(b)), `two tools differing only in ${field} hash the same`);
  });
}

test("the hash is over the whole tool, so key order is not a difference", () => {
  const forward = { name: "probe", description: "FIXTURE: planted.", inputSchema: { type: "object", properties: { a: { type: "number" }, b: { type: "string" } } } };
  const backward = { inputSchema: { properties: { b: { type: "string" }, a: { type: "number" } }, type: "object" }, description: "FIXTURE: planted.", name: "probe" };
  assert.equal(hashOf(forward), hashOf(backward), "the same tool hashed differently because its keys arrived in another order");
});

test("RECORDED GAP: a description that is not a string is normalised away before the comparison", () => {
  /*
   * `recordOf` keeps `description` only when it is a string, and
   * `definitionOf` writes the result back out — so an object description
   * becomes null on both sides of the comparison and two different ones
   * are the same tool to this gate. The raw hash DOES see it; the
   * normalised one, which is what the gate compares, does not.
   *
   * The specification says a description is a string, so no well-formed
   * server reaches this. A server that wanted to move text past the pin
   * could, if its client renders a non-string description to a model —
   * which is a question about clients and is not answered here.
   *
   * THE FIX, not applied in this commit: keep the field verbatim in
   * `extra` when it is not a string, rather than dropping it — one line in
   * `recordOf`'s exclusion list, plus a format bump, because every pin
   * written before it hashes the old way and a gate must not call an
   * unchanged tool changed on the day it is upgraded.
   */
  const one = { name: "probe", description: { text: "FIXTURE: one." } };
  const two = { name: "probe", description: { text: "FIXTURE: two." } };
  assert.notEqual(recordOf(one).hash, recordOf(two).hash, "the raw hash does not see it either, which would be a different bug");
  assert.equal(hashOf(one), hashOf(two), "the gap is closed; update this test and the README's audit note");
});

/* ── End to end: shadow ─────────────────────────────────────────────────── */

/*
 * Every field the fixture can change, through the gate in shadow mode. The
 * second list is the changed one, so each run asks for two.
 */
const CHANGES = ["title", "description", "inputSchema", "outputSchema", "annotations", "_meta", "unknown"] as const;

for (const change of CHANGES) {
  test(`shadow: a tool differing only in ${change} is a changed tool`, { timeout: 60_000 }, async () => {
    const journal = join(mkdtempSync(join(tmpdir(), "gate-fields-journal-")), "journal.jsonl");
    const r = await drive(
      [GATE, "--journal", journal, "--", process.execPath, FIELDS, `--change=${change}`],
      [INIT, listMsg(2), listMsg(3)],
    );
    /* Shadow changes nothing: both lists reach the client whole. */
    assert.deepEqual(namesIn(r, 2), ["probe"]);
    assert.deepEqual(namesIn(r, 3), ["probe"], "shadow mode took a tool out of the list");

    const notes = readFileSync(journal, "utf8").trim().split("\n").map((l) => JSON.parse(l) as Record<string, any>);
    const wouldHide = notes.filter((n) => n.kind === "would-hide");
    assert.equal(wouldHide.length, 1, `${change}: ${wouldHide.length} would-hide notes, not 1`);
    assert.deepEqual(wouldHide[0]!.hidden.map((h: { tool: string }) => h.tool), ["probe"]);
  });
}

for (const change of ["none", "key-order"] as const) {
  test(`shadow: ${change} is not a change`, { timeout: 60_000 }, async () => {
    const journal = join(mkdtempSync(join(tmpdir(), "gate-fields-journal-")), "journal.jsonl");
    await drive([GATE, "--journal", journal, "--", process.execPath, FIELDS, `--change=${change}`], [INIT, listMsg(2), listMsg(3)]);
    const notes = readFileSync(journal, "utf8").trim().split("\n").map((l) => JSON.parse(l) as Record<string, any>);
    assert.equal(notes.filter((n) => n.kind === "would-hide").length, 0, `${change} was called a change`);
    assert.ok(notes.some((n) => n.kind === "list-unchanged"), `${change}: no list was compared at all, so this test proved nothing`);
  });
}

/* ── End to end: enforce ────────────────────────────────────────────────── */

for (const change of CHANGES) {
  test(`enforce: a tool differing only in ${change} is taken out and its calls are not forwarded`, { timeout: 60_000 }, async () => {
    const pin = await pinned(change);
    const r = await drive(
      [GATE, "--pin", pin, "--mode", "enforce", "--", process.execPath, FIELDS, `--change=${change}`],
      [INIT, listMsg(2), callMsg(3), listMsg(4), callMsg(5)],
    );
    /* The first list matches the pin, so it goes through and a call on it
     * is forwarded. That is the half of this that must keep working. */
    assert.deepEqual(namesIn(r, 2), ["probe"], `${change}: the pinned list was not passed through`);
    assert.equal(answerTo(r, 3).result?.content?.[0]?.text, "1", `${change}: a call matching the pin was not forwarded`);

    /* The second differs in one field, so it is not passed on, and the
     * client's cached name no longer buys it a call. */
    assert.deepEqual(namesIn(r, 4), [], `${change}: the changed tool was passed to the client`);
    const refused = answerTo(r, 5);
    assert.ok(refused.error, `${change}: the call was not refused`);
    assert.match(refused.error!.message, /did not forward this call: "probe" is hidden/);
    assert.match(r.stderr, /did not pass 1 tool\(s\) to the client/);

    /* The refusal says which gate and why, and carries nothing a reader
     * could act on against the gate itself. */
    assert.match(refused.error!.message, /gate/i);
    for (const word of [...CONTAINMENT, ...GATEKEEPING]) {
      assert.ok(!new RegExp(`\\b${word}\\b`, "i").test(refused.error!.message), `${change}: the refusal says "${word}"`);
    }
    assert.ok(!/--|\.json|gate approve/.test(refused.error!.message), `${change}: the refusal carries a flag, a path or a command`);
  });
}

test("enforce: an identical second list changes nothing", { timeout: 60_000 }, async () => {
  const pin = await pinned("none");
  const r = await drive(
    [GATE, "--pin", pin, "--mode", "enforce", "--", process.execPath, FIELDS, "--change=none"],
    [INIT, listMsg(2), listMsg(3), callMsg(4)],
  );
  assert.deepEqual(namesIn(r, 3), ["probe"], "a tool was hidden although nothing differed from the pin");
  assert.equal(answerTo(r, 4).result?.content?.[0]?.text, "1");
  assert.ok(!/did not pass/.test(r.stderr));
});

test("enforce: the same keys in another order changes nothing", { timeout: 60_000 }, async () => {
  const pin = await pinned("key-order");
  const r = await drive(
    [GATE, "--pin", pin, "--mode", "enforce", "--", process.execPath, FIELDS, "--change=key-order"],
    [INIT, listMsg(2), listMsg(3), callMsg(4)],
  );
  assert.deepEqual(namesIn(r, 3), ["probe"], "a tool was hidden because its keys arrived in another order");
  assert.equal(answerTo(r, 4).result?.content?.[0]?.text, "1");
});

test("enforce: RECORDED GAP, a non-string description that changes is not noticed", { timeout: 60_000 }, async () => {
  /* The unit test above says why, and names the fix. This one says what it
   * means through the whole gate, which is the part a reader of the README
   * needs: the tool stays in the list and the call is forwarded. */
  const pin = await pinned("nonstring-description");
  const r = await drive(
    [GATE, "--pin", pin, "--mode", "enforce", "--", process.execPath, FIELDS, "--change=nonstring-description"],
    [INIT, listMsg(2), listMsg(3), callMsg(4)],
  );
  assert.deepEqual(namesIn(r, 3), ["probe"], "the gap is closed; update this test and the README's audit note");
  assert.equal(answerTo(r, 4).result?.content?.[0]?.text, "1");
});

/* ── What the gate looks at, and what it does not ───────────────────────── */

/*
 * THE GATE LOOKS AT FIVE THINGS AND FORWARDS EVERYTHING ELSE.
 *
 *   tools/list                       the request, to know an answer is coming
 *   its response                     compared against the pin; tools removed
 *                                    from it under enforcement
 *   tools/call                       client to server: the name is checked,
 *                                    and the call is held when --verify-on-call
 *                                    is on and the picture is stale
 *   notifications/tools/list_changed server to client: counted, and under
 *                                    --relist-on-change it prompts a list
 *   notifications/initialized        client to server: a marker only, so the
 *                                    gate sends nothing of its own before it
 *
 * Plus any message carrying an id in the reserved namespace, in either
 * direction, which belongs to the gate and never reaches the other side.
 *
 * EVERYTHING ELSE IS FORWARDED AS IT ARRIVED AND IS NOT READ. That includes
 * the initialize result — whose `instructions` field is server-authored text
 * a client may put in front of a model — resources, prompts, sampling,
 * roots, elicitation, logging, completion, progress, cancellation, ping, and
 * any method that does not exist yet. It also includes the RESULT of a
 * tools/call: the gate decides whether to forward the call, and does not
 * look at what comes back.
 *
 * This test holds that claim to the bytes, so the README can state it: the
 * server receives the same lines it receives with no gate at all, and the
 * client receives the same bytes back.
 */
const UNGATED = [
  { jsonrpc: "2.0", id: 10, method: "resources/list" },
  { jsonrpc: "2.0", id: 11, method: "resources/read", params: { uri: "fixture://planted/one" } },
  { jsonrpc: "2.0", id: 12, method: "prompts/list" },
  { jsonrpc: "2.0", id: 13, method: "prompts/get", params: { name: "planted_prompt" } },
  { jsonrpc: "2.0", id: 14, method: "completion/complete", params: { ref: { type: "ref/prompt", name: "planted_prompt" } } },
  { jsonrpc: "2.0", id: 15, method: "logging/setLevel", params: { level: "debug" } },
  { jsonrpc: "2.0", id: 16, method: "ping" },
  { jsonrpc: "2.0", id: 17, method: "fixture/not/a/real/method" },
  { jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 999 } },
  { jsonrpc: "2.0", method: "notifications/roots/list_changed" },
  { jsonrpc: "2.0", method: "notifications/progress", params: { progressToken: "fixture", progress: 1 } },
];

/**
 * Write every line, wait, and keep the bytes.
 *
 * `drive` steps on each answer, which cannot send a notification — nothing
 * comes back to step on. These messages include three, so this one writes
 * them all and lets the pauses do the work.
 */
function rawRun(args: string[], messages: unknown[], capMs = 20_000): Promise<{ stdout: Buffer; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { stdio: ["pipe", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let err = "";
    let settled = false;
    child.stdin.on("error", () => {});
    child.stdout.on("data", (c: Buffer) => chunks.push(c));
    child.stderr.on("data", (c: Buffer) => (err += c.toString("utf8")));
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve({ stdout: Buffer.concat(chunks), stderr: err });
    };
    child.on("exit", () => setTimeout(finish, 200));
    void (async () => {
      for (const m of messages) {
        child.stdin.write(JSON.stringify(m) + "\n");
        await new Promise((d) => setTimeout(d, 40));
      }
      await new Promise((d) => setTimeout(d, 300));
      try {
        child.stdin.end();
      } catch {
        /* gone */
      }
    })();
    setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* gone */
      }
      finish();
    }, capMs);
  });
}

test("everything that is not tools/* reaches the server and comes back byte for byte", { timeout: 60_000 }, async () => {
  const pin = await pinned("none");
  const script = [INIT, { jsonrpc: "2.0", method: "notifications/initialized" }, listMsg(2), callMsg(3), ...UNGATED];

  const dir = mkdtempSync(join(tmpdir(), "gate-fields-log-"));
  const direct = join(dir, "direct.log");
  const through = join(dir, "through.log");

  const a = await rawRun([FIELDS, "--change=none", `--log-in=${direct}`], script);
  const b = await rawRun(
    [GATE, "--pin", pin, "--mode", "enforce", "--", process.execPath, FIELDS, "--change=none", `--log-in=${through}`],
    script,
  );

  /* What the SERVER received. Nothing added, nothing dropped, nothing
   * reordered, nothing rewritten. */
  assert.equal(readFileSync(through, "utf8"), readFileSync(direct, "utf8"), "the server received different lines through the gate");

  /* What the CLIENT received. The gate writes nothing of its own to stdout
   * here, because nothing differs from the pin and nothing is refused. */
  assert.equal(b.stdout.toString("hex"), a.stdout.toString("hex"), "the client received different bytes through the gate");

  /* And the claims the README makes about particular ones, named so a
   * failure says which. */
  const out = b.stdout.toString("utf8");
  assert.match(out, /FIXTURE: planted instructions, carried in the initialize result\./, "the initialize result's instructions did not reach the client");
  assert.match(out, /FIXTURE: a planted resource/, "a resource listing did not reach the client");
  assert.match(out, /FIXTURE: planted prompt text\./, "a prompt did not reach the client");
  assert.match(out, /FIXTURE-ONE/, "a completion did not reach the client");
  assert.match(out, /"planted":"FIXTURE: a method no specification names\."/, "a method nobody has defined did not reach the client");
});

test("a tools/call result is forwarded without being read", { timeout: 60_000 }, async () => {
  /*
   * The gate decides about the CALL. What the server sends back is the
   * server's, and it is not compared, counted or rewritten — so a journal
   * naming a tool result would be the gate reading something it says it
   * does not.
   */
  const pin = await pinned("none");
  const journal = join(mkdtempSync(join(tmpdir(), "gate-fields-journal-")), "journal.jsonl");
  const r = await drive(
    [GATE, "--pin", pin, "--journal", journal, "--mode", "enforce", "--", process.execPath, FIELDS, "--change=none"],
    [INIT, listMsg(2), callMsg(3)],
  );
  assert.equal(answerTo(r, 3).result?.content?.[0]?.text, "1");
  const notes = readFileSync(journal, "utf8");
  assert.ok(!/content/.test(notes), "the journal carries something out of a tool result");
});
