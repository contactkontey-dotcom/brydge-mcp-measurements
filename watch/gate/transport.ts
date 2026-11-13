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
 * ── A LINE OF THE GATE'S OWN ─────────────────────────────────────────────
 *
 * `inject` puts one line into the relay's own output, which is the only
 * sound way for the gate to send something: writing to the far end directly
 * would race the Transform and could land inside a line somebody else was
 * halfway through, and a half-interleaved line corrupts the stream for
 * everything after it. Going through the relay means the ordering is the
 * stream's problem rather than this code's, and an injected line lands
 * BETWEEN whole lines however busy the pipe is.
 *
 * Four things it has to get right.
 *
 * ORDER. A reader is consulted about a line BEFORE that line is pushed, so
 * a reader that injects while it is being asked about line 2 would have its
 * own line land before line 2 rather than after it. Whole lines either way,
 * but surprising, so an injection during a read waits until the line that
 * prompted it has gone. The gate's line follows the line it is a reply to.
 *
 * ROOM. `push` never refuses: it buffers and returns false as advice. So
 * "the buffer is full" has to be read before pushing, from the stream's own
 * readableLength, or a stalled far end quietly accumulates every request
 * the gate ever sent. When there is no room the line waits and a timer
 * retries, because a Transform's _read is its own machinery and wrapping it
 * to drain a queue is a way to break a working transport.
 *
 * ORDINARY LINES ARE NEVER HELD. Only the gate's own. A client's message
 * waiting on the gate's bookkeeping would be the gate slowing down the
 * thing it is supposed to be invisible to.
 *
 * AND THE READER IS NOT CONSULTED for an injected line: the gate does not
 * decide about its own messages, and asking would mean a line could be
 * rewritten or dropped by the very code that sent it.
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

/** What became of a line the gate tried to send. */
export type Injected =
  /** Pushed into the stream. */
  | "sent"
  /** Held because the buffer is full; it goes when the stream asks for more. */
  | "held"
  /** The stream has ended. Nothing was sent and nothing will be. */
  | "ended";

/**
 * A relay, with a way for the gate to put a line of its own through it.
 *
 * It is a Transform, so it is piped like any other. `inject` is the extra.
 */
export interface Relay extends Transform {
  /** Send one line (no newline; one is added). */
  inject(payload: Buffer): Injected;
  /** How many injected lines are waiting for room. */
  readonly held: number;
  /** How many have gone out. */
  readonly sent: number;
}

/**
 * A relay: lines through, in the same order, with a reader consulted on each.
 *
 * The reader's own errors must never break a transport that was working.
 * One that throws is recorded by `onReaderError` and the line goes
 * through untouched — the gate failing is not a reason for somebody's server
 * to stop answering.
 */
export function relay(read: Reader, onReaderError?: (e: Error, line: Line) => void): Relay {
  const frames = new Frames();
  const handle = (raw: Buffer, unterminated: boolean, push: (b: Buffer) => void) => {
    const line = lineOf(raw, unterminated);
    let decision: Decision = { pass: true };
    handling = true;
    try {
      decision = read(line);
    } catch (e) {
      onReaderError?.(e as Error, line);
      decision = { pass: true };
    } finally {
      handling = false;
    }
    const tail = unterminated ? Buffer.alloc(0) : Buffer.from([NEWLINE]);
    if (decision.pass) push(Buffer.concat([raw, tail]));
    else if ("replaceWith" in decision) push(Buffer.concat([decision.replaceWith, tail]));
    /* else dropped */
    /* Anything the reader injected goes now, after the line it answers. */
    if (waiting.length) drain();
  };

  /* Lines of the gate's own, waiting for room or for the current line. */
  const waiting: Buffer[] = [];
  let ended = false;
  let sent = 0;
  /* True while a reader is being asked about a line that has not gone yet. */
  let handling = false;

  const stream = new Transform({
    transform(chunk: Buffer, _enc: BufferEncoding, done: TransformCallback) {
      /* Anything waiting goes first, so a line the gate sent earlier is not
       * overtaken by one that arrived later. */
      drain();
      for (const raw of frames.push(chunk)) handle(raw, false, (b) => this.push(b));
      done();
    },
    flush(done: TransformCallback) {
      drain();
      const left = frames.rest();
      if (left) handle(left, true, (b) => this.push(b));
      ended = true;
      done();
    },
  }) as Relay;

  /*
   * Retrying rather than overriding _read.
   *
   * A Transform's _read is part of its own machinery — it is what pulls
   * the next write through — and wrapping it to drain a queue is a way to
   * break a working transport for a case that needs a stalled server to
   * reach at all. A timer that exists only while something is held cannot
   * break anything, and is unref'd so it can never be the reason a process
   * stays alive.
   */
  let retry: ReturnType<typeof setTimeout> | null = null;
  function later(): void {
    if (retry || !waiting.length) return;
    retry = setTimeout(() => {
      retry = null;
      drain();
      later();
    }, 1);
    retry.unref?.();
  }

  /*
   * Whether the readable side has room, asked before pushing rather than
   * learned from a push that has already happened.
   */
  const hasRoom = (): boolean => stream.readableLength < (stream.readableHighWaterMark || 16_384);

  function drain(): void {
    while (waiting.length && !ended && hasRoom()) {
      stream.push(waiting[0]!);
      waiting.shift();
      sent++;
    }
    if (waiting.length && !ended) later();
  }

  stream.inject = (payload: Buffer): Injected => {
    if (ended) return "ended";
    waiting.push(Buffer.concat([payload, Buffer.from([NEWLINE])]));
    /*
     * Inside a read, the line that prompted this has not gone yet. `handle`
     * drains once it has, so the gate's line follows it instead of
     * overtaking it.
     */
    if (handling) return "held";
    drain();
    return waiting.length ? "held" : "sent";
  };
  Object.defineProperty(stream, "held", { get: () => waiting.length });
  Object.defineProperty(stream, "sent", { get: () => sent });
  return stream;
}
