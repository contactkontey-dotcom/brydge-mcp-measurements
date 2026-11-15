/*
 * I3b: a tool list with a hidden tool is cut, not rebuilt.
 *
 * The question is the same one I2 asked of the initialize result: when the
 * gate changes a message, is every byte it did not mean to change still the
 * server's? Before this stage a tools/list with a hidden tool was parsed,
 * filtered and serialised again, so the id — the byte a client matches the
 * answer to its request by — came back as JavaScript writes it. Now the
 * hidden elements are cut out of the server's bytes and nothing else moves.
 *
 * The planted fields server, in its hand-written mode, answers a list whose
 * spaces and id token no serialiser would reproduce — which is what lets a
 * test tell a cut from a rebuild. Ids are written by hand into the request
 * so a big integer is a token in the bytes and not a JavaScript number.
 */
import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { exciseTools } from "../watch/gate/excise.ts";

const ROOT = join(import.meta.dirname, "..");
const FIELDS = join(ROOT, "watch", "gate", "fixtures", "fields-server.mjs");
const { build } = (await import("../watch/gate/build.mjs")) as unknown as { build: (o: { out: string }) => unknown };
const BUILD_DIR = mkdtempSync(join(tmpdir(), "gate-list-excise-build-"));
build({ out: BUILD_DIR });
const GATE = join(BUILD_DIR, "gate", "run.js");

const INIT = `{"jsonrpc":"2.0","id":"init","method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"planted","version":"1"}}}`;
const listWith = (idToken: string) => `{"jsonrpc":"2.0","id":${idToken},"method":"tools/list"}`;

/** Raw lines in, raw bytes out, exit code kept. */
function raw(args: string[], lines: string[], capMs = 20_000): Promise<{ out: Buffer; err: string; code: number | null }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { stdio: ["pipe", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let err = "";
    let settled = false;
    child.stdin.on("error", () => {});
    child.stdout.on("data", (c: Buffer) => chunks.push(c));
    child.stderr.on("data", (c: Buffer) => (err += c.toString("utf8")));
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      resolve({ out: Buffer.concat(chunks), err, code });
    };
    child.on("exit", (code) => setTimeout(() => finish(code), 200));
    void (async () => {
      for (const l of lines) {
        try {
          child.stdin.write(l + "\n");
        } catch {
          break;
        }
        await new Promise((d) => setTimeout(d, 150));
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
const linesOf = (b: Buffer) => b.toString("utf8").split("\n").filter(Boolean);

/**
 * A pin from the fields server's first hand-written list: both planted tools.
 * --change=title makes `probe` differ on the second list, so it is hidden
 * and `probe_keep` stays.
 */
async function handwrittenPin(): Promise<string> {
  const pin = join(mkdtempSync(join(tmpdir(), "gate-list-excise-pin-")), "pin.json");
  const r = await raw([GATE, "--write-pin", pin, "--package", "brydge-fields-server@1.0.0", "--", process.execPath, FIELDS, "--change=title", "--tools=handwritten"], [INIT, listWith("1")]);
  assert.ok(existsSync(pin), r.err);
  return pin;
}

for (const [label, id] of [
  ["zero", "0"],
  ["negative zero", "-0"],
  ["an integer past 2^53", "9007199254740993"],
  ["a float with a trailing zero", "1.0"],
  ["a string", '"req-7"'],
] as const) {
  test(`a hidden tool comes out of the list and every other byte is the server's: ${label}`, { timeout: 60_000 }, async () => {
    /*
     * Against the fields server's HAND-WRITTEN list, whose spaces and id
     * token a serialiser would not reproduce. An earlier version of this
     * test ran against the demo server, whose output is already canonical
     * JSON, and could not tell a cut from a rebuild: reverting the gate to
     * re-serialising killed nothing. This one can, and the guard below
     * makes sure the fixture still gives it something to tell apart.
     */
    const pin = await handwrittenPin();
    const server = ["--change=title", "--tools=handwritten"];
    const own = await raw([FIELDS, ...server], [INIT, listWith("1"), listWith(id)]);
    const gated = await raw([GATE, "--pin", pin, "--mode", "enforce", "--", process.execPath, FIELDS, ...server], [INIT, listWith("1"), listWith(id)]);
    assert.equal(gated.code, 0, gated.err);

    const serverLine = linesOf(own.out)[2]!;
    const gateLine = linesOf(gated.out)[2]!;
    /* The guard: a serialiser would have changed this line. */
    assert.notEqual(JSON.stringify(JSON.parse(serverLine)), serverLine, "the fixture's line is canonical, so this test cannot tell a cut from a rebuild");
    assert.ok(serverLine.includes(`"id": ${id},`), `the fixture did not write the id token ${id} verbatim: ${serverLine.slice(0, 60)}`);

    /* The id token, exactly as the server wrote it, spaces included. */
    assert.ok(gateLine.includes(`"id": ${id},`), `the id token ${id} was altered or re-spaced in: ${gateLine.slice(0, 60)}`);
    /* The whole line: the server's bytes minus one element. */
    const cut = exciseTools(Buffer.from(serverLine, "utf8"), new Set(["probe"]));
    assert.ok(cut.ok && cut.removed.length === 1);
    assert.equal(gateLine, cut.ok && cut.bytes.toString("utf8"), "the list is not the server's bytes minus one element");
    const names = (JSON.parse(gateLine) as { result: { tools: Array<{ name: string }> } }).result.tools.map((t) => t.name);
    assert.deepEqual(names, ["probe_keep"]);
    assert.match(gated.err, /did not pass 1 tool\(s\) to the client/);
  });
}

test("a list whose bytes and parsed copy cannot agree on where a hidden tool is ends the session", { timeout: 60_000 }, async () => {
  /*
   * The fields server's --change=title makes its one tool differ from the
   * pin on the second list, so it is hidden; --tools=dupname writes that
   * second list's element with two "name" members. The parsed copy says the
   * tool is "probe" (last key wins) and the scanner refuses to pick, so the
   * list is not forwarded and the session ends with the reason.
   */
  const pin = join(mkdtempSync(join(tmpdir(), "gate-list-excise-pin-")), "pin.json");
  await raw([GATE, "--write-pin", pin, "--package", "brydge-fields-server@1.0.0", "--", process.execPath, FIELDS, "--change=title"], [INIT, listWith("1")]);
  const r = await raw(
    [GATE, "--pin", pin, "--mode", "enforce", "--", process.execPath, FIELDS, "--change=title", "--tools=dupname"],
    [INIT, listWith("1"), listWith("2")],
  );
  assert.equal(r.code, 78, `exit ${r.code}:\n${r.err}`);
  /* The first list matched the pin and went through; the second did not go anywhere. */
  assert.equal(linesOf(r.out).length, 2, "a list the scanner could not cut was forwarded");
  assert.match(r.err, /failing closed: 1 tool\(s\) are hidden and could not be taken out of the tool list without doubt: tool 1 has 2 "name" member\(s\), not one/);
  assert.match(r.err, /Forwarding a list that was supposed to be changed is not something this does/);
  assert.match(r.err, /the session is ending/);
});
