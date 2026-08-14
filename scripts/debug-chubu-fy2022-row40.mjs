import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

const root = process.argv[2] ?? ".chubu-fy2022-audit";
const names = await readdir(root, { recursive: true });
const rel = names.find((name) => name.endsWith("22-zuikei-itaku.pdf"));
if (!rel) throw new Error("22-zuikei-itaku.pdf not found");
const path = join(root, rel);
const bytes = await readFile(path);
const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(bytes), disableWorker: true }).promise;
const page = await pdf.getPage(9);
const content = await page.getTextContent();
const norm = (v) => String(v ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
const items = content.items.map((item, index) => ({
  index,
  text: norm(item.str),
  x: Number((item.transform?.[4] ?? 0).toFixed(2)),
  y: Number((item.transform?.[5] ?? 0).toFixed(2)),
  w: Number((item.width ?? 0).toFixed(2)),
  h: Number((item.height ?? 0).toFixed(2)),
})).filter((item) => item.text);
console.log(`PAGE9 items=${items.length}`);
for (const item of [...items].sort((a,b)=>(b.y-a.y)||(a.x-b.x))) console.log(JSON.stringify(item));
