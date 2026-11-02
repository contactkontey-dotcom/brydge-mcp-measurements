/*
 * ═══════════════════════════════════════════════════════════════════════════
 * READ A PASTED MCP CONFIG, IN THE BROWSER, AND SEND IT NOWHERE.
 *
 * An MCP config is one of the most secret-dense files a developer keeps:
 * `GITHUB_PERSONAL_ACCESS_TOKEN`, `FIGMA_API_KEY`, database URLs, all sitting
 * in `env` next to the command. Asking somebody to paste that into a website
 * asks for a great deal of trust, so this file is written to need as little of
 * it as possible:
 *
 *   1. ENV VALUES ARE DISCARDED AT PARSE TIME. `readConfig` keeps the KEYS and
 *      throws the values away before anything is rendered, so no value can
 *      reach the page, the clipboard summary, or a screenshot of either.
 *   2. NOTHING IS SENT. There is no fetch, no XMLHttpRequest, no WebSocket, no
 *      sendBeacon, no form, no storage. The page is served with
 *      `connect-src 'none'`, which the browser enforces whatever this code
 *      does — a rule rather than a promise, and the reason the promise is
 *      worth anything.
 *   3. IT IS TESTABLE. These are pure functions over a string, exported so the
 *      test suite can check that a token never survives parsing. The page
 *      inlines this same file, so what is tested is what ships.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** Runners that take a package name as an argument rather than being one. */
const RUNNERS = new Set(["npx", "pnpx", "bunx", "yarn", "pnpm", "npm"]);
/** Runners for ecosystems Level 1 does not measure. */
const OTHER_ECOSYSTEM = { uvx: "Python", uv: "Python", pipx: "Python", python: "Python", python3: "Python", docker: "Docker", podman: "Docker", deno: "Deno", go: "Go" };

/** `@scope/name@1.2.3` → `{ name: "@scope/name", version: "1.2.3" }`. */
export function splitSpec(spec) {
  const at = spec.lastIndexOf("@");
  const scoped = spec.startsWith("@");
  if (at > 0 && !(scoped && at === 0)) return { name: spec.slice(0, at), version: spec.slice(at + 1) };
  return { name: spec, version: null };
}

/**
 * The package a config entry would install, or why there is not one.
 *
 * Shapes in the wild: `npx -y pkg`, `npx --yes pkg@1`, `pnpm dlx pkg`,
 * `npm exec -- pkg`, and a bare installed binary. Flags are skipped; the first
 * argument that is not one is the package.
 */
export function packageOf(entry) {
  if (entry.url || entry.type === "http" || entry.type === "sse") return { kind: "remote", detail: entry.url || entry.type };
  const cmd = (entry.command || "").split(/[\\/]/).pop() || "";
  if (!cmd) return { kind: "unknown", detail: "no command" };
  if (OTHER_ECOSYSTEM[cmd]) return { kind: "other", detail: OTHER_ECOSYSTEM[cmd] };

  const args = Array.isArray(entry.args) ? entry.args.slice() : [];
  if (RUNNERS.has(cmd)) {
    while (args.length) {
      const a = args[0];
      if (a === "dlx" || a === "exec" || a === "--") { args.shift(); continue; }
      if (a.startsWith("-")) {
        /* `-p <pkg>` and `--package <pkg>` name the package in the next word. */
        if (a === "-p" || a === "--package") { args.shift(); break; }
        args.shift();
        continue;
      }
      break;
    }
    if (!args.length) return { kind: "unknown", detail: `${cmd} with no package argument` };
    const { name, version } = splitSpec(args[0]);
    if (OTHER_ECOSYSTEM[name]) return { kind: "other", detail: OTHER_ECOSYSTEM[name] };
    return { kind: "npm", name, version };
  }
  /* A bare binary: the command is often the package name, or its unscoped tail. */
  return { kind: "binary", name: cmd, version: null };
}

/**
 * Every server in a pasted config, with env VALUES already gone.
 *
 * Accepts the shapes Claude Desktop, Claude Code, Cursor, Windsurf and VS Code
 * write: `mcpServers`, `servers`, or `mcp.servers`.
 */
export function readConfig(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), servers: [] };
  }
  const block = data?.mcpServers ?? data?.servers ?? data?.mcp?.servers ?? null;
  if (!block || typeof block !== "object") {
    return { ok: false, error: 'No "mcpServers" or "servers" object in that JSON.', servers: [] };
  }
  const servers = Object.entries(block).map(([label, raw]) => {
    const entry = raw && typeof raw === "object" ? raw : {};
    /* THE ONLY PLACE ENV IS TOUCHED. Keys survive; values do not exist past
     * this line, so nothing downstream can leak one by accident. */
    const envKeys = entry.env && typeof entry.env === "object" ? Object.keys(entry.env) : [];
    return {
      label: String(label),
      command: typeof entry.command === "string" ? entry.command : "",
      args: Array.isArray(entry.args) ? entry.args.filter((a) => typeof a === "string") : [],
      url: typeof entry.url === "string" ? entry.url : null,
      type: typeof entry.type === "string" ? entry.type : null,
      envKeys,
      found: packageOf({ command: entry.command, args: entry.args, url: entry.url, type: entry.type }),
    };
  });
  return { ok: true, error: null, servers };
}

/** Match a parsed server against the measurement index. */
export function match(server, index) {
  const f = server.found;
  if (f.kind === "remote") return { state: "remote", detail: f.detail };
  if (f.kind === "other") return { state: "other", detail: f.detail };
  if (f.kind === "unknown") return { state: "unknown", detail: f.detail };

  const hit = index[f.name] ?? (f.kind === "binary" ? index[`bin:${f.name}`] : undefined);
  if (!hit) return { state: "unmeasured", name: f.name };
  const asked = f.version;
  return {
    state: asked && asked !== hit.version && asked !== "latest" ? "measured-other-version" : "measured",
    name: hit.name,
    wanted: asked,
    record: hit,
  };
}

/** A summary somebody can paste into a ticket. Never carries an env value. */
export function toMarkdown(rows, origin) {
  const out = ["| Server | Package | Measured | Not named in its README |", "| --- | --- | --- | --- |"];
  for (const { server, result } of rows) {
    const pkg = result.record ? `\`${result.record.name}@${result.record.version}\`` : result.name ? `\`${result.name}\`` : "—";
    let measured = "—";
    let found = "—";
    if (result.state === "measured" || result.state === "measured-other-version") {
      measured = `[${result.record.measuredAt}](${origin}/s/${result.record.slug}.html)`;
      const t = result.record.undocumentedTools;
      const h = result.record.undeclaredHosts;
      found = t === 0 && h === 0 ? "nothing" : [t ? `${t} tool${t === 1 ? "" : "s"}` : "", h ? `${h} website${h === 1 ? "" : "s"}` : ""].filter(Boolean).join(", ");
      if (result.state === "measured-other-version") found += ` (your config asks for ${result.wanted})`;
    } else if (result.state === "unmeasured") measured = "not measured";
    else if (result.state === "remote") measured = "remote server, not measurable at Level 1";
    else if (result.state === "other") measured = `${result.detail} package, not measurable at Level 1`;
    else measured = "could not read this entry";
    out.push(`| ${server.label} | ${pkg} | ${measured} | ${found} |`);
  }
  out.push("", `Read in the browser at ${origin}/paste.html. No configuration left the page.`);
  return out.join("\n");
}

/*
 * ═══════════════════════════════════════════════════════════════════════════
 * THE TOTAL FOR ONE PERSON'S SETUP, AND WHAT IT LEAVES OUT.
 *
 * A total is the most quotable thing on this page and therefore the easiest to
 * mislead with. "Your 12 servers offer 190 tools" is false if four of the
 * twelve were never measured — and it is false in the flattering direction,
 * which is the direction that gets screenshotted.
 *
 * So `totals` returns the counted figures and the UNCOUNTED tally side by
 * side, as one object, and nothing can render the first without having the
 * second in its hand. The four buckets are kept apart because they are four
 * different reasons and only one of them is ever going to be fixed by us:
 *
 *   noPage      measured and not yet published, or never measured. These two
 *               are deliberately indistinguishable from this page; saying
 *               which would announce a finding before its page goes up.
 *   hosted      a remote server. There is nothing to install, so Level 1 has
 *               no way to look at it at all.
 *   nonNpm      Python, Docker, Deno, Go. Not measured here.
 *   unreadable  the entry could not be parsed into a package.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** Counted figures and the uncounted tally, for one parsed config. */
export function totals(rows) {
  const t = {
    servers: rows.length,
    counted: 0,
    tools: 0,
    startupMs: 0,
    /* Counted for tools, but with no timing on record. */
    startupUnknown: 0,
    otherVersion: 0,
    noPage: 0,
    hosted: 0,
    nonNpm: 0,
    unreadable: 0,
  };
  for (const { result } of rows) {
    const s = result.state;
    if (s === "measured" || s === "measured-other-version") {
      t.counted += 1;
      t.tools += result.record.offered;
      if (typeof result.record.startupMs === "number") t.startupMs += result.record.startupMs;
      else t.startupUnknown += 1;
      if (s === "measured-other-version") t.otherVersion += 1;
    } else if (s === "unmeasured") t.noPage += 1;
    else if (s === "remote") t.hosted += 1;
    else if (s === "other") t.nonNpm += 1;
    else t.unreadable += 1;
  }
  return t;
}

/** `1234` → `1.2 s`. The same rule the server pages use. */
export function humanMs(ms) {
  if (ms < 1000) return ms + " ms";
  if (ms < 10000) return (ms / 1000).toFixed(1) + " s";
  return Math.round(ms / 1000) + " s";
}

/** The sentence naming everything the total does not include. */
export function uncountedLine(t) {
  const bits = [];
  if (t.noPage) bits.push(`${t.noPage} with no page here (never measured, or measured and not yet published — this page cannot tell you which)`);
  if (t.hosted) bits.push(`${t.hosted} hosted remotely, which Level 1 cannot install or start`);
  if (t.nonNpm) bits.push(`${t.nonNpm} not an npm package`);
  if (t.unreadable) bits.push(`${t.unreadable} that could not be read as a package`);
  if (!bits.length) return `Every server in this config has a page here. The figures above cover all ${t.servers} of them.`;
  const n = t.servers - t.counted;
  return `This total covers ${t.counted} of your ${t.servers} servers. It does NOT count ${n}: ` + bits.join("; ") + `. Your real totals are higher than the figures above, and by an amount this page cannot work out.`;
}

/*
 * A CARD THAT CARRIES NUMBERS AND NOTHING ELSE.
 *
 * This is the one thing on the page designed to be posted somewhere. So it
 * contains no server label, no package name, no version, no credential name
 * and no file path — not because any of those is a secret exactly, but because
 * a list of what somebody runs says more about their work than they mean to
 * share when they share a number. Aggregates only. The test that pastes a
 * token asserts against this string too.
 */
export function cardSvg(t, origin, day) {
  const W = 880;
  const e = (s) =>
    String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const uncounted = t.servers - t.counted;
  const time = t.startupMs > 0 ? humanMs(t.startupMs) : "—";

  /* The card grows to fit its own paragraph. Fixed at 400px the fourth
   * wrapped line sat on top of the footer, which is the one line carrying
   * "not calibration-backed" — the caveat least able to afford being
   * illegible. */
  const lines = wrap(uncountedLine(t), 92);
  const TOP = 300;
  const STEP = 21;
  const footY = TOP + (lines.length - 1) * STEP + 38;
  const H = footY + 22;

  const figure = (x, value, label, note) =>
    `<text x="${x}" y="186" font-family="Newsreader, Georgia, serif" font-size="62" fill="#17150f">${e(value)}</text>` +
    `<text x="${x}" y="214" font-family="Instrument Sans, system-ui, sans-serif" font-size="15" fill="#17150f">${e(label)}</text>` +
    `<text x="${x}" y="236" font-family="Instrument Sans, system-ui, sans-serif" font-size="13" fill="#6b655a">${e(note)}</text>`;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Level 1 totals for a pasted MCP config">`,
    `<rect width="${W}" height="${H}" fill="#faf8f3"/>`,
    `<rect x="0" y="0" width="${W}" height="6" fill="#17150f"/>`,
    `<text x="48" y="74" font-family="Instrument Sans, system-ui, sans-serif" font-size="13" letter-spacing="1.4" fill="#6b655a">BRYDGE LEVEL 1 — WHAT MY MCP SERVERS DO AT STARTUP</text>`,
    `<text x="48" y="120" font-family="Newsreader, Georgia, serif" font-size="30" fill="#17150f">${e(t.counted)} of ${e(t.servers)} servers measured</text>`,
    figure(48, t.tools, "tools offered", "before any tool was called"),
    figure(348, time, "to answer, added up", "approximate, one run each"),
    figure(648, uncounted, "not counted", uncounted === 0 ? "nothing missing" : "see the line below"),
    `<line x1="48" y1="272" x2="${W - 48}" y2="272" stroke="#d8d2c4" stroke-width="1"/>`,
    ...lines.map(
      (line, i) =>
        `<text x="48" y="${TOP + i * STEP}" font-family="Instrument Sans, system-ui, sans-serif" font-size="14" fill="#17150f">${e(line)}</text>`,
    ),
    `<text x="48" y="${footY}" font-family="Instrument Sans, system-ui, sans-serif" font-size="13" fill="#6b655a">${e(day)} · ${e(origin.replace(/^https?:\/\//, ""))}/paste.html · not calibration-backed · not a ranking</text>`,
    `</svg>`,
  ].join("");
}

/** Greedy wrap to `width` characters, so the card's text cannot run off it. */
export function wrap(s, width) {
  const out = [];
  let line = "";
  for (const word of String(s).split(/\s+/)) {
    if (!line) line = word;
    else if (line.length + 1 + word.length <= width) line += " " + word;
    else {
      out.push(line);
      line = word;
    }
  }
  if (line) out.push(line);
  return out.slice(0, 4);
}
