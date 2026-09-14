// ================= document text extraction =================
//
// Word and PowerPoint files are zip archives of XML; the text lives in
// `word/document.xml` and `ppt/slides/slideN.xml`. A small zip reader plus
// tag stripping gets the words out without any dependency. Plain text
// formats pass through. PDFs and everything else are reported as unsupported.

import { inflateRawSync } from "node:zlib";

export type SourceKind = "docx" | "pptx" | "text" | "unsupported";

export interface ExtractedSource {
  name: string;
  kind: SourceKind;
  text: string;
  chars: number;
  error: string | null;
  truncated: boolean;
}

/** Per-source cap so a 200-page deck cannot crowd out the brief. */
export const MAX_SOURCE_CHARS = 40_000;
/** Bounds for archive metadata and decompression before XML parsing begins. */
export const MAX_ZIP_ENTRIES = 512;
export const MAX_ZIP_ENTRY_BYTES = 8_000_000;
export const MAX_ZIP_OUTPUT_BYTES = 16_000_000;

// ---- zip -----------------------------------------------------------------

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  offset: number;
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

/** Central-directory listing of a zip held in memory. */
export const zipEntries = (buf: Buffer): ZipEntry[] => {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66_000); i--) {
    if (i >= 0 && i + 22 <= buf.length && buf.readUInt32LE(i) === EOCD && i + 22 + buf.readUInt16LE(i + 20) === buf.length) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip archive");
  const disk = buf.readUInt16LE(eocd + 4);
  const centralDisk = buf.readUInt16LE(eocd + 6);
  const diskCount = buf.readUInt16LE(eocd + 8);
  const count = buf.readUInt16LE(eocd + 10);
  const centralSize = buf.readUInt32LE(eocd + 12);
  const centralOffset = buf.readUInt32LE(eocd + 16);
  if (disk !== 0 || centralDisk !== 0 || diskCount !== count || count === 0xffff) throw new Error("unsupported zip archive layout");
  if (count > MAX_ZIP_ENTRIES) throw new Error(`zip contains too many entries (maximum ${MAX_ZIP_ENTRIES})`);
  if (centralOffset > buf.length || centralSize > buf.length - centralOffset || centralOffset + centralSize > eocd) throw new Error("corrupt zip central directory");
  let p = centralOffset;
  const out: ZipEntry[] = [];
  let declaredOutput = 0;
  for (let i = 0; i < count; i++) {
    if (p < centralOffset || p + 46 > buf.length || buf.readUInt32LE(p) !== CENTRAL) throw new Error("corrupt zip central directory");
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    const end = p + 46 + nameLen + extraLen + commentLen;
    if (end > buf.length || end > centralOffset + centralSize) throw new Error("corrupt zip central directory");
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    if (size > MAX_ZIP_ENTRY_BYTES) throw new Error(`zip entry ${name} exceeds ${MAX_ZIP_ENTRY_BYTES} bytes`);
    declaredOutput += size;
    if (declaredOutput > MAX_ZIP_OUTPUT_BYTES) throw new Error(`zip expands beyond ${MAX_ZIP_OUTPUT_BYTES} bytes`);
    out.push({ name, method, compressedSize, size, offset });
    p = end;
  }
  if (p !== centralOffset + centralSize) throw new Error("corrupt zip central directory");
  return out;
};

export const zipRead = (buf: Buffer, entry: ZipEntry, maxOutput = MAX_ZIP_ENTRY_BYTES): Buffer => {
  if (maxOutput < 0 || maxOutput > MAX_ZIP_ENTRY_BYTES) throw new Error("invalid zip output limit");
  if (entry.size > maxOutput || entry.size > MAX_ZIP_ENTRY_BYTES) throw new Error(`zip entry ${entry.name} exceeds decompression limit`);
  const p = entry.offset;
  if (p < 0 || p + 30 > buf.length || buf.readUInt32LE(p) !== LOCAL) throw new Error(`corrupt zip entry ${entry.name}`);
  const nameLen = buf.readUInt16LE(p + 26);
  const extraLen = buf.readUInt16LE(p + 28);
  const start = p + 30 + nameLen + extraLen;
  if (start > buf.length || entry.compressedSize > buf.length - start) throw new Error(`corrupt zip entry ${entry.name}`);
  const data = buf.subarray(start, start + entry.compressedSize);
  switch (entry.method) {
    case 0:
      if (data.length > maxOutput || data.length !== entry.size) throw new Error(`zip entry ${entry.name} has an invalid size`);
      return Buffer.from(data);
    case 8:
      try {
        const inflated = inflateRawSync(data, { maxOutputLength: maxOutput });
        if (inflated.length > maxOutput || inflated.length !== entry.size) throw new Error(`zip entry ${entry.name} has an invalid size`);
        return inflated;
      } catch (e) {
        if (e instanceof Error && e.message.startsWith("zip entry")) throw e;
        throw new Error(`zip entry ${entry.name} exceeds decompression limit or is corrupt`, { cause: e });
      }
    default:
      throw new Error(`unsupported zip compression ${entry.method} in ${entry.name}`);
  }
};

// ---- xml text ------------------------------------------------------------

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

const decodeEntities = (s: string): string =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e.startsWith("#x")) return String.fromCodePoint(parseInt(e.slice(2), 16));
    if (e.startsWith("#")) return String.fromCodePoint(parseInt(e.slice(1), 10));
    return ENTITIES[e.toLowerCase()] ?? m;
  });

/** Paragraph-preserving text from WordprocessingML or DrawingML. */
const xmlText = (xml: string, paragraphTag: string): string =>
  decodeEntities(
    xml
      .replace(new RegExp(`</${paragraphTag}>|<${paragraphTag}/>`, "g"), "\n")
      .replace(/<w:tab\/>/g, "\t")
      .replace(/<w:br\/>|<a:br\/>/g, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter((l, i, arr) => l !== "" || (i > 0 && arr[i - 1] !== ""))
    .join("\n")
    .trim();

export const docxText = (buf: Buffer): string => {
  const entries = zipEntries(buf);
  const doc = entries.find((e) => e.name === "word/document.xml");
  if (!doc) throw new Error("no word/document.xml: not a Word document");
  return xmlText(zipRead(buf, doc, MAX_ZIP_ENTRY_BYTES).toString("utf8"), "w:p");
};

export const pptxText = (buf: Buffer): string => {
  const entries = zipEntries(buf);
  const slides = entries
    .map((e) => ({ e, n: Number((e.name.match(/^ppt\/slides\/slide(\d+)\.xml$/) ?? [])[1] ?? NaN) }))
    .filter((s) => Number.isFinite(s.n))
    .sort((a, b) => a.n - b.n);
  if (slides.length === 0) throw new Error("no slides: not a PowerPoint document");
  let remaining = MAX_ZIP_OUTPUT_BYTES;
  return slides
    .map((s) => {
      const bytes = zipRead(buf, s.e, Math.min(MAX_ZIP_ENTRY_BYTES, remaining));
      remaining -= bytes.length;
      const xml = bytes.toString("utf8");
      return `## Slide ${s.n}\n${xmlText(xml, "a:p")}`;
    })
    .join("\n\n");
};

// ---- dispatch --------------------------------------------------------------

const kindOf = (name: string, mime: string): SourceKind => {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "docx" || mime.includes("wordprocessingml")) return "docx";
  if (ext === "pptx" || mime.includes("presentationml")) return "pptx";
  if (["txt", "md", "markdown", "csv", "tsv", "json", "yaml", "yml", "rst"].includes(ext) || mime.startsWith("text/")) return "text";
  return "unsupported";
};

const cap = (text: string): { text: string; truncated: boolean } =>
  text.length > MAX_SOURCE_CHARS ? { text: `${text.slice(0, MAX_SOURCE_CHARS)}\n\n[… truncated at ${MAX_SOURCE_CHARS} characters]`, truncated: true } : { text, truncated: false };

/** Extract text from one uploaded file; never throws, unsupported and corrupt files are reported in `error`. */
export const extractSource = (name: string, mime: string, bytes: Buffer): ExtractedSource => {
  const kind = kindOf(name, mime);
  try {
    let raw: string;
    switch (kind) {
      case "docx":
        raw = docxText(bytes);
        break;
      case "pptx":
        raw = pptxText(bytes);
        break;
      case "text":
        raw = bytes.toString("utf8");
        break;
      case "unsupported":
        return { name, kind, text: "", chars: 0, error: `unsupported file type (use .docx, .pptx, .txt, .md, .csv)${name.toLowerCase().endsWith(".pdf") ? "; export PDFs to text first" : ""}`, truncated: false };
    }
    const c = cap(raw.trim());
    return { name, kind, text: c.text, chars: raw.length, error: c.text ? null : "no text found", truncated: c.truncated };
  } catch (e) {
    return { name, kind, text: "", chars: 0, error: e instanceof Error ? e.message : String(e), truncated: false };
  }
};
