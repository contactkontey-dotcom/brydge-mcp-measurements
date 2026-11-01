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
