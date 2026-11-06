/*
 * ═══════════════════════════════════════════════════════════════════════════
 * THE TOOL LIST AS THE SERVER ACTUALLY SENT IT: NAMES, DESCRIPTIONS, SCHEMAS.
 *
 * `level1/run.ts` keeps the names and throws the rest away, which is why the
 * site reports a tool count and not a tool surface. The instrument never threw
 * it away: `harness/client.ts` records every JSON-RPC message in full and
 * `harness/session.ts` writes them to `session-result.json`. This reads that
 * file. Nothing in the instrument changes, the fingerprint is untouched, and
 * no recalibration is owed.
 *
 * THREE HASHES PER TOOL, NOT ONE. A single hash over the whole tool says
 * "something changed" and leaves a reader to find it by eye in 1,600
 * characters of prose. Description and schema are hashed separately because
 * they fail differently: a reworded description is an editing change, and a
 * schema that gained a parameter is a change in what the tool accepts.
 *
 * THE DESCRIPTION IS SOMEBODY'S PROSE, AND IT STAYS PRIVATE. Raw text is
 * stored beside the hashes so a diff can show what moved, under watch/runs/,
 * which is gitignored. Publishing a maintainer's writing at scale is a
 * different act from publishing a measurement, and this does not do it.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { createHash } from "node:crypto";

/** One tool, as the server described it. */
export interface ToolRecord {
  name: string;
  description: string | null;
  inputSchema: unknown;
  /** Everything else the server sent for this tool, kept verbatim. */
  extra: Record<string, unknown>;
  /** sha256 over the whole tool, canonically serialised. */
  hash: string;
  /** sha256 over the description alone. Null when there is none. */
  descriptionHash: string | null;
  /** sha256 over the input schema alone. Null when there is none. */
  schemaHash: string | null;
}

export interface Capture {
  package: string;
  version: string;
  capturedAt: string;
  count: number;
  tools: ToolRecord[];
}

/**
 * JSON with object keys sorted at every depth.
 *
 * A server is free to emit its schema's keys in any order, and two orderings
 * of the same schema are the same schema. Hashing the raw text would report a
 * change every time a serialiser changed its mind.
 */
export function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
    .join(",")}}`;
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** One tool from the wire into a record with its three hashes. */
export function recordOf(tool: Record<string, unknown>): ToolRecord {
  const name = String(tool.name ?? "");
  const description = typeof tool.description === "string" ? tool.description : null;
  const inputSchema = "inputSchema" in tool ? tool.inputSchema : null;
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(tool)) if (!["name", "description", "inputSchema"].includes(k)) extra[k] = v;
  return {
    name,
    description,
    inputSchema,
    extra,
    hash: sha(canonical(tool)),
    descriptionHash: description === null ? null : sha(description),
    schemaHash: inputSchema === null || inputSchema === undefined ? null : sha(canonical(inputSchema)),
  };
}

/**
 * Accept the shapes a tool list arrives in.
 *
 * Somebody sending a list to compare will have copied it from wherever it was
 * convenient: the whole JSON-RPC reply, the `result` object, a bare array, or
 * a file with a `tools` key. All four are the same list, and refusing three of
 * them would just mean the sender reformats by hand and makes a mistake.
 */
export function parseToolList(value: unknown): Record<string, unknown>[] {
  const asArray = (v: unknown): Record<string, unknown>[] | null => {
    if (!Array.isArray(v)) return null;
    if (!v.every((x) => x && typeof x === "object" && typeof (x as any).name === "string")) return null;
    return v as Record<string, unknown>[];
  };
  const direct = asArray(value);
  if (direct) return direct;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    for (const path of [o.tools, (o.result as any)?.tools, (o.message as any)?.result?.tools]) {
      const hit = asArray(path);
      if (hit) return hit;
    }
  }
  throw new Error("no tool list found: expected an array of tools, or an object with tools, result.tools or message.result.tools");
}

/**
 * The tools/list reply out of a stored session, matched by JSON-RPC id.
 *
 * Not "the last message with a tools key": servers interleave notifications,
 * and a log line that happens to carry one would be taken for the answer.
 */
export function toolsFromSession(session: Record<string, any>): Record<string, unknown>[] | null {
  const transcript = (session?.transcript ?? []) as Array<Record<string, any>>;
  let id: unknown;
  for (const e of transcript) {
    if (e.dir === "to-server" && e.message?.method === "tools/list" && "id" in (e.message ?? {})) {
      id = e.message.id;
      break;
    }
  }
  if (id === undefined) return null;
  for (const e of transcript) {
    if (e.dir === "from-server" && e.message?.id === id && e.message?.result?.tools) {
      return parseToolList(e.message.result.tools);
    }
  }
  return null;
}

export function captureFrom(pkg: string, version: string, tools: Record<string, unknown>[], when: string): Capture {
  const records = tools.map(recordOf).sort((a, b) => a.name.localeCompare(b.name));
  return { package: pkg, version, capturedAt: when, count: records.length, tools: records };
}

/* ── Comparing two captures ─────────────────────────────────────────────── */

export interface ToolChange {
  name: string;
  what: Array<"description" | "input schema" | "other fields">;
  before?: { description: string | null };
  after?: { description: string | null };
}

export interface ToolDiff {
  added: string[];
  removed: string[];
  changed: ToolChange[];
  /** Same name, same hash: nothing moved. */
  unchanged: number;
}

export function diffTools(a: ToolRecord[], b: ToolRecord[]): ToolDiff {
  const byName = (xs: ToolRecord[]) => new Map(xs.map((t) => [t.name, t]));
  const A = byName(a);
  const B = byName(b);
  const added = [...B.keys()].filter((n) => !A.has(n)).sort();
  const removed = [...A.keys()].filter((n) => !B.has(n)).sort();
  const changed: ToolChange[] = [];
  let unchanged = 0;
  for (const [name, x] of A) {
    const y = B.get(name);
    if (!y) continue;
    if (x.hash === y.hash) {
      unchanged++;
      continue;
    }
    const what: ToolChange["what"] = [];
    if (x.descriptionHash !== y.descriptionHash) what.push("description");
    if (x.schemaHash !== y.schemaHash) what.push("input schema");
    /* The hash moved but neither of the two named parts did, so it was one of
     * the fields we do not single out — annotations, _meta, anything new. */
    if (!what.length) what.push("other fields");
    changed.push({ name, what, before: { description: x.description }, after: { description: y.description } });
  }
  changed.sort((p, q) => p.name.localeCompare(q.name));
  return { added, removed, changed, unchanged };
}

/** First line that differs, for showing a reworded description without dumping it. */
export function firstDifference(a: string | null, b: string | null): { at: number; before: string; after: string } | null {
  if (a === b) return null;
  const x = (a ?? "").split("\n");
  const y = (b ?? "").split("\n");
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] !== y[i]) return { at: i + 1, before: x[i] ?? "(no line)", after: y[i] ?? "(no line)" };
  }
  return null;
}

const clip = (s: string, n = 150) => (s.length > n ? s.slice(0, n) + " …" : s);

/** The tool diff as plain text. Facts, and what it does not say. */
export function renderToolDiff(pkg: string, va: string, vb: string, d: ToolDiff, opts: { full?: boolean } = {}): string {
  const out: string[] = [];
  out.push(`${pkg}: tool surface, ${va} -> ${vb}`);
  out.push("");
  out.push(
    `${d.added.length} added, ${d.removed.length} removed, ${d.changed.length} changed, ${d.unchanged} identical.`,
  );
  if (d.added.length) {
    out.push("");
    out.push(`Added:`);
    for (const n of d.added) out.push(`  + ${n}`);
  }
  if (d.removed.length) {
    out.push("");
    out.push(`Removed:`);
    for (const n of d.removed) out.push(`  - ${n}`);
  }
  if (d.changed.length) {
    out.push("");
    out.push(`Changed, same name:`);
    for (const c of d.changed) {
      out.push(`  ${c.name}: ${c.what.join(" and ")}`);
      if (c.what.includes("description")) {
        const fd = firstDifference(c.before?.description ?? null, c.after?.description ?? null);
        const la = (c.before?.description ?? "").length;
        const lb = (c.after?.description ?? "").length;
        out.push(`      description ${la} -> ${lb} characters`);
        if (fd && !opts.full) {
          out.push(`      first line that differs (line ${fd.at}):`);
          out.push(`        before: ${clip(fd.before)}`);
          out.push(`        after:  ${clip(fd.after)}`);
        } else if (opts.full) {
          out.push(`      before: ${c.before?.description ?? "(none)"}`);
          out.push(`      after:  ${c.after?.description ?? "(none)"}`);
        }
      }
    }
  }
  out.push("");
  out.push(`What this does not say: no tool was called, so nothing here is about what any of these do.`);
  out.push(`A description is what the server says about its own tool; this compares that text and does not`);
  out.push(`judge it. Both lists were taken in one configuration, with the same fake credentials and no`);
  out.push(`settings, so a tool list that varies by configuration was seen once.`);
  return out.join("\n");
}
