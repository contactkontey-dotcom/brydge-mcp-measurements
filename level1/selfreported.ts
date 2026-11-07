/*
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT A SERVER SAYS ITS OWN VERSION IS.
 *
 * `initialize` returns a `serverInfo` with a name and a version. That version
 * is the server's own claim about itself, and it is not the version npm
 * installed: across the 67 measured servers, 45 agree and 22 do not.
 *
 * The 22 are not one kind of thing. All five of these are real, from the
 * stored evidence:
 *
 *   a default left in place   @kolbo/mcp          npm 1.128.0  says 1.0.0
 *   a build string            @negokaz/excel-mcp  npm 0.12.0   says 0.12.0-SNAPSHOT-1ff4340
 *   a truncated version       @mantine/mcp-server npm 9.7.4    says 9
 *   not a version at all      @antv/mcp-server-chart npm 0.9.10 says 0.8.x
 *   another product's version @playwright/mcp     npm 0.0.83   says 1.64.0-alpha-1790635538000
 *
 * ── What this is allowed to conclude ──────────────────────────────────────
 *
 * Nothing. A version that does not match the package is overwhelmingly an
 * oversight — a constant that stopped being updated — and nothing measured
 * here can tell that from anything else. So this reports the two strings, says
 * which one is the server's own claim, and stops. No "stale", no "wrong", no
 * "should". The reader is told the one thing that is useful and true: if you
 * ask this server which version it is, the answer will not be the npm one.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** How the server's claim stands against the version npm installed. */
export type Agreement =
  /** Byte-for-byte the same string. */
  | "same"
  /** Both present and different. */
  | "differs"
  /** The server sent no version, or no serverInfo at all. */
  | "not stated";

export interface SelfReported {
  agreement: Agreement;
  /** The version npm was asked to install. */
  packageVersion: string;
  /** Exactly what the server sent, untouched. Null when it sent none. */
  stated: string | null;
  /** The server's own name for itself, when it sent one. */
  statedName: string | null;
}

/**
 * Compare without interpreting.
 *
 * No trimming, no lower-casing, no semver parsing, no coercion. `9` is not
 * read as `9.0.0` and `0.12.0-SNAPSHOT-1ff4340` is not reduced to `0.12.0`:
 * each of those is a judgement about what the maintainer meant, and the two
 * strings are the only facts. An empty or whitespace-only version counts as
 * not stated, because a server that sent `""` has said nothing.
 */
export function selfReported(e: {
  package: { version: string };
  serverInfo: unknown;
}): SelfReported {
  const info = (e.serverInfo ?? null) as { name?: unknown; version?: unknown } | null;
  const raw = info && typeof info === "object" ? info.version : undefined;
  const stated = typeof raw === "string" && raw.trim() !== "" ? raw : null;
  const name = info && typeof info === "object" && typeof info.name === "string" && info.name.trim() !== "" ? info.name : null;
  return {
    agreement: stated === null ? "not stated" : stated === e.package.version ? "same" : "differs",
    packageVersion: e.package.version,
    stated,
    statedName: name,
  };
}

/**
 * The sentence a report page prints, or null when there is nothing to say.
 *
 * Null for "same": a server whose claim matches is the ordinary case and a
 * line about it is noise on 45 of 67 pages.
 */
export function selfReportedLine(s: SelfReported): string | null {
  if (s.agreement === "same") return null;
  if (s.agreement === "not stated") {
    return (
      `**It did not state a version.** The package measured was \`${s.packageVersion}\`. ` +
      `The server's \`initialize\` reply carried no version of its own, so there is nothing here to compare it with.`
    );
  }
  return (
    `**It reported a different version than the one installed.** npm installed \`${s.packageVersion}\`; ` +
    `the server's \`initialize\` reply said \`${s.stated}\`. That second string is the server's own claim about ` +
    `itself, not a measurement, and this does not say which is right or why they differ — only that asking this ` +
    `server which version it is does not return the version you installed.`
  );
}

/** A short form for a table cell or a list row. */
export function selfReportedShort(s: SelfReported): string | null {
  if (s.agreement === "same") return null;
  if (s.agreement === "not stated") return "states no version of its own";
  return `reports itself as ${s.stated}`;
}
