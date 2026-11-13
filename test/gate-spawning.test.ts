/*
 * The two things about starting a child that differ by platform.
 *
 * Windows cannot be run from here, so the platform is an argument and both
 * answers are checked. The errors are planted objects with the codes Node
 * really gives; the end-to-end cases use a planted command name that does
 * not exist, and no other project's code is started.
 */
import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { cmdExeForm, detachedOn, isWindows, killStyleOn, startupAdvice } from "../watch/gate/spawning.ts";
import { CONTAINMENT, flatten, GATEKEEPING } from "./banned.ts";

const POSIX = ["linux", "darwin", "freebsd", "openbsd", "sunos", "aix"];

/* ── Detaching ──────────────────────────────────────────────────────────── */

test("the child is detached everywhere but Windows", () => {
  for (const p of POSIX) assert.equal(detachedOn(p), true, `${p} should spawn detached`);
  assert.equal(detachedOn("win32"), false, "Windows would give the server its own console window");
  assert.equal(isWindows("win32"), true);
  assert.equal(isWindows("linux"), false);
});

test("the kill matches the way the child was spawned", () => {
  /*
   * These two must agree: a signal to -pid needs a process group, and
   * there is only a group where the child was spawned detached.
   */
  for (const p of [...POSIX, "win32"]) {
    assert.equal(
      killStyleOn(p) === "group",
      detachedOn(p),
      `${p}: a group kill without a detached child, or the other way round`,
    );
  }
  assert.equal(killStyleOn("win32"), "child");
});

/* ── The message when the command did not start ─────────────────────────── */

const enoent = { code: "ENOENT", message: "spawn npx ENOENT" };
const einval = { code: "EINVAL", message: "spawn npx.cmd EINVAL" };

test("on Windows, a command that is really a .cmd gets the cmd.exe form", () => {
  for (const e of [enoent, einval]) {
    const lines = startupAdvice(e, "win32", "npx", ["-y", "my-server"]);
    assert.ok(lines.length > 0, `${e.code}: nothing was said`);
    const text = lines.join("\n");
    assert.match(text, /cmd\.exe \/c npx -y my-server/);
    assert.match(text, /a \.bat or \.cmd file cannot be started directly/);
    assert.match(text, /after the "--" in your client's config/);
    /* Every line is one of the gate's own. */
    for (const l of lines) assert.match(l, /^gate: /, `a line does not say who is speaking: ${l}`);
  }
});

test("it says it did not change the command", () => {
  const text = startupAdvice(enoent, "win32", "npx", ["-y", "my-server"]).join("\n");
  assert.match(text, /did not change the command it was given/);
  /* And it does not tell somebody that it will, or has. */
  assert.ok(!/we have run|retrying|instead the gate/i.test(text), text);
});

test("nothing is added on a platform where that is not the problem", () => {
  for (const p of POSIX) {
    assert.deepEqual(startupAdvice(enoent, p, "npx", ["-y", "x"]), [], `${p} got Windows advice`);
    assert.deepEqual(startupAdvice(einval, p, "npx", ["-y", "x"]), [], `${p} got Windows advice`);
  }
});

test("nothing is added for an error that is not about a .cmd", () => {
  for (const code of ["EACCES", "EPERM", "E2BIG", "", "ETIMEDOUT"]) {
    assert.deepEqual(
      startupAdvice({ code, message: `spawn thing ${code}` }, "win32", "thing", []),
      [],
      `${code || "(no code)"} got the .cmd advice`,
    );
  }
  /* And an error object with no code at all. */
  assert.deepEqual(startupAdvice({ message: "something" }, "win32", "thing", []), []);
});

test("the cmd.exe form quotes what cmd would need quoted, and nothing else", () => {
  assert.equal(cmdExeForm("npx", ["-y", "my-server"]), "cmd.exe /c npx -y my-server");
  assert.equal(
    cmdExeForm("C:/Program Files/nodejs/npx.cmd", ["-y", "a b"]),
    'cmd.exe /c "C:/Program Files/nodejs/npx.cmd" -y "a b"',
  );
  /* A quote in an argument is doubled, which is cmd's own escape. */
  assert.equal(cmdExeForm("x", ['a"b']), 'cmd.exe /c x "a""b"');
  assert.equal(cmdExeForm("node", []), "cmd.exe /c node");
});

test("the advice claims nothing the gate does not do", () => {
  const flat = flatten(startupAdvice(enoent, "win32", "npx", ["-y", "x"]).join("\n"));
  for (const w of [...CONTAINMENT, ...GATEKEEPING]) assert.ok(!flat.includes(w), `the advice says "${w}"`);
});

/* ── Driven, on this platform ───────────────────────────────────────────── */

const { build } = (await import("../watch/gate/build.mjs")) as unknown as {
  build: (o: { out: string }) => { files: string[] };
};
/* Its own build, for the reason gate-enforce.test.ts has one. */
const BUILD_DIR = mkdtempSync(join(tmpdir(), "gate-spawning-build-"));
build({ out: BUILD_DIR });
const GATE = join(BUILD_DIR, "gate", "run.js");

function run(args: string[]): Promise<{ err: string; code: number | null }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { stdio: ["pipe", "pipe", "pipe"] });
    let err = "";
    child.stdin.on("error", () => {});
    child.stderr.on("data", (c: Buffer) => (err += c.toString("utf8")));
    child.on("exit", (code) => setTimeout(() => resolve({ err, code }), 100));
    setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* gone */
      }
    }, 20_000);
  });
}

test("a command that does not exist says so and exits 127", { timeout: 60_000 }, async () => {
  const r = await run([GATE, "--", "brydge-planted-command-that-is-not-there", "--flag"]);
  assert.match(r.err, /gate: the command did not start: /);
  assert.equal(r.code, 127);
  /* On this platform there is no .cmd advice, because that is not the
   * problem here. The Windows case is covered above, by argument. */
  if (process.platform !== "win32") {
    assert.ok(!r.err.includes("cmd.exe"), `a POSIX run was given Windows advice:\n${r.err}`);
  }
});

test("a server that does start is still passed through, detached or not", { timeout: 60_000 }, async () => {
  /*
   * The point of the change is that nothing else about running a server
   * moves with it. On this platform the child is detached as before; what
   * this proves is that the one spawn call still works after being
   * rewritten to take the flag from a function.
   */
  const server = join(import.meta.dirname, "..", "watch", "gate", "fixtures", "demo-server.mjs");
  const child = spawn(process.execPath, [GATE, "--", process.execPath, server, "--mode=baseline"], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  const out = await new Promise<string>((resolve) => {
    let buf = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (c: string) => {
      buf += c;
      if (buf.includes("demo_now")) resolve(buf);
    });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) + "\n");
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) + "\n");
    setTimeout(() => resolve(buf), 15_000);
  });
  try {
    child.kill("SIGKILL");
  } catch {
    /* gone */
  }
  assert.match(out, /"demo_add"/);
  assert.match(out, /"demo_now"/);
});

/* ── The wiring ─────────────────────────────────────────────────────────── */

/*
 * These read run.ts rather than running it, because the Windows branch
 * cannot be reached from here. What they prove is that run.ts asks the
 * functions above rather than deciding for itself, and that it asks with
 * the real platform. What they cannot prove is that Windows then behaves
 * as the functions say; that is for the tester.
 */
test("run.ts takes the detached flag and the advice from these functions, with the real platform", () => {
  const src = readFileSync(join(import.meta.dirname, "..", "watch", "gate", "run.ts"), "utf8");

  /* The spawn's detached flag is the function's answer, not a literal. */
  assert.match(src, /const detached = detachedOn\(process\.platform\);/);
  assert.match(src, /spawn\(command!, args, \{ stdio: \["pipe", "pipe", "pipe"\], detached \}\)/);
  assert.ok(!/detached: true/.test(src), "run.ts still spawns with detached hard-coded");

  /* The kill style likewise, and there is only one place that kills. */
  assert.match(src, /const killStyle = killStyleOn\(process\.platform\);/);
  assert.equal([...src.matchAll(/process\.kill\(-/g)].length, 1, "a group kill outside endChild");
  assert.match(src, /if \(killStyle === "group"\) process\.kill\(-child\.pid, signal\);\s*\n\s*else child\.kill\(signal\);/);

  /* The advice is given the error, the real platform, and the command as
   * it was given — not a reconstruction of it. */
  assert.match(src, /startupAdvice\(e as \{ code\?: string \}, process\.platform, command!, args\)/);
  /* And nothing anywhere passes a platform in as a literal. */
  for (const m of src.matchAll(/(detachedOn|killStyleOn|startupAdvice)\([^)]*"(win32|linux|darwin)"/g)) {
    assert.fail(`run.ts hard-codes a platform: ${m[0]}`);
  }
});

test("the command the gate runs is the command it was given", () => {
  /*
   * The whole point of advising rather than rewriting. If run.ts ever
   * grows a cmd.exe of its own around the command, this fails.
   */
  const src = readFileSync(join(import.meta.dirname, "..", "watch", "gate", "run.ts"), "utf8");
  assert.equal([...src.matchAll(/spawn\(/g)].length, 1, "run.ts spawns in more than one place");
  assert.ok(!/"cmd\.exe"|'cmd\.exe'|cmd\.exe \/c/.test(src), "run.ts puts cmd.exe around the command itself");
  assert.match(src, /const \[command, \.\.\.args\] = argv\.slice\(dashdash \+ 1\);/);
});
