import { fileURLToPath } from "node:url";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const STANDARD_FONT_DATA_URL = `${fileURLToPath(new URL("../node_modules/pdfjs-dist/standard_fonts/", import.meta.url))}/`;
const sources = [
  ["smrj-2017-discretionary", "https://www.smrj.go.jp/procurement/bid/contract/fbrion000000dvwx-att/zuiikeiyakuhonbu2017all.pdf"],
  ["smrj-2017-competitive", "https://www.smrj.go.jp/procurement/bid/contract/fbrion000000dvwx-att/nyuusatuhonbu2017all.pdf"],
  ["nedo-2017-q1", "https://www.nedo.go.jp/content/100867505.pdf"],
  ["nedo-2017-q2", "https://www.nedo.go.jp/content/100870810.pdf"],
  ["nedo-2017-q3", "https://www.nedo.go.jp/content/100873968.pdf"],
  ["nedo-2017-q4", "https://www.nedo.go.jp/content/100878277.pdf"],
];

function groupLines(items) {
  const rows = [];
  for (const item of items) {
    if (!item?.str?.trim() || !Array.isArray(item.transform)) continue;
    const x = item.transform[4];
    const y = item.transform[5];
    let row = rows.find((candidate) => Math.abs(candidate.y - y) <= 1.5);
    if (!row) {
      row = { y, items: [] };
      rows.push(row);
    }
    row.items.push({ x, text: item.str.replace(/\s+/g, " ").trim() });
  }
  return rows
    .sort((a, b) => b.y - a.y)
    .map((row) => ({ y: row.y, items: row.items.sort((a, b) => a.x - b.x) }));
}

for (const [id, url] of sources) {
  const response = await fetch(url, { headers: { "user-agent": "Mozilla/5.0", accept: "application/pdf,*/*;q=0.1" }, redirect: "follow" });
  const buffer = Buffer.from(await response.arrayBuffer());
  console.log(`SOURCE ${id} status=${response.status} bytes=${buffer.length} magic=${buffer.subarray(0,5).toString("ascii")}`);
  if (!response.ok || buffer.subarray(0, 5).toString("ascii") !== "%PDF-") continue;
  const loadingTask = getDocument({ data: new Uint8Array(buffer), disableFontFace: true, isEvalSupported: false, standardFontDataUrl: STANDARD_FONT_DATA_URL, useSystemFonts: false });
  const pdf = await loadingTask.promise;
  try {
    console.log(`BEGIN ${id} pages=${pdf.numPages}`);
    const pageLimit = id.startsWith("smrj") ? Math.min(2, pdf.numPages) : Math.min(3, pdf.numPages);
    for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const text = await page.getTextContent({ disableNormalization: false, includeMarkedContent: false });
      const lines = groupLines(text.items);
      console.log(`PAGE ${pageNumber} lines=${lines.length}`);
      for (const line of lines.slice(0, 220)) {
        console.log(`${line.y.toFixed(1)}\t${line.items.map((item) => `[${item.x.toFixed(1)}]${item.text}`).join(" | ")}`);
      }
      page.cleanup();
    }
    console.log(`END ${id}`);
  } finally {
    await pdf.destroy();
  }
}
