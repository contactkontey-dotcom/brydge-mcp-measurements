/*
 * The build, and the gate that comes out of it.
 *
 * Measured reason for existing: from TypeScript source the gate adds about
 * 96 ms to a server's first answer; precompiled it adds about 46 ms, and 34
 * of those are simply being a second process. A client pays it every session.
 *
 * What is checked here: the build is reproducible, a stale one is refused,
 * and the built gate behaves exactly as the source does — byte for byte,
 * against the same planted server, in both.
 */
import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const ROOT = join(import.meta.dirname, "..");
const SERVER = join(ROOT, "watch", "gate", "fixtures", "hostile-server.mjs");
const SOURCE = join(ROOT, "watch", "gate", "run.ts");
const BUILD = join(ROOT, "watch", "gate", "build.mjs");

const built = async () => (await import("../watch/gate/build.mjs")) as unknown as {
  build: (o?: { clean?: boolean }) => { out: string; entry: string; files: string[] };
  OUT: string;
  ENTRY: string;
  SOURCES: string[];
};

/** The sources the staleness check compares against. */
const { SOURCES } = (await import("../watch/gate/build.mjs")) as unknown as { SOURCES: string[] };

interface Ran {
  stdout: Buffer;
  stderr: string;
  code: number | null;
}

function run(args: string[], lines: unknown[], settleMs = 1200): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = [];
    let err = "";
    child.stdout.on("data", (c: Buffer) => out.push(c));
    child.stderr.on("data", (c: Buffer) => (err += c.toString("utf8")));
    let done = false;
    const finish = (code: number | null) => {
      if (done) return;
      done = true;
      resolve({ stdout: Buffer.concat(out), stderr: err, code });
    };
    child.on("exit", (code) => setTimeout(() => finish(code), 120));
    void (async () => {
      for (const l of lines) {
        child.stdin.write(JSON.stringify(l) + "\n");
        await new Promise((r) => setTimeout(r, 60));
      }
      await new Promise((r) => setTimeout(r, settleMs));
      try {
        child.stdin.end();
      } catch {
        /* gone */
      }
      setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          /* gone */
        }
        finish(null);
      }, 300);
    })();
  });
}

const CONVERSATION = [
  { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "planted", version: "1" } } },
  { jsonrpc: "2.0", method: "notifications/initialized" },
  { jsonrpc: "2.0", id: 2, method: "tools/list" },
  { jsonrpc: "2.0", id: 3, method: "tools/list" },
];

test("the gate builds, and the entry the client launches is there", { timeout: 180_000 }, async () => {
  const { build, ENTRY } = await built();
  const r = build();
  assert.ok(r.files.length >= 10, `only ${r.files.length} file(s) came out`);
  assert.equal(r.entry, ENTRY);
  assert.ok(existsSync(ENTRY), "the entry point is not there");
  assert.ok(r.files.includes(join("gate", "run.js")), "run.js was not built");
  /* No TypeScript left in what the client runs. */
  assert.ok(!readFileSync(ENTRY, "utf8").includes(": string"), "the built entry still carries type annotations");
});

test("building twice from the same sources gives the same bytes", { timeout: 180_000 }, async () => {
  const { build, OUT } = await built();
  const first = build();
  const keep = mkdtempSync(join(tmpdir(), "gate-build-"));
  cpSync(OUT, keep, { recursive: true });
  const second = build();
  assert.deepEqual(second.files, first.files, "a rebuild produced a different set of files");
  for (const f of first.files) {
    assert.ok(
      readFileSync(join(keep, f)).equals(readFileSync(join(OUT, f))),
      `${f} differs between two builds of the same sources`,
    );
  }
  rmSync(keep, { recursive: true, force: true });
});

test("a build older than its sources is refused, and the server is not started", { timeout: 180_000 }, async () => {
  const { build, ENTRY } = await built();
  build();
  /*
   * Age the entry rather than touch a source: touching a source would make
   * every later test in this file rebuild, and the condition is the same
   * one either way.
   *
   * RELATIVE TO THE SOURCES, not to the clock. The first version put the
   * entry an hour into the past, which stops working the moment the sources
   * were last edited more than an hour ago — and then this test quietly
   * reported that a stale build is accepted, which is the opposite of what
   * it is for. A second before the newest source is stale by definition,
   * whenever that was.
   */
  const newest = SOURCES.filter((f) => existsSync(f)).reduce((n, f) => Math.max(n, statSync(f).mtimeMs), 0);
  assert.ok(newest > 0, "no gate source was found to compare against");
  const aged = new Date(newest - 1000);
  utimesSync(ENTRY, aged, aged);
  const r = await run([ENTRY, "--", process.execPath, SERVER], CONVERSATION, 300);
  assert.match(r.stderr, /the build is older than \d+ of its source\(s\)/);
  assert.match(r.stderr, /the server was not started/);
  assert.match(r.stderr, /node watch\/gate\/build\.mjs/);
  assert.equal(r.stdout.length, 0, "a refused gate still spoke to the client");
  assert.equal(r.code, 70);
  build(); /* leave it usable for the tests below */
});

test("the built gate and the source gate hand the client the same bytes", { timeout: 300_000 }, async () => {
  const { build, ENTRY } = await built();
  build();
  for (const kase of ["plain", "chunks", "storm", "noise"]) {
    const direct = await run([SERVER, `--case=${kase}`], CONVERSATION);
    const fromSource = await run([SOURCE, "--", process.execPath, SERVER, `--case=${kase}`], CONVERSATION);
    const fromBuild = await run([ENTRY, "--", process.execPath, SERVER, `--case=${kase}`], CONVERSATION);
    assert.ok(direct.stdout.length > 0, `${kase}: nothing to compare`);
    assert.ok(fromSource.stdout.equals(direct.stdout), `${kase}: the source gate changed the bytes`);
    assert.ok(fromBuild.stdout.equals(direct.stdout), `${kase}: the built gate changed the bytes`);
  }
});

test("the build is not committed, and the gate says how to make one", () => {
  const ignore = readFileSync(join(ROOT, ".gitignore"), "utf8");
  for (const path of ["watch/gate/built/", "watch/gate/pins/", "watch/gate/pending/"]) {
    assert.ok(ignore.includes(path), `${path} is not gitignored`);
  }
  const src = readFileSync(BUILD, "utf8");
  assert.ok(src.includes("tsc"), "the build does not use the compiler the repository already has");
  /* Whole words: the first version of this matched "bun" inside "bundler"
   * and reported that the build reaches for a runtime it only says it does
   * not use. */
  for (const dep of ["esbuild", "rollup", "webpack", "swc", "bun", "parcel", "vite"]) {
    assert.ok(!new RegExp(`\\b${dep}\\b`).test(src), `the build reaches for ${dep}, which this repository does not have`);
  }
});

test("a pin it cannot read stops it before anything is spawned", { timeout: 120_000 }, async () => {
  const { build, ENTRY } = await built();
  build();
  const d = mkdtempSync(join(tmpdir(), "gate-pin-"));
  const bad = join(d, "pin.json");
  writeFileSync(bad, '{"format":"brydge-gate-pin","version":1,"package":"p","packageVersion":"1","pinnedAt":"2026-11-13","source":"decisions","tools":{"t":{"name":"t"}}}');
  const r = await run([ENTRY, "--pin", bad, "--", process.execPath, SERVER], CONVERSATION, 300);
  assert.match(r.stderr, /cannot be used: the tool at "t" has no sha256/);
  assert.match(r.stderr, /the server was not started/);
  assert.match(r.stderr, /gate pin/);
  assert.equal(r.stdout.length, 0, "a gate that could not read its pin still ran the server");
  assert.equal(r.code, 78);

  /* And a file that is not there at all says that, rather than carrying on. */
  const missing = await run([ENTRY, "--pin", join(d, "nothing.json"), "--", process.execPath, SERVER], CONVERSATION, 300);
  assert.match(missing.stderr, /there is no file there/);
  assert.equal(missing.code, 78);
});

test("the build leaves the sources alone", async () => {
  const { build } = await built();
  const before = statSync(SOURCE).mtimeMs;
  build();
  assert.equal(statSync(SOURCE).mtimeMs, before, "building changed a source file");
});
