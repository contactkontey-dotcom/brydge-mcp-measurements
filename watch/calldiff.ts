/*
 * ═══════════════════════════════════════════════════════════════════════════
 * STAGE C: DID THE SAME CALL RETURN THE SAME THING IN BOTH VERSIONS?
 *
 * Per tool, one comparison of two hashes, under the rule the rest of this
 * project uses: a version earns a comparison by reproducing itself. If a
 * version's OWN two runs returned different output for a tool, that tool is
 * "can't tell" and is never counted as changed, however different the two
 * versions look.
 *
 * ── Coverage is printed on every result, not just the thin ones ───────────
 *
 * 128 of 142 eligible tools repeat, but 142 is itself a small slice of the
 * 1131 tools these servers offer. A line reading "3 tools changed" with no
 * denominator invites the reader to think the server was checked. Every
 * result carries "Call-checked: N of M tools; the rest were not called."
 *
 * ── Nothing read here is shown unless a person asks for it by name ────────
 *
 * The comparison is between hashes. Lengths and the 200-character excerpts
 * exist on disk and are printed only for tools named in `show`, which
 * nothing sets by default. Tool output is untrusted text from a third party;
 * it is not quoted, summarised or sent anywhere.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { loadCalls, type CallRecord } from "./probe.ts";
import { folderOf } from "./store.ts";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { callableOf, type CallRecord as _CR } from "./probe.ts";

/** What this stage never claims, printed under every "not compared" list. */
export const CALL_LIMITS = [
  "The call was made with NO ARGUMENTS. Only tools that require none were called, and optional arguments were left unset, so a tool that does more when given something was not asked to.",
  "One configuration. Both versions ran with the same fake credentials and no settings of their own, so a reply that depends on configuration was seen in that one configuration.",
];

export type CallVerdict = "same" | "differs" | "can't tell" | "not called";

export interface ToolCall {
  tool: string;
  verdict: CallVerdict;
  /** Why, for "can't tell" and "not called". */
  why: string | null;
}

export interface CallDiff {
  package: string;
  a: string;
  b: string;
  /** Every tool name either version offered. The denominator. */
  allTools: number;
  rows: ToolCall[];
  same: string[];
  differs: string[];
  cantTell: ToolCall[];
  notCalled: ToolCall[];
  /** True only when BOTH versions have stored call data. */
  haveCallData: boolean;
}

function toolNames(name: string, version: string): string[] {
  const f = join(folderOf(name, version), "tools-1.json");
  if (!existsSync(f)) return [];
  return (JSON.parse(readFileSync(f, "utf8")).tools as Array<{ name: string }>).map((t) => t.name);
}

function eligible(name: string, version: string): string[] {
  const f = join(folderOf(name, version), "tools-1.json");
  if (!existsSync(f)) return [];
  return callableOf(JSON.parse(readFileSync(f, "utf8")).tools);
}

/** Both runs of one version, keyed by tool, or null when a run is missing. */
function runsOf(name: string, version: string): [Map<string, CallRecord>, Map<string, CallRecord>] | null {
  const a = loadCalls(name, version, 1);
  const b = loadCalls(name, version, 2);
  if (!a || !b) return null;
  return [new Map(a.map((x) => [x.tool, x])), new Map(b.map((x) => [x.tool, x]))];
}

/**
 * One tool's verdict.
 *
 * The reproduce check comes FIRST, for both versions, before the two
 * versions are compared at all. A tool that does not repeat within a version
 * cannot support a claim about the difference between versions, and saying
 * so is not a hedge — it is the only honest answer available.
 */
function verdictOf(
  tool: string,
  A: ReturnType<typeof runsOf>,
  B: ReturnType<typeof runsOf>,
  eligA: Set<string>,
  eligB: Set<string>,
): ToolCall {
  if (!eligA.has(tool) || !eligB.has(tool)) {
    return { tool, verdict: "not called", why: "it declares no readOnlyHint, or it requires an argument, in at least one version" };
  }
  if (!A || !B) return { tool, verdict: "not called", why: "no call data stored for one of the versions" };
  const [a1, a2] = A;
  const [b1, b2] = B;
  const ra1 = a1.get(tool), ra2 = a2.get(tool), rb1 = b1.get(tool), rb2 = b2.get(tool);
  if (!ra1 || !ra2 || !rb1 || !rb2) return { tool, verdict: "not called", why: "the tool was not called in every run" };
  if (!ra1.answered || !ra2.answered || !rb1.answered || !rb2.answered) {
    return { tool, verdict: "can't tell", why: "a run produced no reply" };
  }
  if (ra1.hash !== ra2.hash) return { tool, verdict: "can't tell", why: `the two runs of ${"A"} returned different output` };
  if (rb1.hash !== rb2.hash) return { tool, verdict: "can't tell", why: `the two runs of ${"B"} returned different output` };
  return { tool, verdict: ra1.hash === rb1.hash ? "same" : "differs", why: null };
}

export function callDiff(pkg: string, a: string, b: string): CallDiff {
  const all = [...new Set([...toolNames(pkg, a), ...toolNames(pkg, b)])].sort();
  const eligA = new Set(eligible(pkg, a));
  const eligB = new Set(eligible(pkg, b));
  const A = runsOf(pkg, a);
  const B = runsOf(pkg, b);
  const rows = all.map((t) => {
    const r = verdictOf(t, A, B, eligA, eligB);
    return r.why ? { ...r, why: r.why.replace(/\bA\b/, a).replace(/\bB\b/, b) } : r;
  });
  return {
    package: pkg,
    a,
    b,
    allTools: all.length,
    rows,
    same: rows.filter((r) => r.verdict === "same").map((r) => r.tool),
    differs: rows.filter((r) => r.verdict === "differs").map((r) => r.tool),
    cantTell: rows.filter((r) => r.verdict === "can't tell"),
    notCalled: rows.filter((r) => r.verdict === "not called"),
    haveCallData: A !== null && B !== null,
  };
}

/** The one line that must appear on every result. */
export function coverageLine(d: CallDiff): string {
  const checked = d.same.length + d.differs.length + d.cantTell.length;
  return `Call-checked: ${checked} of ${d.allTools} tools; the rest were not called.`;
}

export interface RenderOptions {
  /** Tool names whose length and 200-character excerpt to print. Nothing by default. */
  show?: string[];
  /** Where to read the excerpts from. */
  at?: { version: string; run: 1 | 2 };
}

export function renderCallDiff(d: CallDiff, opts: RenderOptions = {}): string {
  const out: string[] = [];
  out.push(`${d.package}: replies, ${d.a} -> ${d.b}`);
  out.push("");
  if (!d.haveCallData) {
    out.push(`No calls were made. ${coverageLine(d)}`);
    out.push("");
    out.push(`Not compared, and why:`);
    out.push(`  - every tool: no call data is stored for ${!loadCalls(d.package, d.a, 1) ? d.a : d.b}`);
    for (const l of CALL_LIMITS) out.push(`  - ${l}`);
    return out.join("\n");
  }

  out.push(coverageLine(d));
  out.push("");
  if (d.differs.length) {
    out.push(`REPLY CHANGED: ${d.differs.length} tool${d.differs.length === 1 ? "" : "s"}`);
    for (const t of d.differs) out.push(`  ${t}`);
  } else {
    out.push(`No reply changed among the tools that were call-checked.`);
  }
  out.push("");
  out.push(`Same reply in both versions: ${d.same.length}`);

  if (d.cantTell.length) {
    out.push("");
    out.push(`CAN'T TELL, and not counted as changed: ${d.cantTell.length}`);
    for (const r of d.cantTell) out.push(`  ${r.tool} — ${r.why}`);
  }

  /* Excerpts only for tools a person named. */
  if (opts.show?.length) {
    const at = opts.at ?? { version: d.b, run: 1 as const };
    const recs = new Map((loadCalls(d.package, at.version, at.run) ?? []).map((r) => [r.tool, r]));
    out.push("");
    out.push(`Excerpts, ${at.version} run ${at.run}, capped at 200 characters, for the ${opts.show.length} tool(s) asked for:`);
    for (const t of opts.show) {
      const r = recs.get(t);
      out.push(r ? `  ${t}  (${r.bytes} bytes${r.isError ? ", flagged an error" : ""})` : `  ${t}  (no record)`);
      if (r?.excerpt) out.push(`    ${r.excerpt}`);
    }
  }

  out.push("");
  out.push(`Not compared (${d.notCalled.length} of ${d.allTools} tools), and what a call here does not cover:`);
  if (d.notCalled.length) {
    out.push(`  - ${d.notCalled.length} tool(s) were not called: they declare no readOnlyHint, or they require an argument.`);
  }
  for (const l of CALL_LIMITS) out.push(`  - ${l}`);
  return out.join("\n");
}
