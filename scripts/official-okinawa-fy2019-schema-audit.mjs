import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { getDocument, Util } from "pdfjs-dist/legacy/build/pdf.mjs";

const DIRECTORY = path.resolve(".audit/okinawa-historical");
const COLUMNS = [
  ["ordinal", 0.03],
  ["program", 0.055],
  ["organization", 0.25],
  ["amount", 0.38],
  ["account", 0.448],
  ["budgetItem", 0.57],
  ["date", 0.75],
  ["publicInterestClass", 0.84],
  ["jurisdictionClass", 0.89],
];
const SOURCES = [
  { filename: "2019-31fyhojokamiki.pdf", expectedRowsPerPage: [16, 16] },
  { filename: "2019-31fyhojoshimoki.pdf", expectedRowsPerPage: [3] },
];

function normalize(text) {
  return text.normalize("NFC").replace(/\s+/gu, " ").trim();
}

function itemGeometry(raw, viewport) {
  const [, , transformedSkewX, transformedScaleY, transformedX, transformedTopY] = Util.transform(viewport.transform, raw.transform ?? []);
  const x = transformedX;
  const y = viewport.height - transformedTopY;
  const width = Math.max(Number(raw.width) || 0, 0);
  const height = Math.max(Math.hypot(transformedSkewX, transformedScaleY), Math.abs(Number(raw.height)), 1);
  return { x, y, width, height, centerX: x + width / 2, centerY: y + height / 2 };
}

function dateThenTextSplit(item, viewport) {
  const dateLeft = COLUMNS.find((column) => column[0] === "date")[1] * viewport.width;
  const nextLeft = COLUMNS.find((column) => column[0] === "publicInterestClass")[1] * viewport.width;
  if (item.x < dateLeft || item.x >= nextLeft || item.x + item.width <= nextLeft) return false;
  return /^(?:(?:平成|令和)[元\d]+年)\d{1,2}月\d{1,2}日\s*(\S.*)$/u.test(item.text);
}

const documents = [];
for (const source of SOURCES) {
  const bytes = await readFile(path.join(DIRECTORY, source.filename));
  const loadingTask = getDocument({ data: new Uint8Array(bytes), disableFontFace: true, useSystemFonts: false, isEvalSupported: false });
  try {
    const pdf = await loadingTask.promise;
    const pages = [];
    let nonEmptyPositionedTextItems = 0;
    let dateThenTextSplitMatches = 0;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent({ disableNormalization: false, includeMarkedContent: false });
      const positioned = [];
      for (const raw of content.items) {
        if (!raw || typeof raw.str !== "string" || !raw.str.trim()) continue;
        const text = normalize(raw.str);
        const item = { text, ...itemGeometry(raw, viewport) };
        positioned.push(item);
        if (dateThenTextSplit(item, viewport)) dateThenTextSplitMatches += 1;
      }
      nonEmptyPositionedTextItems += positioned.length;
      const ordinalLeft = COLUMNS[0][1] * viewport.width;
      const programLeft = COLUMNS[1][1] * viewport.width;
      const ordinalCandidates = positioned
        .filter((item) => item.centerX >= ordinalLeft && item.centerX < programLeft && /^\d{1,3}$/u.test(item.text))
        .map((item) => Number(item.text))
        .sort((a, b) => a - b);
      pages.push({
        pageNumber,
        width: viewport.width,
        height: viewport.height,
        rawTextContentItems: content.items.length,
        nonEmptyPositionedTextItems: positioned.length,
        ordinalCandidates,
      });
      page.cleanup();
    }
    documents.push({
      ...source,
      pageCount: pdf.numPages,
      nonEmptyPositionedTextItems,
      dateThenTextSplitMatches,
      positionedTextItemsAfterSplit: nonEmptyPositionedTextItems + dateThenTextSplitMatches,
      pages,
    });
  } finally {
    await loadingTask.destroy().catch(() => {});
  }
}

const report = { schemaVersion: 1, checkedAt: new Date().toISOString(), documents };
await writeFile(path.join(DIRECTORY, "fy2019-schema.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report));
