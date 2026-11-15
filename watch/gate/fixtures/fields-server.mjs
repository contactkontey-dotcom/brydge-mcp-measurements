/*
 * A PLANTED MCP SERVER FOR ONE QUESTION: WHICH FIELDS COUNT?
 *
 * Nobody else's code, and nobody else's prose. Every string below was
 * written in this repository to read as a tool definition, and the server
 * reads nothing, writes nothing and calls nothing.
 *
 * It offers ONE tool, `probe`, carrying every field a tool definition can
 * carry: name, title, description, inputSchema, outputSchema, annotations,
 * _meta, and one field no specification mentions, to stand for whatever a
 * server invents next.
 *
 * `--change=<field>` changes EXACTLY THAT ONE FIELD on the second tools/list
 * it serves, and nothing else. So a test can ask the gate a single question
 * — does a tool whose only difference is `annotations` count as changed? —
 * and get an answer that cannot be about anything else.
 *
 * The change lands on the second list served within a session, so one
 * process can show a pin being matched and then not matched. `--notify`
 * also sends notifications/tools/list_changed after `--notify-after` ms.
 *
 * It answers a few methods beyond tools/* as well — resources, prompts,
 * completion, logging, ping, and a method no specification mentions — so a
 * test can show what the gate does NOT look at. `--log-in=<file>` records
 * every line it receives, which is how such a test compares what reaches
 * the server with and without the gate in front of it.
 */
import { appendFileSync } from "node:fs";

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? fallback : hit.slice(name.length + 3);
};
const CHANGE = arg("change", "none");
const NOTIFY = process.argv.includes("--notify");
const NOTIFY_AFTER = Number(arg("notify-after", "250"));
const LOG_IN = arg("log-in", "") || null;
/*
 * What the initialize result carries as `instructions`.
 *
 *   a       planted wording A (the default)
 *   b       planted wording B
 *   none    no instructions key at all
 *   other   the key, with a value that is not a string
 *   dup     two instructions keys in one result — written by hand, because
 *           no serialiser will produce it, and sent so a gate can show what
 *           it does when the bytes are not unambiguous
 */
const INSTRUCTIONS = arg("instructions", "a");
/* `--discover`: answer server/discover with a result of the same shape as
 * initialize's, instead of an error. The second place the field can arrive. */
const DISCOVER = process.argv.includes("--discover");
const INSTRUCTIONS_A = "FIXTURE: planted instructions A, carried in the initialize result. Token INSTR-A-5531.";
const INSTRUCTIONS_B = "FIXTURE: planted instructions B, reworded, for the same planted server. Token INSTR-B-7748.";

const out = (s) => process.stdout.write(s);
const send = (m) => out(JSON.stringify(m) + "\n");
const logIn = LOG_IN
  ? (line) => {
      try {
        appendFileSync(LOG_IN, line + "\n");
      } catch {
        /* a log that cannot be written is not a reason to stop answering */
      }
    }
  : () => {};

/* Planted prose. Both wordings were written here. */
const DESCRIPTION_A = "FIXTURE: returns the planted number this server was started with.";
const DESCRIPTION_B = "FIXTURE: returns the planted number this server was started with, as text.";

/*
 * The first form of the tool, and then one field at a time.
 *
 * Written as a base plus an override per field so that the ONLY difference
 * between the two lists is the field named. A fixture that rebuilt the whole
 * definition for each case could differ in two places and the test would
 * still pass.
 */
const BASE = {
  name: "probe",
  title: "Planted probe",
  description: DESCRIPTION_A,
  inputSchema: { type: "object", properties: { n: { type: "number" } }, required: ["n"] },
  outputSchema: { type: "object", properties: { text: { type: "string" } } },
  annotations: { readOnlyHint: true, destructiveHint: false, title: "Planted probe" },
  _meta: { "brydge/fixture": { flag: 1 }, "brydge/planted": true },
  /* No specification names this. It stands for the next field some server
   * decides to send, and the gate's answer for it should be the same. */
  plantedUnknownField: { shape: "first" },
};

/** The second form: BASE with exactly one field replaced. */
const CHANGED = {
  none: {},
  title: { title: "Planted probe, second wording" },
  description: { description: DESCRIPTION_B },
  inputSchema: { inputSchema: { type: "object", properties: { n: { type: "string" } }, required: ["n"] } },
  outputSchema: { outputSchema: { type: "object", properties: { text: { type: "number" } } } },
  annotations: { annotations: { readOnlyHint: false, destructiveHint: false, title: "Planted probe" } },
  _meta: { _meta: { "brydge/fixture": { flag: 2 }, "brydge/planted": true } },
  unknown: { plantedUnknownField: { shape: "second" } },
  /*
   * A description that is not a string, twice over. Both forms are
   * malformed — the specification says a description is a string — and this
   * exists to show what the gate does with them, not to suggest a server
   * should send one.
   */
  "nonstring-description": { description: { text: DESCRIPTION_B } },
  "key-order": {}, /* served with its keys in a different order; see below */
};

if (!(CHANGE in CHANGED)) {
  process.stderr.write(`fields-server: no such --change: ${CHANGE}\n`);
  process.exit(2);
}

/* The non-string case needs the FIRST list malformed as well, or the test
 * would be measuring string -> object and not object -> object. */
const first =
  CHANGE === "nonstring-description"
    ? { ...BASE, description: { text: DESCRIPTION_A } }
    : BASE;

/* `key-order`: the same tool with its keys emitted in another order. A
 * server is free to do this at any time and it is not a change. */
const reorder = (t) => Object.fromEntries(Object.keys(t).sort().reverse().map((k) => [k, t[k]]));

let listsServed = 0;
const toolFor = (which) => {
  if (which === 1) return first;
  if (CHANGE === "key-order") return reorder(first);
  return { ...first, ...CHANGED[CHANGE] };
};

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, nl);
    buf = buf.slice(nl + 1);
    if (!line.trim()) continue;
    logIn(line);
    let m;
    try {
      m = JSON.parse(line);
    } catch {
      continue;
    }
    handle(m);
  }
});

/** The initialize-shaped result, with the instructions this run was told to carry. */
function initializeResult() {
  const result = {
    protocolVersion: "2025-06-18",
    capabilities: { tools: { listChanged: true }, resources: {}, prompts: {}, logging: {}, completions: {} },
    serverInfo: { name: "brydge-fields-server", version: "1.0.0" },
  };
  /*
   * Server-authored text that a client may put in front of a model. It was
   * measured reaching one, which is why a gate now pins it.
   */
  if (INSTRUCTIONS === "a") result.instructions = INSTRUCTIONS_A;
  if (INSTRUCTIONS === "b") result.instructions = INSTRUCTIONS_B;
  if (INSTRUCTIONS === "other") result.instructions = { text: INSTRUCTIONS_A };
  return result;
}

/** Send an initialize-shaped answer, including the one no serialiser can make. */
function sendInitializeShaped(id) {
  if (INSTRUCTIONS === "dup") {
    /* Two keys. Hand-written, so JSON.stringify cannot be the one to drop one. */
    const line =
      `{"jsonrpc":"2.0","id":${JSON.stringify(id)},"result":{"protocolVersion":"2025-06-18",` +
      `"capabilities":{"tools":{"listChanged":true}},"serverInfo":{"name":"brydge-fields-server","version":"1.0.0"},` +
      `"instructions":${JSON.stringify(INSTRUCTIONS_A)},"instructions":${JSON.stringify(INSTRUCTIONS_B)}}}`;
    logIn(`<< ${line}`);
    return out(line + "\n");
  }
  send({ jsonrpc: "2.0", id, result: initializeResult() });
}

function handle(m) {
  const { id, method } = m;
  if (method === "server/discover") {
    if (DISCOVER) return sendInitializeShaped(id);
    return send({ jsonrpc: "2.0", id, error: { code: -32601, message: "FIXTURE: no server/discover here." } });
  }
  if (method === "initialize") {
    sendInitializeShaped(id);
    if (NOTIFY) {
      setTimeout(() => send({ jsonrpc: "2.0", method: "notifications/tools/list_changed" }), NOTIFY_AFTER).unref?.();
    }
    return;
  }
  if (method === "notifications/initialized") return;
  if (method === "tools/list") {
    listsServed++;
    return send({ jsonrpc: "2.0", id, result: { tools: [toolFor(listsServed === 1 ? 1 : 2)] } });
  }
  if (method === "tools/call") {
    const name = m.params?.name;
    if (name !== "probe") {
      return send({ jsonrpc: "2.0", id, error: { code: -32602, message: `FIXTURE: no tool named ${JSON.stringify(name ?? null)}` } });
    }
    return send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: String(m.params?.arguments?.n ?? "none") }] } });
  }
  /* ── Everything the gate does not look at ──────────────────────────────── */
  if (method === "resources/list") {
    return send({
      jsonrpc: "2.0",
      id,
      result: { resources: [{ uri: "fixture://planted/one", name: "planted-one", description: "FIXTURE: a planted resource, and nothing reads it." }] },
    });
  }
  if (method === "resources/read") {
    return send({ jsonrpc: "2.0", id, result: { contents: [{ uri: "fixture://planted/one", text: "FIXTURE: planted resource text." }] } });
  }
  if (method === "prompts/list") {
    return send({ jsonrpc: "2.0", id, result: { prompts: [{ name: "planted_prompt", description: "FIXTURE: a planted prompt." }] } });
  }
  if (method === "prompts/get") {
    return send({
      jsonrpc: "2.0",
      id,
      result: { messages: [{ role: "user", content: { type: "text", text: "FIXTURE: planted prompt text." } }] },
    });
  }
  if (method === "completion/complete") {
    return send({ jsonrpc: "2.0", id, result: { completion: { values: ["FIXTURE-ONE", "FIXTURE-TWO"], hasMore: false } } });
  }
  if (method === "logging/setLevel") return send({ jsonrpc: "2.0", id, result: {} });
  if (method === "ping") return send({ jsonrpc: "2.0", id, result: {} });
  if (method === "fixture/not/a/real/method") {
    return send({ jsonrpc: "2.0", id, result: { planted: "FIXTURE: a method no specification names." } });
  }
  if (id !== undefined) send({ jsonrpc: "2.0", id, error: { code: -32601, message: `FIXTURE: no method ${JSON.stringify(method ?? null)}` } });
}

process.stdin.on("end", () => process.exit(0));
process.stderr.write(`fields-server: brydge-fields-server 1.0.0, change ${CHANGE}, 1 planted tool\n`);
