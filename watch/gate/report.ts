/*
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THE GATE SAW, WRITTEN WHERE A PERSON CAN READ IT.
 *
 * A stdio proxy has nowhere to show anybody anything. Its stdout is the
 * transport and its stderr is a client's log, so the report goes to a file
 * and stderr gets one line saying where.
 *
 * ── IT IS THE SAME REPORT THE REVIEW PAGE ALREADY RENDERS ────────────────
 *
 * The pin holds the definitions it pinned, and the server has just sent the
 * ones it is offering now. Two sets of tool records is exactly what
 * `queueFor` takes, and `prepare` turns a queue into the word diffs, schema
 * diffs and visible markers the Stage 5 page draws. So the pending file is
 * a prepared queue, and `review --page` can render it without knowing a gate
 * exists. Nothing about the diff is written twice.
 *
 * ── THE STDERR LINE SAYS NOTHING A LOG SHOULD NOT CARRY ──────────────────
 *
 * Counts, kinds, and a path. A client's log is somewhere a description
 * should never end up, and forty-four items of somebody's prose in a log is
 * how a proxy becomes the thing that published them.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { prepare, type Prepared } from "../page.ts";
import { otherFieldLines, queueFor } from "../review.ts";
import type { ToolRecord } from "../tools.ts";
import { ADOPTED, recordsOf, type Pin } from "./pin.ts";
import type { WouldHide } from "./router.ts";

export const PENDING_FORMAT = "brydge-gate-pending";
export const PENDING_VERSION = 1;

export interface Pending {
  format: string;
  version: number;
  package: string;
  packageVersion: string;
  seenAt: string;
  /** Where the pin came from, carried so the report cannot omit it. */
  pinnedBy: Pin["source"];
  pinnedAt: string;
  /** What this is and is not, in the file, for whoever opens it next. */
  shadow: string;
  /** What the gate would have hidden, by name and by what moved. */
  wouldHide: WouldHide[];
  notes: string[];
  /** The queue, prepared: word diffs, schema diffs, visible markers. */
  prepared: Prepared;
}

/** Said in the file and in the one stderr line, so neither can be read alone. */
export const SHADOW_LINE =
  "Shadow mode: every message was forwarded as it arrived and nothing was hidden from the client. " +
  "This is a record of what differs from the pin.";

/** Said wherever a pin nobody reviewed is the thing being compared against. */
export const ADOPTED_LINE =
  `This pin was ${ADOPTED}: it was taken from what the server was offering at the time, ` +
  "so a difference from it is a difference from that, and not from anything anybody signed off.";

/**
 * The pending report for one live tool list.
 *
 * `from` is the pin's version string and `to` is the live one, which is what
 * the queue's two sides are called. They are not package versions here —
 * the whole point is that a description can move without one — so they are
 * named for what they are.
 */
export function pendingOf(pin: Pin, live: ToolRecord[], wouldHide: WouldHide[], seenAt: string): Pending {
  const queue = queueFor(pin.package, `pinned ${pin.pinnedAt}`, `offered ${seenAt}`, recordsOf(pin), live);
  const notes = otherFieldLines(queue);
  if (pin.source === ADOPTED) notes.unshift(ADOPTED_LINE);
  return {
    format: PENDING_FORMAT,
    version: PENDING_VERSION,
    package: pin.package,
    packageVersion: pin.packageVersion,
    seenAt,
    pinnedBy: pin.source,
    pinnedAt: pin.pinnedAt,
    shadow: SHADOW_LINE,
    wouldHide,
    notes,
    prepared: prepare(queue, seenAt),
  };
}

/** The one line stderr gets: counts, kinds, a path. Never a description. */
export function stderrLine(p: Pending, file: string): string {
  const by: Record<string, number> = {};
  for (const h of p.wouldHide) by[h.because] = (by[h.because] ?? 0) + 1;
  const kinds =
    Object.entries(by)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([because, n]) => `${n} ${because}`)
      .join("; ") || "none";
  const adopted = p.pinnedBy === ADOPTED ? `, against a pin that was ${ADOPTED}` : "";
  return `gate: ${p.wouldHide.length} tool(s) differ from the pin${adopted} (${kinds}); written to ${file}`;
}
