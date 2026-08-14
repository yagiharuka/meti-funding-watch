import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

const directory = process.argv[2] ?? ".audit-chubu-2022";
const files = (await readdir(directory)).filter((name) => name.endsWith(".pdf")).sort();
if (files.length !== 6) throw new Error(`expected 6 PDFs, found ${files.length}: ${files.join(", ")}`);

const normalize = (text) => String(text ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
const datePattern = /(?:20\d{2}[年/.]\s*\d{1,2}[月/.]\s*\d{1,2}日?|令和\s*0?4年\s*\d{1,2}月\s*\d{1,2}日)/;
const ordinalPattern = /^\d{1,4}$/;

for (const name of files) {
  const path = join(directory, name);
  const bytes = await readFile(path);
  const sha = createHash("sha256").update(bytes).digest("hex");
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(bytes), disableWorker: true }).promise;
  const pages = [];
  let totalItems = 0;
  const firstPageItems = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items = content.items.map((item) => ({
      text: normalize(item.str),
      x: Number(item.transform?.[4] ?? 0),
      y: Number(item.transform?.[5] ?? 0),
      w: Number(item.width ?? 0),
      h: Number(item.height ?? 0),
    })).filter((item) => item.text);
    totalItems += items.length;
    const ordinalCandidates = items.filter((item) => item.x < viewport.width * 0.12 && ordinalPattern.test(item.text));
    const dateCandidates = items.filter((item) => datePattern.test(item.text));
    pages.push({
      page: pageNumber,
      width: Number(viewport.width.toFixed(2)),
      height: Number(viewport.height.toFixed(2)),
      textItems: items.length,
      ordinalCandidates: ordinalCandidates.length,
      dateCandidates: dateCandidates.length,
    });
    if (pageNumber === 1) {
      firstPageItems.push(...items
        .sort((a, b) => (b.y - a.y) || (a.x - b.x))
        .slice(0, 180)
        .map((item) => ({ text: item.text, x: Number(item.x.toFixed(1)), y: Number(item.y.toFixed(1)) })));
    }
  }
  console.log(`AUDIT ${basename(path)} bytes=${bytes.length} sha256=${sha} pages=${pdf.numPages} items=${totalItems}`);
  console.log(`PAGES ${basename(path)} ${JSON.stringify(pages)}`);
  console.log(`FIRST_PAGE_ITEMS ${basename(path)} ${JSON.stringify(firstPageItems)}`);
}
