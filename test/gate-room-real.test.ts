/*
 * The gate in front of one real server, in the sealed room.
 *
 * @modelcontextprotocol/server-memory, from the install tree a previous
 * measurement left behind. Nothing is installed here and the server is
 * started only inside the room, under the same unshare, tmpfs, resolver,
 * setpriv and strace every measured server gets.
 *
 * THREE SESSIONS, NOT TWO. Direct, direct again, then gated. A comparison
 * between the direct run and the gated run says nothing until the direct run
 * has been shown to repeat: a server that answers differently twice in a row
 * could not tell us anything about a proxy either way.
 *
 * SKIPPED, NOT FAKED, where the install tree is gone — the disk policy
 * deletes a sandbox once its evidence is stored, so on most machines this
 * will skip. It needs root, and it takes about a minute.
 */
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const ROOT = join(import.meta.dirname, "..");
const RUN_BASE = "/srv/brydge-measure";

function installTree(): string | null {
  if (!existsSync(RUN_BASE)) return null;
  for (const d of readdirSync(RUN_BASE).filter((x) => x.startsWith("modelcontextprotocol--server-memory-")).sort().reverse()) {
    if (existsSync(join(RUN_BASE, d, "install", "node_modules", ".bin", "mcp-server-memory"))) return d;
  }
  return null;
}

const tree = installTree();
const canRun = tree !== null && process.getuid?.() === 0;

test("the room check can run, or is known not to have", () => {
  if (tree === null) return; /* nothing installed: nothing to run against */
  assert.equal(process.getuid?.(), 0, "the install tree is here but this is not root, so the room never ran");
});

test(
  "one real server answers a client the same whether or not the gate is in front of it",
  { skip: !canRun, timeout: 600_000 },
  () => {
    const out = execFileSync(process.execPath, [join(ROOT, "watch", "gate", "room-real.mjs")], {
      encoding: "utf8",
      timeout: 570_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const r = JSON.parse(out) as {
      runs: Array<{ label: string; gated: boolean; initError: string | null; toolsOffered: number | null; stdoutBytes: number | null; journal: Record<string, number> | null }>;
      control_directA_equals_directB: boolean | null;
      directA_equals_gated: boolean | null;
    };

    /* Every session actually started the server. */
    for (const run of r.runs) {
      assert.equal(run.initError, null, `${run.label}: the server did not initialize`);
      assert.equal(run.toolsOffered, 9, `${run.label}: the client saw a different number of tools`);
      assert.ok((run.stdoutBytes ?? 0) > 1000, `${run.label}: too little came back to compare`);
    }

    /* The control first: if this is false the comparison below means nothing. */
    assert.equal(r.control_directA_equals_directB, true, "the server does not answer the same twice, so nothing can be concluded about the gate");
    assert.equal(r.directA_equals_gated, true, "the client saw different bytes with the gate in front of the server");

    /* And the gate did see the surface it would be gating. */
    const gated = r.runs.find((x) => x.gated)!;
    assert.equal(gated.journal?.baseline, 1, "the gate did not take a baseline from the real server's tool list");
    assert.equal(gated.journal?.["fail-closed"], undefined, "a real server tripped a fail-closed");
    assert.equal(gated.journal?.["unparsed-line"], undefined, "a real server wrote something that is not a message");
  },
);
