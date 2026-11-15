/*
 * ═══════════════════════════════════════════════════════════════════════════
 * TWO LANES: KEEP SERVING WHAT WAS APPROVED, OR HOLD IT AS BEFORE.
 *
 * A server reworded a description. Under enforcement the tool comes out of
 * the list and the client loses it until somebody reviews the change —
 * which is right for a tool that charges a card and heavy-handed for one
 * that lists files. This is the opt-in alternative: when the change reads
 * as read-only, the client keeps the definition somebody approved, and the
 * change goes into the report to be reviewed at leisure.
 *
 * Off unless asked for. The lane never makes a tool MORE available than
 * the pin says: what it serves is the approved version, not the new one.
 *
 * ── IT CLASSIFIES THE WHOLE TOOL, NOT THE CHANGED SLICE ──────────────────
 *
 * watch/risk.ts labels a review ITEM from what that item carries — for a
 * description change, the name alone. That is right for a reading order
 * and wrong for this: a tool that takes a `webhook_url` is not a reader
 * whatever its description did, and a lane that looked only at the changed
 * slice could be walked past by rewording the description of a tool whose
 * parameters were already risky.
 *
 * So the decision here classifies the LIVE definition whole — name,
 * parameters, annotations — and asks for `read-only` with nothing else
 * beside it. The item's own label in the report is unchanged; this is a
 * second, stricter question asked for a different purpose.
 *
 * ── WHAT IS NEVER IN THE LANE ────────────────────────────────────────────
 *
 *   a tool that is not in the pin        there is no approved version to serve
 *   a change in a field nothing classifies  `_meta`, `title`, `outputSchema`
 *                                        make no review item, so nothing
 *                                        labelled them; holding is what the
 *                                        gate does today, and the lane does
 *                                        not widen it on a guess
 *   anything the classifier did not call read-only, `unknown` included
 *
 * Each of those holds, which is to say: behaves exactly as it does today.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { classify, type Assessment } from "../risk.ts";
import type { WouldHide } from "./router.ts";

/** Off by default; this is how it is turned on. */
export const FLAG = "--lane-read-only";

/** What a report item says about a tool the lane is serving. */
export const KEPT = "kept on the approved version";

export type Lane = "serve-pinned" | "hold";

export interface Decision {
  lane: Lane;
  /** One of the fixed phrases below. Never a description, never a path. */
  because: string;
  /** What the classifier made of the live tool, for the journal and the line. */
  assessment: Assessment | null;
}

/* The phrases. Fixed, so a journal and a stderr line cannot drift apart. */
export const BECAUSE = {
  readOnly: "the tool reads as read-only and the change is recorded for review",
  notReadOnly: "the tool does not read as read-only",
  notPinned: "there is no approved version of this tool to serve",
  unclassified: "the change is in a field nothing classifies",
} as const;

/**
 * Which lane one differing tool goes down.
 *
 * `because` from the router is how the tool differs, and it decides
 * whether there is anything to classify at all.
 */
export function decide(opts: {
  /** The definition the pin holds, or undefined when it holds none. */
  pinned: Record<string, unknown> | undefined;
  /** The tool as the server is offering it now. */
  live: Record<string, unknown>;
  /** Why the router would hide it. */
  differs: WouldHide["because"];
  /** Parameter names new in this change, where the schema is what moved. */
  addedParameters?: string[];
}): Decision {
  if (!opts.pinned) return { lane: "hold", because: BECAUSE.notPinned, assessment: null };
  if (opts.differs === "not in the baseline") {
    return { lane: "hold", because: BECAUSE.notPinned, assessment: null };
  }
  if (opts.differs === "it differs from the baseline in some other field") {
    return { lane: "hold", because: BECAUSE.unclassified, assessment: null };
  }

  /*
   * The whole live tool, and the kind of change it was. The kind is passed
   * through so that a new parameter can be marked as new; the classifier
   * reads no description whichever kind it is.
   */
  const kind = opts.differs === "its input schema differs from the baseline" ? "input schema" : "description";
  const assessment = classify(opts.live, kind, { addedParameters: opts.addedParameters });
  const readOnly = assessment.classes.length === 1 && assessment.classes[0] === "read-only";
  return readOnly
    ? { lane: "serve-pinned", because: BECAUSE.readOnly, assessment }
    : { lane: "hold", because: BECAUSE.notReadOnly, assessment };
}

/** The one line stderr gets about the lane, once per list that used it. */
export const keptLine = (n: number): string =>
  `gate: ${n} tool(s) ${KEPT} across a change recorded for review. The approved definition is what the client was sent, ` +
  `not the one the server is offering now.`;

/** Said once, when the flag is on, because it changes what a client is sent. */
export const ANNOUNCEMENT =
  `gate: ${FLAG} is on. When a tool's definition changes and the change reads as read-only — inferred from its name, ` +
  `its parameters and its annotations, never from its description — the client keeps being sent the definition somebody ` +
  `approved, and the change goes into the report for review. Every other change is held as it would be without this flag. ` +
  `A definition served this way may no longer describe what the server does.`;
