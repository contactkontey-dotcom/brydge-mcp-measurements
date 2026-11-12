/*
 * ═══════════════════════════════════════════════════════════════════════════
 * THE QUEUE, AND WHAT A SET OF DECISIONS DOES TO AN APPROVED LIST.
 *
 * Three things live here: building the queue of items for a package and two
 * versions, reading back the decisions a reviewer exported, and working out
 * what the approved list for the newer version should then hold.
 *
 * ── WHAT IS IN THE QUEUE, AND WHAT IS COUNTED INSTEAD ────────────────────
 *
 * Three kinds: a description whose text moved, an input schema whose shape
 * moved, and a tool that was not there before. A tool that differs only in
 * some other field — 47 of the kolbo pair's tools differ only under `_meta`
 * — is NOT an item. Putting 47 of those in a queue would bury the four that
 * a person has to read, and asking somebody to decide about each would be
 * asking them to decide about something no diff here can describe. They are
 * counted in one line, with the key named by pointer, and that is all.
 *
 * ── A TOOL GOES ON THE LIST ONLY IF EVERY ITEM ABOUT IT WAS APPROVED ─────
 *
 * A tool whose description was approved and whose schema was held is not on
 * the list. Half of its surface was signed off and the other half was not,
 * and a name on an approved list says the whole tool was. Undecided is not
 * approved either, and neither is a decision that turned out to be about an
 * earlier edit. Each exclusion is named with its reason.
 *
 * ── THE REVIEW IS ABOUT TOOLS, AND THE ENTRY SAYS SO ─────────────────────
 *
 * An approved entry also holds the websites and programs a version was seen
 * to use, and nobody decided about those here. They come from the newer
 * version's own measurement, and the output says that plainly and names
 * anything in it that the previous list did not have. An entry that quietly
 * carried a signature onto a startup surface nobody looked at would be the
 * most useful-looking thing in the file and the least true.
 *
 * ── IT READS AND WRITES NOTHING ──────────────────────────────────────────
 *
 * Captures and lists in, findings out. The I/O is the CLI's.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import type { ApprovedEntry } from "./approved.ts";
import {
  decide,
  itemHashOf,
  itemKeyOf,
  keyOf,
  put,
  Refused,
  tally,
  type Decision,
  type DecisionRecord,
  type DecisionsFile,
  type ItemKind,
  type ReviewItem,
  type Tally,
} from "./decisions.ts";
import { canonical, diffTools, type ToolRecord } from "./tools.ts";

/* ── Building the queue ─────────────────────────────────────────────────── */

/** A tool as the server declared it, without the hashes we derived. */
export function definitionOf(t: ToolRecord): Record<string, unknown> {
  return { name: t.name, description: t.description, inputSchema: t.inputSchema ?? null, ...t.extra };
}

export interface Queue {
  package: string;
  from: string;
  to: string;
  /** In reading order: descriptions, then schemas, then new tools. */
  items: ReviewItem[];
  /*
   * TWO TALLIES, BECAUSE ONE READ WRONG.
   *
   * The first draft tallied the pointers over EVERY changed tool and
   * printed the total under a sentence about the tools that differ only
   * somewhere else. On the kolbo pair that read "47 tools differ only in a
   * field that is neither ... : 50 at /_meta/ui/resourceUri" — 47 and 50 in
   * one sentence, about two different sets. The three extra are tools whose
   * schema ALSO moved, so they are in the queue, and their `_meta` movement
   * is not what that line is about. It is still worth saying, so it has a
   * line of its own.
   */
  otherField: Tallied;
  /** Tools that ARE in the queue and differ in some other field as well. */
  alsoOtherField: Tallied;
  /** On the older version and not the newer. Not an item: there is nothing to approve. */
  removed: string[];
  /** Same name, same everything. */
  unchanged: number;
  /** Every tool name the newer version offers. */
  offered: string[];
}

export interface Tallied {
  tools: number;
  pointers: Array<{ pointer: string; tools: number; atCap: boolean }>;
}

/** The order items are read in, and the order they are printed in. */
export const KIND_ORDER: ItemKind[] = ["description", "input schema", "new tool"];

/**
 * The queue for one pair of versions.
 *
 * A tool whose description AND schema both moved is two items, because they
 * are two decisions: watch/decisions.ts hashes the kind along with the
 * content so that one can never answer for the other.
 */
export function queueFor(pkg: string, from: string, to: string, a: ToolRecord[], b: ToolRecord[]): Queue {
  const A = new Map(a.map((t) => [t.name, t]));
  const B = new Map(b.map((t) => [t.name, t]));
  const d = diffTools(a, b);

  const descriptions: ReviewItem[] = [];
  const schemas: ReviewItem[] = [];
  const only = new Map<string, { tools: number; atCap: boolean }>();
  const also = new Map<string, { tools: number; atCap: boolean }>();
  let onlyTools = 0;
  let alsoTools = 0;

  for (const c of d.changed) {
    const x = A.get(c.name)!;
    const y = B.get(c.name)!;
    const inQueue = c.what.includes("description") || c.what.includes("input schema");
    if (c.what.includes("description")) {
      descriptions.push({ kind: "description", tool: c.name, before: x.description, after: y.description });
    }
    if (c.what.includes("input schema")) {
      schemas.push({ kind: "input schema", tool: c.name, before: x.inputSchema ?? null, after: y.inputSchema ?? null });
    }
    const pointers = c.pointers ?? [];
    if (!inQueue) onlyTools++;
    else if (pointers.length) alsoTools++;
    const into = inQueue ? also : only;
    for (const p of pointers) {
      const seen = into.get(p.pointer) ?? { tools: 0, atCap: false };
      into.set(p.pointer, { tools: seen.tools + 1, atCap: seen.atCap || p.atCap });
    }
  }
  const tallied = (m: Map<string, { tools: number; atCap: boolean }>, tools: number): Tallied => ({
    tools,
    pointers: [...m.entries()]
      .map(([pointer, v]) => ({ pointer, tools: v.tools, atCap: v.atCap }))
      .sort((p, q) => q.tools - p.tools || p.pointer.localeCompare(q.pointer)),
  });

  const newTools: ReviewItem[] = d.added.map((name) => ({
    kind: "new tool",
    tool: name,
    before: null,
    after: definitionOf(B.get(name)!),
  }));

  const by = (xs: ReviewItem[]) => xs.sort((p, q) => p.tool.localeCompare(q.tool));
  return {
    package: pkg,
    from,
    to,
    items: [...by(descriptions), ...by(schemas), ...by(newTools)],
    otherField: tallied(only, onlyTools),
    alsoOtherField: tallied(also, alsoTools),
    removed: d.removed,
    unchanged: d.unchanged,
    offered: [...B.keys()].sort(),
  };
}

const where = (t: Tallied) =>
  t.pointers.map((p) => `${p.tools} at ${p.pointer}${p.atCap ? " (a subtree: the walk stopped there)" : ""}`).join(", ");

/**
 * The lines for fields that are neither the description nor the schema.
 *
 * One for the tools that differ ONLY there, which are not in the queue, and
 * one for the tools that are in the queue and differ there as well. Each
 * line's counts are over its own set, so a number in it is never a number
 * about the other. Both say which key and stop: what the key is for is a
 * reading of somebody else's build that nothing here measured.
 */
export function otherFieldLines(q: Queue): string[] {
  const out: string[] = [];
  if (q.otherField.tools) {
    const n = q.otherField.tools;
    out.push(
      `${n} tool${n === 1 ? "" : "s"} differ${n === 1 ? "s" : ""} only in a field that is neither the description ` +
        `nor the input schema, and ${n === 1 ? "is" : "are"} not in the queue: ${where(q.otherField)}.`,
    );
  }
  if (q.alsoOtherField.tools) {
    const n = q.alsoOtherField.tools;
    out.push(
      `${n} tool${n === 1 ? "" : "s"} in the queue differ${n === 1 ? "s" : ""} in such a field as well, ` +
        `which no item covers: ${where(q.alsoOtherField)}.`,
    );
  }
  return out;
}

/* ── Reading back what a reviewer exported ──────────────────────────────── */

export const FORMAT = "brydge-review-decisions";
export const FORMAT_VERSION = 1;

export interface Exported {
  format: string;
  version: number;
  package: string;
  fromVersion: string;
  toVersion: string;
  decisions: Array<{ kind: ItemKind; name: string; decision: Decision; by: string; at: string; itemHash: string }>;
}

/**
 * Parse an exported decisions file, refusing anything that is not one.
 *
 * The envelope names the package and both versions, and `apply` checks them
 * against what it was asked about: a file of decisions about one pair of
 * versions, applied to another, would attach real names and dates to items
 * nobody looked at.
 */
export function parseExport(text: string): Exported {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new Refused(`that file is not JSON: ${(e as Error).message}`);
  }
  const o = raw as Partial<Exported>;
  if (!o || typeof o !== "object" || Array.isArray(o)) throw new Refused("that file is not an exported set of decisions");
  if (o.format !== FORMAT) throw new Refused(`the format is "${String(o.format)}", not "${FORMAT}"`);
  if (o.version !== FORMAT_VERSION) throw new Refused(`the format version is ${String(o.version)}, and this reads ${FORMAT_VERSION}`);
  for (const k of ["package", "fromVersion", "toVersion"] as const) {
    if (typeof o[k] !== "string" || !o[k]) throw new Refused(`the file names no ${k}`);
  }
  if (!Array.isArray(o.decisions)) throw new Refused("the file carries no list of decisions");
  o.decisions.forEach((r, i) => {
    for (const k of ["kind", "name", "decision", "by", "at", "itemHash"] as const) {
      if (typeof r?.[k] !== "string" || !r[k]) throw new Refused(`decision ${i + 1} names no ${k}`);
    }
  });
  return o as Exported;
}

/* ── Applying them ──────────────────────────────────────────────────────── */

export interface Carried {
  /** Approved here, or carried from the previous list and not in the queue. */
  tools: string[];
  approvedHere: string[];
  carried: string[];
  /** Offered by the newer version and left off, each with the reason. */
  left: Array<{ tool: string; because: string }>;
}

export interface Applied {
  queue: Queue;
  merged: DecisionsFile;
  tally: Tally;
  /** Incoming records that match no item in the queue, with the reason. */
  refused: Array<{ record: Exported["decisions"][number]; because: string }>;
  carried: Carried;
  /** The entry to write, or null when there is no measured shape to build it from. */
  entry: ApprovedEntry | null;
  /** In the newer version's measurement and not on the previous list. */
  unreviewed: { hosts: string[]; programs: string[] };
}

/**
 * What a set of decisions does.
 *
 * Nothing is written. The caller gets the merged decisions, the tally, the
 * tools that would go on the list and why each one that did not was left
 * off, and the entry to write if it has a measured shape for the newer
 * version.
 */
export function apply(opts: {
  queue: Queue;
  file: DecisionsFile;
  incoming: Exported;
  /** The list entry the previous version was approved under, if there is one. */
  previous: ApprovedEntry | null;
  /** The newer version's measured surface, for the two lists nobody reviewed. */
  measured: { tools: string[]; hosts: string[]; programs: string[] } | null;
  /** Today, as YYYY-MM-DD. */
  at: string;
}): Applied {
  const { queue, file, incoming, previous, measured, at } = opts;
  if (incoming.package !== queue.package) {
    throw new Refused(`those decisions are about ${incoming.package}, and this is ${queue.package}`);
  }
  if (incoming.fromVersion !== queue.from || incoming.toVersion !== queue.to) {
    throw new Refused(
      `those decisions are about ${incoming.fromVersion} -> ${incoming.toVersion}, ` +
        `and this is ${queue.from} -> ${queue.to}`,
    );
  }

  const byKey = new Map(queue.items.map((i) => [itemKeyOf(i), i]));
  let merged = file;
  const refused: Applied["refused"] = [];
  for (const r of incoming.decisions) {
    const item = byKey.get(itemKeyOf({ kind: r.kind, tool: r.name }));
    if (!item) {
      refused.push({ record: r, because: `there is no ${r.kind} to decide for ${r.name} between these two versions` });
      continue;
    }
    const hash = itemHashOf(item);
    if (r.itemHash !== hash) {
      refused.push({
        record: r,
        because:
          `the decision was made about a different ${r.kind} for ${r.name} ` +
          `(the file says ${r.itemHash.slice(0, 12)}, this item is ${hash.slice(0, 12)})`,
      });
      continue;
    }
    try {
      merged = put(merged, queue.package, decide({ item, decision: r.decision, by: r.by, at: r.at, fromVersion: queue.from, toVersion: queue.to }));
    } catch (e) {
      refused.push({ record: r, because: (e as Error).message });
    }
  }

  const t = tally(merged, queue.package, queue.to, queue.items);

  /* ── Which tools go on the list ───────────────────────────────────────── */

  const approvedItems = new Set(t.approved.map((r) => itemKeyOf({ kind: r.kind, tool: r.name })));
  const itemsByTool = new Map<string, ReviewItem[]>();
  for (const i of queue.items) itemsByTool.set(i.tool, [...(itemsByTool.get(i.tool) ?? []), i]);

  const approvedHere: string[] = [];
  const left: Carried["left"] = [];
  for (const [toolName, items] of [...itemsByTool].sort()) {
    const unapproved = items.filter((i) => !approvedItems.has(itemKeyOf(i)));
    if (!unapproved.length) {
      approvedHere.push(toolName);
      continue;
    }
    const why = unapproved.map((i) => {
      const held = t.held.find((r) => r.name === i.tool && r.kind === i.kind);
      if (held) return `its ${i.kind} was held`;
      const stale = t.stale.find((s) => s.item.tool === i.tool && s.item.kind === i.kind);
      if (stale) return `the decision about its ${i.kind} was about an earlier edit`;
      return `its ${i.kind} is not yet decided`;
    });
    /* A tool with an approved item AND an unapproved one is named with
     * both, so "not on the list" never reads as "nobody looked". */
    const approvedPart = items.filter((i) => approvedItems.has(itemKeyOf(i))).map((i) => `its ${i.kind} was approved`);
    left.push({ tool: toolName, because: [...approvedPart, ...why].join("; ") });
  }

  const onPrevious = new Set(previous?.tools ?? []);
  const inQueue = new Set(itemsByTool.keys());
  const carried: string[] = [];
  for (const toolName of queue.offered) {
    if (inQueue.has(toolName)) continue;
    if (onPrevious.has(toolName)) carried.push(toolName);
    else {
      left.push({
        tool: toolName,
        because: previous
          ? "it is unchanged between these two versions and was not on the previous list, so no item put it in front of anybody"
          : "there is no previous list to carry it from, and it is unchanged, so no item put it in front of anybody",
      });
    }
  }

  const tools = [...new Set([...approvedHere, ...carried])].sort();
  /*
   * Whoever approved something here, by name.
   *
   * The entry's own date is the day it was WRITTEN, and each decision
   * carries the day it was MADE: a list rebuilt today from decisions taken
   * last week is what this is for, and `renderApplied` says so. Where
   * nobody approved anything — everything carried — there is no name to
   * put, and the field is left off rather than filled with the operator's.
   */
  const by = [...new Set(t.approved.map((r) => r.by))].sort().join(", ");
  const entry: ApprovedEntry | null = measured
    ? {
        package: queue.package,
        version: queue.to,
        approvedAt: at,
        ...(by ? { approvedBy: by } : {}),
        tools,
        hosts: measured.hosts,
        programs: measured.programs,
      }
    : null;

  const minus = (xs: string[], ys: string[]) => xs.filter((x) => !ys.includes(x)).sort();
  return {
    queue,
    merged,
    tally: t,
    refused,
    carried: { tools, approvedHere, carried, left: left.sort((p, q) => p.tool.localeCompare(q.tool)) },
    entry,
    unreviewed: {
      hosts: measured ? minus(measured.hosts, previous?.hosts ?? []) : [],
      programs: measured ? minus(measured.programs, previous?.programs ?? []) : [],
    },
  };
}

/* ── Printing it ────────────────────────────────────────────────────────── */

/** Said wherever an entry is written: the review was about tools. */
export const TOOLS_ONLY =
  "The review was about tool descriptions, input schemas and new tools. The websites and programs " +
  "on this entry come from this version's own measurement, and nobody decided about them here.";

/** The queue as text. Kinds and tool names; never an item's content. */
export function renderQueue(q: Queue): string {
  const out: string[] = [];
  out.push(`${q.package}: ${q.from} -> ${q.to}, ${q.items.length} item${q.items.length === 1 ? "" : "s"} to review.`);
  out.push("");
  for (const kind of KIND_ORDER) {
    const items = q.items.filter((i) => i.kind === kind);
    if (!items.length) continue;
    out.push(`${kind} (${items.length}):`);
    for (const i of items) out.push(`  ${i.tool}`);
    out.push("");
  }
  for (const line of otherFieldLines(q)) out.push(line);
  if (otherFieldLines(q).length) out.push("");
  if (q.removed.length) {
    out.push(`${q.removed.length} tool${q.removed.length === 1 ? "" : "s"} on ${q.from} and not on ${q.to}, which is nothing to approve: ${q.removed.join(", ")}.`);
    out.push("");
  }
  out.push(`${q.unchanged} tool${q.unchanged === 1 ? "" : "s"} identical between the two versions.`);
  return out.join("\n");
}

/** What applying a set of decisions did. */
export function renderApplied(a: Applied): string {
  const out: string[] = [];
  const n = a.carried.tools.length;
  out.push(`${a.queue.package}@${a.queue.to}: ${n} tool${n === 1 ? "" : "s"} on the list.`);
  out.push(`  ${a.carried.approvedHere.length} approved here, ${a.carried.carried.length} carried from the list for ${a.queue.from}.`);
  if (a.entry) {
    const dates = [...new Set(a.tally.approved.map((r) => r.at))].sort();
    out.push(
      `  The entry is dated ${a.entry.approvedAt}, the day it was written` +
        (a.entry.approvedBy ? `, from decisions made by ${a.entry.approvedBy}` : ", from no decision made here") +
        (dates.length ? ` on ${dates.join(", ")}.` : "."),
    );
  }
  out.push("");
  if (a.refused.length) {
    out.push(`${a.refused.length} decision${a.refused.length === 1 ? "" : "s"} in that file applied to nothing here:`);
    for (const r of a.refused) out.push(`  ${r.record.kind} — ${r.record.name}: ${r.because}`);
    out.push("");
  }
  if (a.carried.left.length) {
    out.push(`Offered by ${a.queue.to} and not on the list (${a.carried.left.length}):`);
    for (const l of a.carried.left) out.push(`  ${l.tool} — ${l.because}`);
    out.push("");
  }
  for (const line of otherFieldLines(a.queue)) out.push(line);
  if (otherFieldLines(a.queue).length) out.push("");
  if (a.unreviewed.hosts.length || a.unreviewed.programs.length) {
    out.push(`In ${a.queue.to}'s measurement and not on the previous list:`);
    for (const h of a.unreviewed.hosts) out.push(`  website: ${h}`);
    for (const p of a.unreviewed.programs) out.push(`  program: ${p}`);
    out.push("");
  }
  out.push(TOOLS_ONLY);
  return out.join("\n");
}

export { keyOf };
