/*
 * ═══════════════════════════════════════════════════════════════════════════
 * THE PIN: THE TOOL SURFACE SOMEBODY SIGNED OFF, BY CONTENT.
 *
 * watch/decisions.json records WHO decided WHAT, keyed by package@version. A
 * gate in a client's config cannot use that directly, for the reason the
 * whole gate exists: a description can change between calls with no version
 * bump, so "version 2.1.0 was approved" is not the unit. The pin is per tool
 * and by content — the three hashes watch/tools.ts already computes.
 *
 * ── IT CARRIES THE DEFINITIONS, NOT ONLY THE HASHES ──────────────────────
 *
 * A hash answers "this differs" and nothing else. To show a reviewer WHICH
 * WORDS moved, the text that was pinned has to be there to diff against, so
 * the pin holds each definition as it was approved. That makes a pin a file
 * of somebody else's prose, which is why watch/gate/pins is gitignored for
 * the same reason watch/runs is.
 *
 * ── EVERY TOOL SAYS HOW IT CAME TO BE PINNED ─────────────────────────────
 *
 * Either a decision approved it — and the record carries the reviewer, the
 * date and the `itemHash` of the decision in watch/decisions.json, so the
 * two files can be read against each other — or it was adopted from what a
 * server was offering at the time, which is labelled `adopted, not reviewed`
 * and is not an approval. A gate that let the second read like the first
 * would be a gate whose pin means nothing.
 *
 * ── READING ONE IS STRICT, AND FAILING IS CLOSED ─────────────────────────
 *
 * Every field of every record is checked, and anything that is not a pin is
 * refused by name. A gate that cannot read its pin does not start the
 * server: starting it is the risk — startup is when a server reads
 * credentials, which is this project's own Level 1 finding — and a gate that
 * cannot know what was approved has nothing to offer in exchange for taking
 * that risk.
 *
 * ── WRITING ONE IS ATOMIC ────────────────────────────────────────────────
 *
 * Written to a temporary file in the same directory, flushed, then renamed
 * over the old one. A crash mid-write leaves the old pin, not half a pin,
 * and a reader never sees a partial file. This module does the write because
 * the write is the part that can destroy the record.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";
import { canonical, recordOf, type ToolRecord } from "../tools.ts";

export const FORMAT = "brydge-gate-pin";
export const FORMAT_VERSION = 1;

/** The label for a surface nobody reviewed. Used wherever such a pin is shown. */
export const ADOPTED = "adopted, not reviewed";

export type How = "approve" | typeof ADOPTED;

export interface PinnedTool {
  name: string;
  hash: string;
  descriptionHash: string | null;
  schemaHash: string | null;
  /** The definition as it was pinned, so a later difference can be shown. */
  definition: Record<string, unknown>;
  how: How;
  /** Who decided, and when, where a decision did. */
  by: string | null;
  at: string | null;
  /** The decision in watch/decisions.json this came from, where one did. */
  itemHash: string | null;
}

export interface Pin {
  format: string;
  version: number;
  /** The identity the operator states. A command line is not one. */
  package: string;
  packageVersion: string;
  pinnedAt: string;
  /** Where the whole pin came from, for the one line a report has to carry. */
  source: "decisions" | typeof ADOPTED;
  tools: Record<string, PinnedTool>;
}

export class NotAPin extends Error {}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const HEX = /^[0-9a-f]{64}$/;
const plain = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/** The file a pin for this identity lives in. */
export function pathFor(dir: string, pkg: string, version: string): string {
  /* One path segment, whatever the package is called: every character a
   * path could use becomes "--", so the result is always a file directly in
   * `dir` and never anywhere else. */
  const segment = `${pkg}@${version}`.replace(/[^A-Za-z0-9._@-]+/g, "--");
  return join(dir, `${segment}.json`);
}

/** A tool's definition as the server sent it, without our derived hashes. */
export function definitionOf(t: ToolRecord): Record<string, unknown> {
  return { name: t.name, description: t.description, inputSchema: t.inputSchema ?? null, ...t.extra };
}

export function pinnedToolOf(t: ToolRecord, how: How, who: { by: string | null; at: string | null; itemHash: string | null }): PinnedTool {
  return {
    name: t.name,
    hash: t.hash,
    descriptionHash: t.descriptionHash,
    schemaHash: t.schemaHash,
    definition: definitionOf(t),
    how,
    by: who.by,
    at: who.at,
    itemHash: who.itemHash,
  };
}

/** The records of a pin, back as the tool records everything else here uses. */
export function recordsOf(pin: Pin): ToolRecord[] {
  return Object.values(pin.tools)
    .map((p) => recordOf(p.definition))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/* ── Writing ────────────────────────────────────────────────────────────── */

export function serialize(pin: Pin): string {
  const tools: Record<string, PinnedTool> = {};
  for (const k of Object.keys(pin.tools).sort()) tools[k] = pin.tools[k]!;
  return JSON.stringify({ ...pin, tools }, null, 2) + "\n";
}

/**
 * Write a pin where nothing can read half of it.
 *
 * Same directory, so the rename is on one filesystem and is therefore
 * atomic; flushed before the rename, so a machine that loses power has
 * either the old pin or the new one.
 */
export function write(file: string, pin: Pin): void {
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.writing-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  const body = serialize(pin);
  const fd = openSync(temp, "wx");
  try {
    writeSync(fd, body);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(temp, file);
  } catch (e) {
    try {
      unlinkSync(temp);
    } catch {
      /* leave it; the old pin is intact either way */
    }
    throw e;
  }
}

/* ── Reading ────────────────────────────────────────────────────────────── */

/** Parse a pin, refusing anything that is not one, by name. */
export function parse(text: string): Pin {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new NotAPin(`it is not JSON: ${(e as Error).message}`);
  }
  if (!plain(raw)) throw new NotAPin("it is not an object");
  const p = raw as Partial<Pin>;
  if (p.format !== FORMAT) throw new NotAPin(`its format is ${JSON.stringify(p.format)}, not ${JSON.stringify(FORMAT)}`);
  if (p.version !== FORMAT_VERSION) throw new NotAPin(`its format version is ${JSON.stringify(p.version)}, and this reads ${FORMAT_VERSION}`);
  for (const k of ["package", "packageVersion", "pinnedAt"] as const) {
    if (typeof p[k] !== "string" || !p[k]) throw new NotAPin(`it names no ${k}`);
  }
  if (!DATE.test(p.pinnedAt!)) throw new NotAPin(`its date ${JSON.stringify(p.pinnedAt)} is not YYYY-MM-DD`);
  if (p.source !== "decisions" && p.source !== ADOPTED) throw new NotAPin(`its source is ${JSON.stringify(p.source)}`);
  if (!plain(p.tools)) throw new NotAPin("it carries no tools");

  for (const [key, v] of Object.entries(p.tools)) {
    const say = (why: string) => {
      throw new NotAPin(`the tool at ${JSON.stringify(key)} ${why}`);
    };
    if (!plain(v)) say("is not a record");
    const t = v as Partial<PinnedTool>;
    if (typeof t.name !== "string" || !t.name) say("has no name");
    if (t.name !== key) say(`is filed under a key that is not its name, ${JSON.stringify(t.name)}`);
    if (typeof t.hash !== "string" || !HEX.test(t.hash)) say("has no sha256");
    for (const h of ["descriptionHash", "schemaHash"] as const) {
      if (t[h] !== null && (typeof t[h] !== "string" || !HEX.test(t[h] as string))) say(`has a ${h} that is neither null nor a sha256`);
    }
    if (!plain(t.definition)) say("carries no definition, so nothing could be shown against it");
    if (t.how !== "approve" && t.how !== ADOPTED) say(`says it was pinned by ${JSON.stringify(t.how)}`);
    if (t.by !== null && (typeof t.by !== "string" || !t.by)) say("has a reviewer that is not a name");
    if (t.at !== null && (typeof t.at !== "string" || !DATE.test(t.at))) say("has a date that is not YYYY-MM-DD");
    if (t.itemHash !== null && (typeof t.itemHash !== "string" || !HEX.test(t.itemHash))) say("has an itemHash that is not a sha256");
    if (t.how === "approve" && t.itemHash === null && t.by === null) {
      say("says it was approved and names neither a decision nor a reviewer");
    }
    /* The hashes must be the hashes OF the definition that is there. A pin
     * whose hashes and definitions disagree would compare one thing and show
     * another. */
    const again = recordOf(t.definition as Record<string, unknown>);
    if (again.hash !== t.hash) say("has a hash that is not the hash of the definition beside it");
    if (canonical(again.descriptionHash) !== canonical(t.descriptionHash)) say("has a descriptionHash that does not match its definition");
    if (canonical(again.schemaHash) !== canonical(t.schemaHash)) say("has a schemaHash that does not match its definition");
  }
  return raw as unknown as Pin;
}

/** Read a pin from disk, or say why there is none to read. */
export function read(file: string): Pin {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") throw new NotAPin("there is no file there");
    throw new NotAPin(`it could not be read: ${err.message}`);
  }
  if (!text.trim()) throw new NotAPin("the file is empty");
  return parse(text);
}

/* ── Making one ─────────────────────────────────────────────────────────── */

/**
 * A pin adopting whatever a server is offering now.
 *
 * Every tool is labelled `adopted, not reviewed`, which is what it is: the
 * alternative is a gate whose first run shows a server with no tools at all,
 * and an operator who concludes the thing is broken. The label travels with
 * every record and is said again in the report.
 */
export function adopt(pkg: string, version: string, tools: ToolRecord[], at: string): Pin {
  const out: Record<string, PinnedTool> = {};
  for (const t of tools) out[t.name] = pinnedToolOf(t, ADOPTED, { by: null, at, itemHash: null });
  return { format: FORMAT, version: FORMAT_VERSION, package: pkg, packageVersion: version, pinnedAt: at, source: ADOPTED, tools: out };
}

export interface FromDecisions {
  pin: Pin;
  /** Offered at that version and not on the approved list, with nothing pinned. */
  notPinned: string[];
  /** On the approved list and not in the capture, so there was nothing to pin. */
  missing: string[];
}

/**
 * A pin from an approved list and the decisions behind it.
 *
 * The approved list says which tool NAMES somebody signed off. The capture
 * says what those tools were. The decisions say who signed each one off and
 * when. A tool on the list with no decision behind it was carried — it was
 * on an earlier version's list and did not change — and its record says so
 * by naming neither a reviewer nor an item, which `parse` allows only
 * because `how` is then read from the list and not from a decision.
 */
export function fromDecisions(opts: {
  package: string;
  version: string;
  approved: string[];
  tools: ToolRecord[];
  decisions: Record<string, { by: string; at: string; itemHash: string; decision: string }>;
  at: string;
}): FromDecisions {
  const byName = new Map(opts.tools.map((t) => [t.name, t]));
  const out: Record<string, PinnedTool> = {};
  const missing: string[] = [];
  for (const name of opts.approved) {
    const t = byName.get(name);
    if (!t) {
      missing.push(name);
      continue;
    }
    /* The newest approval for this tool, whichever item it was about. */
    const mine = Object.entries(opts.decisions)
      .filter(([key, d]) => key.endsWith(`:${name}`) && d.decision === "approve")
      .map(([, d]) => d)
      .sort((a, b) => a.at.localeCompare(b.at));
    const last = mine.at(-1) ?? null;
    out[name] = pinnedToolOf(t, "approve", {
      by: last?.by ?? null,
      at: last?.at ?? null,
      itemHash: last?.itemHash ?? null,
    });
  }
  const notPinned = opts.tools.map((t) => t.name).filter((n) => !out[n]).sort();
  return {
    pin: {
      format: FORMAT,
      version: FORMAT_VERSION,
      package: opts.package,
      packageVersion: opts.version,
      pinnedAt: opts.at,
      source: "decisions",
      tools: out,
    },
    notPinned,
    missing,
  };
}
