/*
 * ═══════════════════════════════════════════════════════════════════════════
 * COMPARING TWO TOOL LISTS, IN THE READER'S BROWSER, WITH NO NETWORK.
 *
 * This is the same comparison watch/tools.ts makes, with the hashing left
 * out: hashes exist there so a captured surface can be stored and compared
 * later, and here both sides are in front of us, so canonical text is
 * compared directly. The rules it does keep are the ones that decide whether
 * an answer is right:
 *
 *   - Object keys are sorted at every depth before comparing. A server may
 *     emit a schema's keys in any order, and two orderings of one schema are
 *     one schema. Comparing raw text reports a change every time a serialiser
 *     changes its mind.
 *   - Description and input schema are compared separately, and a field that
 *     is neither is named rather than lumped into "something else". 47 of the
 *     kolbo pair's tools differ only in `_meta`; under a label like "other"
 *     that reads as 47 changed tools, and named it reads as one build
 *     artifact, which is what it is.
 *   - A list of bare names is a valid list. It can only answer added and
 *     removed, and the page says so rather than reporting zero changes.
 *
 * NO fetch, XMLHttpRequest, sendBeacon, WebSocket, EventSource, localStorage,
 * sessionStorage, indexedDB or document.cookie is used here. The page's CSP
 * forbids them regardless; this file does not reach for them in the first
 * place. (A test strips comments before checking, so naming them here to say
 * they are unused does not trip it.)
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** JSON with object keys sorted at every depth. */
export function canonical(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  return (
    "{" +
    Object.keys(v)
      .sort()
      .map((k) => JSON.stringify(k) + ":" + canonical(v[k]))
      .join(",") +
    "}"
  );
}

/**
 * Accept the shapes a tool list arrives in.
 *
 * Somebody pasting one has copied it from wherever was convenient: the whole
 * JSON-RPC reply, the `result` object, a bare array, or a file with a `tools`
 * key. A bare array of strings is accepted too — that is what a list of names
 * looks like when somebody has pulled it out by hand, and refusing it would
 * only mean they reformat it themselves and make a mistake.
 */
export function parseToolList(value) {
  const objects = (v) =>
    Array.isArray(v) && v.length && v.every((x) => x && typeof x === "object" && typeof x.name === "string") ? v : null;
  const strings = (v) =>
    Array.isArray(v) && v.length && v.every((x) => typeof x === "string") ? v.map((name) => ({ name })) : null;
  /* An empty array IS a valid tool list: a server that offers nothing. */
  if (Array.isArray(value) && value.length === 0) return [];

  for (const candidate of [value, value && value.tools, value && value.result && value.result.tools, value && value.message && value.message.result && value.message.result.tools]) {
    const hit = objects(candidate) || strings(candidate);
    if (hit) return hit;
    if (Array.isArray(candidate) && candidate.length === 0) return [];
  }
  throw new Error("no tool list found: expected an array of tools or of names, or an object with tools, result.tools or message.result.tools");
}

/** Parse pasted text into a tool list, with a message a reader can act on. */
export function readList(text) {
  const t = String(text || "").trim();
  if (!t) return { ok: false, because: "empty" };
  let parsed;
  try {
    parsed = JSON.parse(t);
  } catch (e) {
    return { ok: false, because: "That is not JSON. " + (e && e.message ? e.message : "") };
  }
  try {
    return { ok: true, tools: parseToolList(parsed) };
  } catch (e) {
    return { ok: false, because: e && e.message ? e.message : String(e) };
  }
}

/** One tool reduced to the three things compared. */
export function recordOf(tool) {
  const extra = {};
  for (const k of Object.keys(tool)) if (k !== "name" && k !== "description" && k !== "inputSchema") extra[k] = tool[k];
  return {
    name: String(tool.name),
    description: typeof tool.description === "string" ? tool.description : null,
    schema: "inputSchema" in tool && tool.inputSchema !== undefined ? canonical(tool.inputSchema) : null,
    extra,
  };
}

/**
 * Whether a list carries anything beyond names.
 *
 * A names-only list cannot answer "changed description" or "changed schema",
 * and a page that prints 0 for both would be saying no description moved when
 * it has never seen one.
 */
export function carriesDetail(tools) {
  return tools.some((t) => t.description !== null || t.schema !== null || Object.keys(t.extra).length > 0);
}

export function diffTools(a, b) {
  const A = new Map(a.map((t) => [t.name, t]));
  const B = new Map(b.map((t) => [t.name, t]));
  const added = [...B.keys()].filter((n) => !A.has(n)).sort();
  const removed = [...A.keys()].filter((n) => !B.has(n)).sort();
  const descriptionChanged = [];
  const schemaChanged = [];
  const otherChanged = [];
  let unchanged = 0;

  for (const [name, x] of A) {
    const y = B.get(name);
    if (!y) continue;
    const fields = [];
    if (x.description !== y.description) {
      fields.push("description");
      descriptionChanged.push({ name, before: x.description, after: y.description });
    }
    if (x.schema !== y.schema) {
      fields.push("input schema");
      schemaChanged.push({ name, before: x.schema, after: y.schema });
    }
    const other = [];
    for (const k of [...new Set([...Object.keys(x.extra), ...Object.keys(y.extra)])].sort()) {
      if (canonical(x.extra[k]) !== canonical(y.extra[k])) other.push(k);
    }
    if (other.length) otherChanged.push({ name, fields: other });
    if (!fields.length && !other.length) unchanged++;
  }

  descriptionChanged.sort((p, q) => p.name.localeCompare(q.name));
  schemaChanged.sort((p, q) => p.name.localeCompare(q.name));
  otherChanged.sort((p, q) => p.name.localeCompare(q.name));
  return { added, removed, descriptionChanged, schemaChanged, otherChanged, unchanged, counts: { a: a.length, b: b.length } };
}

/** The first line that differs, so a reworded description is shown, not dumped. */
export function firstDifference(a, b) {
  if (a === b) return null;
  const x = String(a === null ? "" : a).split("\n");
  const y = String(b === null ? "" : b).split("\n");
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] !== y[i]) return { at: i + 1, before: x[i] === undefined ? "(no line)" : x[i], after: y[i] === undefined ? "(no line)" : y[i] };
  }
  return null;
}

/**
 * One plain sentence for the top of the result.
 *
 * It counts and it names. It does not say whether any of it matters: a tool
 * list that differs is a tool list that differs, and what that is worth
 * depends on a configuration and a judgement this page does not have.
 */
export function summaryOf(d, detail) {
  const bits = [];
  /* Same order as the sections below it, so the two cannot contradict. */
  if (d.descriptionChanged.length) bits.push(d.descriptionChanged.length + " with a changed description");
  if (d.schemaChanged.length) bits.push(d.schemaChanged.length + " with a changed input schema");
  if (d.added.length) bits.push(d.added.length + " added");
  if (d.removed.length) bits.push(d.removed.length + " removed");
  const head = d.counts.a + (d.counts.a === 1 ? " tool" : " tools") + " on the left, " + d.counts.b + " on the right.";
  if (!bits.length) {
    /*
     * A no-change says what was compared, one thing at a time, and never
     * offers the two totals as the comparison. 46 and 46 is also what a
     * one-for-one swap looks like, and a count of names says nothing at all
     * about a description or an input schema. Where either was not compared
     * the qualification leads, rather than trailing a reassuring sentence.
     */
    const same = d.counts.a === d.counts.b;
    const names =
      "Tool names: " +
      (same ? d.counts.a + " in both" : d.counts.a + " then " + d.counts.b) +
      ", " + d.added.length + " added, " + d.removed.length + " removed.";
    const said = detail ? "compared, none changed" : "not compared";
    return (
      (detail ? "No change." : "No change in what could be compared.") +
      " " + names + " Descriptions: " + said + ". Input schemas: " + said + "."
    );
  }
  return head + " " + bits.join(", ") + ".";
}
