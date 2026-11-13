/*
 * The router, replayed over recorded sessions from real servers.
 *
 * ── WHERE THE CORPUS IS ──────────────────────────────────────────────────
 *
 * Not watch/runs: those hold the Level 1 evidence and the tool captures, and
 * no transcript. The message stream of a session lives in the sandbox the
 * harness built for it, under `session.transcript` — and the disk policy
 * deletes a sandbox once its evidence is stored, so that corpus is whatever
 * happens to still be on the machine.
 *
 * watch/transcripts holds the kept copy, made by watch/gate/keep.mjs, and it
 * is what these tests read. It is gitignored for the reason watch/runs is:
 * every message a server sent is in it, descriptions included. The sandboxes
 * are read only as a fallback, so a machine that still has them can run these
 * before anybody has made the copy. Where neither is there, these SKIP rather
 * than quietly passing on nothing.
 *
 * ── WHAT IT COVERS, AND WHAT IT CANNOT ───────────────────────────────────
 *
 * `Recorded.message` is the PARSED message, so this covers real sequences,
 * real shapes and the requests real servers make of their client — and NOT
 * byte framing. Framing is covered where the bytes can be planted:
 * gate-transport.test.ts, and the byte-for-byte comparison against a directly
 * run server in gate-hostile.test.ts.
 *
 * ── NOTHING IS PRINTED BUT COUNTS ────────────────────────────────────────
 *
 * Descriptions are compared against and never printed: an assertion that
 * fails names the tool and the server, not one character of the text.
 */
import { strict as assert } from "node:assert";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { lineOf } from "../watch/gate/transport.ts";
import { Router, type Side } from "../watch/gate/router.ts";

const KEPT = join(import.meta.dirname, "..", "watch", "transcripts");
const SANDBOXES = "/srv/brydge-measure";
const source: "kept" | "sandboxes" | null = existsSync(join(KEPT, "index.json"))
  ? "kept"
  : existsSync(SANDBOXES)
    ? "sandboxes"
    : null;
const have = source !== null;

interface Entry {
  dir: "to-server" | "from-server" | "stderr" | "stdout-noise";
  message: unknown;
}

function sessions(): string[] {
  if (source === "kept") {
    return readdirSync(KEPT)
      .filter((f) => f.endsWith(".json") && f !== "index.json")
      .map((f) => join(KEPT, f))
      .sort();
  }
  if (source === "sandboxes") {
    return readdirSync(SANDBOXES)
      .filter((d) => !d.startsWith("gate-room-"))
      .map((d) => join(SANDBOXES, d, "session-result.json"))
      .filter((f) => existsSync(f))
      .sort();
  }
  return [];
}

/** A kept copy carries the transcript at the top; a sandbox nests it. */
function transcriptOf(file: string): Entry[] | null {
  try {
    const d = JSON.parse(readFileSync(file, "utf8")) as { transcript?: Entry[]; session?: { transcript?: Entry[] } };
    const t = d.transcript ?? d.session?.transcript;
    return t && t.length ? t : null;
  } catch {
    return null;
  }
}

function replay(transcript: Entry[]): Router {
  const router = new Router();
  for (const e of transcript) {
    if (e.dir === "stderr") continue;
    const side: Side = e.dir === "to-server" ? "client-to-server" : "server-to-client";
    const raw = e.dir === "stdout-noise" ? Buffer.from(String(e.message), "utf8") : Buffer.from(JSON.stringify(e.message), "utf8");
    router.see(lineOf(raw), side);
  }
  return router;
}

/** The first server message carrying a tools array, found without matching ids. */
function naiveToolCount(transcript: Entry[]): number | null {
  for (const e of transcript) {
    if (e.dir !== "from-server") continue;
    const m = e.message as { result?: { tools?: unknown } } | null;
    if (m && typeof m === "object" && Array.isArray(m.result?.tools)) return m.result.tools.length;
  }
  return null;
}

const label = (file: string) =>
  source === "kept" ? (file.split("/").pop() ?? file).replace(/\.json$/, "") : (file.split("/").slice(-2, -1)[0] ?? file);

test("the recorded sessions are there to replay", { skip: !have }, () => {
  assert.ok(sessions().length > 0, `${SANDBOXES} exists and holds no session-result.json`);
});

test("every recorded session replays without the router throwing", { skip: !have }, () => {
  let replayed = 0;
  for (const f of sessions()) {
    const t = transcriptOf(f);
    if (!t) continue;
    assert.doesNotThrow(() => replay(t), `the router threw on ${label(f)}`);
    replayed++;
  }
  assert.ok(replayed > 0, "no session carried a transcript");
});

test("the list the router matches by id is the list that is there", { skip: !have }, () => {
  /*
   * Two different ways of finding the tool list: the router matches a
   * response to the request that asked for it, by id; this counts the first
   * server message that happens to carry a tools array. On a well-behaved
   * server they agree. A disagreement means one of them picked the wrong
   * message, and it is named.
   */
  const differed: string[] = [];
  let compared = 0;
  for (const f of sessions()) {
    const t = transcriptOf(f);
    if (!t) continue;
    const naive = naiveToolCount(t);
    if (naive === null) continue;
    const router = replay(t);
    compared++;
    if (router.baselineSize !== naive) differed.push(`${label(f)}: by id ${router.baselineSize}, first seen ${naive}`);
  }
  assert.ok(compared >= 20, `only ${compared} sessions answered a tools/list`);
  assert.deepEqual(differed, [], "the two ways of finding the tool list disagree");
});

test("no note from a real session carries a description", { skip: !have }, () => {
  let checked = 0;
  for (const f of sessions()) {
    const t = transcriptOf(f);
    if (!t) continue;
    const router = replay(t);
    const text = JSON.stringify(router.notes);
    for (const e of t) {
      const m = e.message as { result?: { tools?: Array<{ name?: string; description?: unknown }> } } | null;
      const tools = m && typeof m === "object" ? m.result?.tools : undefined;
      if (!Array.isArray(tools)) continue;
      for (const tool of tools) {
        const d = tool?.description;
        if (typeof d !== "string" || d.length < 40) continue;
        assert.ok(!text.includes(d.slice(0, 40)), `a note carries the description of ${String(tool.name)} in ${label(f)}`);
        checked++;
      }
    }
  }
  assert.ok(checked > 100, `only ${checked} descriptions were checked for`);
});

test("real sessions, counted", { skip: !have }, () => {
  const totals: Record<string, number> = {};
  const failClosed: string[] = [];
  const serverMethods: Record<string, number> = {};
  let servers = 0;
  let withList = 0;
  for (const f of sessions()) {
    const t = transcriptOf(f);
    if (!t) continue;
    servers++;
    const router = replay(t);
    if (router.baselineSize > 0) withList++;
    for (const [kind, n] of Object.entries(router.summary())) totals[kind] = (totals[kind] ?? 0) + n;
    for (const note of router.notes) {
      if (note.kind === "fail-closed") failClosed.push(`${label(f)}: ${note.because}`);
      if (note.kind === "server-request") serverMethods[note.method] = (serverMethods[note.method] ?? 0) + 1;
    }
  }
  const say = (o: Record<string, number>) =>
    Object.entries(o)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, n]) => `${k}=${n}`)
      .join(" ");
  process.stderr.write(`\n    replayed ${servers} session(s) from the ${source} corpus; ${withList} answered a tools/list\n    ${say(totals)}\n`);
  if (Object.keys(serverMethods).length) process.stderr.write(`    the server asked the client: ${say(serverMethods)}\n`);
  for (const line of failClosed.slice(0, 12)) process.stderr.write(`    fail-closed  ${line}\n`);
  assert.ok(servers > 0);
  assert.ok((totals["baseline"] ?? 0) > 0, "not one session produced a baseline");
});
