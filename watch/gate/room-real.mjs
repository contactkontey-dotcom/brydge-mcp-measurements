/*
 * ONE REAL SERVER, IN THE SEALED ROOM, WITH AND WITHOUT THE GATE.
 *
 * The server is @modelcontextprotocol/server-memory, from the install tree a
 * previous measurement left behind: nothing is installed here, and it is
 * started only inside the room, under the same unshare, tmpfs, resolver,
 * setpriv and strace every measured server gets.
 *
 * Three sessions, not two. Direct, direct again, then gated — because a
 * comparison between the direct run and the gated run means nothing until
 * the direct run has been shown to repeat. A server that answers differently
 * twice in a row cannot tell us anything about a proxy.
 *
 * The outermost process in all three is the same byte recorder, so it is not
 * a variable either.
 */
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const RUN_BASE = "/srv/brydge-measure";
const UID = 996;
const GID = 995;

/** The newest install tree a previous measurement left for this package. */
function installedBin() {
  const dirs = readdirSync(RUN_BASE)
    .filter((d) => d.startsWith("modelcontextprotocol--server-memory-"))
    .sort()
    .reverse();
  for (const d of dirs) {
    const bin = join(RUN_BASE, d, "install", "node_modules", ".bin", "mcp-server-memory");
    if (existsSync(bin)) return { bin, from: d };
  }
  return null;
}

const found = installedBin();
if (!found) {
  process.stderr.write("no install tree for @modelcontextprotocol/server-memory; nothing is installed here\n");
  process.exit(1);
}

function session(label, gated) {
  const runDir = join(RUN_BASE, `gate-real-${label}-${Date.now()}`);
  const probeDir = join(runDir, "probes");
  const copyDir = join(runDir, "gate");
  const capture = join(runDir, "capture");
  for (const d of [runDir, probeDir, join(copyDir, "watch", "gate"), capture]) mkdirSync(d, { recursive: true });
  chmodSync(runDir, 0o755);
  for (const name of ["node-probe.cjs", "sitecustomize.py", "lo-up.py"]) {
    copyFileSync(join(ROOT, "harness", "probes", name), join(probeDir, name));
    chmodSync(join(probeDir, name), 0o644);
  }
  /* Out of /home, which the room replaces with a tmpfs. */
  for (const rel of [["watch", "tools.ts"], ["watch", "gate", "transport.ts"], ["watch", "gate", "router.ts"], ["watch", "gate", "run.ts"]]) {
    copyFileSync(join(ROOT, ...rel), join(copyDir, ...rel));
  }
  copyFileSync(join(ROOT, "watch", "gate", "fixtures", "tee.mjs"), join(copyDir, "tee.mjs"));
  execFileSync("chmod", ["-R", "a+rX", copyDir]);
  execFileSync("chown", ["-R", `${UID}:${GID}`, capture]);

  const bytes = join(capture, "stdout.bin");
  const journal = join(capture, "journal.ndjson");
  const inner = gated
    ? [process.execPath, join(copyDir, "watch", "gate", "run.ts"), "--journal", journal, "--", found.bin]
    : [found.bin];
  const args = [join(copyDir, "tee.mjs"), "--out", bytes, "--", ...inner];

  const spec = {
    slug: `gate-real-${label}`,
    name: "@modelcontextprotocol/server-memory",
    registry: "local",
    version: "2.0.1",
    readmeCommand: "npx -y @modelcontextprotocol/server-memory@2.0.1",
    bin: process.execPath,
    args,
    declared: { credentials: [], tools: null, destinations: [] },
    fixtures: {},
    probes: [],
    notChecked: [],
  };
  const configPath = join(runDir, "config.json");
  writeFileSync(configPath, JSON.stringify({ spec, runDir, probeDir, bin: spec.bin, args }));
  const env = {
    PATH: `${dirname(process.execPath)}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/sbin:/usr/bin:/bin`,
    HOME: "/root",
    LANG: "C.UTF-8",
  };
  try {
    execFileSync("unshare", ["-n", "-m", process.execPath, join(ROOT, "harness", "session.ts"), configPath], {
      env,
      stdio: ["ignore", "ignore", "ignore"],
      timeout: 5 * 60_000,
    });
  } catch {
    /* the result file is what says whether it worked */
  }
  const resultPath = join(runDir, "session-result.json");
  const result = existsSync(resultPath) ? JSON.parse(readFileSync(resultPath, "utf8")) : null;
  return {
    label,
    gated,
    runDir,
    bytes: existsSync(bytes) ? readFileSync(bytes) : null,
    journal: existsSync(journal) ? readFileSync(journal, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : null,
    offered: result?.offered ?? null,
    serverInfo: result?.serverInfo ?? null,
    initError: result?.initError ?? null,
  };
}

process.stderr.write(`install tree: ${found.from}\n`);
const a = session("direct-a", false);
const b = session("direct-b", false);
const c = session("gated", true);

const sha = (buf) => (buf ? execFileSync("sha256sum", ["-"], { input: buf }).toString().slice(0, 16) : null);
const kinds = (j) => (j ? j.reduce((o, n) => ((o[n.kind] = (o[n.kind] ?? 0) + 1), o), {}) : null);

console.log(JSON.stringify({
  installTree: found.from,
  serverStartedOnlyInTheRoom: true,
  runs: [a, b, c].map((r) => ({
    label: r.label,
    gated: r.gated,
    initError: r.initError,
    serverInfo: r.serverInfo,
    toolsOffered: r.offered ? r.offered.length : null,
    stdoutBytes: r.bytes ? r.bytes.length : null,
    stdoutSha256: sha(r.bytes),
    journal: kinds(r.journal),
  })),
  control_directA_equals_directB: a.bytes && b.bytes ? a.bytes.equals(b.bytes) : null,
  directA_equals_gated: a.bytes && c.bytes ? a.bytes.equals(c.bytes) : null,
}, null, 2));
