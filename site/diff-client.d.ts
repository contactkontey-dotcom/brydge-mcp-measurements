export interface ToolRecord {
  name: string;
  description: string | null;
  schema: string | null;
  extra: Record<string, unknown>;
}
export interface ToolDiff {
  added: string[];
  removed: string[];
  descriptionChanged: Array<{ name: string; before: string | null; after: string | null }>;
  schemaChanged: Array<{ name: string; before: string | null; after: string | null }>;
  otherChanged: Array<{ name: string; fields: string[]; pointers: Array<{ pointer: string; atCap: boolean }> }>;
  unchanged: number;
  counts: { a: number; b: number };
}
export function canonical(v: unknown): string;
export function parseToolList(value: unknown): Array<Record<string, unknown>>;
export function readList(text: string): { ok: true; tools: Array<Record<string, unknown>> } | { ok: false; because: string };
export function recordOf(tool: Record<string, unknown>): ToolRecord;
export function carriesDetail(tools: ToolRecord[]): boolean;
export function diffTools(a: ToolRecord[], b: ToolRecord[]): ToolDiff;
export function firstDifference(a: string | null, b: string | null): { at: number; before: string; after: string } | null;
export function summaryOf(d: ToolDiff, detail: boolean, caveat?: string): string | null;
export function noChangeBlock(
  d: ToolDiff,
  detail: boolean,
  alwaysNotCompared: string[],
  caveat: string,
): { compared: string[]; notCompared: string[]; caveat: string };
export declare const POINTER_DEPTH: number;
export function escapePointer(segment: string): string;
export function differingPointers(
  a: unknown,
  b: unknown,
  base?: string,
  depth?: number,
): Array<{ pointer: string; atCap: boolean }>;
