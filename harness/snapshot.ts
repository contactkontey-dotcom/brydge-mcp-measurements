import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/*
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THE SANDBOX'S FILES WERE, BEFORE AND AFTER ONE CALL.
 *
 * The disk oracle wants to say exactly which files a call created, changed or
 * removed, and it wants to be able to say "nothing, anywhere we can see" and
 * mean it. So before every call the harness records every file in the two
 * directories that matter — the one the server is allowed to work in, and the
 * one it must never touch — as a content hash, a size and a mode, and after the
 * call it does it again. The difference is the call's effect on disk.
 *
 * This is one half of the disk oracle. The other half is the kernel trace,
 * which catches a write to somewhere neither directory covers. Both are read;
 * the more damning of the two wins.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export interface FileState {
  sha256: string;
  size: number;
  mode: number;
}

/** Absolute path → its state. Missing key means the file did not exist. */
export type Snapshot = Map<string, FileState>;

function walk(dir: string, out: string[]): void {
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return; /* the directory does not exist yet; nothing to record */
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.isFile()) out.push(full);
    /* symlinks and sockets are recorded as their presence only, below */
    else out.push(full);
  }
}

/** Snapshot every file under each directory. */
export function snapshot(dirs: string[]): Snapshot {
  const map: Snapshot = new Map();
  for (const dir of dirs) {
    const files: string[] = [];
    walk(dir, files);
    for (const path of files) {
      try {
        const st = statSync(path);
        if (!st.isFile()) {
          map.set(path, { sha256: "", size: 0, mode: st.mode });
          continue;
        }
        const buf = readFileSync(path);
        map.set(path, { sha256: createHash("sha256").update(buf).digest("hex"), size: st.size, mode: st.mode });
      } catch {
        /* vanished between walk and stat: treat as absent */
      }
    }
  }
  return map;
}

export interface DiskDiff {
  created: string[];
  modified: string[];
  removed: string[];
}

/** What changed between two snapshots, paths relative to `root` for printing. */
export function diff(before: Snapshot, after: Snapshot, root: string): DiskDiff {
  const created: string[] = [];
  const modified: string[] = [];
  const removed: string[] = [];
  const rel = (p: string) => relative(root, p) || p;
  for (const [path, state] of after) {
    const was = before.get(path);
    if (!was) created.push(rel(path));
    else if (was.sha256 !== state.sha256 || was.size !== state.size) modified.push(rel(path));
  }
  for (const path of before.keys()) if (!after.has(path)) removed.push(rel(path));
  created.sort();
  modified.sort();
  removed.sort();
  return { created, modified, removed };
}
