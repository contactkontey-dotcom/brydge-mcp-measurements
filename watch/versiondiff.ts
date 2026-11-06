/*
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT CHANGED BETWEEN TWO VERSIONS, AND WHEN WE CANNOT SAY.
 *
 * Each version is measured TWICE. A field is compared across versions only if
 * that version's own two runs agree about it. Where they disagree the answer
 * is "can't tell" and NO change is reported — not a change hedged with a
 * caveat, not a change at all. A diff that guesses once is a diff nobody can
 * quote.
 *
 * The README digest is carried on its own line and never counted among the
 * behaviour changes. It differs on nearly every version bump and means only
 * that the text differs; folded into a count it would make every release look
 * eventful.
 *
 * A version that did not start is an outcome, not an empty measurement. Its
 * sets are empty because nothing was observed, and comparing them would report
 * every tool and host as removed — a finding nobody made.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { BEHAVIOUR, agree, type Behaviour, type Shape } from "./fields.ts";

export interface Change {
  field: Behaviour;
  added: string[];
  removed: string[];
}

export type Outcome =
  | "compared"
  | "could-not-start-a"
  | "could-not-start-b"
  | "could-not-start-both"
  | "cannot-tell";

export interface Diff {
  package: string;
  a: string;
  b: string;
  outcome: Outcome;
  /** One sentence naming the outcome, in the words a report prints. */
  says: string;
  /** Behaviour fields that moved. Empty when nothing did, or nothing could. */
  changes: Change[];
  /** Fields one version's own two runs disagreed about. No change claimed. */
  cannotTell: string[];
  /** Separate from the count, always. */
  readme: "same" | "changed" | "can't tell" | "not compared";
}

/** Two runs of one version, as stored. */
export interface Measured {
  version: string;
  runs: [Shape, Shape];
}

const minus = (x: string[], y: string[]) => {
  const s = new Set(y);
  return x.filter((v) => !s.has(v));
};

/**
 * Compare two versions, each measured twice.
 *
 * `cannotTell` collects a field from EITHER version: if A's runs disagreed
 * about its tool list, the tool list cannot be compared, whatever B did.
 */
export function versiondiff(pkg: string, A: Measured, B: Measured): Diff {
  const a1 = A.runs[0];
  const b1 = B.runs[0];
  const sa = agree(A.runs[0], A.runs[1]);
  const sb = agree(B.runs[0], B.runs[1]);
  const shaky = new Set<string>([...sa.disagreed, ...sb.disagreed]);

  const base: Omit<Diff, "outcome" | "says" | "changes" | "readme"> = {
    package: pkg,
    a: A.version,
    b: B.version,
    cannotTell: [...shaky].sort(),
  };

  /* Whether it started at all is the first question, and if the two runs of
   * one version disagree about THAT, nothing below is worth comparing. */
  if (shaky.has("whether it started")) {
    return {
      ...base,
      outcome: "cannot-tell",
      says: `The two runs of one version disagreed about whether it started, so nothing is compared.`,
      changes: [],
      readme: "not compared",
    };
  }

  const aStuck = a1.couldNotStart !== null;
  const bStuck = b1.couldNotStart !== null;
  if (aStuck || bStuck) {
    const outcome: Outcome = aStuck && bStuck ? "could-not-start-both" : aStuck ? "could-not-start-a" : "could-not-start-b";
    const says =
      aStuck && bStuck
        ? `Neither version ${A.version} nor version ${B.version} could start, nothing compared.`
        : aStuck
          ? `Version ${A.version} could not start, nothing compared.`
          : `Version ${B.version} could not start, nothing compared.`;
    return { ...base, outcome, says, changes: [], readme: "not compared" };
  }

  const changes: Change[] = [];
  for (const f of BEHAVIOUR) {
    if (shaky.has(f)) continue; /* can't tell: no change is reported */
    const added = minus(b1.sets[f], a1.sets[f]);
    const removed = minus(a1.sets[f], b1.sets[f]);
    if (added.length || removed.length) changes.push({ field: f, added, removed });
  }

  const readme = shaky.has("README digest")
    ? ("can't tell" as const)
    : a1.readmeDigest === b1.readmeDigest
      ? ("same" as const)
      : ("changed" as const);

  const n = changes.length;
  return {
    ...base,
    outcome: "compared",
    says:
      n === 0
        ? `Nothing changed in the ${BEHAVIOUR.length - shaky.size} fields that could be compared.`
        : `${n} of the ${BEHAVIOUR.length - shaky.size} fields that could be compared changed.`,
    changes,
    readme,
  };
}

/** The diff as plain text. Facts, and a line about what it does not say. */
export function renderDiff(d: Diff): string {
  const out: string[] = [];
  out.push(`${d.package}: ${d.a} -> ${d.b}`);
  out.push("");
  out.push(d.says);
  if (d.outcome === "compared") {
    out.push("");
    for (const c of d.changes) {
      out.push(`  ${c.field}`);
      for (const x of c.removed) out.push(`    - ${x}`);
      for (const x of c.added) out.push(`    + ${x}`);
    }
    if (!d.changes.length) out.push("  (no additions or removals)");
    out.push("");
    out.push(
      `  README digest: ${
        d.readme === "same"
          ? "unchanged"
          : d.readme === "changed"
            ? "differs between the two versions. That means the text differs and nothing more."
            : "can't tell"
      }`,
    );
  }
  if (d.cannotTell.length) {
    out.push("");
    out.push(`Can't tell, and no change is reported for these: ${d.cannotTell.join(", ")}.`);
    out.push(`A version's two runs disagreed about them, so this cannot say whether the version did.`);
  }
  out.push("");
  out.push(`What this does not say: no tool was called in either run, so nothing here is about what a tool does.`);
  out.push(`Both versions were given the same fake credentials and no settings of their own, so a tool list that`);
  out.push(`depends on configuration was seen in one configuration only. A name appearing here was looked up or`);
  out.push(`opened to; the room has no route off the host, so no connection completed and no content was seen.`);
  return out.join("\n");
}
