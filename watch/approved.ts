/*
 * ═══════════════════════════════════════════════════════════════════════════
 * A LIST SOMEBODY APPROVED, AND WHAT A LATER RUN SHOWS THAT IS NOT ON IT.
 *
 * The list is per VERSION, because that is the only thing anyone can actually
 * have looked at. "We approve package-registry-mcp" is not a statement about
 * any particular software; "we approved what 2.0.0 offered on 6 November" is.
 *
 * NOTHING HERE BLOCKS ANYTHING. There is no allow, no deny, no exit code that
 * means stop. An item absent from the list is labelled `new, not on your list`
 * and that is the whole of it: a difference between what somebody approved and
 * what a later run showed. Whether it matters is not a thing this can know —
 * a package adding a tool is the ordinary way packages improve.
 *
 * The three categories come from `shapeOf`, so "a tool" means here exactly
 * what it means in the diff and on the site. A second definition would be a
 * second answer to the same question.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import type { Shape } from "./fields.ts";

/** The label, in one place, so every report uses the same words. */
export const NEW_LABEL = "new, not on your list";
/** Its counterpart. Not "removed": we saw one run, not a removal. */
export const ABSENT_LABEL = "on your list, not offered in this run";

export interface ApprovedEntry {
  /** The package and version somebody looked at. */
  package: string;
  version: string;
  /** When it was added to the list, and by whom, if given. */
  approvedAt: string;
  approvedBy?: string;
  tools: string[];
  hosts: string[];
  programs: string[];
}

/** Keyed `package@version`: one entry per version anybody approved. */
export type ApprovedList = Record<string, ApprovedEntry>;

export const keyOf = (pkg: string, version: string) => `${pkg}@${version}`;

/** Build an entry from a measured shape. The three lists, nothing else. */
export function entryFrom(pkg: string, version: string, s: Shape, when: string, who?: string): ApprovedEntry {
  return {
    package: pkg,
    version,
    approvedAt: when,
    ...(who ? { approvedBy: who } : {}),
    tools: [...s.sets["tools offered"]],
    hosts: [...s.sets["websites reached"]],
    programs: [...s.sets["programs started"]],
  };
}

export interface Check {
  package: string;
  /** The version the list was approved for. */
  approvedVersion: string;
  /** The version this run measured. */
  ranVersion: string;
  /** Present in the run, absent from the list. */
  newItems: { tools: string[]; hosts: string[]; programs: string[] };
  /** On the list, absent from this run. */
  absent: { tools: string[]; hosts: string[]; programs: string[] };
  /** True when the run showed nothing the list does not have. */
  allOnList: boolean;
}

const minus = (x: string[], y: string[]) => {
  const s = new Set(y);
  return x.filter((v) => !s.has(v));
};

/**
 * Compare one measured run against an approved entry.
 *
 * The run is a single `Shape`. Where it came from two runs that disagreed,
 * the caller is responsible for not asking — same rule as the diff: a field
 * nobody can reproduce is not a field to label.
 */
export function checkAgainst(entry: ApprovedEntry, ranVersion: string, s: Shape): Check {
  const newItems = {
    tools: minus(s.sets["tools offered"], entry.tools),
    hosts: minus(s.sets["websites reached"], entry.hosts),
    programs: minus(s.sets["programs started"], entry.programs),
  };
  const absent = {
    tools: minus(entry.tools, s.sets["tools offered"]),
    hosts: minus(entry.hosts, s.sets["websites reached"]),
    programs: minus(entry.programs, s.sets["programs started"]),
  };
  return {
    package: entry.package,
    approvedVersion: entry.version,
    ranVersion,
    newItems,
    absent,
    allOnList: !newItems.tools.length && !newItems.hosts.length && !newItems.programs.length,
  };
}

/** The check as plain text. Facts and labels; no judgement, no verdict. */
export function renderCheck(c: Check): string {
  const out: string[] = [];
  out.push(`${c.package}: ran ${c.ranVersion}, checked against the list approved for ${c.approvedVersion}`);
  out.push("");
  if (c.allOnList) {
    out.push(`Everything this run showed is on your list.`);
  } else {
    for (const [kind, items] of [
      ["tool", c.newItems.tools],
      ["website", c.newItems.hosts],
      ["program", c.newItems.programs],
    ] as const) {
      for (const name of items) out.push(`  ${kind}: ${name} — ${NEW_LABEL}`);
    }
  }
  const anyAbsent = c.absent.tools.length || c.absent.hosts.length || c.absent.programs.length;
  if (anyAbsent) {
    out.push("");
    for (const [kind, items] of [
      ["tool", c.absent.tools],
      ["website", c.absent.hosts],
      ["program", c.absent.programs],
    ] as const) {
      for (const name of items) out.push(`  ${kind}: ${name} — ${ABSENT_LABEL}`);
    }
  }
  return out.join("\n");
}

/*
 * Reading and writing the list live here, not in the CLI, because they are
 * where the list can be silently emptied. The first version of this passed
 * sorted keys as JSON.stringify's second argument — which is a REPLACER, an
 * allow-list of property names, not an ordering. Every entry serialised as
 * `{}`. It wrote a file, printed a cheerful count and lost everything, and no
 * unit test saw it because no unit test went through a file.
 */

/** The list, keys sorted, as it is written to disk. */
export function serialize(list: ApprovedList): string {
  const sorted: ApprovedList = {};
  for (const k of Object.keys(list).sort()) sorted[k] = list[k]!;
  return JSON.stringify(sorted, null, 2) + "\n";
}

/** Parse a list, checking each entry still holds what an entry must hold. */
export function deserialize(text: string): ApprovedList {
  const raw = JSON.parse(text) as Record<string, unknown>;
  const out: ApprovedList = {};
  for (const [key, v] of Object.entries(raw)) {
    const e = v as Partial<ApprovedEntry>;
    if (!e || typeof e !== "object" || !e.package || !e.version || !Array.isArray(e.tools)) {
      throw new Error(`approved list entry "${key}" is not an entry: ${JSON.stringify(v).slice(0, 80)}`);
    }
    out[key] = e as ApprovedEntry;
  }
  return out;
}
