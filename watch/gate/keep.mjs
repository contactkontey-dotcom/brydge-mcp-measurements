/*
 * KEEP THE RECORDED TRANSCRIPTS, BECAUSE THE SANDBOXES GO.
 *
 * A session's full message stream lives in the sandbox the harness built for
 * it. The disk policy deletes a sandbox once its evidence is stored — forty
 * of them is sixteen gigabytes — so the transcripts go with it. This copies
 * the transcript out, and nothing else: no install tree, no trace, no
 * canaries.
 *
 * watch/transcripts is gitignored, for the reason watch/runs is: every
 * message a server sent is in it, its tool descriptions included.
 *
 * Our own gate-room runs are skipped. The corpus is for replaying against
 * what real servers did, and a planted server in it would be a fixture
 * wearing a measurement's clothes.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEST = join(ROOT, "watch", "transcripts");
const SANDBOXES = "/srv/brydge-measure";

if (!existsSync(SANDBOXES)) {
  process.stderr.write(`no ${SANDBOXES}; nothing to keep\n`);
  process.exit(0);
}
mkdirSync(DEST, { recursive: true });

const index = [];
for (const sandbox of readdirSync(SANDBOXES).sort()) {
  if (sandbox.startsWith("gate-room-")) continue;
  const file = join(SANDBOXES, sandbox, "session-result.json");
  if (!existsSync(file)) continue;
  let d;
  try {
    d = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    continue;
  }
  const transcript = d.session?.transcript ?? [];
  if (!transcript.length) continue;
  const body = JSON.stringify({
    sandbox,
    slug: d.slug ?? sandbox,
    serverInfo: d.serverInfo ?? null,
    initError: d.initError ?? null,
    offered: d.offered ?? [],
    transcript,
  });
  writeFileSync(join(DEST, `${sandbox}.json`), body);
  index.push({
    file: `${sandbox}.json`,
    slug: d.slug ?? sandbox,
    entries: transcript.length,
    offered: (d.offered ?? []).length,
    sha256: createHash("sha256").update(body).digest("hex"),
  });
}
writeFileSync(
  join(DEST, "index.json"),
  JSON.stringify({ copiedFrom: `${SANDBOXES}/*/session-result.json`, sessions: index.length, index }, null, 2) + "\n",
);
process.stderr.write(`kept ${index.length} transcript(s) in ${DEST}\n`);
