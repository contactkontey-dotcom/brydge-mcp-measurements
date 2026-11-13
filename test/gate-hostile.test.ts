/*
 * The gate in front of a server that behaves badly on purpose.
 *
 * The server is watch/gate/fixtures/hostile-server.mjs — planted, written
 * here, nobody else's code. The proof of pass-through is not an inspection:
 * the same server is run DIRECTLY and BEHIND THE GATE with the same input,
 * and the two stdout streams are compared byte for byte.
 */
import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const ROOT = join(import.meta.dirname, "..");
const SERVER = join(ROOT, "watch", "gate", "fixtures", "hostile-server.mjs");
const GATE = join(ROOT, "watch", "gate", "run.ts");

interface Ran {
  stdout: Buffer;
  stderr: string;
  code: number | null;
}

/**
 * Run a command, write the lines, wait until it has gone quiet, collect the
 * bytes.
 *
 * QUIET, NOT A FIXED DELAY. The first version waited a set 2.5 seconds, which
 * is plenty on an idle machine and not always enough when the whole suite is
 * running in parallel — the byte-at-a-time case failed there and nowhere
 * else, which is a test that reports on the load rather than on the gate.
 * This waits for a gap in the output instead, with a cap.
 */
function run(command: string, args: string[], lines: unknown[], _quietMs = 0, capMs = 30_000): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = [];
    let err = "";
    let lastAt = Date.now();
    child.stdout.on("data", (c: Buffer) => {
      out.push(c);
      lastAt = Date.now();
    });
    child.stderr.on("data", (c: Buffer) => (err += c.toString("utf8")));
    /*
     * The `die` case exits in the middle of a request, so a write lands on
     * a dead pipe. Without a listener that EPIPE ends the whole test RUN
     * rather than a test, and it only lands when the machine is loaded
     * enough for the exit to get ahead of the writes — which is why this
     * test failed in the full suite and passed three times on its own.
     */
    child.stdin.on("error", () => {});
    let settled = false;
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      resolve({ stdout: Buffer.concat(out), stderr: err, code });
    };
    child.on("exit", (code) => setTimeout(() => finish(code), 150));
    /* Write with a gap, so a server that answers in order is not raced. */
    void (async () => {
      for (const line of lines) {
        child.stdin.write(JSON.stringify(line) + "\n");
        await new Promise((r) => setTimeout(r, 60));
      }
      /*
       * Nothing here waits on a clock. The last line is a sentinel the
       * planted server answers and then exits on, so both runs end on an
       * EVENT and the capture is the same however loaded the machine is.
       * Two earlier versions of this ended on a timer — first a fixed delay,
       * then a quiet window — and both reported on the machine rather than
       * on the gate. The kill below is for a process that will not leave.
       */
      void lastAt;
      try {
        child.stdin.end();
      } catch {
        /* gone */
      }
      setTimeout(() => {
        if (settled) return;
        try {
          child.kill("SIGKILL");
        } catch {
          /* gone */
        }
        finish(null);
      }, capMs);
    })();
  });
}

/** The sentinel goes last: the planted server answers it and exits. */
const DONE = { jsonrpc: "2.0", id: 99, method: "fixture/done" };

const CONVERSATION = [
  { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "planted", version: "1" } } },
  { jsonrpc: "2.0", method: "notifications/initialized" },
  { jsonrpc: "2.0", id: 2, method: "tools/list" },
  { jsonrpc: "2.0", id: 3, method: "tools/list" },
  { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "read_file", arguments: { path: "/planted" } } },
  DONE,
];

/*
 * The quiet window has to be wider than the longest pause the server under
 * test takes, or closing its input is indistinguishable from it having
 * finished. The slow case sleeps 1.2 seconds on purpose, and with the
 * default window this closed its input mid-sleep and it never answered —
 * which the test correctly reported as the client losing the reply.
 */
const direct = (kase: string, lines = CONVERSATION) => run(process.execPath, [SERVER, `--case=${kase}`], lines);
const gated = (kase: string, journal: string | null, lines = CONVERSATION) =>
  run(process.execPath, [GATE, ...(journal ? ["--journal", journal] : []), "--", process.execPath, SERVER, `--case=${kase}`], lines);

const journalOf = (path: string) =>
  readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);

/* ── Byte-for-byte, case by case ────────────────────────────────────────── */

const CASES = [
  ["plain", "an ordinary exchange"],
  ["chunks", "a reply written one byte at a time"],
  ["split-utf8", "a character split across two writes"],
  ["storm", "twenty-five list_changed notifications"],
  ["noise", "non-JSON on stdout, which breaks its own transport"],
  ["unreadable", "a tools/list whose tools are not an array"],
  ["batch", "a JSON-RPC batch array"],
] as const;

for (const [kase, what] of CASES) {
  test(`${kase}: ${what} reaches the client unchanged`, { timeout: 60_000 }, async () => {
    const a = await direct(kase);
    const b = await gated(kase, null);
    assert.ok(a.stdout.length > 0, "the planted server produced nothing to compare");
    assert.equal(b.stdout.toString("utf8"), a.stdout.toString("utf8"), `${kase}: the client saw different text`);
    assert.ok(b.stdout.equals(a.stdout), `${kase}: the client saw different bytes`);
  });
}

test("slow: a server that takes its time still answers, unchanged", { timeout: 60_000 }, async () => {
  const a = await direct("slow");
  const b = await gated("slow", null);
  assert.ok(a.stdout.includes("read_file"), "the slow server never answered at all");
  assert.ok(b.stdout.equals(a.stdout), "the gate changed a slow server's answer");
});

test("die: a server that exits mid-request takes the gate with it, with its own code", { timeout: 60_000 }, async () => {
  const a = await direct("die");
  const b = await gated("die", null);
  assert.ok(b.stdout.equals(a.stdout), "what arrived before the exit differed");
  assert.equal(a.code, 3, "the planted server did not exit 3");
  assert.equal(b.code, 3, "the gate did not carry the child's exit code");
});

/* ── What the journal recorded ──────────────────────────────────────────── */

test("the journal records the second list's differences, and never a description", { timeout: 60_000 }, async () => {
  const journal = join(mkdtempSync(join(tmpdir(), "gate-")), "journal.ndjson");
  await gated("plain", journal);
  const notes = journalOf(journal);
  const kinds = notes.map((n) => n.kind);
  assert.ok(kinds.includes("baseline"), "no baseline was taken");
  assert.ok(kinds.includes("would-hide"), "the second list's differences were not noticed");

  const hide = notes.find((n) => n.kind === "would-hide") as { hidden: Array<{ tool: string; because: string }>; shown: number };
  assert.deepEqual(
    hide.hidden.map((h) => `${h.tool}: ${h.because}`).sort(),
    ["read_file: its description differs from the baseline", "write_file: not in the baseline"],
  );
  assert.equal(hide.shown, 1, "list_dir is unchanged and should still be counted as shown");

  /* The planted descriptions are in the server, not in the journal. */
  const text = readFileSync(journal, "utf8");
  for (const prose of ["reads the planted file", "writes the planted bytes", "FIXTURE"]) {
    assert.ok(!text.includes(prose), `the journal carries a description: ${prose}`);
  }
});

test("a batch and an unreadable list are each recorded as fail-closed", { timeout: 60_000 }, async () => {
  for (const [kase, why] of [["batch", /a batch of/], ["unreadable", /a tools\/list this cannot read/]] as const) {
    const journal = join(mkdtempSync(join(tmpdir(), "gate-")), "journal.ndjson");
    await gated(kase, journal);
    const notes = journalOf(journal);
    const closed = notes.filter((n) => n.kind === "fail-closed");
    assert.ok(closed.length >= 1, `${kase}: nothing was recorded as fail-closed`);
    assert.ok(closed.some((n) => why.test(String(n.because))), `${kase}: the reason does not say what was wrong`);
  }
});

test("non-JSON on stdout is recorded by size, and still reaches the client", { timeout: 60_000 }, async () => {
  const journal = join(mkdtempSync(join(tmpdir(), "gate-")), "journal.ndjson");
  const b = await gated("noise", journal);
  assert.ok(b.stdout.toString("utf8").includes("this is not JSON and never was"), "the client lost the server's own output");
  const notes = journalOf(journal);
  const unparsed = notes.filter((n) => n.kind === "unparsed-line");
  assert.ok(unparsed.length >= 1, "a line that is not a message went unrecorded");
  assert.equal(typeof unparsed[0]!.bytes, "number");
});

test("a storm of notifications is counted, and every one of them arrives", { timeout: 60_000 }, async () => {
  const journal = join(mkdtempSync(join(tmpdir(), "gate-")), "journal.ndjson");
  const b = await gated("storm", journal);
  const arrived = b.stdout.toString("utf8").split("\n").filter((l) => l.includes("list_changed")).length;
  assert.equal(arrived, 25, "the client did not receive every notification");
  assert.equal(journalOf(journal).filter((n) => n.kind === "list-changed").length, 25);
});

test("the gate's own output goes to stderr, and says what it did not do", { timeout: 60_000 }, async () => {
  const b = await gated("plain", null);
  assert.match(b.stderr, /Nothing was hidden from the client and no call was stopped/);
  /* Without --pin the baseline is the first list the server answered. */
  assert.match(b.stderr, /2 tool\(s\) against no pin: the first list seen/);
  /* And none of it is on stdout, where it would corrupt the transport. */
  for (const line of b.stdout.toString("utf8").split("\n").filter(Boolean)) {
    assert.doesNotThrow(() => JSON.parse(line), `stdout carried something that is not a message: ${line.slice(0, 60)}`);
  }
});
