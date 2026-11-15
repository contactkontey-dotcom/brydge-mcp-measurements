/*
 * The journal's first line: which session this is a journal of.
 *
 * Until N1 a journal was a list of observations with nothing saying what
 * they were observations OF. A notifier reading one cannot route it to an
 * owner without the package, and cannot know whether a `would-hide` means
 * "a gate would have" or "a gate did" without the mode. Both are now the
 * first line.
 */
import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const ROOT = join(import.meta.dirname, "..");
const DEMO = join(ROOT, "watch", "gate", "fixtures", "demo-server.mjs");
const { build } = (await import("../watch/gate/build.mjs")) as unknown as { build: (o: { out: string }) => unknown };
const BUILD_DIR = mkdtempSync(join(tmpdir(), "gate-journal-build-"));
build({ out: BUILD_DIR });
const GATE = join(BUILD_DIR, "gate", "run.js");

const INIT = { jsonrpc: "2.0", id: 1, method: "initialize", params: {} };
const READY = { jsonrpc: "2.0", method: "notifications/initialized" };
const LIST = { jsonrpc: "2.0", id: 2, method: "tools/list" };

function run(args: string[], script: unknown[], capMs = 25_000): Promise<{ err: string; code: number | null }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { stdio: ["pipe", "ignore", "pipe"] });
    let err = "";
    let settled = false;
    child.stdin.on("error", () => {});
    child.stderr.on("data", (c: Buffer) => (err += c.toString("utf8")));
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      resolve({ err, code });
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

const dir = () => mkdtempSync(join(tmpdir(), "gate-journal-"));
const header = (file: string) => JSON.parse(readFileSync(file, "utf8").split("\n")[0]!) as Record<string, any>;

async function pinned(): Promise<string> {
  const pin = join(dir(), "pin.json");
  await run([GATE, "--write-pin", pin, "--package", "brydge-demo-server@1.0.0", "--", process.execPath, DEMO, "--mode=baseline"], [INIT, READY, LIST]);
  assert.ok(existsSync(pin));
  return pin;
}

test("the first line names the session, and it is a session note", async () => {
  const j = join(dir(), "journal.jsonl");
  await run([GATE, "--journal", j, "--", process.execPath, DEMO, "--mode=baseline"], [INIT, READY, LIST]);
  const h = header(j);
  assert.equal(h.kind, "session");
  assert.deepEqual(Object.keys(h).sort(), ["at", "kind", "mode", "package", "packageVersion", "session"]);
  assert.ok(Number.isFinite(h.at));
  /* And it is FIRST: a reader takes the header without scanning. */
  const lines = readFileSync(j, "utf8").trim().split("\n");
  assert.ok(lines.length > 1, "nothing was observed, so this proves nothing about order");
  assert.ok(!lines.slice(1).some((l) => (JSON.parse(l) as { kind: string }).kind === "session"), "more than one session note");
});

test("the mode is in it, because what the other lines mean depends on it", async () => {
  const pin = await pinned();
  const shadow = join(dir(), "shadow.jsonl");
  const enforce = join(dir(), "enforce.jsonl");
  await run([GATE, "--pin", pin, "--journal", shadow, "--", process.execPath, DEMO, "--mode=baseline"], [INIT, READY, LIST]);
  await run([GATE, "--pin", pin, "--mode", "enforce", "--journal", enforce, "--", process.execPath, DEMO, "--mode=baseline"], [INIT, READY, LIST]);
  assert.equal(header(shadow).mode, "shadow");
  assert.equal(header(enforce).mode, "enforce");
});

test("the package comes from the pin, from --package, or is null when nothing names it", async () => {
  const pin = await pinned();
  const fromPin = join(dir(), "a.jsonl");
  await run([GATE, "--pin", pin, "--mode", "enforce", "--journal", fromPin, "--", process.execPath, DEMO, "--mode=baseline"], [INIT, READY, LIST]);
  assert.equal(header(fromPin).package, "brydge-demo-server");
  assert.equal(header(fromPin).packageVersion, "1.0.0");

  const taking = join(dir(), "b.jsonl");
  await run([GATE, "--write-pin", join(dir(), "p.json"), "--package", "planted@9.9.9", "--journal", taking, "--", process.execPath, DEMO, "--mode=baseline"], [INIT, READY, LIST]);
  assert.equal(header(taking).package, "planted");
  assert.equal(header(taking).packageVersion, "9.9.9");

  const nameless = join(dir(), "c.jsonl");
  await run([GATE, "--journal", nameless, "--", process.execPath, DEMO, "--mode=baseline"], [INIT, READY, LIST]);
  assert.equal(header(nameless).package, null, "a package was invented for a session that names none");
  assert.equal(header(nameless).packageVersion, null);
});

test("the session label is random, so two journals of one server are told apart", async () => {
  const pin = await pinned();
  const seen = new Set<string>();
  for (let i = 0; i < 3; i++) {
    const j = join(dir(), `s${i}.jsonl`);
    await run([GATE, "--pin", pin, "--mode", "enforce", "--journal", j, "--", process.execPath, DEMO, "--mode=baseline"], [INIT, READY, LIST]);
    const s = header(j).session as string;
    assert.match(s, /^[0-9a-f]{8}$/, `not a label: ${s}`);
    seen.add(s);
  }
  assert.equal(seen.size, 3, "two sessions carried the same label");
});

test("the header carries no path, and nothing else private", async () => {
  /* The journal is the one file you can send without reading it first.
   * The header must not be what breaks that: the pin's path is a path on
   * somebody's machine and has no business in it. */
  const pin = await pinned();
  const j = join(dir(), "journal.jsonl");
  await run([GATE, "--pin", pin, "--mode", "enforce", "--journal", j, "--", process.execPath, DEMO, "--mode=baseline"], [INIT, READY, LIST]);
  const line = readFileSync(j, "utf8").split("\n")[0]!;
  assert.ok(!line.includes(pin), "the header carries the pin's path");
  assert.ok(!line.includes("/"), `the header carries something path-shaped: ${line}`);
  assert.ok(!line.includes(DEMO));
});

test("no --journal is not an error, and writes nothing", async () => {
  const r = await run([GATE, "--", process.execPath, DEMO, "--mode=baseline"], [INIT, READY, LIST]);
  assert.equal(r.code, 0, r.err);
});
