import { createSocket } from "node:dgram";
import { createServer as createHttpServer, type IncomingMessage } from "node:http";
import { createServer as createTcpServer, type Socket } from "node:net";

/*
 * ═══════════════════════════════════════════════════════════════════════════
 * A NETWORK THAT GOES NOWHERE AND WRITES EVERYTHING DOWN.
 *
 * A server under measurement runs in its own network namespace with nothing
 * but loopback. Nothing it sends leaves the machine. Instead:
 *
 *   EVERY NAME IT LOOKS UP is answered, with 127.0.0.1, by the stub below —
 *   so a server that phones home tells us where home is.
 *
 *   EVERY CONNECTION to that answer on port 80 is read in full: a plaintext
 *   request carrying a planted secret is caught with the secret in it. On
 *   port 443 the connection is read only as far as the name the client asked
 *   for; what it would have sent is encrypted and is never seen. That is a
 *   limit of the method, and it is printed on every page.
 *
 *   EVERY CONNECTION to anything else fails, and the kernel trace records the
 *   address it was aimed at.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export interface DnsQuery {
  t: number;
  name: string;
  type: number;
}

/** The names in one DNS query. Exported for its test. */
export function parseQuery(msg: Buffer): { id: number; name: string; type: number; questionEnd: number } | null {
  if (msg.length < 17) return null;
  const id = msg.readUInt16BE(0);
  let at = 12;
  const labels: string[] = [];
  while (at < msg.length) {
    const len = msg[at];
    if (len === 0) break;
    if (len > 63 || at + 1 + len > msg.length) return null;
    labels.push(msg.subarray(at + 1, at + 1 + len).toString("latin1"));
    at += 1 + len;
  }
  if (at + 5 > msg.length) return null;
  const type = msg.readUInt16BE(at + 1);
  return { id, name: labels.join(".").toLowerCase(), type, questionEnd: at + 5 };
}

/** An answer: A queries get 127.0.0.1, anything else an empty NOERROR. Exported for its test. */
export function answer(msg: Buffer, q: { id: number; type: number; questionEnd: number }): Buffer {
  const question = msg.subarray(12, q.questionEnd);
  const isA = q.type === 1;
  const header = Buffer.alloc(12);
  header.writeUInt16BE(q.id, 0);
  header.writeUInt16BE(0x8180, 2);
  header.writeUInt16BE(1, 4);
  header.writeUInt16BE(isA ? 1 : 0, 6);
  if (!isA) return Buffer.concat([header, question]);
  const record = Buffer.from([0xc0, 0x0c, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x3c, 0x00, 0x04, 127, 0, 0, 1]);
  return Buffer.concat([header, question, record]);
}

export function startDns(log: DnsQuery[]): Promise<() => void> {
  const socket = createSocket("udp4");
  socket.on("message", (msg, from) => {
    const q = parseQuery(msg);
    if (!q) return;
    log.push({ t: Date.now(), name: q.name, type: q.type });
    socket.send(answer(msg, q), from.port, from.address);
  });
  return new Promise((resolve, reject) => {
    socket.once("error", reject);
    socket.bind(53, "127.0.0.1", () => resolve(() => socket.close()));
  });
}

export interface CaughtConnection {
  t: number;
  port: number;
  /** Port 80: the request as sent, up to 64 KiB. */
  request?: string;
  /** Port 443: the host named in the TLS ClientHello, if it named one. */
  sni?: string | null;
}

/** The server name from a TLS ClientHello, or null. Exported for its test. */
export function sniOf(hello: Buffer): string | null {
  try {
    if (hello[0] !== 0x16 || hello[5] !== 0x01) return null;
    let at = 5 + 4 + 2 + 32;
    at += 1 + hello[at];
    at += 2 + hello.readUInt16BE(at);
    at += 1 + hello[at];
    const end = at + 2 + hello.readUInt16BE(at);
    at += 2;
    while (at + 4 <= end) {
      const type = hello.readUInt16BE(at);
      const len = hello.readUInt16BE(at + 2);
      if (type === 0) {
        const nameLen = hello.readUInt16BE(at + 4 + 3);
        return hello.subarray(at + 4 + 5, at + 4 + 5 + nameLen).toString("latin1");
      }
      at += 4 + len;
    }
  } catch {
    /* malformed: no name */
  }
  return null;
}

export function startCatchAll(port: 80 | 443, log: CaughtConnection[]): Promise<() => void> {
  const server = createTcpServer((socket: Socket) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const entry: CaughtConnection = { t: Date.now(), port };
    log.push(entry);
    socket.on("data", (d: Buffer) => {
      if (size < 65536) {
        chunks.push(d);
        size += d.length;
      }
      const all = Buffer.concat(chunks);
      if (port === 443) {
        entry.sni = sniOf(all);
        socket.destroy();
        return;
      }
      entry.request = all.toString("latin1").slice(0, 65536);
      /* Answer like a server that has nothing, so the client stops waiting. */
      if (all.includes("\r\n\r\n")) socket.end("HTTP/1.1 404 Not Found\r\ncontent-length: 0\r\nconnection: close\r\n\r\n");
    });
    socket.on("error", () => {});
    socket.setTimeout(5000, () => socket.destroy());
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(() => server.close()));
  });
}

export interface WebRequest {
  t: number;
  method: string;
  path: string;
  userAgent: string | null;
  headers: Record<string, string | string[] | undefined>;
}

/** The pages a server is given, on loopback, with every request written down. */
export function startWeb(
  pages: Record<string, { type: string; body: string; status?: number }>,
  log: WebRequest[],
): Promise<{ base: string; close: () => void }> {
  const server = createHttpServer((req: IncomingMessage, res) => {
    const path = (req.url ?? "/").split("#")[0];
    log.push({ t: Date.now(), method: req.method ?? "GET", path, userAgent: (req.headers["user-agent"] as string) ?? null, headers: req.headers });
    const page = pages[path.split("?")[0]];
    if (!page) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
      return;
    }
    res.writeHead(page.status ?? 200, { "content-type": page.type });
    res.end(page.body);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ base: `http://127.0.0.1:${port}`, close: () => server.close() });
    });
  });
}
