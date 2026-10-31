/*
 * A COPY OF THE SITE THAT WORKS WHEN IT IS NOT AT A DOMAIN ROOT.
 *
 * The real site is served from `/`, so its links are absolute: `/s/x.html`,
 * `/b/x.svg`. A preview is served from some other prefix, where an absolute
 * link points at that host's root and every page 404s. So this writes a second
 * copy with the directories folded into the filenames — `s-x.html`, `b-x.svg`
 * — and the links rewritten to match, which is the one layout where every page
 * can reach every other with a bare relative name.
 *
 * It only moves and rewrites. Nothing is regenerated, so the preview cannot say
 * something the built site does not.
 */
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, "dist");
const OUT = join(HERE, "preview");

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const flat = (dir, name) => (dir ? `${dir}-${name}` : name);
const rewrite = (html) =>
  html
    .replace(/(href|src)="\/(s|b|p)\/([^"]+)"/g, (_m, attr, dir, name) => `${attr}="${dir}-${name}"`)
    .replace(/(href|src)="\/([a-z0-9.-]+\.(?:html|txt|xml|svg|png))"/g, (_m, attr, name) => `${attr}="${name}"`)
    .replace(/href="\/"/g, 'href="index.html"');

let n = 0;
for (const dir of ["", "s", "b", "p"]) {
  const from = dir ? join(DIST, dir) : DIST;
  for (const name of readdirSync(from)) {
    const src = join(from, name);
    if (statSync(src).isDirectory()) continue;
    const dest = join(OUT, flat(dir, name));
    if (name.endsWith(".html")) writeFileSync(dest, rewrite(readFileSync(src, "utf8")));
    else copyFileSync(src, dest);
    n++;
  }
}
console.error(`${n} file(s) → site/preview/ (flat, relative links)`);
