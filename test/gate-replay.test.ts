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
import { Router, type Pinned, type Side } from "../watch/gate/router.ts";
import { Enforcer } from "../watch/gate/enforce.ts";
import { CAP, isReservedId, Lister } from "../watch/gate/relist.ts";

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

/* ── Replayed under enforcement ─────────────────────────────────────────── */

/*
 * The same recorded sessions, with the enforcer wired to the router exactly
 * as watch/gate/run.ts wires it. Two runs over each session:
 *
 *   approved — the pin is adopted from that session's own first tool list,
 *              so nothing differs from the baseline. Nothing may be hidden
 *              and no line may be replaced. This is the kill rule at the
 *              scale of the whole corpus, against 70-odd real servers
 *              rather than one planted one.
 *
 *   none     — the pin names no tool, so everything the server offers is
 *              new. Every list is replaced and every call to a tool the
 *              server listed is refused.
 *
 * Counts and tool names only. The transcripts hold every description these
 * servers sent, and nothing here prints one.
 */

interface Replayed {
  lines: number;
  replaced: number;
  refused: number;
  hiddenAtEnd: number;
  stopped: number;
  listed: number;
}

function replayEnforcing(transcript: Entry[], baseline: Pinned[]): Replayed {
  const enforcer = new Enforcer({ pinFile: "/nowhere/pin.json" });
  const out: Replayed = { lines: 0, replaced: 0, refused: 0, hiddenAtEnd: 0, stopped: 0, listed: 0 };
  const router = new Router({
    mode: "enforce",
    baseline,
    onList: (records, hidden) => {
      out.listed = Math.max(out.listed, records.length);
      enforcer.noteList(records, hidden);
    },
  });
  for (const e of transcript) {
    if (e.dir === "stderr") continue;
    const side: Side = e.dir === "to-server" ? "client-to-server" : "server-to-client";
    const raw = e.dir === "stdout-noise" ? Buffer.from(String(e.message), "utf8") : Buffer.from(JSON.stringify(e.message), "utf8");
    const line = lineOf(raw);
    router.see(line, side);
    out.lines++;
    const action = side === "client-to-server" ? enforcer.fromClient(line) : enforcer.fromServer(line);
    if (action.stop) out.stopped++;
    if (action.replaceWith) out.replaced++;
    if (action.replyToClient) out.refused++;
  }
  out.hiddenAtEnd = enforcer.hiddenCount;
  return out;
}

/**
 * The pin a `gate pin --from-current` would write for this session: the
 * first tool list the server answered, taken as it stands.
 */
function baselineFrom(transcript: Entry[]): Pinned[] | null {
  let first: Pinned[] | null = null;
  /*
   * An empty baseline rather than none: with no baseline at all the router
   * adopts the first list silently and never calls back, which is right for
   * a gate with no pin and useless for reading the list out.
   */
  const router = new Router({
    baseline: [],
    onList: (records) => {
      if (first) return;
      first = records.map((r) => ({ name: r.name, hash: r.hash, descriptionHash: r.descriptionHash, schemaHash: r.schemaHash }));
    },
  });
  for (const e of transcript) {
    if (e.dir === "stderr") continue;
    const side: Side = e.dir === "to-server" ? "client-to-server" : "server-to-client";
    const raw = e.dir === "stdout-noise" ? Buffer.from(String(e.message), "utf8") : Buffer.from(JSON.stringify(e.message), "utf8");
    router.see(lineOf(raw), side);
  }
  return first;
}

test("replayed under enforcement with everything approved, nothing is hidden", { skip: !have }, () => {
  const hid: string[] = [];
  let sessions_ = 0;
  let lines = 0;
  for (const f of sessions()) {
    const t = transcriptOf(f);
    if (!t) continue;
    const base = baselineFrom(t);
    if (!base) continue;
    const r = replayEnforcing(t, base);
    sessions_++;
    lines += r.lines;
    if (r.replaced || r.refused || r.hiddenAtEnd) {
      hid.push(`${label(f)}: replaced ${r.replaced}, refused ${r.refused}, hidden ${r.hiddenAtEnd} of ${r.listed}`);
    }
  }
  assert.ok(sessions_ >= 20, `only ${sessions_} sessions answered a tools/list`);
  assert.deepEqual(hid, [], "a session with everything approved had something taken out of it");
  process.stderr.write(`\n    enforced over ${sessions_} session(s), ${lines} line(s), with everything approved: nothing replaced, nothing refused\n`);
});

test("replayed under enforcement against an empty pin, every listed tool is hidden", { skip: !have }, () => {
  const wrong: string[] = [];
  let sessions_ = 0;
  let replaced = 0;
  let refused = 0;
  let tools = 0;
  for (const f of sessions()) {
    const t = transcriptOf(f);
    if (!t) continue;
    const base = baselineFrom(t);
    if (!base) continue;
    const r = replayEnforcing(t, []);
    sessions_++;
    replaced += r.replaced;
    refused += r.refused;
    tools += r.listed;
    /* Every tool the server listed is new against a pin that names none. */
    if (r.hiddenAtEnd !== r.listed) wrong.push(`${label(f)}: ${r.hiddenAtEnd} hidden of ${r.listed} listed`);
    if (r.replaced === 0) wrong.push(`${label(f)}: ${r.listed} tool(s) listed and no list was replaced`);
  }
  assert.ok(sessions_ >= 20, `only ${sessions_} sessions answered a tools/list`);
  assert.deepEqual(wrong, [], "a tool the pin does not name was passed to the client");
  process.stderr.write(
    `    enforced over ${sessions_} session(s) against a pin naming nothing: ${replaced} list(s) replaced, ${refused} call(s) refused, ${tools} tool(s) hidden\n`,
  );
});

test("nothing the enforcer sends a client carries a description", { skip: !have }, () => {
  /*
   * The refusals and the replaced lists are bytes a real client would read.
   * A replaced list carries the tools that stayed, which is the server's own
   * text going back the way it came — so what is checked here is that no
   * HIDDEN tool's description leaves the gate, and that no refusal carries
   * any description at all.
   */
  let checked = 0;
  for (const f of sessions()) {
    const t = transcriptOf(f);
    if (!t) continue;
    const base = baselineFrom(t);
    if (!base) continue;

    const enforcer = new Enforcer({ pinFile: "/nowhere/pin.json" });
    const router = new Router({ mode: "enforce", baseline: [], onList: (records, hidden) => enforcer.noteList(records, hidden) });
    const sent: string[] = [];
    for (const e of t) {
      if (e.dir === "stderr") continue;
      const side: Side = e.dir === "to-server" ? "client-to-server" : "server-to-client";
      const raw = e.dir === "stdout-noise" ? Buffer.from(String(e.message), "utf8") : Buffer.from(JSON.stringify(e.message), "utf8");
      const line = lineOf(raw);
      router.see(line, side);
      const a = side === "client-to-server" ? enforcer.fromClient(line) : enforcer.fromServer(line);
      if (a.replaceWith) sent.push(a.replaceWith.toString("utf8"));
      if (a.replyToClient) sent.push(a.replyToClient.toString("utf8"));
    }
    const text = sent.join("\n");

    for (const e of t) {
      const m = e.message as { result?: { tools?: Array<{ name?: string; description?: unknown }> } } | null;
      const tools = m && typeof m === "object" ? m.result?.tools : undefined;
      if (!Array.isArray(tools)) continue;
      for (const tool of tools) {
        const d = tool?.description;
        if (typeof d !== "string" || d.length < 40) continue;
        assert.ok(
          !text.includes(d.slice(0, 40)),
          `the gate sent the client the description of ${String(tool.name)} from ${label(f)} although nothing was approved`,
        );
        checked++;
      }
    }
  }
  assert.ok(checked > 100, `only ${checked} descriptions were checked for`);
});

/* ── Replayed with --relist-on-change ───────────────────────────────────── */

/*
 * The question the flag raises is how much traffic it adds, and these
 * recordings can answer it: each entry carries the millisecond it happened,
 * so the Lister can be driven on the clock those servers actually ran on
 * rather than on a guess.
 *
 * Nothing answers the gate's requests in a replay — there is no server
 * here — so after five recorded seconds each one is forgotten and a later
 * notification may ask again, which is what would happen against a server
 * that went quiet.
 */

interface Stamped extends Entry {
  t?: number;
}

interface Would {
  notices: number;
  asked: number;
  declined: Record<string, number>;
}

/** What the flag would have done over one recorded session. */
function wouldAsk(transcript: Stamped[]): Would {
  let at = transcript[0]?.t ?? 0;
  const lister = new Lister({ now: () => at });
  const out: Would = { notices: 0, asked: 0, declined: {} };
  for (const e of transcript) {
    if (typeof e.t === "number") at = e.t;
    if (e.dir === "stderr") continue;
    if (e.dir === "to-server") {
      lister.sawClient(e.message);
      continue;
    }
    if (!lister.isChangeNotice(e.message)) continue;
    out.notices++;
    const decided = lister.consider();
    if (decided.ask) out.asked++;
    else out.declined[decided.why] = (out.declined[decided.why] ?? 0) + 1;
  }
  return out;
}

test("replayed with the flag, the policy holds over every recorded session", { skip: !have }, () => {
  const over: string[] = [];
  let sessions_ = 0;
  let notices = 0;
  let asked = 0;
  let withNotices = 0;
  const declined: Record<string, number> = {};
  let most = { label: "", asked: 0, notices: 0 };

  for (const f of sessions()) {
    const t = transcriptOf(f) as Stamped[] | null;
    if (!t) continue;
    sessions_++;
    const w = wouldAsk(t);
    notices += w.notices;
    asked += w.asked;
    if (w.notices) withNotices++;
    for (const [why, n] of Object.entries(w.declined)) declined[why] = (declined[why] ?? 0) + n;
    if (w.asked > most.asked) most = { label: label(f), asked: w.asked, notices: w.notices };

    /* The two promises the policy makes, per session. */
    if (w.asked > CAP) over.push(`${label(f)}: ${w.asked} requests, past the cap of ${CAP}`);
    if (w.asked > w.notices) over.push(`${label(f)}: ${w.asked} requests for ${w.notices} notification(s)`);
  }

  assert.ok(sessions_ >= 20, `only ${sessions_} sessions replayed`);
  assert.deepEqual(over, [], "the policy did not hold");
  const say = (o: Record<string, number>) =>
    Object.entries(o)
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${k}: ${n}`)
      .join("; ") || "none";
  process.stderr.write(
    `\n    with --relist-on-change over ${sessions_} recorded session(s): ${notices} notification(s) in ${withNotices} session(s), ` +
      `${asked} request(s) the gate would have sent\n    declined — ${say(declined)}\n` +
      (most.asked ? `    the most in one session: ${most.asked} request(s) for ${most.notices} notification(s) (${most.label})\n` : ""),
  );
});

test("replayed with the flag, nothing about the comparison changes", { skip: !have }, () => {
  /*
   * The flag adds requests and reads their answers. In a replay there are
   * no answers to them, so every comparison must come out exactly as it
   * does without the flag — same notes, same counts, same order. If this
   * differs, the flag is changing how the recorded lists are read, which
   * is not what it is for.
   */
  const differed: string[] = [];
  let compared = 0;
  for (const f of sessions()) {
    const t = transcriptOf(f) as Stamped[] | null;
    if (!t) continue;
    const plain = replay(t).notes.map((n) => n.kind).join(",");
    /* The same replay, with the lister running alongside it. */
    let at = t[0]?.t ?? 0;
    const lister = new Lister({ now: () => at });
    const router = new Router();
    for (const e of t) {
      if (typeof (e as Stamped).t === "number") at = (e as Stamped).t!;
      if (e.dir === "stderr") continue;
      const side: Side = e.dir === "to-server" ? "client-to-server" : "server-to-client";
      const raw = e.dir === "stdout-noise" ? Buffer.from(String(e.message), "utf8") : Buffer.from(JSON.stringify(e.message), "utf8");
      if (side === "client-to-server") lister.sawClient(e.message);
      else if (lister.isChangeNotice(e.message)) {
        const d = lister.consider();
        /* What run.ts does with it: tell the router to expect an answer. */
        if (d.ask) router.expectOwnList(d.id);
      }
      router.see(lineOf(raw), side);
    }
    compared++;
    const withFlag = router.notes.map((n) => n.kind).join(",");
    if (withFlag !== plain) differed.push(label(f));
  }
  assert.ok(compared >= 20, `only ${compared} sessions compared`);
  assert.deepEqual(differed, [], "the flag changed what the comparison recorded");
});

test("no recorded session ever used an id in the gate's namespace", { skip: !have }, () => {
  /*
   * The collision rule ends a session when a client uses one of the gate's
   * ids. Worth knowing whether any real client ever has: across the whole
   * corpus, in both directions, nothing does.
   */
  let checked = 0;
  const used: string[] = [];
  for (const f of sessions()) {
    const t = transcriptOf(f);
    if (!t) continue;
    for (const e of t) {
      if (e.dir === "stderr") continue;
      const m = e.message as { id?: unknown } | null;
      if (m && typeof m === "object" && "id" in m) {
        checked++;
        if (isReservedId(m.id)) used.push(`${label(f)}: ${String(m.id)}`);
      }
    }
  }
  assert.ok(checked > 200, `only ${checked} ids were checked`);
  assert.deepEqual(used, [], "a recorded session used an id this gate reserves");
  process.stderr.write(`    ${checked} recorded id(s) checked; none in the gate's namespace\n`);
});
