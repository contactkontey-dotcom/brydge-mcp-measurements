/*
 * A PLANTED MCP SERVER THAT BEHAVES BADLY ON PURPOSE.
 *
 * Nobody else's code. Every reply below is written here, and every
 * description in it is a fixture written to read as one. It exists to put the
 * gate's transport through the things real servers do:
 *
 *   • a message split across chunk boundaries, one byte at a time
 *   • a multi-byte character split across two writes
 *   • an id reused for a second, different request
 *   • a storm of notifications/tools/list_changed
 *   • a tools/list that takes its time
 *   • non-JSON on stdout, which breaks its own transport
 *   • a batch array
 *   • exiting in the middle of a request
 *
 * And, for the tool list the gate asks for itself, every way a server can
 * answer one badly: not at all, with an error, with one page of a list,
 * with an answer to an id nobody sent, and with a message carrying that id
 * but a method on it as well.
 *
 * Driven by argv: `--case <name>`. `--log-in <file>` writes every line the
 * server receives, which is how a test compares what reaches the SERVER
 * with and without the gate asking for things of its own.
 */
import { appendFileSync } from "node:fs";

const CASE = (process.argv.find((a) => a.startsWith("--case=")) ?? "--case=plain").slice(7);
const LOG_IN = (process.argv.find((a) => a.startsWith("--log-in=")) ?? "").slice(9) || null;
const GATE_ID = /^brydge-gate\//;

const out = (s) => process.stdout.write(s);
/*
 * Every line the server received, in order, exactly as it arrived.
 *
 * Appended synchronously: a test that compares two recordings cannot have
 * one of them still buffered when the process goes.
 */
const logIn = LOG_IN
  ? (line) => {
      try {
        appendFileSync(LOG_IN, line + "\n");
      } catch {
        /* a log that cannot be written is not a reason to stop answering */
      }
    }
  : () => {};
const send = (m) => out(JSON.stringify(m) + "\n");

/* Planted. The soft hyphen and the zero-width space are deliberate. */
const A = "FIXTURE A: reads the planted file and returns its planted bytes.";
const B = "FIXTURE B: reads the planted file​ and says what happens when it is mis­sing.";

const toolList = (which) => {
  /* `withdraw`: the second list drops a tool the first one had, which is
   * what a client with a cached list meets when a server stops offering
   * something mid-session. */
  /* `stable`: the same list every time, so a pin can match it exactly. It
   * is what lets a test ask whether enforcing with everything approved
   * changes a single byte. */
  if (CASE === "stable") which = 1;
  if (CASE === "withdraw") {
    return {
      tools:
        which === 1
          ? [
              { name: "read_file", description: A, inputSchema: { type: "object" } },
              { name: "list_dir", description: A, inputSchema: { type: "object" } },
            ]
          : [{ name: "list_dir", description: A, inputSchema: { type: "object" } }],
    };
  }
  return {
    tools: [
      { name: "read_file", description: which === 1 ? A : B, inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
      { name: "list_dir", description: A, inputSchema: { type: "object", properties: {} } },
      ...(which === 2 ? [{ name: "write_file", description: "FIXTURE C: writes the planted bytes.", inputSchema: { type: "object" } }] : []),
    ],
  };
};

let listsServed = 0;

async function slowly(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

/** Write a string one byte at a time, so every boundary lands mid-message. */
async function byByte(s) {
  const b = Buffer.from(s, "utf8");
  for (const byte of b) {
    out(Buffer.from([byte]));
    await new Promise((r) => setImmediate(r));
  }
}

let buffer = "";
let chain = Promise.resolve();
process.stdin.setEncoding("utf8");
/*
 * When the client closes its input, this is done — AFTER whatever is still
 * queued. Exiting the moment the input ended was a bug with a sharp edge:
 * the slow case sleeps 1.2 seconds before answering, the input closed at
 * about 0.36, and the server went without ever answering. Both runs then
 * agreed, which is the worst way for a comparison to pass. Queued behind
 * the chain, the exit happens when there is nothing left to answer.
 */
process.stdin.on("end", () => {
  chain = chain.then(() => process.exit(0));
});
/*
 * ONE AT A TIME, IN ARRIVAL ORDER.
 *
 * Each `data` event used to start its own async handler, so five lines
 * arriving 60 ms apart ran five handlers at once — and the sentinel, which
 * replies and exits, could go while the slow case was still sleeping on an
 * earlier list. That truncated the capture, and the race resolved
 * differently in the direct run and the gated one, which is a test
 * reporting on a race rather than on the gate. Chaining them is also what a
 * server answering in order actually does.
 */
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let at;
  while ((at = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, at).trim();
    buffer = buffer.slice(at + 1);
    if (!line) continue;
    logIn(line);
    let m;
    try {
      m = JSON.parse(line);
    } catch {
      continue;
    }
    const message = m;
    chain = chain.then(() => handle(message));
  }
});

async function handle(m) {
  if (m.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: m.id,
      result: {
        protocolVersion: "2025-06-18",
        capabilities: { tools: { listChanged: true } },
        serverInfo: { name: "planted-hostile-server", version: "0.0.0" },
      },
    });
    if (CASE === "noise") out("this is not JSON and never was\n");
    if (CASE === "storm") for (let i = 0; i < 25; i++) send({ jsonrpc: "2.0", method: "notifications/tools/list_changed" });
    if (CASE === "relist-loop") send({ jsonrpc: "2.0", method: "notifications/tools/list_changed" });
    if (CASE === "relist-many") for (let i = 0; i < 60; i++) send({ jsonrpc: "2.0", method: "notifications/tools/list_changed" });
    return;
  }
  if (m.method === "notifications/initialized") return;

  if (m.method === "tools/list") {
    /*
     * THE WAYS OF ANSWERING THE GATE'S OWN REQUEST BADLY.
     *
     * Each applies only to a list asked for under one of the gate's ids,
     * so the client's own lists in the same session are answered normally
     * and a test can tell the two apart.
     */
    const asGate = typeof m.id === "string" && GATE_ID.test(m.id);
    if (asGate) {
      if (CASE === "relist-ignore") return; /* no answer at all, ever */
      if (CASE === "relist-error") {
        return send({ jsonrpc: "2.0", id: m.id, error: { code: -32603, message: "FIXTURE: this server will not answer that." } });
      }
      if (CASE === "relist-page") {
        /* One page of a list. A tool that changed may be on another. */
        return send({
          jsonrpc: "2.0",
          id: m.id,
          result: { tools: [{ name: "read_file", description: A, inputSchema: { type: "object" } }], nextCursor: "FIXTURE-PAGE-2" },
        });
      }
      if (CASE === "relist-stranger") {
        /* An answer to an id nobody sent, and then a message carrying the
         * gate's id with a method on it, which is a request and not an
         * answer however much the id looks like one. */
        send({ jsonrpc: "2.0", id: "brydge-gate/99", result: toolList(1) });
        send({ jsonrpc: "2.0", id: m.id, method: "notifications/fixture/not-an-answer" });
        return;
      }
    }
    listsServed++;
    const which = listsServed === 1 ? 1 : 2;
    const body = JSON.stringify({ jsonrpc: "2.0", id: m.id, result: toolList(which) }) + "\n";
    if (CASE === "slow") await slowly(1200);
    /* `notify`: tell the client the list changed, then serve the new one —
     * the other order of events from the default, where it changes with no
     * notification at all. */
    /*
     * The cases that exist to be asked a question need to prompt one: the
     * gate asks on notifications/tools/list_changed and nothing else, so a
     * case that never sends the notification is never asked anything.
     */
    const NOTIFIES_ONCE = ["notify", "relist-ignore", "relist-error", "relist-page", "relist-stranger"];
    if (NOTIFIES_ONCE.includes(CASE) && listsServed === 1) send({ jsonrpc: "2.0", method: "notifications/tools/list_changed" });
    /*
     * `relist-loop`: a notification in answer to every tools/list, which is
     * the ping-pong a gate that asked on every notification would be stuck
     * in. The minimum interval and the cap are what stop it.
     */
    if (CASE === "relist-loop") send({ jsonrpc: "2.0", method: "notifications/tools/list_changed" });
    if (CASE === "chunks") return byByte(body);
    if (CASE === "split-utf8") {
      /* A message carrying a character whose bytes land in two writes. */
      const text = JSON.stringify({ jsonrpc: "2.0", id: m.id, result: { tools: [{ name: "café_tool", description: "FIXTURE: a planted name with an accent." }] } }) + "\n";
      const b = Buffer.from(text, "utf8");
      const cut = b.indexOf(Buffer.from("é", "utf8")) + 1;
      out(b.subarray(0, cut));
      await slowly(20);
      return out(b.subarray(cut));
    }
    if (CASE === "unreadable") return send({ jsonrpc: "2.0", id: m.id, result: { tools: "not an array" } });
    if (CASE === "batch") return out(JSON.stringify([{ jsonrpc: "2.0", id: m.id, result: toolList(1) }]) + "\n");
    if (CASE === "die") return process.exit(3);
    return out(body);
  }

  /*
   * THE SENTINEL. A test that compares two runs byte for byte cannot end
   * them on a timer: a quiet window is a guess about load, and under a
   * loaded machine it truncated whichever run was unlucky. This replies and
   * then goes, flushing first, so both runs end on an EVENT and the
   * comparison is deterministic however busy the machine is.
   */
  if (m.method === "fixture/done") {
    return process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: m.id, result: { done: true } }) + "\n", () => process.exit(0));
  }

  if (m.method === "tools/call") {
    if (CASE === "die") return process.exit(3);
    return send({ jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: "FIXTURE: a planted reply." }] } });
  }

  send({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "FIXTURE: no such method here." } });
}
