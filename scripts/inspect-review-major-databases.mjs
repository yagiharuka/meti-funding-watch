import ExcelJS from "exceljs";
import { mkdir, writeFile } from "node:fs/promises";

const pages = [
  { year: 2025, url: "https://www.gyoukaku.go.jp/review/database/index.html" },
  { year: 2024, url: "https://www.gyoukaku.go.jp/review/database/R04/index.html" },
  { year: 2023, url: "https://www.gyoukaku.go.jp/review/database/R03/index.html" },
];

function absolutize(base, href) {
  try { return new URL(href, base).href; } catch { return null; }
}
function xlsxLinks(html, base) {
  const links = [];
  const re = /href=["']([^"']+\.xlsx(?:\?[^"']*)?)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    const url = absolutize(base, m[1]);
    if (url) links.push(url);
  }
  return [...new Set(links)];
}
function cellText(cell) {
  const value = cell.value;
  if (value == null) return "";
  if (typeof value === "object" && "richText" in value) return value.richText.map((r) => r.text).join("");
  if (typeof value === "object" && "text" in value) return String(value.text ?? "");
  return String(value).replace(/\s+/g, " ").trim();
}

const results = [];
for (const spec of pages) {
  const record = { reviewYear: spec.year, indexUrl: spec.url, status: "pending", indexStatus: null, xlsxUrl: null, xlsxStatus: null, bytes: null, workbook: null, error: null };
  try {
    const page = await fetch(spec.url, { headers: { "user-agent": "Mozilla/5.0 meti-funding-watch/1.0" } });
    record.indexStatus = page.status;
    if (!page.ok) throw new Error(`index HTTP ${page.status}`);
    const html = await page.text();
    const links = xlsxLinks(html, spec.url);
    if (!links.length) throw new Error("xlsx link not found");
    record.xlsxUrl = links[0];
    const response = await fetch(record.xlsxUrl, { headers: { "user-agent": "Mozilla/5.0 meti-funding-watch/1.0" } });
    record.xlsxStatus = response.status;
    if (!response.ok) throw new Error(`xlsx HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    record.bytes = bytes.length;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes);
    record.workbook = { worksheets: [] };
    for (const sheet of wb.worksheets) {
      const interesting = [];
      const firstRows = [];
      for (let r = 1; r <= Math.min(sheet.rowCount, 12); r++) {
        const values = [];
        sheet.getRow(r).eachCell({ includeEmpty: false }, (cell, col) => {
          const text = cellText(cell);
          if (text) {
            values.push({ col, text: text.slice(0, 180) });
            if (/支出先|法人番号|府省|省庁|支出額|事業名|資金の流れ|契約|補助/i.test(text)) interesting.push({ row: r, col, text: text.slice(0, 240) });
          }
        });
        if (values.length) firstRows.push({ row: r, values: values.slice(0, 80) });
      }
      record.workbook.worksheets.push({ name: sheet.name, rowCount: sheet.rowCount, columnCount: sheet.columnCount, firstRows, interesting: interesting.slice(0, 200) });
    }
    record.status = "ok";
  } catch (error) {
    record.status = "error";
    record.error = error instanceof Error ? error.message : String(error);
  }
  results.push(record);
}
await mkdir("data/audits", { recursive: true });
await writeFile("data/audits/review-major-database-inspection.json", JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2) + "\n");
console.log(JSON.stringify(results.map((r) => ({ reviewYear: r.reviewYear, status: r.status, indexStatus: r.indexStatus, xlsxUrl: r.xlsxUrl, xlsxStatus: r.xlsxStatus, bytes: r.bytes, error: r.error, sheets: r.workbook?.worksheets.map((s) => ({ name: s.name, rowCount: s.rowCount, columnCount: s.columnCount, interesting: s.interesting.slice(0, 30) })) })), null, 2));
