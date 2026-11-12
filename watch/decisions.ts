/*
 * ═══════════════════════════════════════════════════════════════════════════
 * WHO LOOKED AT WHAT, AND WHAT THEY DECIDED ABOUT IT.
 *
 * watch/approved.ts records a VERSION somebody approved: one date, one name,
 * three flat lists. That is the right record of "we looked at what 2.0.0
 * offered", and it has no way to say "Devansh approved the reworded
 * description on these four tools and held the seventh". A review queue
 * produces one decision per item, and this is where they live.
 *
 * ── WHAT HOLD MEANS, AND WHAT IT DOES NOT ────────────────────────────────
 *
 * Hold means: looked at, not added to the list, not in the allow rules.
 *
 * That is the whole of it. It does not stop the tool being offered, does not
 * stop anybody calling it, and does not stop a server starting. Nothing in
 * this project is a gate — approved.ts says so in its own header and it is
 * as true here. A held item is an item somebody read and did not sign off,
 * which is a fact about the reviewer, not about the software. A test asserts
 * no output here says otherwise.
 *
 * ── A DECISION NEVER APPLIES TO SOMETHING ELSE ───────────────────────────
 *
 * Every record carries `itemHash`, over exactly the pair the reviewer was
 * shown. A decision is only ever handed back for an item whose hash still
 * matches; where it does not, the lookup says `stale` and names the reason,
 * and the caller treats the item as undecided.
 *
 * Without that, a decision would be keyed by tool name and kind — and the
 * second time a maintainer edits that description, the approval somebody
 * gave for the FIRST edit would silently cover the second. The hash is what
 * makes "approved" mean "approved this text" rather than "approved this
 * tool, whatever it says next".
 *
 * ── THE TEXT IS HASHED, NEVER STORED ─────────────────────────────────────
 *
 * `itemHashOf` is handed the two sides so it can hash them. Nothing it is
 * handed is kept: a record holds a kind, a tool name, a decision, a name, a
 * date, two version strings and the hash. A test serialises a file built
 * from fixtures carrying prose and asserts the prose is not in it.
 *
 * ── IT READS AND WRITES NOTHING ──────────────────────────────────────────
 *
 * `serialize` and `deserialize` are here; the file I/O is the CLI's, as it
 * is for approved.ts. Same rule as watch/words.ts and watch/schemadiff.ts,
 * checked the same way.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { createHash } from "node:crypto";
import { canonical } from "./tools.ts";

/** The one sentence that defines hold, used wherever hold is printed. */
export const HOLD_MEANS = "looked at, not added to the list, not in the allow rules";

/** The two decisions. There is no third, and no absence-of-decision value. */
export type Decision = "approve" | "hold";
export const DECISIONS: Decision[] = ["approve", "hold"];

/**
 * The three kinds of thing a review queue puts in front of somebody.
 *
 * They are the three the diffs can show: a description whose text moved, an
 * input schema whose shape moved, and a tool that was not there before. A
 * tool that differs only in some other field is not among them — Stage 4
 * counts those in one line rather than asking anybody to decide about each.
 */
export type ItemKind = "description" | "input schema" | "new tool";
export const ITEM_KINDS: ItemKind[] = ["description", "input schema", "new tool"];

/**
 * One thing to decide about.
 *
 * `before` and `after` are the two sides the reviewer was shown, and they
 * exist here ONLY to be hashed. For a description they are the two texts,
 * for a schema the two schemas, and for a new tool `before` is null and
 * `after` is the whole tool definition. Nothing stores them.
 */
export interface ReviewItem {
  kind: ItemKind;
  tool: string;
  before: unknown;
  after: unknown;
}

/** A decision, as it is written down. */
export interface DecisionRecord {
  kind: ItemKind;
  name: string;
  decision: Decision;
  /** Who decided. A name, not an account: nothing here authenticates anybody. */
  by: string;
  /** The day they decided, as YYYY-MM-DD. */
  at: string;
  fromVersion: string;
  toVersion: string;
  /** sha256 over the pair they were shown. */
  itemHash: string;
}

/**
 * The file: `package@version` to the decisions made about that version.
 *
 * The inner key is `kind:tool`, so one item carries one decision. Deciding
 * again replaces it, with its own name and date — a review that could not
 * be revised would be a record nobody dares write in.
 *
 * The package is in the outer key and not in each record, which is the field
 * list this was asked for. `deserialize` therefore checks the key parses.
 */
export type DecisionsFor = Record<string, DecisionRecord>;
export type DecisionsFile = Record<string, DecisionsFor>;

export const keyOf = (pkg: string, version: string) => `${pkg}@${version}`;
export const itemKeyOf = (item: Pick<ReviewItem, "kind" | "tool">) => `${item.kind}:${item.tool}`;

/** The last `@` separates them: a scoped package name contains none, a version none. */
export function splitKey(key: string): { package: string; version: string } | null {
  const at = key.lastIndexOf("@");
  if (at <= 0 || at === key.length - 1) return null;
  return { package: key.slice(0, at), version: key.slice(at + 1) };
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/**
 * The hash of exactly what was shown.
 *
 * Over the kind, the tool name and both sides. The kind is in it because the
 * same tool's description and schema are two decisions, and a hash that
 * covered only the content would let one stand for the other where a tool's
 * description and schema happened to be the same value.
 */
export function itemHashOf(item: ReviewItem): string {
  return sha(canonical({ kind: item.kind, tool: item.tool, before: item.before ?? null, after: item.after ?? null }));
}

/* ── Writing one down ───────────────────────────────────────────────────── */

export class Refused extends Error {}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A record for one decision, or a refusal.
 *
 * It refuses rather than correcting: an empty reviewer name or a date in
 * somebody's local format is a caller that has not been told what this file
 * is for, and writing a record with a blank `by` would produce a decision
 * nobody made.
 */
export function decide(opts: {
  item: ReviewItem;
  decision: Decision;
  by: string;
  at: string;
  fromVersion: string;
  toVersion: string;
}): DecisionRecord {
  const { item, decision, by, at, fromVersion, toVersion } = opts;
  if (!ITEM_KINDS.includes(item.kind)) throw new Refused(`"${item.kind}" is not a kind of item: ${ITEM_KINDS.join(", ")}`);
  if (!item.tool.trim()) throw new Refused("the item names no tool");
  if (!DECISIONS.includes(decision)) throw new Refused(`"${decision}" is not a decision: ${DECISIONS.join(", ")}`);
  if (!by.trim()) throw new Refused("a decision needs a name: who decided it");
  if (!DATE.test(at)) throw new Refused(`"${at}" is not a date as YYYY-MM-DD`);
  if (!fromVersion.trim() || !toVersion.trim()) throw new Refused("a decision is about a change between two named versions");
  return {
    kind: item.kind,
    name: item.tool,
    decision,
    by: by.trim(),
    at,
    fromVersion: fromVersion.trim(),
    toVersion: toVersion.trim(),
    itemHash: itemHashOf(item),
  };
}

/** The file with one decision added or replaced. The argument is not changed. */
export function put(file: DecisionsFile, pkg: string, record: DecisionRecord): DecisionsFile {
  const key = keyOf(pkg, record.toVersion);
  return {
    ...file,
    [key]: { ...(file[key] ?? {}), [itemKeyOf({ kind: record.kind, tool: record.name })]: record },
  };
}

/* ── Reading one back ───────────────────────────────────────────────────── */

export type Found =
  | { state: "decided"; record: DecisionRecord }
  | { state: "undecided" }
  | { state: "stale"; record: DecisionRecord; because: string };

/**
 * The decision for an item, if one applies to THIS item.
 *
 * A record whose hash does not match is handed back as `stale` with the
 * reason, rather than dropped: "somebody decided about an earlier version of
 * this text" is worth telling a reviewer, and is not the same as nobody
 * having looked.
 */
export function lookup(file: DecisionsFile, pkg: string, toVersion: string, item: ReviewItem): Found {
  const record = file[keyOf(pkg, toVersion)]?.[itemKeyOf(item)];
  if (!record) return { state: "undecided" };
  const hash = itemHashOf(item);
  if (record.itemHash !== hash) {
    return {
      state: "stale",
      record,
      because:
        `the decision was made about a different ${item.kind} for this tool ` +
        `(recorded ${record.itemHash.slice(0, 12)}, this item is ${hash.slice(0, 12)})`,
    };
  }
  /* A record filed under this version that names a different pair of
   * versions is about a different comparison, whatever its hash says. */
  if (record.toVersion !== toVersion) {
    return { state: "stale", record, because: `the decision was made about the change to ${record.toVersion}` };
  }
  return { state: "decided", record };
}

export interface Tally {
  approved: DecisionRecord[];
  held: DecisionRecord[];
  undecided: ReviewItem[];
  stale: Array<{ item: ReviewItem; record: DecisionRecord; because: string }>;
}

/**
 * Every item sorted into what is decided about it.
 *
 * The items are the caller's current ones, so a decision about an item that
 * is no longer in front of anybody does not appear at all: it is still in
 * the file, and it applies to nothing.
 */
export function tally(file: DecisionsFile, pkg: string, toVersion: string, items: ReviewItem[]): Tally {
  const out: Tally = { approved: [], held: [], undecided: [], stale: [] };
  for (const item of items) {
    const found = lookup(file, pkg, toVersion, item);
    if (found.state === "undecided") out.undecided.push(item);
    else if (found.state === "stale") out.stale.push({ item, record: found.record, because: found.because });
    else if (found.record.decision === "approve") out.approved.push(found.record);
    else out.held.push(found.record);
  }
  return out;
}

/** Tool names with an approved item, once each. What Stage 4 adds to a list. */
export function approvedTools(t: Tally): string[] {
  return [...new Set(t.approved.map((r) => r.name))].sort();
}

/** Tool names every one of whose items was held, and none approved. */
export function heldTools(t: Tally): string[] {
  const approved = new Set(t.approved.map((r) => r.name));
  return [...new Set(t.held.map((r) => r.name))].filter((n) => !approved.has(n)).sort();
}

/* ── The file on disk ───────────────────────────────────────────────────── */

/*
 * The lesson from watch/approved.ts, which is worth repeating here because
 * this is the same shape of mistake waiting: its first version passed sorted
 * keys as JSON.stringify's SECOND argument, which is a replacer — an
 * allow-list of property names — not an ordering. Every entry serialised as
 * `{}`, it wrote the file, printed a cheerful count, and lost everything,
 * and no unit test saw it because no unit test went through a file.
 */

/** The file, keys sorted at both levels, as it is written to disk. */
export function serialize(file: DecisionsFile): string {
  const out: DecisionsFile = {};
  for (const key of Object.keys(file).sort()) {
    const inner: DecisionsFor = {};
    for (const k of Object.keys(file[key]!).sort()) inner[k] = file[key]![k]!;
    out[key] = inner;
  }
  return JSON.stringify(out, null, 2) + "\n";
}

const HEX = /^[0-9a-f]{64}$/;

/** Parse a file, checking every record still holds what a record must hold. */
export function deserialize(text: string): DecisionsFile {
  const raw = JSON.parse(text) as Record<string, unknown>;
  const out: DecisionsFile = {};
  for (const [key, group] of Object.entries(raw)) {
    if (!splitKey(key)) throw new Refused(`"${key}" is not a package@version key`);
    if (!group || typeof group !== "object" || Array.isArray(group)) {
      throw new Refused(`the decisions under "${key}" are not a group of records`);
    }
    const inner: DecisionsFor = {};
    for (const [itemKey, v] of Object.entries(group as Record<string, unknown>)) {
      const r = v as Partial<DecisionRecord>;
      const bad =
        !r || typeof r !== "object"
          ? "not a record"
          : !r.kind || !ITEM_KINDS.includes(r.kind)
            ? "no kind of item"
            : typeof r.name !== "string" || !r.name
              ? "no tool name"
              : !r.decision || !DECISIONS.includes(r.decision)
                ? "no decision"
                : typeof r.by !== "string" || !r.by
                  ? "nobody decided it"
                  : typeof r.at !== "string" || !DATE.test(r.at)
                    ? "no date as YYYY-MM-DD"
                    : typeof r.fromVersion !== "string" || !r.fromVersion || typeof r.toVersion !== "string" || !r.toVersion
                      ? "not about a change between two named versions"
                      : typeof r.itemHash !== "string" || !HEX.test(r.itemHash)
                        ? "no sha256 of what was looked at"
                        : itemKey !== itemKeyOf({ kind: r.kind, tool: r.name })
                          ? `filed under "${itemKey}", which is not "${itemKeyOf({ kind: r.kind, tool: r.name })}"`
                          : null;
      if (bad) throw new Refused(`the decision at ${key} / ${itemKey} has ${bad}`);
      inner[itemKey] = r as DecisionRecord;
    }
    out[key] = inner;
  }
  return out;
}

/* ── Printing it ────────────────────────────────────────────────────────── */

/** What a tally says, in text. No item's content, only its kind and tool. */
export function renderTally(t: Tally, pkg: string, from: string, to: string): string {
  const out: string[] = [];
  const n = t.approved.length + t.held.length + t.undecided.length + t.stale.length;
  out.push(`${pkg}: ${from} -> ${to}, ${n} item${n === 1 ? "" : "s"} to review.`);
  out.push("");
  const group = (title: string, lines: string[]) => {
    if (!lines.length) return;
    out.push(`${title} (${lines.length}):`);
    for (const l of lines) out.push(`  ${l}`);
    out.push("");
  };
  group("approved", t.approved.map((r) => `${r.kind} — ${r.name}, by ${r.by} on ${r.at}`));
  group("held", t.held.map((r) => `${r.kind} — ${r.name}, by ${r.by} on ${r.at}`));
  group("not yet decided", t.undecided.map((i) => `${i.kind} — ${i.tool}`));
  group(
    "decided about something else, so not carried over",
    t.stale.map((s) => `${s.item.kind} — ${s.item.tool}: ${s.because}`),
  );
  out.push(`held means: ${HOLD_MEANS}.`);
  return out.join("\n");
}
