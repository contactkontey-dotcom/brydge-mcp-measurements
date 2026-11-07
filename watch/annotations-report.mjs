/*
 * What the stored tool definitions say about annotations.
 *
 * Reads watch/runs/<pkg>@<version>/tools-1.json, which holds every tool as
 * the server described it. Counts only servers whose TWO captures agree,
 * because a surface nobody can reproduce is not a surface to count.
 *
 * Facts and counts. It does not say whether a hint is true: that would need
 * the tool to be called, and nothing here calls one.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RUNS = join(dirname(fileURLToPath(import.meta.url)), "runs");
const canon = (v) =>
  v === null || typeof v !== "object"
    ? JSON.stringify(v) ?? "null"
    : Array.isArray(v)
      ? `[${v.map(canon).join(",")}]`
      : `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}`;

/*
 * THE 67 MEASURED SERVERS, AT THE VERSION EACH ONE'S PAGE REPORTS.
 *
 * watch/runs also holds the extra versions the diff sweeps measured — kolbo
 * at 1.128.0 AND 1.131.2, package-registry-mcp at 2.0.0 AND 2.1.0, and so
 * on. Walking the folder counts those twice and turns 67 servers into 68
 * rows, which is how a rate quietly becomes wrong. The evidence files are
 * the authority for which package at which version is one of the 67.
 */
const EVIDENCE = join(dirname(fileURLToPath(import.meta.url)), "..", "level1", "evidence");
const slug = (n) => n.replace(/^@/, "").replace(/\//g, "--");
const measured = readdirSync(EVIDENCE)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(join(EVIDENCE, f), "utf8")))
  .map((e) => ({ key: `${slug(e.package.name)}@${e.package.version}`, name: e.package.name, version: e.package.version }))
  .sort((a, b) => a.name.localeCompare(b.name));

const rows = [];
const unusable = [];
const missing = [];
for (const m of measured) {
  const d = m.key;
  const one = join(RUNS, d, "tools-1.json");
  const two = join(RUNS, d, "tools-2.json");
  if (!existsSync(one) || !existsSync(two)) {
    missing.push(`${m.name}@${m.version}`);
    continue;
  }
  const a = JSON.parse(readFileSync(one, "utf8"));
  const b = JSON.parse(readFileSync(two, "utf8"));
  if (canon(a.tools) !== canon(b.tools)) {
    unusable.push(`${d} (the two captures disagree)`);
    continue;
  }
  const tools = a.tools;
  let anno = 0, roPresent = 0, roTrue = 0, noReq = 0, pass = 0;
  const keys = new Set();
  for (const t of tools) {
    const ann = t.extra?.annotations;
    if (ann && typeof ann === "object") {
      anno++;
      for (const k of Object.keys(ann)) keys.add(k);
      if ("readOnlyHint" in ann) {
        roPresent++;
        if (ann.readOnlyHint === true) roTrue++;
      }
    }
    const req = Array.isArray(t.inputSchema?.required) ? t.inputSchema.required : [];
    if (req.length === 0) noReq++;
    if (ann?.readOnlyHint === true && req.length === 0) pass++;
  }
  rows.push({ key: d, package: a.package, version: a.version, tools: tools.length, anno, roPresent, roTrue, noReq, pass, keys: [...keys].sort() });
}

const n = rows.length;
console.log(`MEASURED SERVERS (from level1/evidence): ${measured.length}`);
if (missing.length) {
  console.log(`No tool list captured (${missing.length}) — NOT counted below:`);
  for (const m of missing) console.log(`  ${m}`);
}
console.log();
const sum = (f) => rows.reduce((t, r) => t + f(r), 0);
const servers = (f) => rows.filter(f).length;

console.log(`SERVERS WITH A REPRODUCED TOOL LIST: ${n}`);
if (unusable.length) { console.log(`not counted (${unusable.length}):`); for (const u of unusable) console.log(`  ${u}`); }
console.log(`TOOLS IN TOTAL: ${sum((r) => r.tools)}`);
console.log();
console.log(`Servers sending an annotations object on at least one tool: ${servers((r) => r.anno > 0)} of ${n}`);
console.log(`Servers sending one on EVERY tool:                          ${servers((r) => r.anno === r.tools)} of ${n}`);
console.log(`Servers sending none at all:                                ${servers((r) => r.anno === 0)} of ${n}`);
console.log();
console.log(`Servers declaring readOnlyHint on at least one tool: ${servers((r) => r.roPresent > 0)} of ${n}`);
console.log(`Tools carrying an annotations object:  ${sum((r) => r.anno)}`);
console.log(`Tools declaring readOnlyHint at all:   ${sum((r) => r.roPresent)}`);
console.log(`Tools with readOnlyHint === true:      ${sum((r) => r.roTrue)}`);
console.log(`Tools with no required arguments:      ${sum((r) => r.noReq)}`);
console.log();
console.log(`>>> TOOLS PASSING "readOnlyHint true AND no required arguments": ${sum((r) => r.pass)}`);
console.log(`>>> SERVERS WITH AT LEAST ONE SUCH TOOL:                         ${servers((r) => r.pass > 0)} of ${n}`);
console.log();
const keys = new Set(); for (const r of rows) for (const k of r.keys) keys.add(k);
console.log(`Annotation keys seen anywhere: ${[...keys].sort().join(", ") || "(none)"}`);
console.log();
console.log("Per server, where anything is annotated:");
for (const r of rows.filter((x) => x.anno > 0).sort((x, y) => y.pass - x.pass)) {
  console.log(`  ${String(r.pass).padStart(4)} pass | ${String(r.roTrue).padStart(4)} readOnly | ${String(r.noReq).padStart(4)} no-req | ${String(r.tools).padStart(4)} tools | ${r.package}@${r.version}`);
}
console.log();
console.log(`Servers with no annotations on any tool: ${servers((r) => r.anno === 0)}`);
for (const r of rows.filter((x) => x.anno === 0)) console.log(`  ${String(r.tools).padStart(4)} tools | ${r.package}@${r.version}`);
