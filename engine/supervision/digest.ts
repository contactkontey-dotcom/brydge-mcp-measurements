import { createHash } from "node:crypto";

/*
 * ═══════════════════════════════════════════════════════════════════════════
 * ONE WAY TO HASH A RECORD, SO TWO MODULES CANNOT DISAGREE.
 *
 * Supervision digests things it must be able to recognise again later: the
 * shape of a destination's answer, the facts a mandate was authorised against,
 * the reading a verification was formed from. Those digests are compared
 * across modules and across time, so the serialisation has to be a function of
 * the CONTENT and of nothing else.
 *
 * This lived in the judgment product's ledger, which is where it was first
 * needed and not where it belongs: supervision is the only caller left, and a
 * hash function is not part of anybody's product. Same move as the workspace
 * cookie — infrastructure filed under a product, moved out before the product
 * goes.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * Deterministic serialisation.
 *
 * `JSON.stringify` follows key INSERTION order, so two identical records built
 * by different code paths serialise differently and digest differently — for a
 * reason no reader can see. Sorting the keys removes the construction order
 * from the answer.
 */
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}

/**
 * The digest of any value, hashed the one way.
 *
 * Exported so every layer that records a digest produces the SAME one. Two
 * modules each rolling their own key ordering produce digests that disagree
 * for invisible reasons, which is precisely the failure a digest exists to
 * make impossible.
 */
export function digestOf(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}
