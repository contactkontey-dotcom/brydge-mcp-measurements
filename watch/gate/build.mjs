/*
 * BUILDING THE GATE, SO A CLIENT DOES NOT PAY TO COMPILE IT EVERY TIME.
 *
 * Measured, which is why this exists at all. To a server's first answer,
 * median of fifteen: the server alone 30 ms, a plain-JavaScript passthrough
 * 64 ms, the gate from TypeScript source 126 ms, the gate precompiled 76 ms.
 * A second process is what any proxy costs; the 62 ms on top was Node
 * stripping types off four modules on every launch, and a client pays it
 * every session. Precompiling gives back 50 of those 62.
 *
 * tsc, which is already a devDependency. No bundler and no new dependency:
 * the remaining 11 ms is four module loads instead of one, and chasing it
 * would mean adding a build tool to a repository that has none.
 *
 * NOT HAND-WRITTEN JAVASCRIPT. The alternative was a second copy of
 * `recordOf` and `canonical` in plain JS — the drift seam this repository
 * already pays for in site/diff-client.js, where one walk exists twice and a
 * test holds the two together. That seam in the one component that sits in
 * front of somebody's running server is not a trade worth making, and it
 * would cost type checking on the most delicate code here.
 *
 * THE OUTPUT IS NOT COMMITTED. A built artefact in the repository drifts
 * from its source and nothing notices. It is gitignored, built on demand,
 * and the gate refuses to run from a build older than its sources.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
export const OUT = join(HERE, "built");

/** The sources the built gate is made of, in the order tsc is given them. */
export const SOURCES = [
  join(ROOT, "watch", "tools.ts"),
  join(ROOT, "watch", "fields.ts"),
  join(ROOT, "watch", "approved.ts"),
  join(ROOT, "watch", "versiondiff.ts"),
  join(ROOT, "watch", "words.ts"),
  join(ROOT, "watch", "schemadiff.ts"),
  join(ROOT, "watch", "decisions.ts"),
  join(ROOT, "watch", "review.ts"),
  join(ROOT, "watch", "page.ts"),
  join(ROOT, "watch", "gate", "transport.ts"),
  join(ROOT, "watch", "gate", "router.ts"),
  join(ROOT, "watch", "gate", "pin.ts"),
  join(ROOT, "watch", "gate", "report.ts"),
  join(ROOT, "watch", "gate", "run.ts"),
];

/** The entry point the client launches, once built. */
export const ENTRY = join(OUT, "gate", "run.js");

/** The newest modification time among the sources, or 0 when none are there. */
export function sourcesChangedAt() {
  let newest = 0;
  for (const f of SOURCES) {
    if (!existsSync(f)) continue;
    newest = Math.max(newest, statSync(f).mtimeMs);
  }
  return newest;
}

export function builtAt() {
  return existsSync(ENTRY) ? statSync(ENTRY).mtimeMs : 0;
}

/**
 * Whether the build may be used, and why not when it may not.
 *
 * Where the sources are absent there is nothing to compare against — that is
 * a shipped build, and it runs. Where they are present and newer, it refuses:
 * a gate quietly running last week's code is worse than one that will not
 * start, because only one of the two is noticed.
 */
export function staleness() {
  const built = builtAt();
  if (!built) return { ok: false, because: "the gate has not been built" };
  const sources = sourcesChangedAt();
  if (!sources) return { ok: true, because: null };
  if (sources > built) {
    const newer = SOURCES.filter((f) => existsSync(f) && statSync(f).mtimeMs > built).map((f) => f.slice(ROOT.length + 1));
    return { ok: false, because: `the build is older than ${newer.length} of its source(s): ${newer.join(", ")}` };
  }
  return { ok: true, because: null };
}

/**
 * Build, by default into watch/gate/built.
 *
 * `out` exists because two things wanted a build at once: the room drivers
 * copied the shared tree while the build test was deleting and remaking it,
 * and the gate in the room then died on its first line. Anything that needs
 * its own build asks for one somewhere of its own.
 */
export function build({ clean = true, out = OUT } = {}) {
  if (clean && existsSync(out)) rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  execFileSync(
    process.execPath,
    [
      join(ROOT, "node_modules", "typescript", "bin", "tsc"),
      ...SOURCES,
      "--target", "es2022",
      "--module", "nodenext",
      "--moduleResolution", "nodenext",
      "--allowImportingTsExtensions",
      "--rewriteRelativeImportExtensions",
      "--strict",
      "--skipLibCheck",
      "--newLine", "lf",
      "--outDir", out,
    ],
    { stdio: ["ignore", "pipe", "inherit"], cwd: ROOT },
  );
  const files = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else files.push(p.slice(out.length + 1));
    }
  };
  walk(out);
  return { out, entry: join(out, "gate", "run.js"), files: files.sort() };
}

if (process.argv[1] && process.argv[1].endsWith("build.mjs")) {
  const r = build();
  process.stderr.write(`gate: built ${r.files.length} file(s) -> ${r.out}\n`);
  for (const f of r.files) process.stderr.write(`  ${f}\n`);
}
