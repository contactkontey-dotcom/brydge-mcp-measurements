import * as zlib from "node:zlib";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { readFileSync, writeFileSync } from "node:fs";

/*
 * ═══════════════════════════════════════════════════════════════════════════
 * A WORKBOOK IS A ZIP OF XML. WE READ AND WRITE OUR OWN, SO NO LIBRARY DECIDES.
 *
 * An .xlsx is a ZIP archive of XML parts. To ask "did the server write 42 into
 * cell B2?" the harness needs to open the workbook independently of whatever
 * wrote it. A spreadsheet library would do it — and would be one more thing a
 * reader has to trust and one more dependency that could differ between two
 * installs. This is a few hundred lines that do exactly what is needed and
 * nothing else: enough of the ZIP container and enough of SpreadsheetML to
 * read a cell's value and to write a small sheet. It is not a general xlsx
 * implementation and does not pretend to be.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/* ── ZIP: read the central directory, inflate each stored part ────────────── */

interface ZipEntry {
  name: string;
  data: Buffer;
}

function readZip(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  /* End of Central Directory: scan back for its signature. */
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 22 - 65536; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip: no end-of-central-directory record");
  const count = buf.readUInt16LE(eocd + 10);
  let at = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) throw new Error("corrupt central directory");
    const method = buf.readUInt16LE(at + 10);
    const compSize = buf.readUInt32LE(at + 20);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const localOff = buf.readUInt32LE(at + 42);
    const name = buf.toString("utf8", at + 46, at + 46 + nameLen);
    /* The local header repeats name+extra with its own lengths. */
    const lhNameLen = buf.readUInt16LE(localOff + 26);
    const lhExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lhNameLen + lhExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);
    out.set(name, method === 8 ? inflateRawSync(raw) : Buffer.from(raw));
    at += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/* crc32 for the ZIP we write. Node exposes zlib.crc32 on 22.2+; keep a table
 * fallback so the harness reads the same on any 22.18+. */
let crcTable: Uint32Array | null = null;
function crc32(buf: Buffer): number {
  const z = (zlib as { crc32?: (b: Buffer) => number }).crc32;
  if (typeof z === "function") return z(buf) >>> 0;
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function writeZip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const stored = deflateRawSync(e.data);
    const useDeflate = stored.length < e.data.length;
    const body = useDeflate ? stored : e.data;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(e.data);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);
    locals.push(local, body);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(e.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centrals.push(central);
    offset += local.length + body.length;
  }
  const centralStart = offset;
  const centralSize = centrals.reduce((a, b) => a + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralStart, 16);
  return Buffer.concat([...locals, ...centrals, eocd]);
}

/* ── SpreadsheetML: enough to read a value and write a small sheet ────────── */

const unescape = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&amp;/g, "&");

const escape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Every worksheet, as cell reference → value. */
export function readWorkbook(path: string): Record<string, Record<string, string>> {
  const zip = readZip(readFileSync(path));
  const shared: string[] = [];
  const ss = zip.get("xl/sharedStrings.xml");
  if (ss) {
    const xml = ss.toString("utf8");
    for (const si of xml.match(/<si>[\s\S]*?<\/si>/g) ?? []) {
      const texts = [...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => unescape(m[1]));
      shared.push(texts.join(""));
    }
  }
  /* Map each sheet name to its part path via workbook.xml + its rels. */
  /* Attributes appear in any order across writers: openpyxl (which real Excel
   * servers use) writes Target before Id, our own writer the other way. So each
   * element is matched whole and its attributes pulled out one at a time. */
  const attr = (el: string, name: string) => new RegExp(`\\b${name}="([^"]+)"`).exec(el)?.[1];
  const rels = new Map<string, string>();
  const relsXml = zip.get("xl/_rels/workbook.xml.rels")?.toString("utf8") ?? "";
  for (const el of relsXml.match(/<Relationship\b[^>]*?\/?>/g) ?? []) {
    const id = attr(el, "Id");
    const target = attr(el, "Target");
    if (id && target) rels.set(id, target.startsWith("/") ? target.slice(1) : `xl/${target}`);
  }
  const names: Array<{ name: string; part: string }> = [];
  const wb = zip.get("xl/workbook.xml")?.toString("utf8") ?? "";
  for (const el of wb.match(/<sheet\b[^>]*?\/?>/g) ?? []) {
    const name = attr(el, "name");
    const rid = attr(el, "r:id");
    const part = rid ? rels.get(rid) : undefined;
    if (name && part) names.push({ name: unescape(name), part });
  }
  const out: Record<string, Record<string, string>> = {};
  for (const { name, part } of names) {
    const sheetXml = zip.get(part)?.toString("utf8");
    const cells: Record<string, string> = {};
    if (sheetXml) {
      for (const m of sheetXml.matchAll(/<c\s+[^>]*r="([A-Z]+\d+)"([^>]*)>([\s\S]*?)<\/c>/g)) {
        const ref = m[1];
        const t = /t="([^"]+)"/.exec(m[2])?.[1];
        const inner = m[3];
        let value = "";
        if (t === "s") {
          const idx = parseInt(/<v>(\d+)<\/v>/.exec(inner)?.[1] ?? "-1", 10);
          value = shared[idx] ?? "";
        } else if (t === "inlineStr") {
          value = [...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => unescape(x[1])).join("");
        } else {
          value = unescape(/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? "");
        }
        cells[ref] = value;
      }
    }
    out[name] = cells;
  }
  return out;
}

const colLetter = (n: number): string => {
  let s = "";
  for (n += 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

/** Write a workbook of {sheetName: rows}. Strings and numbers only. */
export function writeWorkbook(path: string, sheets: Record<string, Array<Array<string | number>>>): void {
  const names = Object.keys(sheets);
  const sheetParts = names.map((_, i) => `xl/worksheets/sheet${i + 1}.xml`);
  const cell = (ref: string, v: string | number) =>
    typeof v === "number"
      ? `<c r="${ref}"><v>${v}</v></c>`
      : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escape(v)}</t></is></c>`;
  const worksheet = (rows: Array<Array<string | number>>) => {
    const body = rows
      .map((row, r) => `<row r="${r + 1}">${row.map((v, c) => cell(`${colLetter(c)}${r + 1}`, v)).join("")}</row>`)
      .join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
  };
  const entries: ZipEntry[] = [
    {
      name: "[Content_Types].xml",
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheetParts.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`,
      ),
    },
    {
      name: "_rels/.rels",
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      ),
    },
    {
      name: "xl/workbook.xml",
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${escape(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`,
      ),
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>`,
      ),
    },
    ...names.map((n, i) => ({ name: sheetParts[i], data: Buffer.from(worksheet(sheets[n])) })),
  ];
  writeFileSync(path, writeZip(entries));
}
