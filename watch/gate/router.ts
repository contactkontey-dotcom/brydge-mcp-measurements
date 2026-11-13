/*
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THE GATE WOULD DO, WITHOUT DOING ANY OF IT.
 *
 * G1 is shadow mode: every line is forwarded as it arrived, in both
 * directions, and this module only writes down what it WOULD hide and where
 * it WOULD stop. Nothing it returns changes a byte. `mode` exists in the type
 * from the start so that turning it on later is a change to one branch rather
 * than a new design, and "enforce" is not built.
 *
 * ── THE BASELINE ─────────────────────────────────────────────────────────
 *
 * There is no pin file yet. The baseline is the first tool list seen in the
 * session, and every later list is compared against it. That is not a
 * substitute for a pin — it cannot know what anybody approved — but it is the
 * thing the request turns on: descriptions can change between calls with no
 * version bump, so a gate that only looked once would miss exactly the case
 * it exists for. A caller may pass a baseline in instead, which is the shape
 * a pin will have.
 *
 * ── FAIL CLOSED, RECORDED ────────────────────────────────────────────────
 *
 * Two things this cannot gate and must never wave through once it is
 * enforcing: a JSON-RPC batch, which can carry a tools/list or a tools/call
 * inside an array, and a tools/list result whose tools it cannot parse. Both
 * produce a `fail-closed` note here with the reason. In shadow mode the note
 * is all that happens — enacting it would change the traffic, which is the
 * one thing shadow mode promises not to do, and a gate that broke somebody's
 * server while claiming to be observing would be worth nothing.
 *
 * ── IDS ──────────────────────────────────────────────────────────────────
 *
 * Client ids are numbers or strings and are never rewritten. The gate's own
 * ids live in a separate shape, and a collision is detected rather than
 * assumed away: a gate that swallowed a response meant for the client would
 * hang it for good. G1 sends no request of its own, so the machinery is here
 * and tested and nothing uses it yet.
 *
 * ── IT NEVER PRINTS A DESCRIPTION ────────────────────────────────────────
 *
 * Notes carry tool names, counts, kinds and hashes. The text that changed is
 * what watch/words.ts shows a person who asked for it; a proxy's journal is
 * not that place, and a journal full of somebody's prose is a different
 * artefact from a journal of what moved.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { canonical, recordOf, type ToolRecord } from "../tools.ts";
import type { Line } from "./transport.ts";

export type Side = "client-to-server" | "server-to-client";
export type Mode = "shadow" | "enforce";

/** What a tool's three hashes look like once pinned. The pin's shape. */
export interface Pinned {
  name: string;
  hash: string;
  descriptionHash: string | null;
  schemaHash: string | null;
}

export const pinnedOf = (t: ToolRecord): Pinned => ({
  name: t.name,
  hash: t.hash,
  descriptionHash: t.descriptionHash,
  schemaHash: t.schemaHash,
});

/** Why a tool would not be shown. Named by what moved, never by what it is for. */
export type WouldHide =
  | { tool: string; because: "not in the baseline" }
  | { tool: string; because: "its description differs from the baseline" }
  | { tool: string; because: "its input schema differs from the baseline" }
  | { tool: string; because: "it differs from the baseline in some other field" };

export type Note =
  | { kind: "baseline"; at: number; tools: number; source: "first list seen" | "given" }
  | { kind: "would-hide"; at: number; listId: string; shown: number; hidden: WouldHide[] }
  | { kind: "list-unchanged"; at: number; listId: string; tools: number }
  | { kind: "fail-closed"; at: number; side: Side; because: string }
  | { kind: "unparsed-line"; at: number; side: Side; bytes: number; because: string }
  | { kind: "server-request"; at: number; method: string }
  | { kind: "list-changed"; at: number }
  | { kind: "id-collision"; at: number; id: string }
  | { kind: "pagination"; at: number; listId: string };

const idKey = (id: unknown): string => (typeof id === "string" ? `s:${id}` : `n:${String(id)}`);

/** A plain object, and nothing else. */
const plain = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * The tools array out of a tools/list result, or why it could not be read.
 *
 * Deliberately narrow: `result.tools` must be an array of objects with a
 * string name. Anything else is a result this cannot gate, which is a
 * fail-closed, not a shrug.
 */
export function toolsOf(result: unknown): { tools: Record<string, unknown>[] } | { because: string } {
  if (!plain(result)) return { because: "the result is not an object" };
  const tools = result.tools;
  if (!Array.isArray(tools)) return { because: "the result carries no tools array" };
  for (const [i, t] of tools.entries()) {
    if (!plain(t)) return { because: `tool ${i + 1} is not an object` };
    if (typeof t.name !== "string" || !t.name) return { because: `tool ${i + 1} has no name` };
  }
  return { tools: tools as Record<string, unknown>[] };
}

export interface RouterOptions {
  mode?: Mode;
  /** The surface to compare against. Without one, the first list seen becomes it. */
  baseline?: Pinned[];
  now?: () => number;
  /**
   * Called with every tool list the server answers, and what would be hidden.
   *
   * The records, not the notes: a caller that writes a report needs the
   * definitions to diff against, and a note carries names and hashes only
   * because a note goes in a journal.
   */
  onList?: (records: ToolRecord[], hidden: WouldHide[]) => void;
}

export class Router {
  readonly notes: Note[] = [];
  readonly mode: Mode;
  private baseline: Map<string, Pinned> | null = null;
  private readonly now: () => number;
  private readonly onList: ((records: ToolRecord[], hidden: WouldHide[]) => void) | null;
  /** Client request ids in flight, to the method they asked for. */
  private readonly inFlight = new Map<string, string>();
  /** Ids this gate has reserved for its own use. G1 reserves none. */
  private readonly ours = new Set<string>();
  private lists = 0;

  constructor(opts: RouterOptions = {}) {
    this.mode = opts.mode ?? "shadow";
    this.now = opts.now ?? Date.now;
    this.onList = opts.onList ?? null;
    if (opts.baseline) {
      this.baseline = new Map(opts.baseline.map((p) => [p.name, p]));
      this.notes.push({ kind: "baseline", at: this.now(), tools: opts.baseline.length, source: "given" });
    }
  }

  /** Counts only. A caller printing a journal has nothing else to print. */
  summary(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const n of this.notes) out[n.kind] = (out[n.kind] ?? 0) + 1;
    return out;
  }

  get baselineSize(): number {
    return this.baseline?.size ?? 0;
  }

  /**
   * One line, one side. Returns the notes it produced.
   *
   * In shadow mode the caller forwards the line whatever comes back. The
   * return value is what a journal is written from.
   */
  see(line: Line, side: Side): Note[] {
    const made: Note[] = [];
    const note = (n: Note) => {
      made.push(n);
      this.notes.push(n);
    };
    const at = this.now();

    if (line.parsed === null) {
      /* An empty line is a server pressing return, not a broken message. */
      if (line.text.trim() && line.parseError) {
        note({ kind: "unparsed-line", at, side, bytes: line.raw.length, because: line.parseError });
      }
      return made;
    }

    /*
     * A BATCH. The array form is legal JSON-RPC and MCP carried it until
     * 2025-06-18. One can hold a tools/list or a tools/call, so a gate that
     * let arrays past would have a hole the exact width of the thing it is
     * for.
     */
    if (Array.isArray(line.parsed)) {
      note({
        kind: "fail-closed",
        at,
        side,
        because: `a batch of ${line.parsed.length} message(s): this cannot read a tools/list or a tools/call inside an array`,
      });
      return made;
    }
    if (!plain(line.parsed)) {
      note({ kind: "unparsed-line", at, side, bytes: line.raw.length, because: "the message is not an object" });
      return made;
    }

    const message = line.parsed;
    const id = message.id;
    const method = typeof message.method === "string" ? message.method : null;

    if (side === "client-to-server") {
      if (method && id !== undefined) {
        const key = idKey(id);
        if (this.ours.has(key)) note({ kind: "id-collision", at, id: key });
        this.inFlight.set(key, method);
      }
      return made;
    }

    /* ── From the server ──────────────────────────────────────────────── */

    if (method && id !== undefined) {
      /* The server asking the client for something: sampling, roots,
       * elicitation, ping. Recorded by name; it passes through untouched. */
      note({ kind: "server-request", at, method });
      return made;
    }
    if (method === "notifications/tools/list_changed") {
      note({ kind: "list-changed", at });
      return made;
    }
    if (method) return made; /* any other notification */

    if (id === undefined) return made;
    const key = idKey(id);
    const asked = this.inFlight.get(key);
    if (asked === undefined) return made;
    this.inFlight.delete(key);
    if (asked !== "tools/list") return made;

    const listId = `${++this.lists}`;
    if (message.error !== undefined) return made; /* the server said no; nothing to gate */

    const read = toolsOf(message.result);
    if ("because" in read) {
      note({ kind: "fail-closed", at, side, because: `a tools/list this cannot read: ${read.because}` });
      return made;
    }
    if (plain(message.result) && typeof message.result.nextCursor === "string") {
      /* A page, not the surface. Named so a reader is not told a partial
       * list is the whole one. */
      note({ kind: "pagination", at, listId });
    }

    const records = read.tools.map(recordOf);
    if (!this.baseline) {
      this.baseline = new Map(records.map((t) => [t.name, pinnedOf(t)]));
      note({ kind: "baseline", at, tools: records.length, source: "first list seen" });
      return made;
    }

    const hidden: WouldHide[] = [];
    for (const t of records) {
      const was = this.baseline.get(t.name);
      if (!was) {
        hidden.push({ tool: t.name, because: "not in the baseline" });
        continue;
      }
      if (was.hash === t.hash) continue;
      if (was.descriptionHash !== t.descriptionHash) {
        hidden.push({ tool: t.name, because: "its description differs from the baseline" });
        continue;
      }
      if (was.schemaHash !== t.schemaHash) {
        hidden.push({ tool: t.name, because: "its input schema differs from the baseline" });
        continue;
      }
      hidden.push({ tool: t.name, because: "it differs from the baseline in some other field" });
    }

    if (hidden.length) {
      note({ kind: "would-hide", at, listId, shown: records.length - hidden.length, hidden });
    } else {
      note({ kind: "list-unchanged", at, listId, tools: records.length });
    }
    /* After the note, so a caller that throws cannot cost the journal its
     * entry. Its own failure is the caller's to handle. */
    this.onList?.(records, hidden);
    return made;
  }
}

/** The one sentence a summary carries about what this did and did not do. */
export const SHADOW_MEANS =
  "Shadow mode: every message was forwarded exactly as it arrived, in both directions. " +
  "Nothing was hidden from the client and no call was stopped. This records what a gate would have hidden.";

/** Exported for the tests that compare a parse against the canonical form. */
export { canonical };
