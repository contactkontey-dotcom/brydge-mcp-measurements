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
 * Driven by argv: `--case <name>`.
 */
const CASE = (process.argv.find((a) => a.startsWith("--case=")) ?? "--case=plain").slice(7);

const out = (s) => process.stdout.write(s);
const send = (m) => out(JSON.stringify(m) + "\n");

/* Planted. The soft hyphen and the zero-width space are deliberate. */
const A = "FIXTURE A: reads the planted file and returns its planted bytes.";
const B = "FIXTURE B: reads the planted file​ and says what happens when it is mis­sing.";

const toolList = (which) => ({
  tools: [
    { name: "read_file", description: which === 1 ? A : B, inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
    { name: "list_dir", description: A, inputSchema: { type: "object", properties: {} } },
    ...(which === 2 ? [{ name: "write_file", description: "FIXTURE C: writes the planted bytes.", inputSchema: { type: "object" } }] : []),
  ],
});

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
process.stdin.setEncoding("utf8");
process.stdin.on("data", async (chunk) => {
  buffer += chunk;
  let at;
  while ((at = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, at).trim();
    buffer = buffer.slice(at + 1);
    if (!line) continue;
    let m;
    try {
      m = JSON.parse(line);
    } catch {
      continue;
    }
    await handle(m);
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
    return;
  }
  if (m.method === "notifications/initialized") return;

  if (m.method === "tools/list") {
    listsServed++;
    const which = listsServed === 1 ? 1 : 2;
    const body = JSON.stringify({ jsonrpc: "2.0", id: m.id, result: toolList(which) }) + "\n";
    if (CASE === "slow") await slowly(1200);
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

  if (m.method === "tools/call") {
    if (CASE === "die") return process.exit(3);
    return send({ jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: "FIXTURE: a planted reply." }] } });
  }

  send({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "FIXTURE: no such method here." } });
}
