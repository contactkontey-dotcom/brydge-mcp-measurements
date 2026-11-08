/*
 * ═══════════════════════════════════════════════════════════════════════════
 * STAGE B: CALL THE TOOLS THAT SAY THEY ONLY READ, AND SEE IF THEY REPEAT.
 *
 * This answers one question and no other: of the tools that declare
 * `readOnlyHint: true` and require no arguments, how many return the SAME
 * output twice? Nothing here diffs across versions, judges a reply, or shows
 * anything to a reader. A tool whose two runs disagree can never support a
 * comparison, so knowing how many do is what decides whether a call-level
 * diff is worth building at all.
 *
 * ── Nothing it reads is ever shown ────────────────────────────────────────
 *
 * Tool output is untrusted text from a third party, and it is not summarised,
 * quoted, or printed. What is stored per call is a sha256 of the whole reply,
 * its length, whether it was flagged an error, and an excerpt capped at 200
 * characters — kept on disk for a person who chooses to look, never surfaced.
 * Everything this prints is a count or a hash.
 *
 * ── Arguments come from the planted fixtures or not at all ────────────────
 *
 * Only tools with no required arguments are called, and they are called with
 * `{}`. Optional arguments are left unset: inventing a plausible value is how
 * a test call becomes a real request. If a future selection needs an
 * argument, it may only take one the room already planted.
 *
 * ── No instrument change ──────────────────────────────────────────────────
 *
 * It calls `measureServer` with probes, which the harness has always
 * supported and Level 1 chooses not to use. harness/, engine/ and measure.ts
 * are untouched and the fingerprint is unchanged.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { measureServer } from "../measure.ts";
import type { Probe, ServerSpec } from "../harness/types.ts";
import { executableOf, resolvePackage } from "../level1/resolve.ts";
import { slugOf } from "../level1/run.ts";
import { folderOf } from "./store.ts";
import type { ToolRecord } from "./tools.ts";

/** Capped hard. A reply is evidence for a person, not reading material. */
export const EXCERPT = 200;

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** A tool this stage is willing to call. */
export function isCallable(t: ToolRecord): boolean {
  const ann = (t.extra as Record<string, any> | undefined)?.annotations;
  if (!ann || typeof ann !== "object" || ann.readOnlyHint !== true) return false;
  const req = (t.inputSchema as Record<string, any> | null | undefined)?.required;
  return !Array.isArray(req) || req.length === 0;
}

export function callableOf(tools: ToolRecord[]): string[] {
  return tools.filter(isCallable).map((t) => t.name).sort();
}

/**
 * One call's record. No field here can carry a readable reply except
 * `excerpt`, which is truncated on the way in and never printed.
 */
export interface CallRecord {
  tool: string;
  /** Whether a reply arrived at all. */
  answered: boolean;
  /** sha256 of the whole reply text. The only thing compared. */
  hash: string | null;
  bytes: number | null;
  isError: boolean | null;
  excerpt: string | null;
  why: string | null;
}

/**
 * The reply to one `tools/call`, out of a stored session, matched by id.
 *
 * Not "the last message mentioning the tool": servers interleave
 * notifications, and a log line that happens to carry the name would be
 * taken for the answer. Same rule as `toolsFromSession`.
 */
export function callsFromSession(session: Record<string, any>): Map<string, CallRecord> {
  const out = new Map<string, CallRecord>();
  const transcript = (session?.transcript ?? []) as Array<Record<string, any>>;
  const asked = new Map<unknown, string>();
  for (const e of transcript) {
    if (e.dir === "to-server" && e.message?.method === "tools/call" && "id" in (e.message ?? {})) {
      asked.set(e.message.id, String(e.message.params?.name ?? ""));
    }
  }
  for (const [id, tool] of asked) {
    const reply = transcript.find((e) => e.dir === "from-server" && e.message?.id === id);
    if (!reply) {
      out.set(tool, { tool, answered: false, hash: null, bytes: null, isError: null, excerpt: null, why: "no reply" });
      continue;
    }
    const m = reply.message ?? {};
    /* The whole reply, errors included: an error that repeats is still a
     * repeatable output, and that is what this counts. */
    const body = m.error !== undefined ? m.error : (m.result ?? null);
    const text = JSON.stringify(body ?? null);
    out.set(tool, {
      tool,
      answered: true,
      hash: sha(text),
      bytes: text.length,
      isError: m.error !== undefined || m.result?.isError === true,
      excerpt: text.slice(0, EXCERPT),
      why: null,
    });
  }
  return out;
}

/** A probe that calls a tool and asks nothing of the answer. */
function probeFor(tool: string, n: number): Probe {
  return {
    key: `call-${n}`,
    tool,
    claim: "(not judged: this stage only asks whether the output repeats)",
    reading: "(not judged)",
    arguments: {},
    oracle: "reply",
    where: {},
    must: [],
  };
}

export interface RunOutcome {
  package: string;
  version: string;
  called: string[];
  runs: Array<Map<string, CallRecord> | { failed: string }>;
}

/** Call every selected tool once, in one sealed room. */
export async function callOnce(name: string, version: string, tools: string[]): Promise<Map<string, CallRecord> | { failed: string }> {
  let resolved;
  let bin: string;
  try {
    resolved = resolvePackage(`${name}@${version}`);
    bin = executableOf(resolved).bin;
  } catch (e) {
    return { failed: e instanceof Error ? e.message : String(e) };
  }
  const spec: ServerSpec = {
    slug: slugOf(name),
    name,
    registry: "npm",
    version,
    readmeCommand: `npx -y ${name}@${version}`,
    bin,
    args: [],
    callTimeoutSeconds: 60,
    declared: { credentials: [], tools: null, destinations: [] },
    fixtures: {},
    probes: tools.map(probeFor),
    notChecked: [],
  };
  try {
    const out = await measureServer(spec);
    const raw = out.raw as { session?: Record<string, unknown> };
    return callsFromSession((raw.session ?? {}) as Record<string, any>);
  } catch (e) {
    return { failed: e instanceof Error ? e.message : String(e) };
  }
}

/** Where a run's call records live. Beside the runs, never in the repo. */
export function callsPath(name: string, version: string, n: 1 | 2): string {
  return join(folderOf(name, version), `calls-${n}.json`);
}

export function storeCalls(name: string, version: string, n: 1 | 2, calls: Map<string, CallRecord>): void {
  writeFileSync(callsPath(name, version, n), JSON.stringify([...calls.values()], null, 2) + "\n");
}

export function loadCalls(name: string, version: string, n: 1 | 2): CallRecord[] | null {
  const p = callsPath(name, version, n);
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as CallRecord[]) : null;
}

/** How the two runs of one version compare, per tool. Counts only. */
export type Verdict = "identical" | "differs" | "no answer" | "missing";

export function verdictFor(a: CallRecord | undefined, b: CallRecord | undefined): Verdict {
  if (!a || !b) return "missing";
  if (!a.answered || !b.answered) return "no answer";
  return a.hash === b.hash ? "identical" : "differs";
}
