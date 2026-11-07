/*
 * ═══════════════════════════════════════════════════════════════════════════
 * AN APPROVED LIST AS CLAUDE CODE PERMISSION LINES.
 *
 * `permissions.allow` entries, one per approved tool, in the form Claude
 * Code's own documentation gives:
 *
 *   "To match one tool, write its full name, `mcp__<server>__<tool>`."
 *
 * ── Why no wildcard line ──────────────────────────────────────────────────
 *
 * `mcp__<alias>__*` is valid, is one line instead of N, and is what most
 * people would paste. It is left out on purpose. It approves every tool the
 * server offers, including ones it did not offer when the list was approved
 * and ones a later version adds. An approved list is a record of a surface
 * somebody checked; a wildcard authorises the surface they have not seen
 * yet, which is the thing this whole project exists to notice.
 *
 * ── What the alias is ─────────────────────────────────────────────────────
 *
 * The key in the reader's own `mcpServers` config, NOT the npm package name.
 * Claude Code builds the tool identifier from the configured server name, so
 * an alias that does not match it produces lines that match nothing and
 * prompt anyway. Nothing here can check that, so the header says it plainly.
 *
 * ── Three ways the identifier goes wrong, from the documentation ──────────
 *
 *   1. "Names with characters such as `.` or spaces: those characters become
 *      `_`." So `my.server` is written `my_server`. Printing the alias as
 *      given emits lines that silently match nothing.
 *
 *   2. An alias containing `__`, or ending in `_`, cannot take the per-tool
 *      form at all: for a server named `reports__v2`, Claude Code reads
 *      `mcp__reports__v2__<tool>` as a rule for a server called `reports`.
 *      Refused rather than emitted, because the lines would look right.
 *
 *   3. "Claude Code skips any `mcp__` rule that has parentheses", and says so
 *      only in the invalid-settings dialog. A tool name carrying one is
 *      reported here instead of exported into silence.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import type { ApprovedEntry } from "./approved.ts";

/** Characters Claude Code rewrites to `_` in a server name. */
const REWRITTEN = /[^A-Za-z0-9_-]/g;

export interface Normalised {
  /** The alias as Claude Code will read it. */
  alias: string;
  /** True when that differs from what was typed. */
  rewritten: boolean;
}

/**
 * The alias as the identifier will carry it.
 *
 * Only the documented rewrite: anything outside letters, digits, `_` and `-`
 * becomes `_`. Case is left alone — the documentation does not say it is
 * folded, and guessing would produce lines that match nothing.
 */
export function normaliseAlias(alias: string): Normalised {
  const out = alias.replace(REWRITTEN, "_");
  return { alias: out, rewritten: out !== alias };
}

export interface Refusal {
  because: string;
  /** What to do instead. */
  instead: string;
}

/** Why this alias cannot take the per-tool form, or null. */
export function refuseAlias(alias: string): Refusal | null {
  if (!alias.trim()) {
    return { because: "the alias is empty", instead: "Pass --alias <name>, the key you gave this server in your config." };
  }
  const { alias: n } = normaliseAlias(alias);
  if (n.includes("__")) {
    return {
      because: `the alias "${alias}" contains "__", which is the separator Claude Code splits on`,
      instead:
        `A rule written mcp__${n}__<tool> is read as a rule for a server called ` +
        `"${n.slice(0, n.indexOf("__"))}". Use the wildcard form mcp__${n}__* for the whole server, ` +
        `or rename the server in your config.`,
    };
  }
  if (n.endsWith("_")) {
    return {
      because: `the alias "${alias}" ends in "_", so mcp__${n}__<tool> is ambiguous`,
      instead: `Use the wildcard form mcp__${n}__*, or rename the server in your config.`,
    };
  }
  return null;
}

/** Tool names Claude Code would skip or mis-read, with the reason. */
export function unusableTools(tools: string[]): Array<{ tool: string; because: string }> {
  const bad: Array<{ tool: string; because: string }> = [];
  for (const t of tools) {
    if (/[()]/.test(t)) bad.push({ tool: t, because: "contains a parenthesis; Claude Code skips any mcp__ rule that has one" });
    else if (!t.trim()) bad.push({ tool: t, because: "is empty" });
  }
  return bad;
}

export interface Exported {
  lines: string[];
  /** Everything printed, header included. */
  text: string;
  skipped: Array<{ tool: string; because: string }>;
}

/**
 * The export, or a refusal.
 *
 * Returns the whole printable text rather than printing, so a test can read
 * what a reader would paste.
 */
export function exportClaudeCode(entry: ApprovedEntry, rawAlias: string): Exported | Refusal {
  const refusal = refuseAlias(rawAlias);
  if (refusal) return refusal;

  const { alias, rewritten } = normaliseAlias(rawAlias);
  const skipped = unusableTools(entry.tools);
  const usable = entry.tools.filter((t) => !skipped.some((s) => s.tool === t)).slice().sort();
  const lines = usable.map((t) => `  "mcp__${alias}__${t}",`);

  const head = [
    `# Claude Code permissions.allow entries. For Claude Code only — this is not`,
    `# an MCP config, not a Claude Desktop setting, and not portable to any other`,
    `# client.`,
    `#`,
    `# "${alias}" must match the key you gave this server in YOUR config's`,
    `# "mcpServers" object. It is not the npm package name, and nothing here can`,
    `# check it: if the two differ, every line below matches nothing and Claude`,
    `# Code prompts anyway.`,
  ];
  if (rewritten) {
    head.push(
      `#`,
      `# You passed "${rawAlias}". Claude Code rewrites characters such as "." and`,
      `# spaces to "_" in a server name, so the lines below use "${alias}".`,
    );
  }
  head.push(
    `#`,
    `# From the approved list for ${entry.package}@${entry.version}, approved`,
    `# ${entry.approvedAt}${entry.approvedBy ? ` by ${entry.approvedBy}` : ""}. ${usable.length} tool${usable.length === 1 ? "" : "s"}.`,
    `#`,
    `# NO WILDCARD LINE. mcp__${alias}__* would be one line instead of ${usable.length}, and it`,
    `# works, but it approves every tool the server offers — including ones it did`,
    `# not offer when this list was approved, and ones a later version adds. These`,
    `# lines approve the ${usable.length} that were on the list and nothing else.`,
    `#`,
    `# WHAT APPROVING MEANS HERE. The list records what this server OFFERED when it`,
    `# was measured. No tool was ever called, so nothing in it says what any of`,
    `# these tools does. Pasting them into permissions.allow tells Claude Code not`,
    `# to ask before calling them, which is a different decision from the one the`,
    `# list recorded, and it is yours.`,
  );
  if (skipped.length) {
    head.push(`#`, `# NOT EXPORTED (${skipped.length}):`);
    for (const s of skipped) head.push(`#   ${s.tool || "(empty)"} — ${s.because}`);
  }

  return { lines, text: [...head, "", ...lines].join("\n"), skipped };
}

export function isRefusal(v: Exported | Refusal): v is Refusal {
  return "because" in v;
}
