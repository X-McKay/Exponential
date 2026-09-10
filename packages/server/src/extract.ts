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
    if (buf.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip archive");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== CENTRAL) throw new Error("corrupt zip central directory");
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    out.push({ name, method, compressedSize, size, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
};

export const zipRead = (buf: Buffer, entry: ZipEntry): Buffer => {
  const p = entry.offset;
  if (buf.readUInt32LE(p) !== LOCAL) throw new Error(`corrupt zip entry ${entry.name}`);
  const nameLen = buf.readUInt16LE(p + 26);
  const extraLen = buf.readUInt16LE(p + 28);
  const start = p + 30 + nameLen + extraLen;
  const data = buf.subarray(start, start + entry.compressedSize);
  switch (entry.method) {
    case 0:
      return Buffer.from(data);
    case 8:
      return inflateRawSync(data);
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
  return xmlText(zipRead(buf, doc).toString("utf8"), "w:p");
};

export const pptxText = (buf: Buffer): string => {
  const entries = zipEntries(buf);
  const slides = entries
    .map((e) => ({ e, n: Number((e.name.match(/^ppt\/slides\/slide(\d+)\.xml$/) ?? [])[1] ?? NaN) }))
    .filter((s) => Number.isFinite(s.n))
    .sort((a, b) => a.n - b.n);
  if (slides.length === 0) throw new Error("no slides: not a PowerPoint document");
  return slides.map((s) => `## Slide ${s.n}\n${xmlText(zipRead(buf, s.e).toString("utf8"), "a:p")}`).join("\n\n");
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
