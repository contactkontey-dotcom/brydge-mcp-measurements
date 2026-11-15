/*
 * ═══════════════════════════════════════════════════════════════════════════
 * A DECISION, CARRIED INTO THE PIN.
 *
 * The gate reports what differs from its pin; somebody reads the report and
 * decides; this is what their decisions do. An approved change is pinned, so
 * the next run does not flag it. A held one is not, so the next run flags it
 * again — and will keep flagging it until somebody approves it or the server
 * changes it back. Holding is not a state the gate stores: it is the absence
 * of an approval, which is why it survives a restart with nothing to carry.
 *
 * ── A DECISION NEVER APPLIES TO AN ITEM WITH A DIFFERENT HASH ────────────
 *
 * Every decision names the `itemHash` of the exact pair the reviewer was
 * shown. If the server has edited that description again since the report
 * was written, the hash of what is in front of the gate now is a different
 * hash, and the decision is refused by name. Approving what somebody read is
 * the whole of what an approval is worth; carrying it onto the next edit
 * would make "approved" mean "approved this tool, whatever it says next".
 *
 * ── TWO RECORDS, NOT ONE ─────────────────────────────────────────────────
 *
 * The pin gets the definition, the reviewer's name, the date and the
 * `itemHash`. watch/decisions.json gets the decision itself — including the
 * holds, which the pin has nowhere to put. The two are read against each
 * other by that hash.
 *
 * ── IT READS AND WRITES NOTHING ──────────────────────────────────────────
 *
 * Files in, files out, as values. The I/O is the CLI's.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { decide, INSTRUCTIONS_TOOL, itemHashOf, itemKeyOf, put, Refused, type DecisionsFile, type ItemKind, type ReviewItem } from "../decisions.ts";
import { recordOf } from "../tools.ts";
import type { Exported } from "../review.ts";
import { hashedOf } from "./instructions.ts";
import { pinnedToolOf, type Pin, type PinnedInstructions, type PinnedTool } from "./pin.ts";
import type { Pending } from "./report.ts";

/** How the instructions item is named wherever a tool name would be printed. */
export const INSTRUCTIONS_LABEL = "the server's instructions";

export interface Carried {
  /** Tools whose live definition is now pinned, with who approved it. */
  approved: Array<{ tool: string; kind: ItemKind; by: string; at: string }>;
  /** Decided to hold: recorded, not pinned, and flagged again next time. */
  held: Array<{ tool: string; kind: ItemKind; by: string; at: string }>;
  /** Decisions that applied to nothing here, each with the reason. */
  refused: Array<{ tool: string; kind: ItemKind; because: string }>;
  /** Still different from the pin after this, and why. */
  stillFlagged: string[];
}

export interface Applied {
  pin: Pin;
  decisions: DecisionsFile;
  carried: Carried;
  /** True when the pin is not the one that went in. */
  pinChanged: boolean;
}

/**
 * The review item a prepared entry stands for, rebuilt for hashing.
 *
 * The pending report carries each item's `itemHash` already. This rebuilds
 * the item from the pin and the live definition so the hash can be computed
 * again from what is in front of the gate NOW — which is the comparison that
 * matters. A report can be old; the question is whether the thing it
 * described is still the thing here.
 */
export function itemFor(kind: ItemKind, tool: string, pinned: PinnedTool | undefined, live: Record<string, unknown> | undefined): ReviewItem | null {
  if (!live) return null;
  if (kind === "new tool") return { kind, tool, before: null, after: live };
  if (!pinned) return null;
  if (kind === "description") {
    return { kind, tool, before: (pinned.definition.description ?? null) as string | null, after: (live.description ?? null) as string | null };
  }
  return { kind, tool, before: pinned.definition.inputSchema ?? null, after: live.inputSchema ?? null };
}

/**
 * Carry a set of decisions into a pin.
 *
 * `pending` is the report the reviewer read; `incoming` is what they
 * exported. Nothing is written: the caller gets the new pin, the merged
 * decisions, and an account of every decision that did not apply.
 */
export function carry(opts: {
  pin: Pin;
  pending: Pending;
  incoming: Exported;
  decisions: DecisionsFile;
}): Applied {
  const { pin, pending, incoming, decisions } = opts;
  if (incoming.package !== pin.package) {
    throw new Refused(`those decisions are about ${incoming.package}, and this pin is for ${pin.package}`);
  }

  const byKey = new Map(pending.prepared.items.map((i) => [itemKeyOf({ kind: i.kind, tool: i.tool }), i]));
  const tools: Record<string, PinnedTool> = { ...pin.tools };
  /* `undefined` means "leave the pin's instructions as they are". */
  let instructions: PinnedInstructions | null | undefined = undefined;
  const carried: Carried = { approved: [], held: [], refused: [], stillFlagged: [] };
  let merged = decisions;
  let changed = false;

  for (const d of incoming.decisions) {
    const key = itemKeyOf({ kind: d.kind, tool: d.name });
    const entry = byKey.get(key);
    const reject = (because: string) => carried.refused.push({ tool: d.name, kind: d.kind, because });
    if (!entry) {
      reject(`the report carries no ${d.kind} for ${d.name}`);
      continue;
    }
    if (entry.itemHash !== d.itemHash) {
      reject(
        `the decision was made about a different ${d.kind} for ${d.name} ` +
          `(the file says ${d.itemHash.slice(0, 12)}, the report says ${entry.itemHash.slice(0, 12)})`,
      );
      continue;
    }

    /*
     * ── THE INSTRUCTIONS ITEM ───────────────────────────────────────────
     *
     * Same rule as a tool, different place to land: the hash is rebuilt
     * from the pin's text and the text the report saw, and only if it is
     * still the hash the reviewer decided about does the decision apply.
     * Approving pins the seen string; approving a seen `null` pins "none",
     * which is a real decision and is recorded as one. Holding records the
     * decision and leaves the pin as it was.
     */
    if (d.kind === "instructions") {
      if (d.name !== INSTRUCTIONS_TOOL || !pending.instructions) {
        reject(`the report carries no instructions to decide about`);
        continue;
      }
      const item: ReviewItem = { kind: "instructions", tool: INSTRUCTIONS_TOOL, before: pin.instructions?.text ?? null, after: pending.instructions.seen };
      const now = itemHashOf(item);
      if (now !== d.itemHash) {
        reject(`the instructions have changed since that report was written (the decision is about ${d.itemHash.slice(0, 12)}, this is ${now.slice(0, 12)})`);
        continue;
      }
      try {
        merged = put(merged, pin.package, decide({ item, decision: d.decision, by: d.by, at: d.at, fromVersion: `pinned ${pin.pinnedAt}`, toVersion: `offered ${pending.seenAt}` }));
      } catch (e) {
        reject((e as Error).message);
        continue;
      }
      if (d.decision === "hold") {
        carried.held.push({ tool: d.name, kind: d.kind, by: d.by, at: d.at });
        continue;
      }
      instructions = pending.instructions.seen === null ? null : { ...hashedOf(pending.instructions.seen), how: "approve", by: d.by, at: d.at, itemHash: d.itemHash };
      carried.approved.push({ tool: d.name, kind: d.kind, by: d.by, at: d.at });
      changed = true;
      continue;
    }
    /* And the same question again, against what is in front of the gate
     * now rather than what the report said then. */
    const item = itemFor(d.kind, d.name, pin.tools[d.name], pending.offered[d.name]);
    if (!item) {
      reject(`there is nothing in the report to pin for ${d.name}`);
      continue;
    }
    const now = itemHashOf(item);
    if (now !== d.itemHash) {
      reject(
        `the ${d.kind} for ${d.name} has changed since that report was written ` +
          `(the decision is about ${d.itemHash.slice(0, 12)}, this is ${now.slice(0, 12)})`,
      );
      continue;
    }

    try {
      merged = put(merged, pin.package, decide({
        item,
        decision: d.decision,
        by: d.by,
        at: d.at,
        fromVersion: `pinned ${pin.pinnedAt}`,
        toVersion: `offered ${pending.seenAt}`,
      }));
    } catch (e) {
      reject((e as Error).message);
      continue;
    }

    if (d.decision === "hold") {
      carried.held.push({ tool: d.name, kind: d.kind, by: d.by, at: d.at });
      continue;
    }
    /* Approved: the live definition becomes the pinned one. */
    tools[d.name] = pinnedToolOf(recordOf(pending.offered[d.name]!), "approve", { by: d.by, at: d.at, itemHash: d.itemHash });
    carried.approved.push({ tool: d.name, kind: d.kind, by: d.by, at: d.at });
    changed = true;
  }

  /* What a run after this would still flag: anything the report flagged
   * whose live definition is not now the pinned one. */
  for (const h of pending.wouldHide) {
    const live = pending.offered[h.tool];
    const pinned = tools[h.tool];
    if (!live) continue;
    if (!pinned || pinned.hash !== recordOf(live).hash) carried.stillFlagged.push(h.tool);
  }
  /* The instructions, if the report flagged them and nothing approved them. */
  if (pending.instructions && instructions === undefined) carried.stillFlagged.push(INSTRUCTIONS_LABEL);
  carried.stillFlagged = [...new Set(carried.stillFlagged)].sort();

  const next: Pin = { ...pin, tools };
  if (instructions !== undefined) next.instructions = instructions;
  return { pin: next, decisions: merged, carried, pinChanged: changed };
}

/** What carrying a set of decisions did. Names and counts; never a description. */
/**
 * How many items, counting the instructions string as what it is.
 *
 * It is not a tool, and a summary that said "2 approved" when one of the
 * two was the server's instructions would be counting a string as one.
 * "2" on its own is kept where every item IS a tool, so the common line
 * reads as it always has.
 */
export function counted(items: Array<{ kind: ItemKind }>): string {
  const tools = items.filter((x) => x.kind !== "instructions").length;
  if (!items.some((x) => x.kind === "instructions")) return String(tools);
  return tools ? `${tools} tool(s) and ${INSTRUCTIONS_LABEL}` : INSTRUCTIONS_LABEL;
}

export function renderCarried(a: Applied, pinFile: string): string {
  const out: string[] = [];
  const c = a.carried;
  out.push(`${a.pin.package}@${a.pin.packageVersion}: ${counted(c.approved)} approved, ${counted(c.held)} held, ${counted(c.refused)} applied to nothing.`);
  const group = (title: string, lines: string[]) => {
    if (!lines.length) return;
    out.push("");
    out.push(`${title}:`);
    for (const l of lines) out.push(`  ${l}`);
  };
  const named = (x: { kind: ItemKind; tool: string }) => `${x.kind} — ${x.kind === "instructions" ? INSTRUCTIONS_LABEL : x.tool}`;
  group("pinned", c.approved.map((x) => `${named(x)}, by ${x.by} on ${x.at}`));
  group(
    "held, so the next run flags them again",
    c.held.map((x) => `${named(x)}, by ${x.by} on ${x.at}`),
  );
  group("applied to nothing", c.refused.map((x) => `${named(x)}: ${x.because}`));
  out.push("");
  /*
   * The same count, and the same reason: `stillFlagged` can hold the
   * instructions label beside tool names, and "2 tool(s) still differ:
   * read_file, the server's instructions" would be calling a string a tool.
   */
  const flaggedTools = c.stillFlagged.filter((n) => n !== INSTRUCTIONS_LABEL);
  const flaggedInstructions = c.stillFlagged.includes(INSTRUCTIONS_LABEL);
  out.push(
    flaggedTools.length && flaggedInstructions
      ? `${flaggedTools.length} tool(s) and ${INSTRUCTIONS_LABEL} still differ from the pin: ${flaggedTools.join(", ")}.`
      : flaggedTools.length
        ? `${flaggedTools.length} tool(s) still differ from the pin: ${flaggedTools.join(", ")}.`
        : flaggedInstructions
          ? `${INSTRUCTIONS_LABEL.charAt(0).toUpperCase()}${INSTRUCTIONS_LABEL.slice(1)} still differ from the pin.`
          : `Nothing in that report still differs from the pin.`,
  );
  out.push(a.pinChanged ? `pin -> ${pinFile}` : `The pin is unchanged, so it was not written.`);
  return out.join("\n");
}
