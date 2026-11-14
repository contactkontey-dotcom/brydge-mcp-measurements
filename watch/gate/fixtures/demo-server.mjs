/*
 * ═══════════════════════════════════════════════════════════════════════════
 * A PLANTED SERVER FOR WATCHING A REAL CLIENT.
 *
 * Every word in it was written here. There is no real package behind it, it
 * reads nothing, writes nothing outside this process, opens no socket and
 * calls nothing. Its tools do arithmetic on their arguments and echo text
 * back. That is deliberate: the thing being tested is what a CLIENT does
 * when the gate hides a tool or refuses a call, and a server whose
 * descriptions came from somewhere else would put somebody else's prose in
 * front of a model for no reason.
 *
 *   node demo-server.mjs --mode=<mode>
 *
 *     baseline              four tools, and they never change. Pin this.
 *     changed-description   one description differs from the baseline, from
 *                           the very first list. Nothing announces it.
 *     dropped-notified      starts as the baseline; then it stops offering
 *                           one tool and sends
 *                           notifications/tools/list_changed.
 *     dropped-silent        the same drop, and nothing is sent. The client
 *                           finds out only if it lists again.
 *     reworded-notified     starts as the baseline; then one tool's
 *                           description changes to a second planted
 *                           wording and it sends
 *                           notifications/tools/list_changed.
 *     reworded-silent       the same rewording, and nothing is sent.
 *     renamed-notified      starts as the baseline; then one tool is
 *                           RENAMED, keeping its description word for
 *                           word, and it sends
 *                           notifications/tools/list_changed.
 *
 * The change happens once, two seconds after the first tools/list is
 * answered — long enough that a client has the first list, short enough to
 * watch. --drop-after=<ms> moves it, in all four of the modes that change
 * something mid-session, whatever the change is.
 *
 * ── WHAT EACH MODE IS FOR ────────────────────────────────────────────────
 *
 * changed-description is the case the whole gate is about: a description can
 * change between calls with no version bump, so a client that lists once at
 * startup is reading whatever the server says now. Under enforcement, the
 * changed tool is not in the list the client receives.
 *
 * dropped-notified and dropped-silent are the other direction — the server
 * taking a tool away rather than changing one — and they are two modes
 * rather than one because the interesting difference is in the CLIENT: does
 * it re-list when it is told, and what does it do when it is not told and
 * calls something that is gone? The gate answers the second case with "the
 * server is no longer offering …", and whether the model reads that, retries
 * it, or loops is what the observation sheet is for.
 *
 * reworded-notified and reworded-silent are changed-description moved into
 * the middle of a session, which is the case the gate is actually for.
 * changed-description differs from the pin before the client has listed
 * even once, so the first list the client gets is already filtered and it
 * never saw the tool. These two give the client the baseline first, let it
 * cache a list with the tool in it, and only then change the words — so
 * what the client has on screen and what the server is offering have come
 * apart, which is the thing no version number catches.
 *
 * Notified against silent is the whole measurement:
 *
 *   reworded-notified, with --relist-on-change, the gate asks for a list of
 *   its own on the notification, finds the description has moved, and
 *   refuses a call to that tool — before the client has re-listed, and
 *   possibly while the client is still showing it.
 *
 *   reworded-silent, nothing announces the change, so there is nothing for
 *   the gate to ask on. The call is forwarded and the server answers it.
 *   That is the limit of the whole approach, not a defect in it, and the
 *   README says so in those words.
 *
 * renamed-notified is for a question about the CLIENT, not about the gate.
 * A name is a thing a client has to care about: it is what a model calls,
 * and a stale name is a call that cannot work. A description is not — a
 * client can hold an old one indefinitely and never notice. So a client
 * might well re-list on a name change and not on a description-only one,
 * and the two notified modes put exactly that question side by side:
 * reworded-notified changes the words and renamed-notified changes the
 * name, both announce it, and the difference in what the client does next
 * is the answer. The description is kept word for word here so that the
 * name is the only thing that moved.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const MODES = [
  "baseline",
  "changed-description",
  "dropped-notified",
  "dropped-silent",
  "reworded-notified",
  "reworded-silent",
  "renamed-notified",
];
/** The modes that change something once, a while into the session. */
const DROPS = ["dropped-notified", "dropped-silent"];
const REWORDS = ["reworded-notified", "reworded-silent"];
const RENAMES = ["renamed-notified"];
/** Of those, the ones that say so. */
const ANNOUNCES = ["dropped-notified", "reworded-notified", "renamed-notified"];
const arg = (name, fallback) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? fallback : hit.slice(name.length + 3);
};
const mode = arg("mode", "baseline");
const dropAfterMs = Number(arg("drop-after", "2000"));
if (!MODES.includes(mode)) {
  process.stderr.write(`demo-server: --mode is one of ${MODES.join(", ")}, not ${JSON.stringify(mode)}\n`);
  process.exit(64);
}
if (!Number.isFinite(dropAfterMs) || dropAfterMs < 0) {
  process.stderr.write(`demo-server: --drop-after is milliseconds, not ${JSON.stringify(arg("drop-after", ""))}\n`);
  process.exit(64);
}

const NAME = "brydge-demo-server";
const VERSION = "1.0.0";
/** The tool the two dropping modes stop offering. */
const DROPPED = "demo_subtract";
/** The tool whose words change, in changed-description and the two rewordings. */
const REWORDED = "demo_add";
/*
 * The tool that gets renamed, and what to.
 *
 * A different tool from the reworded one, so a session can be read without
 * working out which change it is looking at. Its description says nothing
 * about its own name, so keeping the description word for word leaves it
 * true of the renamed tool as well — the name really is the only thing
 * that moved.
 */
const RENAMED_FROM = "demo_echo";
const RENAMED_TO = "demo_echo_v2";

/*
 * The four tools. Written here, about themselves, and nothing else.
 */
const number = { type: "object", properties: { a: { type: "number" }, b: { type: "number" } }, required: ["a", "b"] };

const BASELINE = [
  {
    name: "demo_add",
    description: "Planted demo tool. Adds its two numbers and returns the sum as text.",
    inputSchema: number,
  },
  {
    name: DROPPED,
    description: "Planted demo tool. Subtracts b from a and returns the difference as text.",
    inputSchema: number,
  },
  {
    name: "demo_echo",
    description: "Planted demo tool. Returns the text it was given, unchanged.",
    inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
  },
  {
    name: "demo_now",
    description: "Planted demo tool. Returns how many milliseconds this process has been running.",
    inputSchema: { type: "object", properties: {} },
  },
];

/*
 * The one changed description.
 *
 * It says what it is, so that a tester reading the client's screen can see
 * at a glance which version they are looking at — and so that nothing here
 * reads as an instruction to anything. Same tool, same schema, same name:
 * only the words differ, which is the case a version number cannot catch.
 */
const CHANGED = BASELINE.map((t) =>
  t.name === REWORDED
    ? { ...t, description: "Planted demo tool, SECOND WORDING. Adds the two numbers it is given and returns their total as text." }
    : t,
);

/*
 * The list as it stands.
 *
 * `reworded` is the same second wording changed-description uses, so a
 * tester comparing the two modes is looking at one pair of planted
 * wordings rather than two.
 */
const listFor = (dropped, reworded, renamed) => {
  const base = mode === "changed-description" || reworded ? CHANGED : BASELINE;
  const named = renamed ? base.map((t) => (t.name === RENAMED_FROM ? { ...t, name: RENAMED_TO } : t)) : base;
  return dropped ? named.filter((t) => t.name !== DROPPED) : named;
};

let dropped = false;
let reworded = false;
let renamed = false;
let listsAnswered = 0;
const startedAt = Date.now();

const send = (m) => process.stdout.write(JSON.stringify(m) + "\n");
const ok = (id, result) => send({ jsonrpc: "2.0", id, result });
const text = (id, s) => ok(id, { content: [{ type: "text", text: s }] });

/**
 * The one change, once, after the first list has gone out.
 *
 * A drop or a rewording, whichever the mode is, and then either the
 * notification or nothing. Scheduled off the FIRST list only, so a client
 * that lists several times does not reset the clock.
 */
function scheduleChange() {
  const drops = DROPS.includes(mode);
  const rewords = REWORDS.includes(mode);
  const renames = RENAMES.includes(mode);
  if (!drops && !rewords && !renames) return;
  if (dropped || reworded || renamed || listsAnswered !== 1) return;
  setTimeout(() => {
    if (drops) {
      dropped = true;
      process.stderr.write(`demo-server: stopped offering ${DROPPED}\n`);
    } else if (rewords) {
      reworded = true;
      process.stderr.write(`demo-server: reworded the description of ${REWORDED}\n`);
    } else {
      renamed = true;
      process.stderr.write(`demo-server: renamed ${RENAMED_FROM} to ${RENAMED_TO}, same description\n`);
    }
    if (ANNOUNCES.includes(mode)) {
      send({ jsonrpc: "2.0", method: "notifications/tools/list_changed" });
      process.stderr.write("demo-server: sent notifications/tools/list_changed\n");
    } else {
      process.stderr.write("demo-server: sent nothing; the client finds out only if it lists again\n");
    }
  }, dropAfterMs).unref?.();
}

function handle(m) {
  if (!m || typeof m !== "object" || Array.isArray(m)) return;
  const { id, method, params } = m;
  if (id === undefined) return; /* a notification: nothing to answer */

  if (method === "initialize") {
    ok(id, {
      protocolVersion: typeof params?.protocolVersion === "string" ? params.protocolVersion : "2025-06-18",
      capabilities: { tools: { listChanged: mode === "dropped-notified" } },
      serverInfo: { name: NAME, version: VERSION },
    });
    return;
  }
  if (method === "tools/list") {
    ok(id, { tools: listFor(dropped, reworded, renamed) });
    listsAnswered++;
    scheduleChange();
    return;
  }
  if (method === "tools/call") {
    const tool = params?.name;
    const a = Number(params?.arguments?.a);
    const b = Number(params?.arguments?.b);
    if (tool === "demo_add") return text(id, `${a + b}`);
    if (tool === DROPPED) {
      if (dropped) {
        /* The server's own answer for a tool it no longer offers, so a
         * tester can tell it apart from the gate's. */
        send({ jsonrpc: "2.0", id, error: { code: -32601, message: `${NAME} does not have a tool called "${tool}"` } });
        return;
      }
      return text(id, `${a - b}`);
    }
    /* The echo tool answers under whichever name it is currently offered
     * under, and not under the other one: a stale name is a call that
     * cannot work, which is the point of renamed-notified. */
    if (tool === (renamed ? RENAMED_TO : RENAMED_FROM)) return text(id, String(params?.arguments?.text ?? ""));
    if (tool === "demo_now") return text(id, `${Date.now() - startedAt}`);
    send({ jsonrpc: "2.0", id, error: { code: -32601, message: `${NAME} does not have a tool called "${String(tool)}"` } });
    return;
  }
  if (method === "resources/list") return ok(id, { resources: [] });
  if (method === "prompts/list") return ok(id, { prompts: [] });
  if (method === "ping") return ok(id, {});
  send({ jsonrpc: "2.0", id, error: { code: -32601, message: `${NAME} does not handle "${String(method)}"` } });
}

process.stderr.write(`demo-server: ${NAME} ${VERSION}, mode ${mode}, ${listFor(false, false, false).length} planted tool(s)\n`);

let buffered = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffered += chunk;
  let nl;
  while ((nl = buffered.indexOf("\n")) !== -1) {
    const line = buffered.slice(0, nl);
    buffered = buffered.slice(nl + 1);
    if (!line.trim()) continue;
    try {
      handle(JSON.parse(line));
    } catch {
      /* A line this cannot parse is not answered: there is no id to answer
       * to, and inventing one would be worse than silence. */
    }
  }
});
process.stdin.on("end", () => process.exit(0));
