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
 *     that reads as 47 changed tools, and named it reads as 47 tools
 *     differing at one field, which is what the comparison saw. What that
 *     field is for is not something this measured, and nothing here
 *     characterises it.
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

/*
 * WHICH KEY MOVED, NOT JUST WHICH TOP-LEVEL FIELD.
 *
 * JSON Pointer (RFC 6901), not a dotted path. A `_meta` can hold BOTH a
 * literal key named "ui/resourceUri" AND a nested ui.resourceUri — the kolbo
 * pair does — and a dotted path writes the two identically. A pointer
 * escapes "~" as "~0" and "/" as "~1", so they are different strings.
 *
 * Depth is capped: past the cap the branch is named rather than the leaf,
 * and the caller is told the walk stopped, so a large churning structure
 * cannot turn one line into hundreds.
 *
 * This mirrors watch/tools.ts. The page cannot import it — that is a Node
 * module and this runs in a browser — so a test compares the two on the same
 * input rather than trusting them to stay alike.
 */
export const POINTER_DEPTH = 6;

export function escapePointer(segment) {
  return String(segment).replace(/~/g, "~0").replace(/\//g, "~1");
}

export function differingPointers(a, b, base, depth) {
  base = base || "";
  depth = depth || 0;
  if (canonical(a) === canonical(b)) return [];
  const plain = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  if (!plain(a) || !plain(b)) return [{ pointer: base || "/", atCap: false }];
  if (depth >= POINTER_DEPTH) return [{ pointer: base || "/", atCap: true }];
  const out = [];
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  for (const k of keys) out.push(...differingPointers(a[k], b[k], base + "/" + escapePointer(k), depth + 1));
  return out;
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
    const pointers = differingPointers(x.extra, y.extra);
    if (pointers.length) otherChanged.push({ name, fields: pointers.map((p) => p.pointer), pointers: pointers });
    if (!fields.length && !pointers.length) unchanged++;
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
 *
 * `caveat` is passed in rather than written here: the same string lives in
 * watch/versiondiff.ts as NO_CHANGE_CAVEAT, site/build.ts injects THAT one
 * into this page, and a test asserts the two are identical. A copy kept here
 * would be a second thing to keep true.
 */
export function summaryOf(d, detail, caveat) {
  const bits = [];
  /* Same order as the sections below it, so the two cannot contradict. */
  if (d.descriptionChanged.length) bits.push(d.descriptionChanged.length + " with a changed description");
  if (d.schemaChanged.length) bits.push(d.schemaChanged.length + " with a changed input schema");
  if (d.added.length) bits.push(d.added.length + " added");
  if (d.removed.length) bits.push(d.removed.length + " removed");
  const head = d.counts.a + (d.counts.a === 1 ? " tool" : " tools") + " on the left, " + d.counts.b + " on the right.";
  if (bits.length) return head + " " + bits.join(", ") + ".";
  return null; /* a no-change is a block, not a sentence: see noChangeBlock */
}

/**
 * The lines of a no-change: what was compared, and what was not.
 *
 * `alwaysNotCompared` and `caveat` are passed in rather than written here.
 * The same strings live in watch/versiondiff.ts and site/build.ts injects
 * THOSE into this page, with a test asserting the two match. A copy kept
 * here would be a second thing to keep true.
 *
 * There is no summary adjective and no qualifying lead-in. The sentence this
 * replaced named a number of fields without naming the fields, which was true
 * and told a reader nothing — least of all which ones were left out. Counts
 * sit beside the thing they count and never alone: 46 and 46 is also what a
 * one-for-one swap looks like.
 */
export function noChangeBlock(d, detail, alwaysNotCompared, caveat) {
  const compared = [
    "tool names: " +
      (d.counts.a === d.counts.b ? d.counts.a + " in both" : d.counts.a + " then " + d.counts.b) +
      ", " + d.added.length + " added, " + d.removed.length + " removed",
  ];
  const notCompared = [];
  if (detail) {
    compared.push("tool descriptions: none changed");
    compared.push("tool input schemas: none changed");
    compared.push("every other field each tool carries: none changed");
  } else {
    notCompared.push("tool descriptions (one of these lists carries names only)");
    notCompared.push("tool input schemas (one of these lists carries names only)");
  }
  /* This page is given two tool lists and nothing else. It never saw either
   * version run, so none of the startup fields is in the compared list. */
  notCompared.push("what either version did at startup — websites reached, programs started, files written, packages installed, connection attempts; this page is given tool lists and nothing else");
  for (const x of alwaysNotCompared || []) notCompared.push(x);
  return { compared: compared, notCompared: notCompared, caveat: caveat };
}
