/*
 * ═══════════════════════════════════════════════════════════════════════════
 * THE MESSAGE SOMEBODY ACTUALLY READS, AT SPEED, POSSIBLY ON A PHONE.
 *
 * Everything else here is read by whoever asked for it. An alert arrives
 * unasked, and it is the one piece of this that will be forwarded, pasted into
 * a ticket and quoted without its context. So:
 *
 *   FACTS AND THEIR SOURCE. Every line is something a run recorded, or a
 *   difference between two such records. No inference, no severity, no score,
 *   no recommendation. The reader decides what it means; that is their job and
 *   not this program's.
 *
 *   NOTHING IS BLOCKED, AND IT SAYS SO. An alert that reads like a stop order
 *   gets treated as one. This one states plainly that nothing was held up, so
 *   nobody goes looking for the switch that turned their build red.
 *
 *   IT ENDS WITH WHAT IT DOES NOT SAY. The limits travel with the message,
 *   because the message travels: a paragraph on a website is no use once this
 *   has been pasted somewhere else. No tool was called. One configuration was
 *   seen. No connection completed.
 *
 * The words safe, unsafe, suspicious and malicious appear nowhere, and a test
 * asserts it on generated output rather than trusting this comment.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { NEW_LABEL, type Check } from "./approved.ts";
import type { Diff } from "./versiondiff.ts";

export interface AlertInput {
  package: string;
  /** The version on the approved list. */
  approved: string;
  /** The newly published version that was measured. */
  found: string;
  /** When the new version was measured, as a plain date. */
  measuredOn: string;
  /** The version-to-version comparison, if both versions were measured twice. */
  diff?: Diff | null;
  /** The new version checked against the approved list, if there is one. */
  check?: Check | null;
  /** Where the full report can be read, if it is published anywhere. */
  reportUrl?: string | null;
}

const bullets = (items: string[], indent = "  ") => items.map((i) => `${indent}${i}`);

/** The alert as plain text. */
export function renderAlert(a: AlertInput): string {
  const out: string[] = [];
  out.push(`${a.package}: version ${a.found} published. You approved ${a.approved}.`);
  out.push("");
  out.push(`Measured ${a.measuredOn}. Each version was started twice in a sealed room, asked once for its`);
  out.push(`list of tools, and compared. No tool was called.`);
  out.push("");

  /* ── What the new version showed that the list does not have ─────────── */
  if (a.check) {
    const n = a.check.newItems;
    const total = n.tools.length + n.hosts.length + n.programs.length;
    if (total === 0) {
      out.push(`AGAINST YOUR LIST: everything ${a.found} showed is on the list you approved for ${a.approved}.`);
    } else {
      out.push(`AGAINST YOUR LIST (${total} item${total === 1 ? "" : "s"} ${NEW_LABEL}):`);
      out.push(...bullets(n.tools.map((t) => `tool: ${t}`)));
      out.push(...bullets(n.hosts.map((h) => `website reached: ${h}`)));
      out.push(...bullets(n.programs.map((p) => `program started: ${p}`)));
    }
    out.push("");
  }

  /* ── What moved between the two versions ─────────────────────────────── */
  if (a.diff) {
    const d = a.diff;
    if (d.outcome !== "compared") {
      out.push(`BETWEEN ${d.a} AND ${d.b}: ${d.says}`);
    } else if (!d.changes.length) {
      out.push(`BETWEEN ${d.a} AND ${d.b}: nothing changed in the fields that could be compared.`);
    } else {
      out.push(`BETWEEN ${d.a} AND ${d.b}:`);
      for (const c of d.changes) {
        out.push(`  ${c.field}`);
        out.push(...bullets(c.removed.map((x) => `- ${x}`), "    "));
        out.push(...bullets(c.added.map((x) => `+ ${x}`), "    "));
      }
    }
    if (d.readme === "changed") {
      out.push(`  README: the text differs between the two versions. That means the text differs and nothing more.`);
    }
    if (d.cannotTell.length) {
      out.push("");
      out.push(`  Can't tell, and no change is reported: ${d.cannotTell.join(", ")}.`);
      out.push(`  A version's own two runs disagreed about these.`);
    }
    out.push("");
  }

  if (a.reportUrl) {
    out.push(`Full report and the evidence behind it: ${a.reportUrl}`);
    out.push("");
  }

  out.push(`NOTHING IS BLOCKED. No install was prevented, no build was failed and no version was withheld`);
  out.push(`from you. This is a message about a difference, and what to do about it is yours to decide.`);
  out.push("");
  out.push(`WHAT THIS DOES NOT SAY: no tool was called in any run, so nothing here is about what a tool does`);
  out.push(`or whether it does what it says. Both versions were given the same fake credentials and no`);
  out.push(`settings of their own, so a tool list that depends on configuration was seen in one configuration`);
  out.push(`only — yours may differ. A website named above was looked up or opened to; the room has no route`);
  out.push(`off the host, so no connection completed and no content was seen. A tool or website absent from`);
  out.push(`your list is a difference from what you approved, and nothing more than that.`);
  return out.join("\n");
}
