/*
 * Stage B sweep. Prints counts and hashes. Never prints a reply.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { callOnce, callableOf, loadCalls, storeCalls, verdictFor } from "./probe.ts";
import { folderOf } from "./store.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const EV = join(ROOT, "level1", "evidence");
const DRY = process.argv.includes("--dry");
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) ?? "").slice(7);
const LIMIT = Number((process.argv.find((a) => a.startsWith("--limit=")) ?? "--limit=1000").slice(8));

const targets = [];
for (const f of readdirSync(EV).filter((x) => x.endsWith(".json"))) {
  const e = JSON.parse(readFileSync(join(EV, f), "utf8"));
  const cap = join(folderOf(e.package.name, e.package.version), "tools-1.json");
  if (!existsSync(cap)) continue;
  const tools = callableOf(JSON.parse(readFileSync(cap, "utf8")).tools);
  if (tools.length) targets.push({ name: e.package.name, version: e.package.version, tools });
}
targets.sort((a, b) => b.tools.length - a.tools.length);

const total = targets.reduce((n, t) => n + t.tools.length, 0);
console.log(`SELECTED: ${total} tools across ${targets.length} servers (readOnlyHint true, no required arguments)`);
for (const t of targets) console.log(`  ${String(t.tools.length).padStart(3)}  ${t.name}@${t.version}`);
if (DRY) process.exit(0);

const chosen = (ONLY ? targets.filter((t) => t.name === ONLY) : targets).slice(0, LIMIT);
console.log(`\nCALLING: ${chosen.length} server(s), two runs each, ${chosen.reduce((n, t) => n + t.tools.length, 0) * 2} calls in all\n`);

for (const t of chosen) {
  process.stderr.write(`${t.name}@${t.version}: ${t.tools.length} tool(s) … `);
  for (const n of [1, 2]) {
    const r = await callOnce(t.name, t.version, t.tools);
    if ("failed" in r) { process.stderr.write(`run ${n} failed: ${r.failed.slice(0, 90)}\n`); break; }
    storeCalls(t.name, t.version, n, r);
    process.stderr.write(`run ${n} ok (${r.size}) `);
  }
  process.stderr.write("\n");
}

/* ── Counts ──────────────────────────────────────────────────────────── */
const tally = { identical: 0, differs: 0, "no answer": 0, missing: 0 };
const perServer = [];
for (const t of targets) {
  const a = loadCalls(t.name, t.version, 1);
  const b = loadCalls(t.name, t.version, 2);
  if (!a || !b) { tally.missing += t.tools.length; perServer.push({ ...t, note: "not called yet" }); continue; }
  const A = new Map(a.map((x) => [x.tool, x]));
  const B = new Map(b.map((x) => [x.tool, x]));
  const row = { name: t.name, version: t.version, identical: 0, differs: 0, noAnswer: 0 };
  for (const name of t.tools) {
    const v = verdictFor(A.get(name), B.get(name));
    tally[v] += 1;
    if (v === "identical") row.identical++; else if (v === "differs") row.differs++; else if (v === "no answer") row.noAnswer++;
  }
  perServer.push(row);
}
console.log(`\n${"=".repeat(60)}`);
console.log(`OF ${total} SELECTED TOOLS:`);
console.log(`  identical on both runs: ${tally.identical}`);
console.log(`  differed between runs:  ${tally.differs}`);
console.log(`  no answer on a run:     ${tally["no answer"]}`);
console.log(`  not called:             ${tally.missing}`);
