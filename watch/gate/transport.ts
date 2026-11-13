/*
 * ═══════════════════════════════════════════════════════════════════════════
 * LINES IN, THE SAME LINES OUT.
 *
 * The stdio transport is newline-delimited JSON-RPC, which harness/client.ts
 * already reads one way. A gate reads it BOTH ways and has a harder job than
 * a client: whatever it does not rewrite, it must hand on exactly as it
 * arrived.
 *
 * ── WHY BYTES, NOT STRINGS ───────────────────────────────────────────────
 *
 * Two reasons, and both have teeth.
 *
 * A multi-byte character split across two chunks is mangled if each chunk is
 * decoded on its own: `JSON.parse` then fails, or worse, succeeds on
 * something subtly different. Buffers are joined before anything is decoded.
 *
 * And re-serialising a parsed message is not the identity. `1.0` comes back
 * as `1`. An id above 2^53 comes back a different number — JSON-RPC allows
 * one and a client may well use one. Key order changes, `é` becomes `é`,
 * a duplicate key loses its twin. So a line this gate passes through is
 * forwarded as the bytes it arrived as, and the parse is a COPY used only to
 * decide. Nothing downstream ever sees the re-serialised form of a message
 * that was only read.
 *
 * ── WHAT COUNTS AS A LINE ────────────────────────────────────────────────
 *
 * Everything up to the next `\n`, with the `\n` put back on the way out. A
 * server emitting `\r\n` keeps its `\r`, because the `\r` is part of what
 * came before the newline. Bytes after the last newline at end of stream are
 * flushed as they are, with no newline invented: a server that died
 * mid-message should look like a server that died mid-message.
 *
 * ── BACKPRESSURE ─────────────────────────────────────────────────────────
 *
 * A Transform in a pipeline, so Node's own machinery handles it. A
 * hand-rolled pump that ignores `write()` returning false either grows
 * without bound on a fast server and a slow client, or deadlocks.
 *
 * ── NOTHING HERE WRITES TO STDOUT ────────────────────────────────────────
 *
 * Not a log line, not a warning. Anything on stdout that is not a protocol
 * message corrupts the transport, and it is the easiest way to break every
 * server this is put in front of. The journal goes to a file, the summary to
 * stderr, and a test asserts the modules contain no console.log at all.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { Transform, type TransformCallback } from "node:stream";

/** One line off the wire: the bytes, and a parse of a copy of them. */
export interface Line {
  /** Exactly what arrived, without the newline. */
  raw: Buffer;
  /** The bytes decoded, for parsing and for a hash. Not what gets forwarded. */
  text: string;
  /** The parsed message, or null when it is not JSON. */
  parsed: unknown;
  /** Why it did not parse, when it did not. */
  parseError: string | null;
  /** True when the line ended the stream without a newline. */
  unterminated: boolean;
}

const NEWLINE = 0x0a;

/** A line, with its parse attempted once. */
export function lineOf(raw: Buffer, unterminated = false): Line {
  const text = raw.toString("utf8");
  if (!text.trim()) return { raw, text, parsed: null, parseError: null, unterminated };
  try {
    return { raw, text, parsed: JSON.parse(text), parseError: null, unterminated };
  } catch (e) {
    return { raw, text, parsed: null, parseError: (e as Error).message, unterminated };
  }
}

/**
 * Bytes into whole lines, across any chunk boundary.
 *
 * Holds the tail until its newline arrives. `rest` is what is left when the
 * stream ends, which is a line only if there is anything in it.
 */
export class Frames {
  private held: Buffer = Buffer.alloc(0);

  push(chunk: Buffer): Buffer[] {
    this.held = this.held.length ? Buffer.concat([this.held, chunk]) : chunk;
    const out: Buffer[] = [];
    let from = 0;
    for (;;) {
      const at = this.held.indexOf(NEWLINE, from);
      if (at === -1) break;
      out.push(this.held.subarray(from, at));
      from = at + 1;
    }
    this.held = from ? this.held.subarray(from) : this.held;
    return out;
  }

  rest(): Buffer | null {
    if (!this.held.length) return null;
    const left = this.held;
    this.held = Buffer.alloc(0);
    return left;
  }
}

/** What a reader decided to do with one line. */
export type Decision =
  /** Hand on the bytes that arrived. */
  | { pass: true }
  /** Hand on these bytes instead. Only for a message this gate rewrites. */
  | { pass: false; replaceWith: Buffer }
  /** Hand on nothing at all. */
  | { pass: false; drop: true };

export type Reader = (line: Line) => Decision;

/**
 * A relay: lines through, in the same order, with a reader consulted on each.
 *
 * The reader's own errors must never break a transport that was working.
 * One that throws is recorded by `onReaderError` and the line goes
 * through untouched — the gate failing is not a reason for somebody's server
 * to stop answering.
 */
export function relay(read: Reader, onReaderError?: (e: Error, line: Line) => void): Transform {
  const frames = new Frames();
  const handle = (raw: Buffer, unterminated: boolean, push: (b: Buffer) => void) => {
    const line = lineOf(raw, unterminated);
    let decision: Decision = { pass: true };
    try {
      decision = read(line);
    } catch (e) {
      onReaderError?.(e as Error, line);
      decision = { pass: true };
    }
    const tail = unterminated ? Buffer.alloc(0) : Buffer.from([NEWLINE]);
    if (decision.pass) return push(Buffer.concat([raw, tail]));
    if ("replaceWith" in decision) return push(Buffer.concat([decision.replaceWith, tail]));
    /* dropped */
  };

  return new Transform({
    transform(chunk: Buffer, _enc: BufferEncoding, done: TransformCallback) {
      for (const raw of frames.push(chunk)) handle(raw, false, (b) => this.push(b));
      done();
    },
    flush(done: TransformCallback) {
      const left = frames.rest();
      if (left) handle(left, true, (b) => this.push(b));
      done();
    },
  });
}
