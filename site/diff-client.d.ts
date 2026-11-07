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
  otherChanged: Array<{ name: string; fields: string[] }>;
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
export function summaryOf(d: ToolDiff, detail: boolean): string;
