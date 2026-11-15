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
import { canonical, definitionOf, normalise, recordOf, type ToolRecord } from "../tools.ts";
import { hashedOf, sha256Of, type Hashed, type State } from "./instructions.ts";

export const FORMAT = "brydge-gate-pin";
/*
 * VERSION 2 ADDS `instructions`, AND THE BUMP IS FOR THE OLD BUILD'S SAKE.
 *
 * A version-1 pin is still read: refusing it would stop every server whose
 * pin was written before this, and the gate fails closed on a pin it
 * cannot read. It is read as not covering instructions — see `State` in
 * ./instructions.ts — so an old pin can never produce a change nobody made.
 *
 * The number has to go up all the same, because an older gate reading a
 * version-2 pin would ignore an `instructions` key it knows nothing about
 * and enforce less than the pin says. Its version check refuses the whole
 * file instead, which is the direction to fail in. Upgrade the build
 * before the pin.
 */
export const FORMAT_VERSION = 2;

/** Versions this can read. Writing is always the current one. */
export const READABLE_VERSIONS = [1, 2];

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

/**
 * The instructions a pin names, and who said so.
 *
 * `null` in a pin is not the same as the key being absent: null is somebody
 * pinning that this server sends none, and absent is nobody having pinned
 * anything. Only the second is `unpinned`.
 */
export interface PinnedInstructions extends Hashed {
  how: How;
  by: string | null;
  at: string | null;
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
  /**
   * The instructions string this server was pinned with.
   *
   * Absent: nobody pinned instructions — a version-1 pin, or one written by
   * a gate that did not look. `null`: pinned as sending none. A record: the
   * string somebody pinned.
   */
  instructions?: PinnedInstructions | null;
  tools: Record<string, PinnedTool>;
}

/**
 * What a server was seen to send, as a caller reports it to a writer here.
 *
 * `{ looked: false }` is the state of every caller that predates this, and
 * writes a pin with no instructions key at all. That is deliberate: a pin
 * must not say a server sends none when nothing ever looked.
 */
export type Looked = { looked: false } | { looked: true; text: string | null };

/** Nobody looked. */
export const NOT_LOOKED: Looked = { looked: false };

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

export function pinnedToolOf(t: ToolRecord, how: How, who: { by: string | null; at: string | null; itemHash: string | null }): PinnedTool {
  /* Normalised, so the hashes stored here are the hashes of the definition
   * stored beside them — which `parse` checks, and which a gate comparing a
   * live list against this pin depends on. */
  const n = normalise(t);
  return {
    name: n.name,
    hash: n.hash,
    descriptionHash: n.descriptionHash,
    schemaHash: n.schemaHash,
    definition: definitionOf(n),
    how,
    by: who.by,
    at: who.at,
    itemHash: who.itemHash,
  };
}

/**
 * The words for an approval with no decision behind it.
 *
 * One phrase, used by every report that shows one, so a reader meets the
 * same sentence wherever it turns up.
 */
export const CARRIED_LABEL = "carried from an earlier approval";

/**
 * Whether this record is an approval carried from an earlier version.
 *
 * `how` is "approve" because somebody did approve this tool, once, at a
 * version this pin is not about; the decision lives in that version's
 * entry in watch/decisions.json and not here.
 */
export function isCarried(t: PinnedTool): boolean {
  return t.how === "approve" && t.itemHash === null && t.by === null;
}

/** The records of a pin, back as the tool records everything else here uses. */
export function recordsOf(pin: Pin): ToolRecord[] {
  return Object.values(pin.tools)
    .map((p) => recordOf(p.definition))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * What this pin says about instructions.
 *
 * The one place the three states are derived, so nothing else has to know
 * that a missing key and a null mean different things.
 */
export function instructionsStateOf(pin: Pin): State {
  if (!("instructions" in pin)) return { kind: "unpinned" };
  const i = pin.instructions;
  if (i === null || i === undefined) return { kind: "absent" };
  return { kind: "text", hash: i.hash, length: i.length };
}

/* ── Writing ────────────────────────────────────────────────────────────── */

export function serialize(pin: Pin): string {
  const tools: Record<string, PinnedTool> = {};
  for (const k of Object.keys(pin.tools).sort()) tools[k] = pin.tools[k]!;
  /* The spread keeps every key the pin has, including an `instructions` of
   * null — which JSON.stringify writes and `in` then finds again, so a pin
   * that names "none" survives a round trip as that and not as unpinned. */
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
  if (typeof p.version !== "number" || !READABLE_VERSIONS.includes(p.version)) {
    throw new NotAPin(`its format version is ${JSON.stringify(p.version)}, and this reads ${READABLE_VERSIONS.join(" or ")}`);
  }
  for (const k of ["package", "packageVersion", "pinnedAt"] as const) {
    if (typeof p[k] !== "string" || !p[k]) throw new NotAPin(`it names no ${k}`);
  }
  if (!DATE.test(p.pinnedAt!)) throw new NotAPin(`its date ${JSON.stringify(p.pinnedAt)} is not YYYY-MM-DD`);
  if (p.source !== "decisions" && p.source !== ADOPTED) throw new NotAPin(`its source is ${JSON.stringify(p.source)}`);
  if (!plain(p.tools)) throw new NotAPin("it carries no tools");

  /*
   * Instructions, if the pin names any.
   *
   * A version-1 pin carrying the key is refused rather than read: it was
   * written by something that did not know the field, so the key did not
   * come from there, and a pin somebody has edited by hand is exactly the
   * file not to guess about.
   */
  if ("instructions" in p) {
    if (p.version === 1) throw new NotAPin("its format version is 1 and it names instructions, which that version cannot");
    const i = p.instructions;
    if (i !== null) {
      const say = (why: string) => {
        throw new NotAPin(`the instructions it names ${why}`);
      };
      if (!plain(i)) say("are not a record");
      const r = i as Partial<PinnedInstructions>;
      if (typeof r.text !== "string") say("carry no text, so nothing could be shown against them");
      if (typeof r.hash !== "string" || !HEX.test(r.hash)) say("have no sha256");
      if (r.hash !== sha256Of(r.text as string)) say("have a hash that is not the hash of the text beside it");
      if (r.length !== (r.text as string).length) say(`state a length of ${JSON.stringify(r.length)} and carry ${(r.text as string).length} characters`);
      if (r.how !== "approve" && r.how !== ADOPTED) say(`say they were pinned by ${JSON.stringify(r.how)}`);
      if (r.by !== null && (typeof r.by !== "string" || !r.by)) say("have a reviewer that is not a name");
      if (r.at !== null && (typeof r.at !== "string" || !DATE.test(r.at))) say("have a date that is not YYYY-MM-DD");
      if (r.itemHash !== null && (typeof r.itemHash !== "string" || !HEX.test(r.itemHash))) say("have an itemHash that is not a sha256");
      /*
       * Kept here, where the tool rule above is not, and the asymmetry is
       * deliberate: instructions are not carried. There is no approved list
       * of names to carry them across a version, so nothing in this
       * repository writes an instructions record that says "approve" with
       * no decision behind it. One in a file is therefore not a carried
       * approval — it is a file somebody edited.
       */
      if (r.how === "approve" && r.itemHash === null && r.by === null) {
        say("say they were approved and name neither a decision nor a reviewer");
      }
    }
  }

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
    /*
     * A TOOL APPROVED WITH NO DECISION BEHIND IT IS CARRIED, AND IS READ.
     *
     * This used to be refused, which contradicted the comment on
     * `fromDecisions` two screens down: a tool on an approved list that did
     * not change between versions has no decision of its own, so its record
     * names neither a reviewer nor an item. `fromDecisions` writes exactly
     * that, and `parse` then would not read it back — so `gate pin
     * --from-decisions` could write a pin that stopped the server from
     * starting, because the gate fails closed on a pin it cannot read.
     *
     * The cost of accepting it is that a hand-edited pin claiming an
     * approval nobody made is no longer told apart here. That is paid for
     * by naming it instead: `isCarried` marks the record, and a report says
     * so in as many words, so a reader is never shown a carried approval as
     * though somebody had just signed it off.
     */
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
export function adopt(pkg: string, version: string, tools: ToolRecord[], at: string, instructions: Looked = NOT_LOOKED): Pin {
  const out: Record<string, PinnedTool> = {};
  for (const t of tools) out[t.name] = pinnedToolOf(t, ADOPTED, { by: null, at, itemHash: null });
  const pin: Pin = {
    format: FORMAT,
    version: FORMAT_VERSION,
    package: pkg,
    packageVersion: version,
    pinnedAt: at,
    source: ADOPTED,
    tools: out,
  };
  /* Only a caller that looked gets a key at all. A caller that did not is
   * every caller written before this existed, and a pin of theirs says
   * nothing about instructions rather than saying there are none. */
  if (instructions.looked) pin.instructions = adoptedInstructions(instructions.text, at);
  return pin;
}

/** An instructions record as adopted: labelled, and nobody's approval. */
export function adoptedInstructions(text: string | null, at: string): PinnedInstructions | null {
  if (text === null) return null;
  return { ...hashedOf(text), how: ADOPTED, by: null, at, itemHash: null };
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
  /** What the server was seen to send, where anything looked. */
  instructions?: Looked;
  /**
   * The decision that approved those instructions, where one did.
   *
   * Approving "none" is a real decision and is recorded as one: the pin
   * then names no instructions, by approval, and anything the server
   * sends later differs from it.
   */
  instructionsApproval?: { by: string; at: string; itemHash: string } | null;
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
  const pin: Pin = {
    format: FORMAT,
    version: FORMAT_VERSION,
    package: opts.package,
    packageVersion: opts.version,
    pinnedAt: opts.at,
    source: "decisions",
    tools: out,
  };
  const seen = opts.instructions ?? NOT_LOOKED;
  if (seen.looked) {
    const approval = opts.instructionsApproval ?? null;
    if (seen.text === null) {
      /* Nothing to carry either way: the pin names none. Who approved that
       * is recorded in watch/decisions.json against the item, not here,
       * because there is no record to hang it on. */
      pin.instructions = null;
    } else if (approval) {
      pin.instructions = { ...hashedOf(seen.text), how: "approve", by: approval.by, at: approval.at, itemHash: approval.itemHash };
    } else {
      pin.instructions = adoptedInstructions(seen.text, opts.at);
    }
  }
  return { pin, notPinned, missing };
}
