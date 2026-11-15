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
import { definitionOf, normalise, type ToolRecord } from "../tools.ts";
import { ADOPTED, CARRIED_LABEL, instructionsStateOf, isCarried, recordsOf, type Pin } from "./pin.ts";
import { INSTRUCTIONS_TOOL, type ReviewItem } from "../decisions.ts";
import { compare as compareInstructions, type Seen } from "./instructions.ts";
import { CLASSES, INFERRED, type Class } from "../risk.ts";
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
  /*
   * The live definition of each flagged tool, so that approving one has
   * something to pin.
   *
   * Without it the report could show a reviewer what moved and then leave
   * nothing to carry their decision into: a pin records a definition, and
   * re-reading the server to find it again would be reading a surface
   * nobody reviewed. Keyed by tool name. Private, like the rest of this
   * file, because a definition carries its description.
   */
  offered: Record<string, Record<string, unknown>>;
  notes: string[];
  /**
   * Pinned tools whose approval was carried from an earlier version, by
   * name.
   *
   * Optional, so a report written before this field existed still reads.
   * A reader seeing an approval with no reviewer beside it is owed the
   * reason, and this is it.
   */
  carried?: string[];
  /**
   * The server's instructions as seen, when they differ from the pin.
   *
   * What `offered` is for a tool: the thing an approval has to pin, kept so
   * that approving does not mean reading the server again. `null` is the
   * server sending none while the pin names some. Absent when nothing
   * differed, or when the pin does not cover instructions. Private, like
   * `offered`: it is somebody's prose.
   */
  instructions?: { seen: string | null };
  /** The queue, prepared: word diffs, schema diffs, visible markers. */
  prepared: Prepared;
}

/** Said in the file and in the one stderr line, so neither can be read alone. */
export const SHADOW_LINE =
  "Shadow mode: every message was forwarded as it arrived and nothing was hidden from the client. " +
  "This is a record of what differs from the pin.";

/** Said wherever a pin nobody reviewed is the thing being compared against. */
/**
 * What the queue looks like by class, for a reader deciding where to start.
 *
 * Counts and class names, which are this project's own words — nothing of
 * the server's. The two sentences after the counts are the two rules that
 * matter most when reading them, said here rather than left to be
 * remembered.
 */
export function riskLine(prepared: Prepared): string | null {
  const by = new Map<Class, number>();
  for (const i of prepared.items) {
    if (!i.risk) continue;
    for (const c of i.risk.classes) by.set(c, (by.get(c) ?? 0) + 1);
  }
  if (!by.size) return null;
  const counts = CLASSES.filter((c) => by.has(c)).map((c) => `${by.get(c)} ${c}`).join(", ");
  return (
    `By kind, ${INFERRED}: ${counts}. Unknown means review, not nothing to worry about; ` +
    `the lowest rank is not a verdict that nothing can go wrong. The reading order is in "triage".`
  );
}

/** Said when a pin holds approvals that no decision in it accounts for. */
export const carriedLine = (names: string[]): string =>
  `${names.length} tool(s) in this pin are ${CARRIED_LABEL}: they were approved at an earlier version, ` +
  `did not change, and so the pin names no reviewer and no decision for them — ${names.join(", ")}.`;

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
/**
 * The review item for the instructions string, or null when there is none.
 *
 * Only when the pin covers instructions and what was seen differs. A
 * non-string field cannot be shown as a diff or pinned, so it makes a note
 * rather than an item.
 */
export function instructionsItemOf(pin: Pin, seen: Seen | undefined): { item: ReviewItem; seen: string | null } | { note: string } | null {
  if (!seen) return null;
  const state = instructionsStateOf(pin);
  const verdict = compareInstructions(state, seen);
  if (verdict.kind !== "differs") return null;
  if (seen.kind === "other") return { note: `The server's initialize result carries an instructions field that is not a string. It cannot be shown or pinned, and under enforcement it is not passed on.` };
  const before = pin.instructions?.text ?? null;
  const after = seen.kind === "text" ? seen.text : null;
  return { item: { kind: "instructions", tool: INSTRUCTIONS_TOOL, before, after }, seen: after };
}

export function pendingOf(pin: Pin, live: ToolRecord[], wouldHide: WouldHide[], seenAt: string, instructionsSeen?: Seen): Pending {
  const queue = queueFor(pin.package, `pinned ${pin.pinnedAt}`, `offered ${seenAt}`, recordsOf(pin), live);
  const notes = otherFieldLines(queue);
  const instructions = instructionsItemOf(pin, instructionsSeen);
  if (instructions && "note" in instructions) notes.push(instructions.note);
  if (instructions && "item" in instructions) queue.items.push(instructions.item);
  const prepared = prepare(queue, seenAt);
  const risk = riskLine(prepared);
  if (risk) notes.push(risk);
  const carried = Object.values(pin.tools).filter(isCarried).map((t) => t.name).sort();
  if (carried.length) notes.unshift(carriedLine(carried));
  if (pin.source === ADOPTED) notes.unshift(ADOPTED_LINE);
  const offered: Record<string, Record<string, unknown>> = {};
  for (const h of wouldHide) {
    const t = live.find((x) => x.name === h.tool);
    if (t) offered[h.tool] = definitionOf(t);
  }
  return {
    format: PENDING_FORMAT,
    version: PENDING_VERSION,
    offered,
    package: pin.package,
    packageVersion: pin.packageVersion,
    seenAt,
    pinnedBy: pin.source,
    pinnedAt: pin.pinnedAt,
    carried,
    shadow: SHADOW_LINE,
    wouldHide,
    notes,
    ...(instructions && "item" in instructions ? { instructions: { seen: instructions.seen } } : {}),
    prepared,
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
  const instructions = p.instructions ? ", and the server's instructions differ from the pin" : "";
  return `gate: ${p.wouldHide.length} tool(s) differ from the pin${adopted} (${kinds})${instructions}; written to ${file}`;
}
