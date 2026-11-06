/*
 * ═══════════════════════════════════════════════════════════════════════════
 * THE SEVEN THINGS A DIFF LOOKS AT, AND WHY NOT THE OTHERS.
 *
 * Sixty-six packages were measured twice at the same version, six days apart.
 * Every field below came back byte-identical in all sixty-six. That is the
 * whole basis on which a change between two VERSIONS can be put down to the
 * package rather than to the measurement, and it is why the list is short.
 *
 * DELIBERATELY ABSENT:
 *
 *   startup timing   A wall-clock duration. It was never measured twice at one
 *                    version, and it would vary if it were. A duration moving
 *                    is not news about a package, and printing it beside real
 *                    changes would teach a reader to discount the rest.
 *   measuredAt       When we ran, not what we found.
 *   findings         Every entry carries `install:integrity`, whose evidence
 *                    embeds the version and tarball hash, so it differs on
 *                    every bump by construction and would make the diff read
 *                    as though something changed each time.
 *   fingerprint      About the instrument.
 *
 * `node` and `setpriv` are dropped from the program list by name. `setpriv` is
 * the harness's own launcher and `node` is the runtime it starts; both appear
 * in 67 of 67 measurements. They would cancel out in a comparison, but only
 * by luck — if the harness changed they would surface as a program the package
 * had "added", which would be a finding about us wearing a package's name.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** Programs the harness starts, never the package's doing. */
export const HARNESS_PROGRAMS = ["node", "setpriv"] as const;

/** The six set-valued fields, in the order a report prints them. */
export const BEHAVIOUR = [
  "tools offered",
  "websites reached",
  "programs started",
  "files written",
  "packages installed while running",
  "connection attempts",
] as const;

export type Behaviour = (typeof BEHAVIOUR)[number];

/** One measurement, reduced to what a diff may look at. */
export interface Shape {
  /** True when the server never reached the point of listing its tools. */
  couldNotStart: string | null;
  /*
   * WHETHER THE SERVER ACTUALLY ANSWERED.
   *
   * `sets["tools offered"]` is empty both when a server answered with no tools
   * and when it was never observed at all, and those are not the same fact. A
   * comparison of two unobserved runs has nothing in it, and reporting that as
   * "nothing changed" is the most confident-sounding way to say nothing.
   */
  observed: boolean;
  sets: Record<Behaviour, string[]>;
  /** Reported on its own line, never counted as a behaviour change. */
  readmeDigest: string | null;
}

const uniq = (xs: Array<string | undefined | null>) => [...new Set(xs.filter((x): x is string => Boolean(x)))].sort();

/**
 * Reduce one evidence file to the comparable shape.
 *
 * A run that could not start has empty sets AND `couldNotStart` set. The
 * emptiness is never compared on its own: a comparison that treated it as data
 * would report every tool and host as removed, which is a finding nobody
 * measured.
 */
export function shapeOf(e: Record<string, any>): Shape {
  const o = (e.observed ?? {}) as Record<string, string[] | undefined>;
  const harness = new Set<string>(HARNESS_PROGRAMS);
  return {
    couldNotStart: e.couldNotStart ? String(e.couldNotStart.stage ?? "unknown") : null,
    observed: Boolean(e.observed),
    sets: {
      "tools offered": uniq(o.offered ?? []),
      /* What the pages call "websites reached for": a name looked up, or one
       * an encrypted connection was opened to. Neither completed — the room
       * has no route off the host. */
      "websites reached": uniq([...(o.dnsNames ?? []), ...(o.tlsHosts ?? [])]),
      "programs started": uniq((o.programsStarted ?? []).filter((p) => !harness.has(p))),
      "files written": uniq(o.filesWritten ?? []),
      "packages installed while running": uniq(o.installedDuringRun ?? []),
      "connection attempts": uniq(o.connectAttempts ?? []),
    },
    readmeDigest: (e.readme?.digest as string | undefined) ?? null,
  };
}

/** Do two runs of the same version agree on everything a diff would use? */
export function agree(a: Shape, b: Shape): { ok: boolean; disagreed: string[] } {
  const disagreed: string[] = [];
  if (a.couldNotStart !== b.couldNotStart) disagreed.push("whether it started");
  if (a.observed !== b.observed) disagreed.push("whether it was observed at all");
  for (const f of BEHAVIOUR) if (a.sets[f].join("\u0000") !== b.sets[f].join("\u0000")) disagreed.push(f);
  if (a.readmeDigest !== b.readmeDigest) disagreed.push("README digest");
  return { ok: disagreed.length === 0, disagreed };
}
