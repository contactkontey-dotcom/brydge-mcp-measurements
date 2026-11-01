/*
 * ═══════════════════════════════════════════════════════════════════════════
 * THE SMALL SUBSET OF MARKDOWN THE REPORTS ACTUALLY USE.
 *
 * The site renders the SAME text `report.ts` already produces, rather than a
 * second description of the same evidence. One renderer means the page and the
 * committed .md file cannot drift, and the thing a maintainer reads in a notice
 * is the thing a visitor reads on the site.
 *
 * So this converts only what those reports contain — headings, paragraphs,
 * bullet lists, pipe tables, fenced blocks, `code`, **bold**, *em*, links — and
 * escapes everything else. It is not a Markdown implementation and does not try
 * to be: anything it does not recognise comes out as escaped text, which is the
 * failure mode that cannot inject markup into the page.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Inline marks, innermost first so code spans are never re-parsed. */
function inline(raw: string): string {
  const code: string[] = [];
  let s = raw.replace(/`([^`]+)`/g, (_m, c: string) => {
    code.push(`<code>${escapeHtml(c)}</code>`);
    return `\u0000${code.length - 1}\u0000`;
  });
  /* Autolinks, before escaping turns the angle brackets into entities:
   * `<contact@brydge-ai.com>` is an address a reader should be able to click,
   * and it appeared on three pages as literal &lt;…&gt; until this existed. */
  const links: string[] = [];
  s = s.replace(/<([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})>/gi, (_m, addr: string) => {
    links.push(`<a href="mailto:${addr}">${escapeHtml(addr)}</a>`);
    return `\u0001${links.length - 1}\u0001`;
  });
  s = s.replace(/<(https?:\/\/[^\s>]+)>/g, (_m, url: string) => {
    links.push(`<a href="${url}">${escapeHtml(url)}</a>`);
    return `\u0001${links.length - 1}\u0001`;
  });
  s = escapeHtml(s);
  s = s.replace(/\u0001(\d+)\u0001/g, (_m, i: string) => links[Number(i)]);
  /* Absolute URLs and root-relative paths both. Without the `\/` arm, an
   * in-site link such as `[How that works](/method.html)` rendered as its own
   * literal brackets on the index, in the one paragraph explaining why 29
   * pages are missing — the place a reader is most likely to follow it. */
  s = s.replace(/\[([^\]]+)\]\(((?:https?:\/\/|\/)[^\s)]+)\)/g, (_m, t: string, u: string) => `<a href="${u}">${t}</a>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  /* Bare URLs, after links, so a link's href is not linkified twice. */
  s = s.replace(/(^|[\s(])((?:https?:\/\/)[^\s<)]+)/g, (_m, pre: string, u: string) => `${pre}<a href="${u}">${u}</a>`);
  return s.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => code[Number(i)]);
}

export function markdownToHtml(md: string): string {
  const out: string[] = [];
  const lines = md.split(/\r?\n/);
  let i = 0;
  const flushPara = (buf: string[]) => {
    if (buf.length) out.push(`<p>${inline(buf.join(" "))}</p>`);
    buf.length = 0;
  };
  const para: string[] = [];

  while (i < lines.length) {
    const line = lines[i];

    if (/^```/.test(line)) {
      flushPara(para);
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) body.push(lines[i++]);
      i++;
      out.push(`<pre><code>${escapeHtml(body.join("\n"))}</code></pre>`);
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      flushPara(para);
      const n = h[1].length;
      out.push(`<h${n}>${inline(h[2])}</h${n}>`);
      i++;
      continue;
    }
    if (/^\s*\|/.test(line)) {
      flushPara(para);
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        const cells = lines[i].trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c) || c === "")) rows.push(cells);
        i++;
      }
      if (rows.length) {
        const head = rows[0].some(Boolean) ? rows.shift()! : null;
        out.push("<div class=\"scroll\"><table>");
        if (head) out.push(`<thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead>`);
        out.push(`<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody>`);
        out.push("</table></div>");
      }
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      flushPara(para);
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        const depth = /^\s{2,}/.test(lines[i]) ? 1 : 0;
        const text = lines[i].replace(/^\s*[-*]\s+/, "");
        if (depth && items.length) items[items.length - 1] += `<ul><li>${inline(text)}</li></ul>`;
        else items.push(inline(text));
        i++;
      }
      out.push(`<ul>${items.map((t) => `<li>${t}</li>`).join("")}</ul>`);
      continue;
    }
    if (!line.trim()) {
      flushPara(para);
      i++;
      continue;
    }
    para.push(line.trim());
    i++;
  }
  flushPara(para);
  return out.join("\n");
}
