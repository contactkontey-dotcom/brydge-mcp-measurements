import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

/*
 * ═══════════════════════════════════════════════════════════════════════════
 * ONE NUMBER THAT IS THE HARNESS ITSELF.
 *
 * A published result is only worth the calibration that came with it, and a
 * calibration is only worth anything if it was run by THE SAME harness that
 * measured the real server. So every result and every calibration carries this
 * fingerprint — a hash over the engine, the harness and the runner. The rule
 * enforced at publication is simple: a real result may go up only if a passing
 * calibration exists with the identical fingerprint. Change a line of the
 * detector and the old calibration no longer vouches for anything.
 *
 * The server specs are NOT in the fingerprint. They are data; adding the
 * eleventh server does not invalidate the calibration of the harness that
 * would measure it. Only the code that does the measuring counts.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);

/** The files that ARE the measuring instrument, relative to the repo root. */
function instrumentFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith(".ts") || name.endsWith(".cjs") || name.endsWith(".py")) out.push(full);
    }
  };
  walk(join(ROOT, "engine"));
  walk(join(ROOT, "harness"));
  out.push(join(ROOT, "measure.ts"));
  return out.filter((f) => {
    try {
      return statSync(f).isFile();
    } catch {
      return false;
    }
  });
}

/** The fingerprint of the measuring instrument as it is on disk now. */
export function fingerprint(): { digest: string; files: Array<{ path: string; sha256: string }> } {
  const files = instrumentFiles()
    .map((f) => ({ path: relative(ROOT, f).replaceAll("\\", "/"), sha256: createHash("sha256").update(readFileSync(f)).digest("hex") }))
    .sort((a, b) => (a.path < b.path ? -1 : 1));
  const digest = createHash("sha256").update(files.map((f) => `${f.path}:${f.sha256}`).join("\n")).digest("hex");
  return { digest, files };
}
