/*
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THE PIN USED TO BE.
 *
 * Approving a change rewrites the pin, and the old one is the only record of
 * what was approved before. Without a copy there is no answer to "what did
 * this look like yesterday" and no way back from an approval somebody
 * regrets — including one made by reading a description that turned out to
 * be worth holding after all.
 *
 * ── A COPY IS MADE BEFORE THE PIN IS REPLACED, NEVER AFTER ───────────────
 *
 * `archive` runs first and the caller replaces the pin only once it has
 * returned. A failed archive is a reason not to replace the pin, so the
 * caller gets the error rather than a silent miss: losing the previous pin
 * is the thing this exists to prevent.
 *
 * ── A COPY IS THE BYTES, NOT A RE-SERIALISATION ──────────────────────────
 *
 * The file is copied as it is on disk. Reading a pin and writing it out
 * again would archive this code's idea of the pin rather than the pin, and
 * the sha256 in the index would be of something nobody ever had.
 *
 * ── GOING BACK IS AN ORDINARY WRITE, AND IS ITSELF ARCHIVED ──────────────
 *
 * `rollback` archives the current pin before installing an older one, so a
 * rollback can be rolled back. The file it installs is parsed first: a pin
 * this cannot read is not put where a gate will read it, whatever it is.
 *
 * ── THESE FILES ARE SOMEBODY ELSE'S PROSE ────────────────────────────────
 *
 * A pin carries the definitions it pinned, so the history is a directory of
 * tool descriptions. It lives under the pins directory and is gitignored for
 * the reason the pins are. Nothing here prints a description: the index
 * carries names, counts, dates and hashes.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { createHash } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { NotAPin, parse, type Pin } from "./pin.ts";

/** One archived pin, read from the file and its name. */
export interface Archived {
  /** The file, absolute or as the caller gave the pin path. */
  file: string;
  /** The name on disk, which carries the time it was archived. */
  name: string;
  /** When the copy was made, from the file name. */
  archivedAt: string;
  /** sha256 of the archived bytes. */
  sha256: string;
  bytes: number;
  /* From the pin itself, where it can still be read. */
  package: string | null;
  packageVersion: string | null;
  pinnedAt: string | null;
  source: string | null;
  tools: number | null;
  /** Why it cannot be read, where it cannot. Such a copy is kept, not hidden. */
  unreadable: string | null;
}

/**
 * Where the copies of one pin live: a directory named after the pin file,
 * beside it.
 *
 * Named after the file rather than the package so that two pins in the same
 * directory cannot share a history, and so that the name needs no escaping
 * beyond what pathFor already did.
 */
export function historyDir(pinFile: string): string {
  return join(dirname(pinFile), "history", basename(pinFile).replace(/\.json$/, ""));
}

const STAMP = /^(\d{8}T\d{6}(?:\.\d{3})?Z)-([0-9a-f]{8})\.json$/;

/** A file name that sorts by time and carries the content it holds. */
function nameFor(at: Date, sha: string): string {
  const s = at.toISOString().replace(/[-:]/g, "").replace(/\.(\d{3})Z$/, ".$1Z");
  return `${s}-${sha.slice(0, 8)}.json`;
}

/** The time in an archived file's name, as it is written there. */
function stampOf(name: string): string | null {
  const m = STAMP.exec(name);
  if (!m) return null;
  const s = m[1]!;
  /* 20261113T074500.000Z back to something a person and a Date can read. */
  const iso = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}${s.slice(15).replace(/Z$/, "")}Z`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

/**
 * Copy the pin at `file` into its history, and say where it went.
 *
 * Returns null when there is nothing there to copy — a first pin has no
 * previous one, which is not a failure. Throws when there is a pin and the
 * copy could not be made, because then the caller must not replace it.
 *
 * The same pin archived twice in the same millisecond lands on the same
 * name, and the second write is skipped rather than failing: two copies of
 * identical bytes are one copy.
 */
export function archive(file: string, now: () => Date = () => new Date()): { file: string; sha256: string } | null {
  if (!existsSync(file)) return null;
  const body = readFileSync(file);
  const sha = createHash("sha256").update(body).digest("hex");
  const dir = historyDir(file);
  mkdirSync(dir, { recursive: true });
  const target = join(dir, nameFor(now(), sha));
  if (existsSync(target) && createHash("sha256").update(readFileSync(target)).digest("hex") === sha) {
    return { file: target, sha256: sha };
  }
  /* The same temp-then-rename the pin write uses: a reader of the history
   * never sees half a file. */
  const temp = `${target}.writing-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  const fd = openSync(temp, "wx");
  try {
    writeSync(fd, body);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(temp, target);
  } catch (e) {
    try {
      unlinkSync(temp);
    } catch {
      /* leave it */
    }
    throw e;
  }
  return { file: target, sha256: sha };
}

/** Every archived copy of this pin, newest first. */
export function list(pinFile: string): Archived[] {
  const dir = historyDir(pinFile);
  if (!existsSync(dir)) return [];
  const out: Archived[] = [];
  for (const name of readdirSync(dir)) {
    const at = stampOf(name);
    if (at === null) continue; /* not one of ours, and not touched */
    const file = join(dir, name);
    let body: Buffer;
    try {
      body = readFileSync(file);
    } catch {
      continue;
    }
    const row: Archived = {
      file,
      name,
      archivedAt: at,
      sha256: createHash("sha256").update(body).digest("hex"),
      bytes: statSync(file).size,
      package: null,
      packageVersion: null,
      pinnedAt: null,
      source: null,
      tools: null,
      unreadable: null,
    };
    try {
      const pin = parse(body.toString("utf8"));
      row.package = pin.package;
      row.packageVersion = pin.packageVersion;
      row.pinnedAt = pin.pinnedAt;
      row.source = pin.source;
      row.tools = Object.keys(pin.tools).length;
    } catch (e) {
      /* Kept and shown as unreadable. A copy that cannot be parsed is still
       * evidence of what was on disk, and hiding it would be worse. */
      row.unreadable = e instanceof NotAPin ? e.message : (e as Error).message;
    }
    out.push(row);
  }
  return out.sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
}

export class NoSuchArchive extends Error {}

/**
 * Put an archived pin back, archiving what is there now first.
 *
 * `which` is 1 for the most recent copy, 2 for the one before it, or an
 * archived file's name. The pin installed is parsed before it is written, so
 * nothing a gate would refuse to read is put where a gate will read it.
 */
export function rollback(
  pinFile: string,
  which: number | string,
  now: () => Date = () => new Date(),
): { installed: Archived; pin: Pin; archivedCurrent: { file: string; sha256: string } | null } {
  const rows = list(pinFile);
  if (!rows.length) throw new NoSuchArchive(`there is no history for ${pinFile}`);
  const row =
    typeof which === "number"
      ? rows[which - 1]
      : rows.find((r) => r.name === which || r.file === which);
  if (!row) {
    throw new NoSuchArchive(
      typeof which === "number"
        ? `there are ${rows.length} archived pin(s) for ${pinFile} and no number ${which}`
        : `no archived pin for ${pinFile} is called ${JSON.stringify(which)}`,
    );
  }
  if (row.unreadable) throw new NotAPin(`the archived pin ${row.name} cannot be used: ${row.unreadable}`);

  const body = readFileSync(row.file, "utf8");
  /*
   * Parsed again, after the listing already parsed it.
   *
   * Not redundant: the listing read the file a moment ago and this reads it
   * now, and between the two somebody could have replaced it. Either check
   * alone refuses a file that is not a pin, which is why no single-line
   * change to one of them is caught by a test — what the test asserts is
   * the property, that nothing which is not a pin is installed.
   */
  const pin = parse(body);

  const archivedCurrent = archive(pinFile, now);

  /* Written the way a pin is written: temp, flush, rename over. The bytes
   * are the archived bytes, not a re-serialisation of them. */
  mkdirSync(dirname(pinFile), { recursive: true });
  const temp = `${pinFile}.writing-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  const fd = openSync(temp, "wx");
  try {
    writeSync(fd, body);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(temp, pinFile);
  } catch (e) {
    try {
      unlinkSync(temp);
    } catch {
      /* leave it */
    }
    throw e;
  }
  return { installed: row, pin, archivedCurrent };
}

/** The history, for a person, in lines. Counts and names only. */
export function renderHistory(pinFile: string, rows: Archived[]): string {
  const out: string[] = [];
  out.push(`The pin at ${pinFile}`);
  if (!rows.length) {
    out.push("");
    out.push("  No previous version has been archived. One is kept each time the pin is replaced.");
    return out.join("\n");
  }
  out.push(`${rows.length} archived version(s), newest first:`);
  out.push("");
  rows.forEach((r, i) => {
    const n = String(i + 1).padStart(3);
    if (r.unreadable) {
      out.push(`${n}  ${r.archivedAt}  ${r.bytes} bytes  CANNOT BE READ: ${r.unreadable}`);
      return;
    }
    out.push(`${n}  ${r.archivedAt}  ${r.tools} tool(s)  pinned ${r.pinnedAt}  ${r.source}  ${r.sha256.slice(0, 12)}`);
  });
  out.push("");
  out.push(`To put one back: node watch/cli.ts gate rollback <package@version> --to <number>`);
  out.push(`The pin in place now is archived first, so a rollback can be rolled back.`);
  return out.join("\n");
}
