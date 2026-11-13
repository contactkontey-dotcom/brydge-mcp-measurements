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
 *     dropped-notified      starts as the baseline; after the first tool
 *                           list it stops offering one tool and sends
 *                           notifications/tools/list_changed.
 *     dropped-silent        the same drop, and nothing is sent. The client
 *                           finds out only if it lists again.
 *
 * The drop happens once, two seconds after the first tools/list is
 * answered — long enough that a client has the first list, short enough to
 * watch. --drop-after=<ms> moves it.
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
 * ═══════════════════════════════════════════════════════════════════════════
 */

const MODES = ["baseline", "changed-description", "dropped-notified", "dropped-silent"];
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
  t.name === "demo_add"
    ? { ...t, description: "Planted demo tool, SECOND WORDING. Adds the two numbers it is given and returns their total as text." }
    : t,
);

const listFor = (dropped) => {
  const base = mode === "changed-description" ? CHANGED : BASELINE;
  return dropped ? base.filter((t) => t.name !== DROPPED) : base;
};

let dropped = false;
let listsAnswered = 0;
const startedAt = Date.now();

const send = (m) => process.stdout.write(JSON.stringify(m) + "\n");
const ok = (id, result) => send({ jsonrpc: "2.0", id, result });
const text = (id, s) => ok(id, { content: [{ type: "text", text: s }] });

/** The drop, once, after the first list has gone out. */
function scheduleDrop() {
  if (mode !== "dropped-notified" && mode !== "dropped-silent") return;
  if (dropped || listsAnswered !== 1) return;
  setTimeout(() => {
    dropped = true;
    process.stderr.write(`demo-server: stopped offering ${DROPPED}\n`);
    if (mode === "dropped-notified") {
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
    ok(id, { tools: listFor(dropped) });
    listsAnswered++;
    scheduleDrop();
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
    if (tool === "demo_echo") return text(id, String(params?.arguments?.text ?? ""));
    if (tool === "demo_now") return text(id, `${Date.now() - startedAt}`);
    send({ jsonrpc: "2.0", id, error: { code: -32601, message: `${NAME} does not have a tool called "${String(tool)}"` } });
    return;
  }
  if (method === "resources/list") return ok(id, { resources: [] });
  if (method === "prompts/list") return ok(id, { prompts: [] });
  if (method === "ping") return ok(id, {});
  send({ jsonrpc: "2.0", id, error: { code: -32601, message: `${NAME} does not handle "${String(method)}"` } });
}

process.stderr.write(`demo-server: ${NAME} ${VERSION}, mode ${mode}, ${listFor(false).length} planted tool(s)\n`);

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
