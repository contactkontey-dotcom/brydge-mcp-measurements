/*
 * A note page prints numbers. These check they are the measured ones.
 *
 * The extract under site/notes/ is committed because Vercel has to build the
 * page, and watch/log/ is gitignored. So the extract is the one place where a
 * figure could drift away from what was measured without anybody noticing.
 * Where the record is on disk, every field is re-derived from it here.
 */
import { strict as assert } from "node:assert";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { pathFor } from "../watch/log.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const NOTES = join(ROOT, "site", "notes");

const notes = existsSync(NOTES)
  ? readdirSync(NOTES)
      /* `demo-*.json` is the comparison page's demo data, not a note extract;
       * site/build.ts skips the same prefix when it writes the note pages. */
      .filter((f) => f.endsWith(".json") && !f.startsWith("demo-"))
      .map((f) => ({ file: f, n: JSON.parse(readFileSync(join(NOTES, f), "utf8")) as Record<string, any> }))
  : [];

test("there is at least one note extract to check", () => {
  assert.ok(notes.length > 0, "site/notes/ holds no extract");
});

for (const { file, n } of notes) {
  test(`${file}: every figure is re-derived from the saved record`, (t) => {
    const rec = pathFor(n.package, n.a, n.b);
    if (!existsSync(rec)) {
      /* watch/log/ is gitignored, so a fresh checkout has no record. The
       * extract is then unverifiable here rather than wrong, and saying so is
       * better than a pass that checked nothing. */
      t.skip(`no saved record at ${rec}; run: node watch/cli.ts record ${n.package} ${n.a} ${n.b}`);
      return;
    }
    const r = JSON.parse(readFileSync(rec, "utf8"));
    const tools = r.diff.changes.find((c: any) => c.field === "tools offered");

    assert.deepEqual(n.toolsOffered, r.diff.counts.find((c: any) => c.field === "tools offered"));
    assert.deepEqual(n.added, tools?.added ?? []);
    assert.deepEqual(n.removed, tools?.removed ?? []);
    assert.equal(n.addedNamedSocial, n.added.filter((x: string) => /social/.test(x)).length);
    assert.deepEqual(n.addedNotNamedSocial, n.added.filter((x: string) => !/social/.test(x)));
    assert.equal(n.added.length, n.addedNamedSocial + n.addedNotNamedSocial.length);

    const union = [...new Set([...r.tools.descriptionChanged.map((x: any) => x.name), ...r.tools.schemaChanged])].sort();
    assert.deepEqual(n.descriptionOrSchemaChanged, union);
    assert.deepEqual(n.descriptionChanged, r.tools.descriptionChanged.map((x: any) => x.name).sort());
    assert.deepEqual(n.schemaChanged, [...r.tools.schemaChanged].sort());
    assert.equal(n.toolsUnchanged, r.tools.unchanged);

    const other: Record<string, number> = {};
    for (const o of r.tools.otherChanged) for (const p of o.pointers) other[p.pointer] = (other[p.pointer] ?? 0) + 1;
    assert.deepEqual(n.changedOnlyInOtherFields, other);
    /* The tool count is a count of tools, never the sum of the pointer
     * counts: one tool moving at two keys appears twice above. */
    assert.equal(n.changedOnlyInOtherFieldsTools, r.tools.otherChanged.length);
    if (Object.keys(other).length > 1) {
      assert.ok(
        Object.values(other).reduce((a, b) => a + b, 0) > n.changedOnlyInOtherFieldsTools,
        "the fixture no longer exercises a tool moving at several keys",
      );
    }

    assert.deepEqual(n.otherFields, r.diff.counts.filter((c: any) => c.field !== "tools offered"));
    assert.equal(n.readme, r.diff.readme);
    assert.equal(n.instrumentFingerprint, r.instrumentFingerprint);
    assert.equal(n.calibrationBacked, r.calibrationBacked);
    assert.equal(n.gap, r.gap);
    assert.deepEqual(n.measuredAt, r.measuredAt);
  });

  test(`${file}: the extract is self-consistent`, () => {
    /* Holds on a fresh checkout too, where the record is absent. */
    assert.equal(n.added.length, n.addedNamedSocial + n.addedNotNamedSocial.length);
    assert.ok(n.descriptionOrSchemaChanged.length <= n.descriptionChanged.length + n.schemaChanged.length);
    for (const name of [...n.descriptionChanged, ...n.schemaChanged]) {
      assert.ok(n.descriptionOrSchemaChanged.includes(name), `${name} missing from the union`);
    }
  });
}

/* ── The built page ────────────────────────────────────────────────────── */

const built = join(ROOT, "site", "dist", "notes");
const pages = existsSync(built) ? readdirSync(built).filter((f) => f.endsWith(".html")) : [];

for (const f of pages) {
  const html = readFileSync(join(built, f), "utf8");
  const prose = html.replace(/<[^>]+>/g, " ").toLowerCase();

  test(`${f}: says "between versions" and never "patch release"`, () => {
    assert.match(prose, /between versions/);
    assert.ok(!/patch release/.test(prose), 'the page must not say "patch release"');
    assert.ok(!/\bpatch\b/.test(prose), 'the page must not call this span a patch');
  });

  test(`${f}: carries no judging word`, () => {
    for (const w of [
      "safe", "unsafe", "suspicious", "malicious", "dangerous", "risky", "harmless",
      "legitimate", "sketchy", "concerning", "alarming", "benign", "trustworthy",
    ]) {
      assert.ok(!new RegExp(`\\b${w}\\b`).test(prose), `the page must not say "${w}"`);
    }
  });

  test(`${f}: states all four limits`, () => {
    assert.match(prose, /no tool was called/);
    assert.match(prose, /fake credentials/);
    assert.match(prose, /maker was not contacted/);
    assert.match(prose, /claims a problem/);
  });

  test(`${f}: no list item was split by the markdown renderer`, () => {
    /*
     * site/md.ts does not join a wrapped list item: a continuation line closes
     * the <ul> and becomes its own paragraph. That split all six bullets of
     * the limits section in half on the first build, and the page still read
     * as prose, so nothing else would have caught it. A paragraph that opens
     * mid-sentence is the signature.
     */
    for (const m of readFileSync(join(built, f), "utf8").matchAll(/<\/ul>\s*<p>(.)/g)) {
      const c = m[1]!;
      assert.ok(c === c.toUpperCase() || !/[a-z]/.test(c), `a paragraph after </ul> opens with "${c}": a split list item`);
    }
    /* And a bullet that ends mid-sentence is the same bug from the other end. */
    for (const m of readFileSync(join(built, f), "utf8").matchAll(/<li>(.*?)<\/li>/gs)) {
      const text = m[1]!.replace(/<[^>]+>/g, "").trim();
      if (text.includes(" ")) assert.match(text, /[.:)`]$/, `a multi-word bullet ends mid-sentence: "${text.slice(-60)}"`);
    }
  });
}
