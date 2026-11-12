/*
 * ═══════════════════════════════════════════════════════════════════════════
 * THE REVIEW QUEUE NEVER REACHES THE PUBLISHED SITE.
 *
 * A review queue shows the text of somebody's tool descriptions, side by
 * side, with every character made visible. That is the right thing to put in
 * front of the person deciding whether to approve them and the wrong thing
 * to publish: watch/runs is gitignored for exactly this reason, and
 * publishing a maintainer's prose at scale is a different act from
 * publishing a measurement.
 *
 * So the review page is generated locally, outside site/dist, and these
 * checks are what stops it drifting in. They are written now, before there
 * is a page to catch, because a guard added after the fact is a guard
 * written around whatever already happened.
 *
 * NOTHING HERE READS A DESCRIPTION. The checks look for the review path's
 * own fingerprints — its delimiters, its identifiers, the files it would
 * have to read — not for anybody's text. A test that loaded the captures to
 * prove their absence would be the leak it was looking for.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { strict as assert } from "node:assert";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { CLOSE, OPEN } from "../watch/words.ts";

const ROOT = join(import.meta.dirname, "..");
const DIST = join(ROOT, "site", "dist");
const built = existsSync(DIST);

function everyFile(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...everyFile(p));
    else out.push(p);
  }
  return out;
}

const TEXTUAL = /\.(html|js|mjs|css|json|txt|svg|xml)$/i;

test("the built site exists, or these checks are known not to have run", () => {
  if (!built) return; /* the site tests skip the same way */
  assert.ok(everyFile(DIST).length > 0, "site/dist is there and empty, so nothing was checked");
});

test("no built file is a review page", { skip: !built }, () => {
  for (const f of everyFile(DIST)) {
    const name = relative(DIST, f);
    assert.ok(
      !/review|queue|decision/i.test(name),
      `${name} looks like part of the review queue and it is in the published site`,
    );
  }
});

test("no built file carries the word diff's own marks", { skip: !built }, () => {
  /*
   * The delimiters are the review path's signature: nothing else here emits
   * them, and marked-up description text cannot exist without them. One in a
   * built page means a word diff was published, whatever the file is called.
   */
  for (const f of everyFile(DIST)) {
    if (!TEXTUAL.test(f)) continue;
    const text = readFileSync(f, "utf8");
    for (const d of [OPEN, CLOSE]) {
      assert.ok(!text.includes(d), `${relative(DIST, f)} carries the word diff's delimiter`);
    }
  }
});

test("no built file carries the review path's code", { skip: !built }, () => {
  const fingerprints = ["wordDiff", "legendFor", "CELL_CAP", "markedIn", "unvisible", "categoryOf", "itemHash"];
  for (const f of everyFile(DIST)) {
    if (!TEXTUAL.test(f)) continue;
    const text = readFileSync(f, "utf8");
    for (const id of fingerprints) {
      assert.ok(!text.includes(id), `${relative(DIST, f)} carries ${id}, which belongs to the review path`);
    }
  }
});

test("the site generator cannot reach the files descriptions live in", () => {
  /* Comments stripped: this file's own prose names these paths, and so does
   * the generator's. */
  const src = readFileSync(join(ROOT, "site", "build.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  for (const p of [
    "watch/runs",
    "tools-1.json",
    "tools-2.json",
    "watch/words.ts",
    "watch/tools.ts",
    "watch/probe.ts",
    "watch/calldiff.ts",
    "watch/decisions.ts",
    "watch/review.ts",
    "approved.json",
  ]) {
    assert.ok(!src.includes(p), `site/build.ts reaches for ${p}`);
  }
});

test("published evidence carries no per-tool description", () => {
  /*
   * level1/run.ts keeps tool NAMES and drops the rest, which is why the site
   * can report a tool count and not a tool surface. This asserts that stays
   * true of what is committed: the only `description` in an evidence file is
   * the server's own, from its initialize reply, which it sends about itself.
   *
   * Keys, never values. A failure names the path and prints no prose.
   */
  const dir = join(ROOT, "level1", "evidence");
  const found: string[] = [];
  const walk = (v: unknown, path: string): void => {
    if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, `${path}/[${i}]`));
      return;
    }
    if (v === null || typeof v !== "object") return;
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (k === "description") found.push(`${path}/${k}`);
      walk(x, `${path}/${k}`);
    }
  };
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".json"))) {
    walk(JSON.parse(readFileSync(join(dir, f), "utf8")), f);
  }
  const unexpected = found.filter((p) => !/^[^/]+\/serverInfo\/description$/.test(p));
  assert.deepEqual(unexpected, [], "an evidence file carries a description that is not the server's own");
});
