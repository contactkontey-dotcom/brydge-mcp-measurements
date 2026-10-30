/*
 * ═══════════════════════════════════════════════════════════════════════════
 * A PACKAGE NAME IN; AN EXACT VERSION AND THE README THAT SHIPPED WITH IT OUT.
 *
 * Two deliberate choices.
 *
 * THE README COMES OUT OF THE TARBALL, not out of the registry's rendered
 * `readme` field. The tarball is the artefact the version is, pinned by an
 * integrity hash; the rendered field is a convenience that a maintainer can
 * change without publishing a version. A measurement that cites line 475 of a
 * README has to mean the bytes that shipped.
 *
 * AND THE VERSION IS RESOLVED BEFORE ANYTHING IS INSTALLED, so the report says
 * which version it is about even when `latest` moves an hour later. A caller
 * that passed no version gets whatever `latest` was at that moment, recorded.
 *
 * This runs OUTSIDE the sealed room, like the install half it precedes: a
 * registry is a network, and the sealed room has none.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface Resolved {
  /** What the caller asked for, verbatim. */
  asked: string;
  name: string;
  version: string;
  tarball: string;
  integrity: string;
  /** The README's bytes, or null when the package ships none. */
  readme: string | null;
  /** Which file in the tarball the README was read from. */
  readmeFile: string | null;
  /** How the package's own documentation says to run it, when it says. */
  bin: Record<string, string> | string | null;
}

export class CouldNotResolve extends Error {}

function npm(args: string[], cwd?: string): string {
  try {
    return execFileSync("npm", args, { cwd, encoding: "utf8", timeout: 300_000, maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    const x = e as { stderr?: string; stdout?: string; message?: string };
    throw new CouldNotResolve(`npm ${args.join(" ")} failed: ${(x.stderr || x.stdout || x.message || "").trim().slice(0, 600)}`);
  }
}

/* A README by any of the names npm packages actually use, in this order. */
const README_NAMES = ["README.md", "readme.md", "Readme.md", "README", "README.markdown", "README.rst", "README.txt"];

/**
 * Resolve a package reference and extract its README.
 *
 * @param ref `name`, `name@version`, or a scoped `@scope/name[@version]`.
 */
export function resolvePackage(ref: string): Resolved {
  /* Split a trailing @version without eating a scope's leading @. */
  const at = ref.lastIndexOf("@");
  const scoped = ref.startsWith("@");
  const hasVersion = at > 0 && !(scoped && at === 0);
  const name = hasVersion ? ref.slice(0, at) : ref;
  const wanted = hasVersion ? ref.slice(at + 1) : "latest";

  const meta = JSON.parse(npm(["view", `${name}@${wanted}`, "name", "version", "dist.tarball", "dist.integrity", "bin", "--json"])) as
    | { name: string; version: string; "dist.tarball": string; "dist.integrity": string; bin?: Record<string, string> | string }
    | Array<{ name: string; version: string }>;

  if (Array.isArray(meta)) {
    throw new CouldNotResolve(`"${ref}" matches ${meta.length} versions; pass one exactly.`);
  }

  const dir = mkdtempSync(join(tmpdir(), "level1-pack-"));
  try {
    const out = npm(["pack", `${meta.name}@${meta.version}`, "--silent", "--pack-destination", dir], dir).trim();
    const tgz = out.split(/\r?\n/).filter(Boolean).pop() ?? readdirSync(dir).find((f) => f.endsWith(".tgz"));
    if (!tgz) throw new CouldNotResolve(`npm pack produced no tarball for ${meta.name}@${meta.version}`);

    let readme: string | null = null;
    let readmeFile: string | null = null;
    for (const candidate of README_NAMES) {
      try {
        execFileSync("tar", ["-xzf", join(dir, tgz), "-C", dir, `package/${candidate}`], { stdio: ["ignore", "ignore", "ignore"], timeout: 120_000 });
        readme = readFileSync(join(dir, "package", candidate), "utf8");
        readmeFile = candidate;
        break;
      } catch {
        /* not this name; try the next */
      }
    }

    return {
      asked: ref,
      name: meta.name,
      version: meta.version,
      tarball: meta["dist.tarball"],
      integrity: meta["dist.integrity"],
      readme,
      readmeFile,
      bin: meta.bin ?? null,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * The executable the harness should start.
 *
 * `npm view bin` is the package's own declaration of what it installs, and the
 * common case is one entry. Several is also common and is not ambiguity: a
 * server frequently ships `setup` and `remove` helpers beside itself, as
 * Desktop Commander does with `setup`, `remove` and `desktop-commander`.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * TWO STATED RULES, AND THEN A REFUSAL. NO PICKING.
 *
 *   one entry                      that one
 *   several, one named as the       that one — the package's own name is the
 *   package itself                 package's own statement of which is it
 *   anything else                  could not start, naming them all
 *
 * The second rule is a convention check, not a judgement about intent: the key
 * either equals the unscoped package name or it does not. The first draft of
 * this refused Desktop Commander outright, which was correct under the rules it
 * had and useless — so the rule was made more precise rather than looser. What
 * it still will not do is take the first entry, or the shortest, or the one
 * that looks most like a server: each of those is a guess, and a guess here
 * measures the wrong program and reports it under the right name.
 */
export function executableOf(r: Resolved): { bin: string; because: string } {
  if (typeof r.bin === "string") return { bin: r.bin, because: `package.json "bin" is a single path` };
  const names = r.bin ? Object.keys(r.bin) : [];

  if (names.length === 0) {
    throw new CouldNotResolve(`${r.name}@${r.version} installs no executable (package.json has no "bin"), so there is nothing to start.`);
  }
  if (names.length === 1) return { bin: names[0], because: `package.json "bin" names exactly one executable` };

  /* `@scope/name` → `name`. */
  const own = r.name.replace(/^@[^/]+\//, "");
  const matching = names.filter((n) => n === own);
  if (matching.length === 1) {
    return {
      bin: matching[0],
      because: `package.json "bin" names ${names.length} executables (${names.join(", ")}); "${own}" matches the package's own name`,
    };
  }

  throw new CouldNotResolve(
    `${r.name}@${r.version} installs ${names.length} executables (${names.join(", ")}) and none is named "${own}"; Level 1 does not choose between them.`,
  );
}
