/*
 * The preview cards are written as SVG by `build.ts`, because SVG is text and a
 * text build needs no browser. Chat clients and link unfurlers mostly will not
 * render an SVG, so this turns each one into the PNG the og:image tags point
 * at. Run it after the build; it needs a Chromium, and the build does not.
 *
 *   node site/build.ts && node site/rasterize.mjs
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pw from "/opt/node-tools/node_modules/playwright/index.js";

const DIST = join(dirname(fileURLToPath(import.meta.url)), "dist");
const P = join(DIST, "p");
const svgs = readdirSync(P).filter((f) => f.endsWith(".svg"));
if (!svgs.length) {
  console.error("no preview cards; run `node site/build.ts` first");
  process.exit(1);
}

const browser = await pw.chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
for (const f of svgs) {
  const svg = readFileSync(join(P, f), "utf8");
  await page.setContent(
    `<!doctype html><meta charset="utf-8">` +
      `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500&family=Newsreader:wght@400;500&family=IBM+Plex+Mono&display=swap">` +
      `<style>html,body{margin:0;padding:0;width:1200px;height:630px;overflow:hidden}svg{display:block}</style>${svg}`,
    { waitUntil: "load" },
  );
  await page.waitForTimeout(350); /* let the webfonts land before the shot */
  writeFileSync(join(P, f.replace(/\.svg$/, ".png")), await page.screenshot({ type: "png" }));
}
await browser.close();
console.error(`rasterised ${svgs.length} preview card(s) → site/dist/p/*.png`);
