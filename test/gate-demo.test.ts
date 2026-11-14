/*
 * The planted demo server, and the three things G3c added around it:
 * --write-pin, --refusal-style, and the demo's own three modes.
 *
 * The demo server is planted: every description in it was written in this
 * repository, it reads nothing and calls nothing. It exists so that a
 * tester can watch a real client meet a hidden tool without pointing the
 * gate at somebody else's server, and so that these tests can drive the
 * same three cases without one either.
 */
import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { read as readPin } from "../watch/gate/pin.ts";
import { ADOPTED } from "../watch/gate/pin.ts";
import { CONTAINMENT, flatten, GATEKEEPING } from "./banned.ts";

const ROOT = join(import.meta.dirname, "..");
const DEMO = join(ROOT, "watch", "gate", "fixtures", "demo-server.mjs");

const { build } = (await import("../watch/gate/build.mjs")) as unknown as {
  build: (o: { out: string }) => { files: string[] };
};
/* Its own build, for the reason gate-enforce.test.ts has one. */
const BUILD_DIR = mkdtempSync(join(tmpdir(), "gate-demo-build-"));
build({ out: BUILD_DIR });
const GATE = join(BUILD_DIR, "gate", "run.js");

interface Answer {
  id?: unknown;
  result?: Record<string, any>;
  error?: Record<string, any>;
  method?: string;
}

interface Ran {
  answers: Answer[];
  notifications: string[];
  stderr: string;
  code: number | null;
}

/**
 * Drive it the way a client does: one message at a time, each sent only
 * once the previous answer has come back.
 *
 * A driver that writes everything at once races the server, and a call sent
 * before the tool list has come back is a different case — the gate has not
 * seen the list yet, so there is nothing for it to hide against. That case
 * has its own test in gate-enforce.test.ts; it is not this one.
 */
function drive(args: string[], messages: unknown[], gapMs = 0, capMs = 30_000): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { stdio: ["pipe", "pipe", "pipe"] });
    const answers: Answer[] = [];
    const notifications: string[] = [];
    let err = "";
    let buf = "";
    let i = 0;
    let settled = false;
    child.stdin.on("error", () => {});
    child.stderr.on("data", (c: Buffer) => (err += c.toString("utf8")));
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      resolve({ answers, notifications, stderr: err, code });
    };
    const next = () => {
      if (i >= messages.length) {
        setTimeout(() => {
          try {
            child.stdin.end();
          } catch {
            /* gone */
          }
        }, gapMs);
        return;
      }
      const m = messages[i++];
      setTimeout(() => child.stdin.write(JSON.stringify(m) + "\n"), gapMs);
    };
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (c: string) => {
      buf += c;
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        const m = JSON.parse(line) as Answer;
        if (m.id === undefined) {
          notifications.push(String(m.method));
          continue;
        }
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

/**
 * Drive it to a script, with real pauses.
 *
 * `drive` above sends the next message when the previous one is answered,
 * which is how a client behaves and is right for most of these tests. It
 * cannot be used where the gate asks for something of its own: that
 * exchange never reaches the client, so a driver waiting for an answer per
 * message would be waiting for a line it can never see. Here the pauses
 * are explicit and the server's own timer does the rest.
 */
function driveWaiting(args: string[], script: Array<unknown | { wait: number }>, capMs = 60_000): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(args[0] === process.execPath ? args[0] : process.execPath, args[0] === process.execPath ? args.slice(1) : args, {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const answers: Answer[] = [];
    const notifications: string[] = [];
    let err = "";
    let buf = "";
    let settled = false;
    child.stdin.on("error", () => {});
    child.stderr.on("data", (c: Buffer) => (err += c.toString("utf8")));
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      resolve({ answers, notifications, stderr: err, code });
    };
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (c: string) => {
      buf += c;
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const l = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!l.trim()) continue;
        let m: Answer;
        try {
          m = JSON.parse(l) as Answer;
        } catch {
          continue;
        }
        if (m.id === undefined) notifications.push(String(m.method));
        else answers.push(m);
      }
    });
    child.on("exit", (code) => setTimeout(() => finish(code), 200));
    void (async () => {
      for (const step of script) {
        if (step && typeof step === "object" && "wait" in step) {
          await new Promise((d) => setTimeout(d, (step as { wait: number }).wait));
          continue;
        }
        child.stdin.write(JSON.stringify(step) + "\n");
        await new Promise((d) => setTimeout(d, 80));
      }
      await new Promise((d) => setTimeout(d, 200));
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

const INIT = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "planted", version: "1" } } };
const listMsg = (id: number) => ({ jsonrpc: "2.0", id, method: "tools/list" });
const callMsg = (id: number, name: string, a: Record<string, unknown> = {}) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: a } });
const namesIn = (r: Ran, id: number) => (r.answers.find((m) => m.id === id)?.result?.tools ?? []).map((t: { name: string }) => t.name);
const PKG = "brydge-demo-server@1.0.0";

/* ── The demo server on its own ─────────────────────────────────────────── */

test("the demo server offers four planted tools and does arithmetic", async () => {
  const r = await drive([DEMO, "--mode=baseline"], [INIT, listMsg(2), callMsg(3, "demo_add", { a: 2, b: 3 }), callMsg(4, "demo_echo", { text: "hi" })]);
  assert.deepEqual(namesIn(r, 2), ["demo_add", "demo_subtract", "demo_echo", "demo_now"]);
  assert.equal(r.answers.find((m) => m.id === 3)?.result?.content[0].text, "5");
  assert.equal(r.answers.find((m) => m.id === 4)?.result?.content[0].text, "hi");
});

test("every description in it says it is planted, and none reads as an instruction", async () => {
  const r = await drive([DEMO, "--mode=baseline"], [INIT, listMsg(2)]);
  const tools = r.answers.find((m) => m.id === 2)!.result!.tools as Array<{ description: string }>;
  assert.equal(tools.length, 4);
  for (const t of tools) {
    assert.match(t.description, /^Planted demo tool/, `a demo description does not say it is planted: ${t.description}`);
  }
  /* And the source says the same, so a tester reading the file sees it. */
  const src = readFileSync(DEMO, "utf8");
  for (const s of ["There is no real package behind it", "reads nothing"]) {
    assert.ok(src.includes(s), `the demo server does not say "${s}"`);
  }
});

test("an unknown mode does not start it", async () => {
  const r = await drive([DEMO, "--mode=whatever"], [INIT], 0, 5_000);
  assert.match(
    r.stderr,
    /--mode is one of baseline, changed-description, dropped-notified, dropped-silent, reworded-notified, reworded-silent, renamed-notified/,
  );
  assert.equal(r.code, 64);
  assert.equal(r.answers.length, 0);
});

test("changed-description changes one description and nothing else", async () => {
  const base = await drive([DEMO, "--mode=baseline"], [INIT, listMsg(2)]);
  const changed = await drive([DEMO, "--mode=changed-description"], [INIT, listMsg(2)]);
  const a = base.answers.find((m) => m.id === 2)!.result!.tools as Array<Record<string, unknown>>;
  const b = changed.answers.find((m) => m.id === 2)!.result!.tools as Array<Record<string, unknown>>;
  assert.deepEqual(a.map((t) => t.name), b.map((t) => t.name), "the names changed too");
  const differ = a.filter((t, i) => JSON.stringify(t) !== JSON.stringify(b[i]));
  assert.equal(differ.length, 1, "more than one tool differs");
  assert.equal(differ[0]!.name, "demo_add");
  assert.deepEqual(
    (b.find((t) => t.name === "demo_add") as { inputSchema: unknown }).inputSchema,
    (a.find((t) => t.name === "demo_add") as { inputSchema: unknown }).inputSchema,
    "the schema changed as well as the words",
  );
});

for (const [mode, notified] of [["dropped-notified", true], ["dropped-silent", false]] as const) {
  test(`${mode} stops offering a tool mid-session${notified ? " and says so" : " and says nothing"}`, { timeout: 60_000 }, async () => {
    const r = await drive(
      [DEMO, `--mode=${mode}`, "--drop-after=50"],
      [INIT, listMsg(2), callMsg(3, "demo_now"), listMsg(4), callMsg(5, "demo_subtract", { a: 9, b: 4 })],
      120,
    );
    assert.ok(namesIn(r, 2).includes("demo_subtract"), `${mode}: the first list is not the baseline`);
    assert.ok(!namesIn(r, 4).includes("demo_subtract"), `${mode}: the tool was still there on the second list`);
    assert.equal(
      r.notifications.includes("notifications/tools/list_changed"),
      notified,
      `${mode}: the notification was ${notified ? "not sent" : "sent"}`,
    );
    /* Without the gate, the server answers for itself: a tool it does not
     * have. That is what the gate's own refusal has to be told apart from. */
    const said = r.answers.find((m) => m.id === 5)!;
    assert.equal(said.error?.code, -32601);
    assert.match(said.error!.message, /brydge-demo-server does not have a tool called "demo_subtract"/);
  });
}

/* ── --write-pin ────────────────────────────────────────────────────────── */

test("--write-pin takes a pin from the live server and says it is unreviewed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gate-writepin-"));
  const pin = join(dir, "pin.json");
  const r = await drive([GATE, "--write-pin", pin, "--package", PKG, "--", process.execPath, DEMO, "--mode=baseline"], [INIT, listMsg(2)]);
  assert.deepEqual(namesIn(r, 2), ["demo_add", "demo_subtract", "demo_echo", "demo_now"], "the list did not come through unchanged");
  assert.ok(existsSync(pin), "no pin was written");
  const p = readPin(pin);
  assert.equal(p.package, "brydge-demo-server");
  assert.equal(p.packageVersion, "1.0.0");
  assert.equal(p.source, ADOPTED);
  assert.deepEqual(Object.keys(p.tools).sort(), ["demo_add", "demo_echo", "demo_now", "demo_subtract"]);
  for (const t of Object.values(p.tools)) assert.equal(t.how, ADOPTED, `${t.name} is recorded as approved`);
  assert.match(r.stderr, /adopted, not reviewed/);
  assert.match(r.stderr, /not something somebody signed off/);
});

test("--write-pin writes once, not on every list", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gate-writepin2-"));
  const pin = join(dir, "pin.json");
  const r = await drive(
    [GATE, "--write-pin", pin, "--package", PKG, "--", process.execPath, DEMO, "--mode=dropped-silent", "--drop-after=50"],
    [INIT, listMsg(2), callMsg(3, "demo_now"), listMsg(4)],
    120,
  );
  assert.equal(Object.keys(readPin(pin).tools).length, 4, "the pin was rewritten from a later list");
  assert.equal([...r.stderr.matchAll(/wrote a pin/g)].length, 1, "it wrote more than one pin");
});

test("--write-pin refuses the combinations that would make it circular", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gate-writepin3-"));
  const pin = join(dir, "pin.json");
  const enforcing = await drive([GATE, "--write-pin", pin, "--package", PKG, "--mode", "enforce", "--", process.execPath, DEMO], [INIT], 0, 5_000);
  assert.match(enforcing.stderr, /--write-pin is for shadow mode/);
  assert.match(enforcing.stderr, /approving its own findings/);
  assert.equal(enforcing.answers.length, 0, "the server was started anyway");

  writeFileSync(pin, "{}");
  const both = await drive([GATE, "--write-pin", pin, "--pin", pin, "--package", PKG, "--", process.execPath, DEMO], [INIT], 0, 5_000);
  assert.match(both.stderr, /--write-pin and --pin together/);
  assert.equal(both.answers.length, 0);

  const nameless = await drive([GATE, "--write-pin", pin, "--", process.execPath, DEMO], [INIT], 0, 5_000);
  assert.match(nameless.stderr, /needs --package <name@version>/);
  assert.equal(nameless.answers.length, 0);
});

/* ── The three modes, with the gate enforcing ───────────────────────────── */

/** Pin the baseline, then run the gate in front of a mode. */
async function pinned(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "gate-demo-pin-"));
  const pin = join(dir, "pin.json");
  await drive([GATE, "--write-pin", pin, "--package", PKG, "--", process.execPath, DEMO, "--mode=baseline"], [INIT, listMsg(2)]);
  assert.ok(existsSync(pin), "the baseline pin was not written");
  return pin;
}

test("enforcing against a changed description takes that one tool out of the list", { timeout: 60_000 }, async () => {
  const pin = await pinned();
  const r = await drive(
    [GATE, "--pin", pin, "--mode", "enforce", "--", process.execPath, DEMO, "--mode=changed-description"],
    [INIT, listMsg(2), callMsg(3, "demo_add", { a: 2, b: 3 }), callMsg(4, "demo_echo", { text: "hi" })],
  );
  assert.deepEqual(namesIn(r, 2), ["demo_subtract", "demo_echo", "demo_now"], "the changed tool was passed to the client");
  const refused = r.answers.find((m) => m.id === 3)!;
  assert.match(refused.error!.message, /did not forward this call: "demo_add" is hidden, because its description differs from the baseline/);
  /* And the three that did not change still work. */
  assert.equal(r.answers.find((m) => m.id === 4)?.result?.content[0].text, "hi");
  assert.match(r.stderr, /did not pass 1 tool\(s\) to the client/);
});

for (const mode of ["dropped-notified", "dropped-silent"] as const) {
  test(`enforcing when the server drops a tool (${mode}) refuses it as withdrawn`, { timeout: 60_000 }, async () => {
    const pin = await pinned();
    const r = await drive(
      [GATE, "--pin", pin, "--mode", "enforce", "--", process.execPath, DEMO, `--mode=${mode}`, "--drop-after=50"],
      [INIT, listMsg(2), callMsg(3, "demo_now"), listMsg(4), callMsg(5, "demo_subtract", { a: 9, b: 4 })],
      120,
    );
    /* Nothing is hidden: every tool still matches the pin. The list shrinks
     * because the server shrank it, and those bytes are the server's. */
    assert.ok(namesIn(r, 2).includes("demo_subtract"));
    assert.deepEqual(namesIn(r, 4), ["demo_add", "demo_echo", "demo_now"]);
    const refused = r.answers.find((m) => m.id === 5)!;
    assert.match(refused.error!.message, /the server is no longer offering "demo_subtract"/);
    assert.equal(refused.error!.data.reason, "no longer offered by the server");
    assert.ok(!/is hidden/.test(refused.error!.message), "a withdrawn tool was called hidden");
    assert.ok(!/did not pass/.test(r.stderr), "something was hidden although nothing differed from the pin");
    /* The journal tells the two modes apart: one was announced. */
    assert.equal(/list-changed=/.test(r.stderr), mode === "dropped-notified", `${mode}: the notification was counted wrongly`);
  });
}

/* ── --refusal-style ────────────────────────────────────────────────────── */

test("the default shape is a protocol error", { timeout: 60_000 }, async () => {
  const pin = await pinned();
  const r = await drive(
    [GATE, "--pin", pin, "--mode", "enforce", "--", process.execPath, DEMO, "--mode=changed-description"],
    [INIT, listMsg(2), callMsg(3, "demo_add", { a: 1, b: 1 })],
  );
  const m = r.answers.find((x) => x.id === 3)!;
  assert.ok(m.error, "the default shape is not an error");
  assert.equal(m.result, undefined);
});

test("--refusal-style result says the same words in a tool result", { timeout: 60_000 }, async () => {
  const pin = await pinned();
  const conv = [INIT, listMsg(2), callMsg(3, "demo_add", { a: 1, b: 1 })];
  const asError = await drive([GATE, "--pin", pin, "--mode", "enforce", "--", process.execPath, DEMO, "--mode=changed-description"], conv);
  const asResult = await drive([GATE, "--pin", pin, "--mode", "enforce", "--refusal-style", "result", "--", process.execPath, DEMO, "--mode=changed-description"], conv);

  /* The list is the same either way: the style is only the refusal. */
  assert.deepEqual(namesIn(asResult, 2), namesIn(asError, 2));

  const m = asResult.answers.find((x) => x.id === 3)!;
  assert.equal(m.error, undefined, "the result shape still sent an error");
  assert.equal(m.result!.isError, true, "isError is not set");
  assert.equal(m.result!.content.length, 1);
  assert.equal(m.result!.content[0].type, "text");
  /* The same sentence, exactly. */
  assert.equal(m.result!.content[0].text, asError.answers.find((x) => x.id === 3)!.error!.message);
  /* And who refused, where a client that reads _meta can find it. */
  assert.equal(m.result!._meta["brydge-gate/didNotForward"].didNotForward, true);
  assert.equal(m.result!._meta["brydge-gate/didNotForward"].tool, "demo_add");
});

test("--refusal-style result is equal to the error shape in every other byte", { timeout: 60_000 }, async () => {
  /*
   * The style must not become a second way of hiding things. Everything but
   * the refused call's own answer has to be identical.
   */
  const pin = await pinned();
  const conv = [INIT, listMsg(2), callMsg(3, "demo_add", { a: 1, b: 1 }), callMsg(4, "demo_echo", { text: "x" }), callMsg(5, "demo_subtract", { a: 9, b: 4 })];
  const a = await drive([GATE, "--pin", pin, "--mode", "enforce", "--", process.execPath, DEMO, "--mode=changed-description"], conv);
  const b = await drive([GATE, "--pin", pin, "--mode", "enforce", "--refusal-style=result", "--", process.execPath, DEMO, "--mode=changed-description"], conv);
  /* Everything but the refused call itself. demo_now is left out of the
   * conversation on purpose: it answers with its own uptime, so two runs
   * differ there whatever the gate does. */
  const without3 = (r: Ran) => JSON.stringify(r.answers.filter((m) => m.id !== 3));
  assert.ok(a.answers.length === 5 && b.answers.length === 5, `a run did not finish: ${a.answers.length} and ${b.answers.length} of 5`);
  assert.equal(without3(b), without3(a), "the style changed something other than the refusal");
});

test("a style nobody has is refused, and so is one in shadow mode", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gate-style-"));
  const pin = join(dir, "pin.json");
  await drive([GATE, "--write-pin", pin, "--package", PKG, "--", process.execPath, DEMO, "--mode=baseline"], [INIT, listMsg(2)]);

  const bad = await drive([GATE, "--pin", pin, "--mode", "enforce", "--refusal-style", "text", "--", process.execPath, DEMO], [INIT], 0, 5_000);
  assert.match(bad.stderr, /--refusal-style is error or result, not "text"/);
  assert.equal(bad.answers.length, 0, "the server was started anyway");

  /* In shadow mode nothing is refused, so a style for it does nothing. It
   * is said rather than quietly ignored. */
  const shadow = await drive([GATE, "--pin", pin, "--refusal-style", "result", "--", process.execPath, DEMO], [INIT], 0, 5_000);
  assert.match(shadow.stderr, /only applies under --mode enforce/);
  assert.equal(shadow.answers.length, 0);
});

test("neither shape claims more than not forwarding", { timeout: 60_000 }, async () => {
  const pin = await pinned();
  const conv = [INIT, listMsg(2), callMsg(3, "demo_add", { a: 1, b: 1 })];
  for (const style of ["error", "result"]) {
    const r = await drive([GATE, "--pin", pin, "--mode", "enforce", `--refusal-style=${style}`, "--", process.execPath, DEMO, "--mode=changed-description"], conv);
    const m = r.answers.find((x) => x.id === 3)!;
    const said = m.error?.message ?? m.result!.content[0].text;
    const flat = flatten([said, r.stderr].join("\n"));
    for (const w of [...CONTAINMENT, ...GATEKEEPING]) assert.ok(!flat.includes(w), `${style} says "${w}"`);
    assert.ok(said.includes("did not forward"), `${style} does not say what happened`);
  }
});

/* ── Reworded mid-session: the case the gate is actually for ─────────────── */

/*
 * changed-description differs from the pin before the client has listed
 * even once, so the first list the client gets is already filtered and it
 * never saw the tool. These two modes give the client the baseline first,
 * let it cache a list with the tool in it, and only then change the words.
 * What the client has on screen and what the server offers have come apart,
 * which is the thing no version number catches.
 *
 * In both, the client lists ONCE. That is the point: everything below
 * happens without it asking again.
 */

const SECOND_WORDING = /SECOND WORDING/;

/** One list, a pause long enough for the server to change, then a call. */
const cachedCallScript = [
  INIT,
  { jsonrpc: "2.0", method: "notifications/initialized" },
  listMsg(2),
  { wait: 1_200 },
  callMsg(3, "demo_add", { a: 2, b: 3 }),
];

test("reworded-notified: the tool is hidden before the client re-lists, and a cached call is refused", { timeout: 120_000 }, async () => {
  const pin = await pinned();
  const dir = mkdtempSync(join(tmpdir(), "gate-reworded-"));
  const r = await driveWaiting(
    [GATE, "--pin", pin, "--pending", dir, "--mode", "enforce", "--relist-on-change", "--", process.execPath, DEMO, "--mode=reworded-notified", "--drop-after=400"],
    cachedCallScript,
  );

  /* The client listed once, and that list had the tool in it. */
  const lists = r.answers.filter((m) => m.result?.tools);
  assert.equal(lists.length, 1, `the client listed ${lists.length} times; this test is about the one-list case`);
  assert.ok(
    lists[0]!.result!.tools.map((t: { name: string }) => t.name).includes("demo_add"),
    "the client's one list did not carry the tool, so nothing was cached to call",
  );

  /* The server said so, and the gate asked for a list of its own. */
  assert.ok(r.notifications.includes("notifications/tools/list_changed"), "the notification was not sent");
  assert.match(r.stderr, /asked the server for a tool list of its own \(brydge-gate\/1\)/);
  /* That answer never reached the client. */
  assert.equal(
    r.answers.filter((m) => typeof m.id === "string" && m.id.startsWith("brydge-gate/")).length,
    0,
    "the gate's own answer was passed to the client",
  );

  /* And the cached call is refused, by the gate, naming why. */
  const said = r.answers.find((m) => m.id === 3)!;
  assert.ok(said.error, `the call was forwarded and the server answered: ${JSON.stringify(said)}`);
  assert.equal(said.error.code, -32000);
  assert.match(said.error.message, /the gate did not forward this call: "demo_add" is hidden, because its description differs from the baseline/);
  /* The sentence that is true precisely in this case. */
  assert.match(said.error.message, /If your client listed the tools before it was hidden, it may still be showing it/);
  assert.equal(said.error.data.reason, "its description differs from the baseline");
  assert.match(r.stderr, /did not forward a call to "demo_add" \(its description differs from the baseline\)/);

  /*
   * How the hiding shows up here, which is not the same as in
   * changed-description: no tools/list result went to the client after the
   * change, so nothing was filtered on the way out and there is no "did
   * not pass" line. The hidden set is carried into the refusal instead,
   * and the summary counts it.
   */
  assert.ok(!/did not pass \d+ tool\(s\)/.test(r.stderr), "a list was filtered although the client never re-listed");
  assert.match(r.stderr, /enforce, 1 hidden/);

  /* A report was written about a change the client never saw. */
  const reports = readdirSync(dir);
  assert.equal(reports.length, 1, `${reports.length} report(s) for one change`);
  /* It is the report, and it names the tool. Read as bytes: no description
   * is printed by this test. */
  const report = JSON.parse(readFileSync(join(dir, reports[0]!), "utf8")) as Record<string, any>;
  assert.equal(report.format, "brydge-gate-pending");
  assert.deepEqual(report.wouldHide.map((w: { tool: string }) => w.tool), ["demo_add"]);
  assert.equal(report.prepared.items[0].kind, "description");
});

test("reworded-silent: nothing announces it, so the call is forwarded", { timeout: 120_000 }, async () => {
  /*
   * The limit of the whole approach, in one test. No notification means
   * nothing for the gate to ask on, so it is still comparing against the
   * list the client asked for — and that list was the baseline. The call
   * goes through to a server whose words have changed since.
   *
   * The gate is not wrong here; it has not been told. The README says so
   * in those words, and a test in gate-docs.test.ts insists that it does.
   */
  const pin = await pinned();
  const dir = mkdtempSync(join(tmpdir(), "gate-reworded-silent-"));
  const r = await driveWaiting(
    [GATE, "--pin", pin, "--pending", dir, "--mode", "enforce", "--relist-on-change", "--", process.execPath, DEMO, "--mode=reworded-silent", "--drop-after=400"],
    cachedCallScript,
  );

  assert.equal(r.notifications.length, 0, `the silent mode sent ${r.notifications.join(", ")}`);
  assert.ok(!/asked the server for a tool list/.test(r.stderr), "the gate asked without being told anything");

  /* The server answered the call itself: 2 + 3. */
  const said = r.answers.find((m) => m.id === 3)!;
  assert.equal(said.error, undefined, `the gate refused a call it had no grounds to refuse: ${JSON.stringify(said)}`);
  assert.equal(said.result!.content[0].text, "5");

  /* Nothing was hidden and nothing was reported, because nothing was seen. */
  assert.match(r.stderr, /enforce, 0 hidden/);
  assert.deepEqual(readdirSync(dir), [], "a report was written about a change nobody saw");
});

test("the two reworded modes differ only in the notification", { timeout: 120_000 }, async () => {
  /*
   * Same rewording, same tool, same second wording. If the lists the
   * client gets differ, the modes are testing two things at once and the
   * comparison above says nothing.
   */
  const script = [INIT, { jsonrpc: "2.0", method: "notifications/initialized" }, listMsg(2), { wait: 1_200 }, listMsg(3)];
  const seen: Record<string, string> = {};
  for (const mode of ["reworded-notified", "reworded-silent"]) {
    const r = await driveWaiting([process.execPath, DEMO, `--mode=${mode}`, "--drop-after=400"], script);
    const lists = r.answers.filter((m) => m.result?.tools).map((m) => JSON.stringify(m.result!.tools));
    assert.equal(lists.length, 2, `${mode}: ${lists.length} lists`);
    /* The first is the baseline, the second carries the new words. */
    assert.ok(!SECOND_WORDING.test(lists[0]!), `${mode}: the first list was already reworded`);
    assert.match(lists[1]!, SECOND_WORDING, `${mode}: the second list was not reworded`);
    seen[mode] = lists.join("\n");
  }
  assert.equal(seen["reworded-silent"], seen["reworded-notified"], "the two modes offer different tools");
});

test("the rewording changes the words and nothing else", { timeout: 120_000 }, async () => {
  const script = [INIT, { jsonrpc: "2.0", method: "notifications/initialized" }, listMsg(2), { wait: 1_200 }, listMsg(3)];
  const r = await driveWaiting([process.execPath, DEMO, "--mode=reworded-notified", "--drop-after=400"], script);
  const before = r.answers.find((m) => m.id === 2)!.result!.tools as Array<Record<string, unknown>>;
  const after = r.answers.find((m) => m.id === 3)!.result!.tools as Array<Record<string, unknown>>;
  assert.deepEqual(after.map((t) => t.name), before.map((t) => t.name), "a name changed too");
  const differ = after.filter((t, i) => JSON.stringify(t) !== JSON.stringify(before[i]));
  assert.equal(differ.length, 1, "more than one tool changed");
  assert.equal(differ[0]!.name, "demo_add");
  assert.deepEqual(
    (after.find((t) => t.name === "demo_add") as { inputSchema: unknown }).inputSchema,
    (before.find((t) => t.name === "demo_add") as { inputSchema: unknown }).inputSchema,
    "the schema changed as well as the words",
  );
  /* Still planted, and still says so. */
  assert.match(String((after.find((t) => t.name === "demo_add") as { description: string }).description), /^Planted demo tool/);
});

/* ── Renamed mid-session: a question about the client ───────────────────── */

test("renamed-notified renames one tool and leaves its description word for word", { timeout: 120_000 }, async () => {
  const script = [INIT, { jsonrpc: "2.0", method: "notifications/initialized" }, listMsg(2), { wait: 1_200 }, listMsg(3)];
  const r = await driveWaiting([process.execPath, DEMO, "--mode=renamed-notified", "--drop-after=400"], script);

  const before = r.answers.find((m) => m.id === 2)!.result!.tools as Array<Record<string, unknown>>;
  const after = r.answers.find((m) => m.id === 3)!.result!.tools as Array<Record<string, unknown>>;
  assert.ok(r.notifications.includes("notifications/tools/list_changed"), "the rename was not announced");

  /* One name moved, and it is the only thing that did. */
  assert.deepEqual(before.map((t) => t.name), ["demo_add", "demo_subtract", "demo_echo", "demo_now"]);
  assert.deepEqual(after.map((t) => t.name), ["demo_add", "demo_subtract", "demo_echo_v2", "demo_now"]);
  const gone = before.find((t) => t.name === "demo_echo")!;
  const arrived = after.find((t) => t.name === "demo_echo_v2")!;
  assert.equal(arrived.description, gone.description, "the description changed as well as the name");
  assert.deepEqual(arrived.inputSchema, gone.inputSchema, "the schema changed as well as the name");
  /* Every other tool is byte-identical across the two lists. */
  for (const name of ["demo_add", "demo_subtract", "demo_now"]) {
    assert.equal(
      JSON.stringify(after.find((t) => t.name === name)),
      JSON.stringify(before.find((t) => t.name === name)),
      `${name} changed too`,
    );
  }
});

test("renamed-notified: the old name stops working and the new one works", { timeout: 120_000 }, async () => {
  /*
   * Which is why a name is a thing a client has to care about and a
   * description is not: a stale name is a call that cannot work, and a
   * stale description is a call that works and may do something else.
   */
  const r = await driveWaiting(
    [process.execPath, DEMO, "--mode=renamed-notified", "--drop-after=400"],
    [INIT, { jsonrpc: "2.0", method: "notifications/initialized" }, listMsg(2), { wait: 1_200 }, callMsg(3, "demo_echo", { text: "hi" }), callMsg(4, "demo_echo_v2", { text: "hi" })],
  );
  const old_ = r.answers.find((m) => m.id === 3)!;
  assert.equal(old_.error?.code, -32601, "the old name still answered");
  assert.match(old_.error!.message, /does not have a tool called "demo_echo"/);
  assert.equal(r.answers.find((m) => m.id === 4)!.result!.content[0].text, "hi");
});

test("renamed-notified under enforcement: the new name is hidden, the old one withdrawn", { timeout: 120_000 }, async () => {
  /*
   * The gate sees a rename as what it is on the wire: one name gone and
   * one arrived. The arrival is not in the pin, so it is hidden; the
   * departure is no longer offered, so a call to it is refused as
   * withdrawn. Two different refusals for one change, which is worth a
   * tester knowing before they read the stderr.
   */
  const pin = await pinned();
  const r = await driveWaiting(
    [GATE, "--pin", pin, "--mode", "enforce", "--relist-on-change", "--", process.execPath, DEMO, "--mode=renamed-notified", "--drop-after=400"],
    [
      INIT,
      { jsonrpc: "2.0", method: "notifications/initialized" },
      listMsg(2),
      { wait: 1_400 },
      listMsg(3),
      callMsg(4, "demo_echo", { text: "hi" }),
      callMsg(5, "demo_echo_v2", { text: "hi" }),
    ],
  );
  /* The client's second list has the new name taken out of it. */
  assert.deepEqual(namesIn(r, 3), ["demo_add", "demo_subtract", "demo_now"], "the new name was passed to the client");
  assert.match(r.stderr, /did not pass 1 tool\(s\) to the client \(1 not in the baseline\)/);

  /* The old name: the server has stopped offering it. */
  const stale = r.answers.find((m) => m.id === 4)!;
  assert.equal(stale.error?.code, -32000, `the gate let a call to a withdrawn name through: ${JSON.stringify(stale)}`);
  assert.match(stale.error!.message, /the server is no longer offering "demo_echo"/);
  /* The new name: not in the baseline, so hidden. */
  const fresh = r.answers.find((m) => m.id === 5)!;
  assert.equal(fresh.error?.code, -32000);
  assert.match(fresh.error!.message, /"demo_echo_v2" is hidden, because not in the baseline/);
});
