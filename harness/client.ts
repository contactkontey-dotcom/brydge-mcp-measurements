import { spawn, type ChildProcess } from "node:child_process";

/*
 * ═══════════════════════════════════════════════════════════════════════════
 * THE SMALLEST MCP CLIENT THAT RECORDS EVERYTHING.
 *
 * Newline-delimited JSON-RPC over the server's stdin and stdout, which is the
 * whole stdio transport. No SDK, on purpose: the thing doing the measuring is
 * short enough to read in one sitting, and has no dependency that could
 * behave differently from one install to the next.
 *
 * EVERYTHING IS RECORDED, both ways, with a timestamp — including what the
 * server asks the CLIENT for. A server can ask its client to list roots, to
 * run a model, or to ask the person a question (elicitation). A question that
 * asks for a password or a token is a server asking for a credential, and it
 * arrives here, not in any environment variable. This client declines every
 * such request and writes down exactly what was asked.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export interface Recorded {
  /** Milliseconds since the Unix epoch. */
  t: number;
  dir: "to-server" | "from-server" | "stderr" | "stdout-noise";
  message: unknown;
}

export interface ServerRequest {
  t: number;
  method: string;
  params: unknown;
}

export class ClientError extends Error {}

export class McpClient {
  readonly transcript: Recorded[] = [];
  readonly serverRequests: ServerRequest[] = [];
  private child: ChildProcess;
  private buffer = "";
  private nextId = 0;
  private waiting = new Map<number, { resolve: (m: Record<string, unknown>) => void; timer: ReturnType<typeof setTimeout> }>();
  private exited: Promise<number | null>;
  /** Set once the server process tree has gone; further requests fail at once. */
  private dead = false;

  constructor(command: string, args: string[], options: { env: Record<string, string>; cwd: string }) {
    this.child = spawn(command, args, { env: options.env, cwd: options.cwd, stdio: ["pipe", "pipe", "pipe"], detached: true });
    this.exited = new Promise((resolve) => this.child.on("exit", (code) => resolve(code)));
    /* When the server dies, nothing more will answer. Fail every pending and
     * future request immediately rather than letting each one burn its timeout —
     * a server that never started should cost seconds, not one timeout per call. */
    this.child.on("exit", () => {
      this.dead = true;
      for (const [id, w] of this.waiting) {
        clearTimeout(w.timer);
        w.resolve({ jsonrpc: "2.0", id, error: { code: -32001, message: "The server process exited." }, serverExited: true });
      }
      this.waiting.clear();
    });
    this.child.stdout!.setEncoding("utf8");
    this.child.stdout!.on("data", (chunk: string) => this.receive(chunk));
    this.child.stderr!.setEncoding("utf8");
    this.child.stderr!.on("data", (chunk: string) =>
      this.transcript.push({ t: Date.now(), dir: "stderr", message: chunk.slice(0, 4000) }),
    );
    this.child.stdin!.on("error", () => {
      /* The server went away; the pending request will time out and say so. */
    });
  }

  get pid(): number | undefined {
    return this.child.pid;
  }

  private receive(chunk: string) {
    this.buffer += chunk;
    let at: number;
    while ((at = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, at).trim();
      this.buffer = this.buffer.slice(at + 1);
      if (!line) continue;
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(line);
      } catch {
        /* A server that prints to stdout is breaking its own transport. Kept, not fatal. */
        this.transcript.push({ t: Date.now(), dir: "stdout-noise", message: line.slice(0, 2000) });
        continue;
      }
      this.transcript.push({ t: Date.now(), dir: "from-server", message });
      this.dispatch(message);
    }
  }

  private dispatch(message: Record<string, unknown>) {
    const id = message.id as number | string | undefined;
    const method = message.method as string | undefined;

    if (method !== undefined && id !== undefined) {
      /* The server asking the client for something. Recorded, then declined. */
      this.serverRequests.push({ t: Date.now(), method, params: message.params });
      if (method === "ping") return this.send({ jsonrpc: "2.0", id, result: {} });
      if (method === "elicitation/create") {
        /* A valid answer, per the protocol: the person declined. */
        return this.send({ jsonrpc: "2.0", id, result: { action: "decline" } });
      }
      return this.send({
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: "Declined by the measurement client, which provides no roots, models or people." },
      });
    }

    if (id !== undefined && typeof id === "number" && this.waiting.has(id)) {
      const w = this.waiting.get(id)!;
      clearTimeout(w.timer);
      this.waiting.delete(id);
      w.resolve(message);
    }
    /* Notifications (logging, progress) are already in the transcript. */
  }

  private send(message: Record<string, unknown>) {
    this.transcript.push({ t: Date.now(), dir: "to-server", message });
    this.child.stdin!.write(`${JSON.stringify(message)}\n`);
  }

  /** A request, and its response message whole: `result` or `error`, as the server sent it. */
  request(method: string, params: unknown, timeoutSeconds = 60): Promise<Record<string, unknown>> {
    const id = ++this.nextId;
    if (this.dead) return Promise.resolve({ jsonrpc: "2.0", id, error: { code: -32001, message: "The server process exited." }, serverExited: true });
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        resolve({ jsonrpc: "2.0", id, error: { code: -32000, message: `No response within ${timeoutSeconds} seconds` }, timedOut: true });
      }, timeoutSeconds * 1000);
      this.waiting.set(id, { resolve, timer });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  notify(method: string, params: unknown) {
    this.send({ jsonrpc: "2.0", method, params });
  }

  /** Stop the server and every process it started. */
  async close(): Promise<void> {
    try {
      this.child.stdin!.end();
    } catch {
      /* already closed */
    }
    const pid = this.child.pid;
    const done = await Promise.race([this.exited, new Promise((r) => setTimeout(() => r("slow"), 3000))]);
    if (done === "slow" && pid) {
      try {
        process.kill(-pid, "SIGTERM");
      } catch {
        /* gone */
      }
      const again = await Promise.race([this.exited, new Promise((r) => setTimeout(() => r("slow"), 3000))]);
      if (again === "slow") {
        try {
          process.kill(-pid, "SIGKILL");
        } catch {
          /* gone */
        }
      }
    }
    for (const w of this.waiting.values()) clearTimeout(w.timer);
  }
}

/** The protocol version this client speaks first. Servers may answer with an older one. */
export const PROTOCOL_VERSION = "2025-06-18";

/** Start a session the way any client would: initialize, then say so. */
export async function initialize(client: McpClient, timeoutSeconds: number) {
  const answer = await client.request(
    "initialize",
    {
      protocolVersion: PROTOCOL_VERSION,
      /* Offered so that a server which would ask the person for something
       * (elicitation) or ask for roots actually does so, and it is recorded. */
      capabilities: { elicitation: {}, roots: { listChanged: false } },
      clientInfo: { name: "brydge-mcp-measurements", version: "1" },
    },
    timeoutSeconds,
  );
  client.notify("notifications/initialized", {});
  return answer;
}
