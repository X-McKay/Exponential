import { deflateRawSync } from "node:zlib";
import { describe, expect, test } from "bun:test";
import { extractSource, MAX_ZIP_ENTRIES, MAX_ZIP_ENTRY_BYTES } from "../src/extract.ts";

const zip = (files: { name: string; raw: Buffer; declaredSize?: number }[]): Buffer => {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const data = deflateRawSync(file.raw);
    const name = Buffer.from(file.name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(file.declaredSize ?? file.raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(file.declaredSize ?? file.raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, data);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const central = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, eocd]);
};

describe("archive extraction limits", () => {
  test("rejects archives with too many entries or an oversized declared entry", () => {
    const many = Array.from({ length: MAX_ZIP_ENTRIES + 1 }, (_, i) => ({ name: `x${i}`, raw: Buffer.alloc(0) }));
    expect(extractSource("many.docx", "", zip(many)).error).toContain("too many entries");
    const oversized = zip([{ name: "word/document.xml", raw: Buffer.from("x"), declaredSize: MAX_ZIP_ENTRY_BYTES + 1 }]);
    expect(extractSource("large.docx", "", oversized).error).toContain("exceeds");
  });

  test("caps actual deflate output even when the archive lies about its size", () => {
    const raw = Buffer.alloc(MAX_ZIP_ENTRY_BYTES + 1, 0x78);
    const bomb = zip([{ name: "word/document.xml", raw, declaredSize: 1 }]);
    const result = extractSource("bomb.docx", "", bomb);
    expect(result.text).toBe("");
    expect(result.error).toContain("decompression limit");
  });
});
