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
import { firstDifference, type ToolDiff } from "./tools.ts";
import type { Diff } from "./versiondiff.ts";

/*
 * HOW MUCH OF A DESCRIPTION AN ALERT CARRIES.
 *
 * A description is the sentence a model reads before deciding whether to call
 * a tool, so "the description changed" is not the useful part — what it now
 * says is. But this message is read at speed, often on a phone, and 8 changed
 * descriptions at full length is several thousand characters.
 *
 * So: both texts for the first few, clipped, with the character counts either
 * side so the reader can see what was cut, and the rest named. Nothing is
 * dropped in silence; a count and a name is always printed for every tool.
 */
const SHOW_TEXT_FOR = 5;
const CLIP_AT = 300;

function clip(v: string | null, n: number): string {
  if (v === null) return "(none)";
  return v.length <= n ? v : `${v.slice(0, n)}… [clipped, ${v.length} characters in all]`;
}

/** The first character position at which two strings differ, or null. */
export function firstDifferingCharacter(a: string | null, b: string | null): number | null {
  if (a === b) return null;
  const x = a ?? "";
  const y = b ?? "";
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) if (x[i] !== y[i]) return i + 1;
  return n + 1;
}

/** Indent a block of text so a multi-line description stays inside its entry. */
function indent(v: string, by: string): string {
  return v.split("\n").map((l) => `${by}${l}`).join("\n");
}

export interface AlertInput {
  package: string;
  /**
   * The version being compared against. Described as approved ONLY when
   * `check` is present, because that is the only case where a list exists.
   * Saying "you approved 2.0.0" to somebody who approved nothing is a false
   * statement about their own decision, in the one piece of this designed to
   * be forwarded — and the reader cannot check it from the message.
   */
  approved: string;
  /** The newly published version that was measured. */
  found: string;
  /** When the new version was measured, as a plain date. */
  measuredOn: string;
  /** The version-to-version comparison, if both versions were measured twice. */
  diff?: Diff | null;
  /**
   * The tool-by-tool comparison, when both versions have a stored capture.
   *
   * `diff` cannot answer this: its "tools offered" field is a set of NAMES,
   * so a tool that kept its name and changed what it says about itself does
   * not appear there at all.
   */
  tools?: ToolDiff | null;
  /**
   * Why there is no tool-by-tool comparison, when there is none.
   *
   * Printed. An alert that simply omits the section reads as "no description
   * changed", and this is the piece of the system that gets forwarded and
   * quoted away from anything that would correct it.
   */
  toolsWhy?: string | null;
  /** The new version checked against the approved list, if there is one. */
  check?: Check | null;
  /** Where the full report can be read, if it is published anywhere. */
  reportUrl?: string | null;
}

const bullets = (items: string[], indent = "  ") => items.map((i) => `${indent}${i}`);

/** The alert as plain text. */
export function renderAlert(a: AlertInput): string {
  const out: string[] = [];
  out.push(
    a.check
      ? `${a.package}: version ${a.found} published. You approved ${a.approved}.`
      : `${a.package}: version ${a.found} published. Compared against ${a.approved}, which is not on an approved list.`,
  );
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
  const t = a.tools ?? null;
  const d = a.diff ?? null;
  /*
   * The tool-by-tool comparison does not depend on the behaviour diff.
   *
   * It is built from the stored captures, and a version can have captures
   * without having the two agreeing runs a `Diff` needs. Nesting this inside
   * `if (a.diff)` meant an alert could hold every changed description and
   * print none of them.
   */
  if (d || t || a.toolsWhy) {
    const span = d ? `${d.a} AND ${d.b}` : `${a.approved} AND ${a.found}`;
    const toolsMoved = !!t && (t.added.length > 0 || t.removed.length > 0 || t.changed.length > 0);

    if (d && d.outcome !== "compared") {
      out.push(`BETWEEN ${span}: ${d.says}`);
    } else if (d && !d.changes.length && !toolsMoved && !a.toolsWhy) {
      out.push(`BETWEEN ${span}: nothing changed in the fields that could be compared.`);
    } else {
      out.push(`BETWEEN ${span}:`);
    }

    /*
     * WHAT A TOOL SAYS ABOUT ITSELF COMES FIRST.
     *
     * A name appearing or disappearing is visible to anybody who lists the
     * tools. A tool that kept its name and changed the sentence a model
     * reads before calling it is the thing nobody sees without comparing,
     * so it is the thing this message leads with.
     */
    if (t) {
      /*
       * One tool, one entry. A tool whose description AND input schema both
       * moved is reported under the description — the text is the part a
       * reader can weigh — and its entry says the schema moved too. The
       * schema section then holds only the tools the description section
       * does not, so no name is printed twice and no fact is lost. The
       * totals are stated in the headings, so the partition cannot be
       * mistaken for the count.
       */
      const describe = t.changed.filter((c) => c.what.includes("description"));
      const schemaOnly = t.changed.filter((c) => !c.what.includes("description") && c.what.includes("input schema"));
      const otherOnly = t.changed.filter((c) => !c.what.includes("description") && !c.what.includes("input schema"));
      const schemaTotal = t.changed.filter((c) => c.what.includes("input schema")).length;

      if (describe.length) {
        out.push("");
        out.push(
          `  DESCRIPTIONS CHANGED: ${describe.length} tool${describe.length === 1 ? "" : "s"}` +
            `${schemaTotal ? `, and ${schemaTotal} tool${schemaTotal === 1 ? " has" : "s have"} a changed input schema` : ""}.`,
        );
        describe.forEach((c, i) => {
          const before = c.before?.description ?? null;
          const after = c.after?.description ?? null;
          const also = c.what.includes("input schema") ? " The input schema also changed." : "";
          out.push(`    ${c.name}: the description changed.${also}`);
          if (i < SHOW_TEXT_FOR) {
            out.push(`      before (${before === null ? "none" : `${before.length} characters`}):`);
            out.push(indent(clip(before, CLIP_AT), "        "));
            out.push(`      after (${after === null ? "none" : `${after.length} characters`}):`);
            out.push(indent(clip(after, CLIP_AT), "        "));
            /*
             * WHERE THE CHANGE IS, WHEN THE CLIP DOES NOT SHOW IT.
             *
             * create_upload_ticket's two descriptions are 1436 and 1627
             * characters and the first is a prefix of the second. Clipped at
             * 300 they print as two identical paragraphs, and a reader is
             * left to conclude the alert is wrong. Saying where the texts
             * diverge costs one line and is the difference between a clip
             * and a misleading one.
             */
            const appended = before !== null && after !== null && after.startsWith(before);
            const trimmed = before !== null && after !== null && before.startsWith(after);
            const at = firstDifferingCharacter(before, after);
            const fd = firstDifference(before, after);
            if (appended) {
              out.push(`      the later text is the earlier one with ${after.length - before.length} characters added at the end`);
            } else if (trimmed) {
              out.push(`      the later text is the earlier one with ${before.length - after.length} characters removed from the end`);
            } else if (at !== null && at > CLIP_AT) {
              out.push(`      the two texts are identical up to character ${at - 1}; they first differ past the clip, at character ${at}`);
            } else if (fd && fd.at > 1) {
              out.push(`      first line that differs: line ${fd.at}`);
            }
          }
        });
        if (describe.length > SHOW_TEXT_FOR) {
          out.push(
            `    The ${describe.length - SHOW_TEXT_FOR} above without their text are named but not quoted here; ` +
              `both texts are in the full comparison.`,
          );
        }
      }

      if (schemaOnly.length) {
        out.push("");
        out.push(
          `  INPUT SCHEMAS CHANGED, description unchanged: ${schemaOnly.length} tool${schemaOnly.length === 1 ? "" : "s"}` +
            `${describe.length ? ` (of ${schemaTotal} with a changed input schema in all)` : ""}.`,
        );
        for (const c of schemaOnly) out.push(`    ${c.name}: the input schema changed.`);
      }

      /*
       * Tools that moved only in a field that is neither: ONE LINE, counted
       * and never listed. 47 of the kolbo pair's tools differ only in
       * `_meta`, a build artifact; 47 names in a forwarded message reads as
       * 47 changed tools, and the count with the field named reads as what
       * it is.
       */
      if (otherOnly.length) {
        const byField = new Map<string, number>();
        for (const c of otherOnly) for (const f of c.what) byField.set(f, (byField.get(f) ?? 0) + 1);
        out.push("");
        for (const [field, n] of [...byField].sort((x, y) => y[1] - x[1])) {
          out.push(`  ${n} tool${n === 1 ? "" : "s"} differ only in ${field}. Not listed individually.`);
        }
        out.push(`  That field is neither the description nor the input schema, and this does not say what in it moved.`);
      }

      if (t.added.length) {
        out.push("");
        out.push(`  TOOLS ADDED: ${t.added.length}`);
        out.push(...bullets(t.added.map((x) => `+ ${x}`), "    "));
      }
      if (t.removed.length) {
        out.push("");
        out.push(`  TOOLS REMOVED: ${t.removed.length}`);
        out.push(...bullets(t.removed.map((x) => `- ${x}`), "    "));
      }
      out.push("");
      out.push(`  ${t.unchanged} tool${t.unchanged === 1 ? "" : "s"} identical in name, description, input schema and every other field.`);
      out.push("");
    } else if (a.toolsWhy) {
      /* Said, not implied. Silence here reads as "no description changed". */
      out.push("");
      out.push(`  DESCRIPTIONS AND INPUT SCHEMAS: not compared (${a.toolsWhy}).`);
      out.push(`  Tool names are compared below. Whether any tool changed what it says about itself is not`);
      out.push(`  answered either way.`);
      out.push("");
    }

    /*
     * The behaviour fields. "tools offered" is dropped when the tool-level
     * comparison ran, because it is the same added and removed names a
     * second time under a different heading.
     */
    if (d && d.outcome === "compared") {
      for (const c of d.changes) {
        if (t && c.field === "tools offered") continue;
        out.push(`  ${c.field}`);
        out.push(...bullets(c.removed.map((x) => `- ${x}`), "    "));
        out.push(...bullets(c.added.map((x) => `+ ${x}`), "    "));
      }
    }
    if (d && d.readme === "changed") {
      out.push(`  README: the text differs between the two versions. That means the text differs and nothing more.`);
    }
    if (d && d.cannotTell.length) {
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
