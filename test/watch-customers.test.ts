import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/*
 * ═══════════════════════════════════════════════════════════════════════════
 * A CUSTOMER'S LIST IS A MAP OF THEIR OWN TOOLING, IN A PUBLIC REPOSITORY.
 *
 * Every entry names a tool, a website or a program a named organisation runs
 * and has signed off on. They gave us that; they did not publish it. One
 * `git add -A` on a distracted afternoon puts it on the internet for good, and
 * a .gitignore is only a rule until somebody passes `-f`.
 *
 * So this asks git itself what is tracked, rather than trusting the ignore
 * file to have been right.
 * ═══════════════════════════════════════════════════════════════════════════
 */
const ROOT = join(import.meta.dirname, "..");
const DIR = "watch/customers";
/* The directory is gone — lists live in the private brydge-watch repo. The
 * test stays, because the thing worth asserting is that nothing under this
 * path is ever tracked, and that is just as true of a folder somebody
 * recreates by habit as of the one that used to be here. */
const ALLOWED = new Set<string>();

test("no customer list is tracked by git", () => {
  const tracked = execFileSync("git", ["ls-files", DIR], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const leaked = tracked.filter((f) => !ALLOWED.has(f));
  assert.deepEqual(leaked, [], `a customer list is in git: ${leaked.join(", ")}`);
});

test("a customer list added to that folder is ignored, including with git add", () => {
  /* The ignore rule is checked against git's own answer for a path that does
   * not exist, so the test needs no fixture and leaves nothing behind. */
  const out = execFileSync("git", ["check-ignore", "-v", `${DIR}/acme.json`], { cwd: ROOT, encoding: "utf8" });
  assert.match(out, /\.gitignore/, "a customer file would not be ignored");
  /* The pointer that replaced the folder must itself be committed. */
  const tracked = execFileSync("git", ["ls-files", "watch/CUSTOMERS.md"], { cwd: ROOT, encoding: "utf8" }).trim();
  assert.equal(tracked, "watch/CUSTOMERS.md", "the pointer explaining where the lists went is not committed");
});

test("nothing in the folder right now looks like an un-ignored customer list", () => {
  if (!existsSync(join(ROOT, DIR))) return; /* gone, which is the point */
  for (const f of readdirSync(join(ROOT, DIR))) {
    if (ALLOWED.has(`${DIR}/${f}`)) continue;
    const out = execFileSync("git", ["check-ignore", "-v", `${DIR}/${f}`], { cwd: ROOT, encoding: "utf8" });
    assert.match(out, /\.gitignore/, `${f} is in the folder and is not ignored`);
  }
});
