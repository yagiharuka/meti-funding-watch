import { inflateRawSync } from "node:zlib";

function cleanXmlText(value = "") {
  return String(value)
    .replace(/&amp;/gu, "&")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&#39;|&apos;/gu, "'")
    .replace(/&#(\d+);/gu, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/[\t\r\n 　]+/gu, " ")
    .trim();
}

function findEndOfCentralDirectory(buffer) {
  const minimum = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error("XLSX ZIP end-of-central-directory not found");
}

function zipEntries(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) throw new Error("XLSX buffer is invalid");
  const eocd = findEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(eocd + 10);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  const entries = new Map();
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error(`XLSX central-directory entry ${index} is invalid`);
    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const filenameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const filename = buffer.subarray(offset + 46, offset + 46 + filenameLength).toString("utf8");
    entries.set(filename, { filename, compressionMethod, compressedSize, uncompressedSize, localOffset });
    offset += 46 + filenameLength + extraLength + commentLength;
  }
  return entries;
}

function readZipEntry(buffer, entry) {
  const offset = entry.localOffset;
  if (buffer.readUInt32LE(offset) !== 0x04034b50) throw new Error(`XLSX local entry is invalid: ${entry.filename}`);
  const filenameLength = buffer.readUInt16LE(offset + 26);
  const extraLength = buffer.readUInt16LE(offset + 28);
  const dataOffset = offset + 30 + filenameLength + extraLength;
  const compressed = buffer.subarray(dataOffset, dataOffset + entry.compressedSize);
  let output;
  if (entry.compressionMethod === 0) output = Buffer.from(compressed);
  else if (entry.compressionMethod === 8) output = inflateRawSync(compressed);
  else throw new Error(`XLSX compression method is unsupported: ${entry.compressionMethod}`);
  if (entry.uncompressedSize && output.length !== entry.uncompressedSize) {
    throw new Error(`XLSX entry size mismatch: ${entry.filename} ${output.length}/${entry.uncompressedSize}`);
  }
  return output;
}

function xmlEntry(buffer, entries, name, required = true) {
  const entry = entries.get(name);
  if (!entry) {
    if (!required) return "";
    throw new Error(`XLSX entry missing: ${name}`);
  }
  return readZipEntry(buffer, entry).toString("utf8");
}

function sharedStrings(xml) {
  if (!xml) return [];
  const values = [];
  for (const match of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gu)) {
    const pieces = [...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gu)].map((part) => cleanXmlText(part[1]));
    values.push(pieces.join(""));
  }
  return values;
}

function columnIndex(reference) {
  const letters = String(reference).match(/^[A-Z]+/u)?.[0] ?? "";
  let value = 0;
  for (const char of letters) value = value * 26 + char.charCodeAt(0) - 64;
  return value ? value - 1 : null;
}

function worksheetRows(xml, strings) {
  const rows = [];
  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/gu)) {
    const row = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/gu)) {
      const attrs = cellMatch[1];
      const body = cellMatch[2];
      const reference = attrs.match(/\br=["']([^"']+)["']/u)?.[1] ?? "";
      const index = columnIndex(reference);
      if (!Number.isInteger(index)) continue;
      const type = attrs.match(/\bt=["']([^"']+)["']/u)?.[1] ?? "";
      let value = "";
      if (type === "inlineStr") {
        value = [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gu)].map((match) => cleanXmlText(match[1])).join("");
      } else {
        const raw = cleanXmlText(body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/u)?.[1] ?? "");
        if (type === "s") value = strings[Number(raw)] ?? "";
        else if (type === "b") value = raw === "1" ? "TRUE" : "FALSE";
        else value = raw;
      }
      row[index] = value;
    }
    while (row.length && !String(row.at(-1) ?? "").trim()) row.pop();
    if (row.some((value) => String(value ?? "").trim())) rows.push(row.map((value) => String(value ?? "")));
  }
  return rows;
}

export function xlsxRowsFromBuffer(buffer) {
  const entries = zipEntries(buffer);
  const strings = sharedStrings(xmlEntry(buffer, entries, "xl/sharedStrings.xml", false));
  const sheets = [...entries.keys()]
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/u.test(name))
    .sort((a, b) => {
      const left = Number(a.match(/sheet(\d+)/u)?.[1]);
      const right = Number(b.match(/sheet(\d+)/u)?.[1]);
      return left - right;
    });
  if (!sheets.length) throw new Error("XLSX contains no worksheets");
  return sheets.map((name) => ({ name, rows: worksheetRows(xmlEntry(buffer, entries, name), strings) }));
}
