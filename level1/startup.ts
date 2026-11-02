/*
 * ═══════════════════════════════════════════════════════════════════════════
 * HOW LONG THE SERVER TOOK TO ANSWER, FROM TIMESTAMPS WE ALREADY HAD.
 *
 * `strace -ff -ttt` stamps every traced syscall to the millisecond, and
 * `harness/client.ts` stamps every JSON-RPC message it writes or reads. Both
 * already cross into this file inside the stored session. Nothing in the
 * instrument changes to produce the figures below, so the fingerprint is
 * untouched and no recalibration is owed — this reads what was always being
 * recorded and stopped throwing it away.
 *
 * TWO ANCHORS, AND WHY THESE TWO.
 *
 *   started   the `execve` of `setpriv`, which is the instant the harness
 *             stops being in charge and the server's own process begins. Not
 *             the `execve` of the server binary one step later: between the
 *             two sits setpriv dropping to an unprivileged id, which is part
 *             of how this is measured and belongs on our side of the line.
 *
 *   answered  the timestamp on the `from-server` message carrying the reply to
 *             `tools/list`, matched by JSON-RPC id. The trace cannot supply
 *             this: it watches `open`, `openat`, `creat`, `execve` and
 *             `connect`, so the write that carries the reply is not in it at
 *             all.
 *
 * WHAT THE NUMBER IS NOT. It is one run, of one version, on one machine, under
 * a kernel tracer that stops the process on every file it opens. That makes it
 * slower than the same start untraced, by an amount this does not attempt to
 * correct for or estimate. It is an upper bound on a traced start, and the page
 * says so next to the figure rather than in a footnote.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** A JSON-RPC message as `harness/client.ts` records it. */
export interface Recorded {
  t: number;
  dir: "to-server" | "from-server" | "stderr" | "stdout-noise";
  message?: unknown;
}

export interface Timed {
  t: number;
  syscall: "open" | "exec" | "connect";
  path?: string;
  result: number;
}

export interface Startup {
  /** Epoch ms: the server's process began. */
  startedAt: number;
  /** Epoch ms: its tool list was on the wire. Null if it never answered. */
  answeredAt: number | null;
  /** Epoch ms: it answered `initialize`. Null if it never did. */
  initializedAt: number | null;
  /** `answeredAt - startedAt`, or null. */
  toToolListMs: number | null;
  /** `initializedAt - startedAt`, or null. */
  toInitializeMs: number | null;
  /** The definition, carried with the number so a page cannot restate it wrong. */
  definition: string;
  /** True: measured under `strace`, which slows the start it is timing. */
  underKernelTrace: true;
  /** One run. There is no spread, so the figure has no error bar. */
  runs: 1;
}

export const DEFINITION =
  "From the execve of setpriv, which is where this harness hands the process to " +
  "an unprivileged user and the server's own work begins, to the timestamp on the " +
  "reply to tools/list. One run, under a kernel tracer that slows what it watches.";

/** Does this message look like the reply to the request with this id? */
function isReplyTo(message: unknown, id: unknown): boolean {
  if (!message || typeof message !== "object") return false;
  const m = message as Record<string, unknown>;
  return m.id === id && ("result" in m || "error" in m);
}

/** The id of the first `to-server` request naming this method, if any. */
function idOf(transcript: Recorded[], method: string): unknown {
  for (const r of transcript) {
    if (r.dir !== "to-server" || !r.message || typeof r.message !== "object") continue;
    const m = r.message as Record<string, unknown>;
    if (m.method === method && "id" in m) return m.id;
  }
  return undefined;
}

/** When the reply to `method` arrived, by JSON-RPC id. */
function repliedAt(transcript: Recorded[], method: string): number | null {
  const id = idOf(transcript, method);
  if (id === undefined) return null;
  for (const r of transcript) {
    if (r.dir === "from-server" && isReplyTo(r.message, id)) return r.t;
  }
  return null;
}

/**
 * The startup figures, or null when the session has no usable anchor.
 *
 * Null rather than zero or a guess: a run whose process start was not traced
 * has no startup time, and a page that prints 0 ms for it would be stating a
 * measurement that was never made.
 */
export function startupOf(session: Record<string, unknown>): Startup | null {
  const trace = (session.trace ?? []) as Timed[];
  const transcript = (session.transcript ?? []) as Recorded[];

  const first = trace.find((e) => e.syscall === "exec" && e.result === 0 && /(^|\/)setpriv$/.test(e.path ?? ""));
  if (!first) return null;

  const answeredAt = repliedAt(transcript, "tools/list");
  const initializedAt = repliedAt(transcript, "initialize");

  /* A reply cannot precede the process that sent it. If the clocks disagree,
   * say nothing rather than print a negative duration as a fast start. */
  const since = (at: number | null) => (at !== null && at >= first.t ? at - first.t : null);

  return {
    startedAt: first.t,
    answeredAt,
    initializedAt,
    toToolListMs: since(answeredAt),
    toInitializeMs: since(initializedAt),
    definition: DEFINITION,
    underKernelTrace: true,
    runs: 1,
  };
}

/** `1234` → `1.2 s`; small values stay in milliseconds. */
export function humanMs(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 10000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.round(ms / 1000)} s`;
}
