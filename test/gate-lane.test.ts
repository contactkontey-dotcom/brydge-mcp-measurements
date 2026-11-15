/*
 * R2a: two lanes. A change that reads as read-only keeps the client on the
 * definition somebody approved; every other change is held as before.
 *
 * The planted lane server has two tools — `get_report`, whose name reads
 * as a reader, and `charge_card`, whose name does not — and changes one
 * thing per mode. The attack this file exists for is `add-risky-parameter`:
 * a read-only NAME gaining a parameter that is not, which must be held and
 * not quietly served.
 *
 * Planted tokens LANE-A/LANE-B and CARD-A/CARD-B let a test prove which
 * wording reached the client without printing either.
 */
import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { BECAUSE, FLAG, KEPT, decide } from "../watch/gate/lane.ts";
import { rewriteTools } from "../watch/gate/excise.ts";
import { CONTAINMENT, flatten, GATEKEEPING, withoutDisclaimers } from "./banned.ts";

const ROOT = join(import.meta.dirname, "..");
const SRV = join(ROOT, "watch", "gate", "fixtures", "lane-server.mjs");
const { build } = (await import("../watch/gate/build.mjs")) as unknown as { build: (o: { out: string }) => unknown };
const BUILD_DIR = mkdtempSync(join(tmpdir(), "gate-lane-build-"));
build({ out: BUILD_DIR });
const GATE = join(BUILD_DIR, "gate", "run.js");

const A_TOKEN = "LANE-A-3131";
const B_TOKEN = "LANE-B-4242";

/* ── The decision, on its own ───────────────────────────────────────────── */

const reader = { name: "get_report", inputSchema: { type: "object", properties: { period: { type: "string" } } }, annotations: { readOnlyHint: true } };
const risky = { name: "get_report", inputSchema: { type: "object", properties: { period: { type: "string" }, webhook_url: { type: "string" } } }, annotations: { readOnlyHint: true } };

test("a reworded description on a tool that reads as read-only goes down the lane", () => {
  const d = decide({ pinned: reader, live: reader, differs: "its description differs from the baseline" });
  assert.equal(d.lane, "serve-pinned");
  assert.equal(d.because, BECAUSE.readOnly);
});

test("THE ATTACK: a risky parameter added to a read-only-named tool is held", () => {
  /*
   * The whole point of classifying the LIVE definition rather than the
   * changed slice. `get_report` still reads as a reader and still claims
   * readOnlyHint; it now takes a `webhook_url`, and that is what counts.
   */
  const d = decide({
    pinned: reader,
    live: risky,
    differs: "its input schema differs from the baseline",
    addedParameters: ["webhook_url"],
  });
  assert.equal(d.lane, "hold");
  assert.equal(d.because, BECAUSE.notReadOnly);
  assert.deepEqual(d.assessment?.classes, ["exec/network"]);
});

test("a reworded description on a tool whose parameters were ALREADY risky is held", () => {
  /* The other half of the same rule: the change is a description, but the
   * tool is not a reader, so there is no lane for it. */
  const d = decide({ pinned: risky, live: risky, differs: "its description differs from the baseline" });
  assert.equal(d.lane, "hold");
  assert.equal(d.because, BECAUSE.notReadOnly);
});

test("money, destructive and unknown are all held", () => {
  for (const [name, params] of [
    ["charge_card", { amount: {} }],
    ["delete_report", { id: {} }],
    ["frobnicate_widget", { id: {} }],
  ] as const) {
    const live = { name, inputSchema: { type: "object", properties: params } };
    const d = decide({ pinned: live, live, differs: "its description differs from the baseline" });
    assert.equal(d.lane, "hold", `${name} went down the lane`);
    assert.equal(d.because, BECAUSE.notReadOnly);
  }
});

test("a tool with no approved version, and a change nothing classifies, are held", () => {
  assert.equal(decide({ pinned: undefined, live: reader, differs: "its description differs from the baseline" }).because, BECAUSE.notPinned);
  assert.equal(decide({ pinned: reader, live: reader, differs: "not in the baseline" }).because, BECAUSE.notPinned);
  assert.equal(
    decide({ pinned: reader, live: reader, differs: "it differs from the baseline in some other field" }).because,
    BECAUSE.unclassified,
  );
  for (const d of [
    decide({ pinned: undefined, live: reader, differs: "its description differs from the baseline" }),
    decide({ pinned: reader, live: reader, differs: "not in the baseline" }),
    decide({ pinned: reader, live: reader, differs: "it differs from the baseline in some other field" }),
  ]) {
    assert.equal(d.lane, "hold");
  }
});

test("nothing the lane says claims more than it does", () => {
  const src = readFileSync(join(ROOT, "watch", "gate", "lane.ts"), "utf8");
  const flat = withoutDisclaimers(flatten(src));
  for (const w of [...CONTAINMENT, ...GATEKEEPING]) assert.ok(!flat.includes(w), `lane.ts says "${w}"`);
});

/* ── The splice, by the bytes ───────────────────────────────────────────── */

const T = (name: string, extra = "") => `{"name":${JSON.stringify(name)},"description":"FIXTURE: planted."${extra}}`;
const list = (id: string, ...tools: string[]) => `{"jsonrpc":"2.0","id":${id},"result":{"tools":[${tools.join(",")}]}}`;

test("a replaced element is exactly the pinned definition, and every other byte is the server's", () => {
  const raw = Buffer.from(list("0", T("a"), T("b"), T("c")), "utf8");
  const pinned = { name: "b", description: "FIXTURE: the approved wording." };
  const r = rewriteTools(raw, new Set(), new Map([["b", pinned]]));
  assert.ok(r.ok);
  if (!r.ok) throw new Error("unreachable");
  assert.equal(r.inserted.length, 1);
  assert.equal(r.kept, 3);
  /* The span that went in, and the bytes either side of it. */
  const span = r.inserted[0]!;
  const out = r.bytes.toString("utf8");
  assert.equal(out, list("0", T("a"), JSON.stringify(pinned), T("c")));
  assert.equal(raw.subarray(0, span.start).toString("utf8"), out.slice(0, span.start));
  assert.equal(raw.subarray(span.end).toString("utf8"), out.slice(span.start + span.bytes));
});

for (const [label, id] of [
  ["zero", "0"],
  ["negative zero", "-0"],
  ["an integer past 2^53", "9007199254740993"],
  ["a float with a trailing zero", "1.0"],
  ["a string", '"req-7"'],
] as const) {
  test(`a splice leaves the id token alone: ${label}`, () => {
    const raw = Buffer.from(list(id, T("a"), T("b")), "utf8");
    const r = rewriteTools(raw, new Set(), new Map([["a", { name: "a" }]]));
    assert.ok(r.ok && r.bytes.toString("utf8").includes(`"id":${id},`), `the id token ${id} was altered`);
  });
}

test("a cut and a splice in one message do not tread on each other", () => {
  const raw = Buffer.from(list("1", T("a"), T("b"), T("c"), T("d")), "utf8");
  const r = rewriteTools(raw, new Set(["b"]), new Map([["c", { name: "c", approved: true }]]));
  assert.ok(r.ok);
  if (!r.ok) throw new Error("unreachable");
  assert.equal(r.bytes.toString("utf8"), list("1", T("a"), '{"name":"c","approved":true}', T("d")));
  assert.equal(r.kept, 3);
});

test("a splice of a name that is not there changes nothing", () => {
  const raw = Buffer.from(list("1", T("a")), "utf8");
  const r = rewriteTools(raw, new Set(), new Map([["zzz", { name: "zzz" }]]));
  assert.ok(r.ok && r.bytes.equals(raw) && r.inserted.length === 0);
});

/* ── Through the built gate ─────────────────────────────────────────────── */

const INIT = { jsonrpc: "2.0", id: 1, method: "initialize", params: {} };
const listMsg = (id: number) => ({ jsonrpc: "2.0", id, method: "tools/list" });
const callMsg = (id: number, name: string, args: Record<string, unknown>) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });

interface Ran { out: string; err: string; code: number | null; journal: Array<Record<string, any>>; report: Record<string, any> | null }

function run(args: string[], script: unknown[], dirs: { journal?: string; pending?: string } = {}, capMs = 30_000): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    let settled = false;
    child.stdin.on("error", () => {});
    child.stdout.on("data", (c: Buffer) => (out += c.toString("utf8")));
    child.stderr.on("data", (c: Buffer) => (err += c.toString("utf8")));
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      const journal =
        dirs.journal && existsSync(dirs.journal)
          ? readFileSync(dirs.journal, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, any>)
          : [];
      let report: Record<string, any> | null = null;
      if (dirs.pending && existsSync(dirs.pending)) {
        const f = readdirSync(dirs.pending)[0];
        if (f) report = JSON.parse(readFileSync(join(dirs.pending, f), "utf8")) as Record<string, any>;
      }
      resolve({ out, err, code, journal, report });
    };
    child.on("exit", (code) => setTimeout(() => finish(code), 150));
    void (async () => {
      for (const m of script) {
        try {
          child.stdin.write(JSON.stringify(m) + "\n");
        } catch {
          break;
        }
        await new Promise((d) => setTimeout(d, 120));
      }
      await new Promise((d) => setTimeout(d, 250));
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
      finish(null);
    }, capMs);
  });
}

const dir = () => mkdtempSync(join(tmpdir(), "gate-lane-"));
const lines = (out: string) => out.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, any>);
const listIn = (r: Ran, id: number) => lines(r.out).find((m) => m.id === id && m.result?.tools)?.result.tools as Array<Record<string, any>> | undefined;
const answerTo = (r: Ran, id: number) => lines(r.out).find((m) => m.id === id)!;

async function pinned(): Promise<string> {
  const pin = join(dir(), "pin.json");
  const r = await run([GATE, "--write-pin", pin, "--package", "brydge-lane-server@1.0.0", "--", process.execPath, SRV, "--mode=baseline"], [INIT, listMsg(2)]);
  assert.ok(existsSync(pin), r.err);
  return pin;
}
const gate = (pin: string, mode: string, extra: string[] = []) => [
  GATE, "--pin", pin, "--mode", "enforce", ...extra, "--", process.execPath, SRV, `--mode=${mode}`,
];

test("the lane serves the approved wording, and the new one never reaches the client", { timeout: 120_000 }, async () => {
  const pin = await pinned();
  const d = dir();
  const journal = join(d, "journal.jsonl");
  const pending = join(d, "pending");
  const r = await run(
    gate(pin, "reword-read-only", [FLAG, "--journal", journal, "--pending", pending]),
    [INIT, listMsg(2), listMsg(3), callMsg(4, "get_report", { period: "q1" })],
    { journal, pending },
  );
  assert.equal(r.code, 0, r.err);

  /* The tool is still in the list, with the wording somebody approved. */
  const tools = listIn(r, 3)!;
  assert.deepEqual(tools.map((t) => t.name), ["get_report", "charge_card"]);
  assert.ok(r.out.includes(A_TOKEN), "the approved wording was not sent");
  assert.ok(!r.out.includes(B_TOKEN), "the new wording reached the client");
  /* And it works. */
  assert.match(answerTo(r, 4).result.content[0].text, /called with: period/);

  /* One stderr line, a journal note of its own, and a marked report item. */
  assert.match(r.err, new RegExp(`1 tool\\(s\\) ${KEPT} across a change recorded for review`));
  const note = r.journal.find((n) => n.kind === "served-pinned");
  assert.ok(note, `no served-pinned note: ${r.journal.map((n) => n.kind).join(", ")}`);
  assert.equal(note!.tool, "get_report");
  assert.equal(note!.n, 1);
  assert.deepEqual(r.report!.keptOnApproved, ["get_report"]);
  assert.equal(r.report!.prepared.items.find((i: Record<string, any>) => i.tool === "get_report").lane, KEPT);
  assert.ok((r.report!.notes as string[]).some((n) => n.includes(KEPT) && n.includes("may no longer describe what the server does")));

  /* Nothing was hidden, so nothing says it was. */
  assert.ok(!/did not pass/.test(r.err), `a hiding was reported:\n${r.err}`);
  assert.ok(!r.journal.some((n) => n.kind === "hidden"), "a hidden note was written although nothing was hidden");
  /* And no planted wording leaked into the journal. */
  assert.ok(!JSON.stringify(r.journal).includes("FIXTURE"), "the journal carries a description");
});

test("the attack is held: a risky parameter added to a read-only name takes the tool out of the list", { timeout: 120_000 }, async () => {
  const pin = await pinned();
  const d = dir();
  const journal = join(d, "journal.jsonl");
  const r = await run(
    gate(pin, "add-risky-parameter", [FLAG, "--journal", journal]),
    [INIT, listMsg(2), listMsg(3), callMsg(4, "get_report", { period: "q1" })],
    { journal },
  );
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(listIn(r, 3)!.map((t) => t.name), ["charge_card"], "the tool was served despite a risky new parameter");
  assert.match(answerTo(r, 4).error.message, /"get_report" is hidden, because its input schema differs from the baseline/);
  assert.ok(!r.journal.some((n) => n.kind === "served-pinned"), "the lane engaged on a risky change");
  assert.match(r.err, /did not pass 1 tool\(s\) to the client/);
});

test("a tool that does not read as read-only is held, flag or no flag", { timeout: 120_000 }, async () => {
  const pin = await pinned();
  for (const extra of [[FLAG], []]) {
    const r = await run(gate(pin, "reword-risky", extra), [INIT, listMsg(2), listMsg(3), callMsg(4, "charge_card", { amount: 1 })]);
    assert.deepEqual(listIn(r, 3)!.map((t) => t.name), ["get_report"], `charge_card was served with ${extra.join(" ") || "no flag"}`);
    assert.match(answerTo(r, 4).error.message, /"charge_card" is hidden/);
  }
});

test("a call that only fits the new version is refused in the gate's own words", { timeout: 120_000 }, async () => {
  const pin = await pinned();
  const d = dir();
  const journal = join(d, "journal.jsonl");
  const r = await run(
    gate(pin, "add-plain-parameter", [FLAG, "--journal", journal]),
    [INIT, listMsg(2), listMsg(3), callMsg(4, "get_report", { period: "q1" }), callMsg(5, "get_report", { period: "q1", page: 2 })],
    { journal },
  );
  assert.equal(r.code, 0, r.err);
  /* The approved schema went out: no `page` in it. */
  const served = listIn(r, 3)!.find((t) => t.name === "get_report")!;
  assert.deepEqual(Object.keys(served.inputSchema.properties), ["period"]);
  /* A call against what was served is forwarded. */
  assert.match(answerTo(r, 4).result.content[0].text, /called with: period/);
  /* A call using the new parameter is not. */
  const refused = answerTo(r, 5);
  assert.ok(refused.error, "the call was forwarded");
  assert.match(refused.error.message, /the gate did not forward this call: "get_report" is being served on the version somebody approved/);
  assert.match(refused.error.message, /uses a parameter that only a newer version of it has/);
  assert.equal(refused.error.data.reason, "the call uses a parameter only a newer version of the tool has");
  /* The message names no parameter, no command, no path and no flag. */
  assert.ok(!refused.error.message.includes("page"), "the refusal named the parameter");
  assert.ok(!/--|\.json|gate approve/.test(refused.error.message), "the refusal carries a flag, a path or a command");
  const flat = flatten(refused.error.message);
  for (const w of [...CONTAINMENT, ...GATEKEEPING]) assert.ok(!flat.includes(w), `the refusal says "${w}"`);
  /* And the journal has it, with the parameter's existence named only there. */
  assert.ok(r.journal.some((n) => n.kind === "refused" && n.because === "the call uses a parameter only a newer version of the tool has"));
});

test("the flag is announced once, and says what it changes", { timeout: 120_000 }, async () => {
  const pin = await pinned();
  const r = await run(gate(pin, "baseline", [FLAG]), [INIT, listMsg(2)]);
  const times = r.err.split(`${FLAG} is on`).length - 1;
  assert.equal(times, 1, `announced ${times} time(s)`);
  assert.match(r.err, /never from its description/);
  assert.match(r.err, /may no longer describe what the server does/);
});

test("the flag is refused in shadow mode, where it would decide nothing", { timeout: 60_000 }, async () => {
  const pin = await pinned();
  const r = await run([GATE, "--pin", pin, FLAG, "--", process.execPath, SRV, "--mode=baseline"], [INIT], {}, 8_000);
  assert.equal(r.code, 64);
  assert.match(r.err, new RegExp(`${FLAG} only applies with --mode enforce`));
  assert.match(r.err, /there is nothing for a lane to decide\. The server was not started\./);
});

/* ── The two byte comparisons ───────────────────────────────────────────── */

test("flag off: byte for byte what the gate sends today", { timeout: 120_000 }, async () => {
  const pin = await pinned();
  const script = [INIT, listMsg(2), listMsg(3), callMsg(4, "get_report", { period: "q1" })];
  const off = await run(gate(pin, "reword-read-only", []), script);
  const without = await run(gate(pin, "reword-read-only", []), script);
  assert.equal(off.out, without.out, "two runs with the flag off do not agree, so this test proves nothing");
  /* The tool is hidden, as it is today. */
  assert.deepEqual(listIn(off, 3)!.map((t) => t.name), ["charge_card"]);
  assert.ok(!off.err.includes(KEPT), "the lane spoke with the flag off");
});

test("flag on and nothing differing: byte for byte what no gate sends", { timeout: 120_000 }, async () => {
  const pin = await pinned();
  const script = [INIT, listMsg(2), listMsg(3), callMsg(4, "get_report", { period: "q1" }), callMsg(5, "charge_card", { amount: 2 })];
  const direct = await run([SRV, "--mode=baseline"], script);
  const gated = await run(gate(pin, "baseline", [FLAG]), script);
  assert.equal(gated.code, 0, gated.err);
  assert.equal(gated.out, direct.out, "the flag changed what a client reads when nothing differed");
  assert.ok(!gated.err.includes(KEPT));
});
