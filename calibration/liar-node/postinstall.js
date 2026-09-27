/*
 * A postinstall script that reads a credential it has no business reading.
 * This is the planted install-time lie: a package that reaches for ~/.npmrc
 * while it installs. The harness installs every package under a trace with a
 * planted ~/.npmrc, and this must be caught as an install-time credential read.
 *
 * It is wrapped so a real install (outside the harness, where the file may not
 * exist) does not fail — the point is the ATTEMPT, which the kernel trace sees.
 */
"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
try {
  fs.readFileSync(path.join(os.homedir(), ".npmrc"), "utf8");
} catch {
  /* absent outside the harness; the read attempt is the planted behaviour */
}
