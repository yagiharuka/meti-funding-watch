import { createHash } from "node:crypto";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const INDEX = "https://www.jpo.go.jp/news/chotatsu/rakusatu/sougou/h29.html";
const headers = { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36", accept: "text/html,application/pdf,*/*;q=0.1" };
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const clean = (v) => String(v ?? "").normalize("NFKC").replace(/[\t\r\n]+/g, " ").replace(/[ 　]+/g, " ").trim();

const indexResponse = await fetch(INDEX, { headers, redirect: "follow", signal: AbortSignal.timeout(20_000) });
if (!indexResponse.ok) throw new Error(`JPO H29 index HTTP ${indexResponse.status}`);
const html = await indexResponse.text();
const hrefs = [...html.matchAll(/href=["']([^"']+\.pdf(?:\?[^"']*)?)["']/gi)]
  .map((m) => new URL(m[1], INDEX).href)
  .filter((url) => /\/sougou\/document\/h29\//.test(url));
const urls = [...new Set(hrefs)];
if (!urls.length || urls.length > 100) throw new Error(`JPO H29 PDF links unexpected: ${urls.length}`);
console.log(`JPO_H29_INDEX=${JSON.stringify({ pdfCount: urls.length, index: INDEX })}`);

for (const url of urls) {
  const response = await fetch(url, { headers, redirect: "follow", signal: AbortSignal.timeout(20_000) });
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!response.ok || buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
    console.log(`JPO_H29_PDF=${JSON.stringify({ url, status: response.status, bytes: buffer.length, ok: false })}`);
    continue;
  }
  const task = getDocument({ data: new Uint8Array(buffer), disableFontFace: true, isEvalSupported: false, useSystemFonts: false });
  try {
    const pdf = await task.promise;
    const all = [];
    for (let p = 1; p <= pdf.numPages; p += 1) {
      const page = await pdf.getPage(p);
      const vp = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent({ disableNormalization: false, includeMarkedContent: false });
      for (const item of tc.items) {
        if (typeof item.str !== "string" || !clean(item.str)) continue;
        all.push({ p, t: clean(item.str), x: Number((item.transform[4] / vp.width).toFixed(4)), y: Number((item.transform[5] / vp.height).toFixed(4)), w: Number(((item.width || 0) / vp.width).toFixed(4)) });
      }
      page.cleanup();
    }
    const interesting = all.filter((item) => /調達件名|契約日|落札者名|法人番号|落札価格|円$|平成29年|平成30年/.test(item.t)).slice(0, 80);
    console.log(`JPO_H29_PDF=${JSON.stringify({ url, status: response.status, ok: true, bytes: buffer.length, sha256: sha256(buffer), pages: pdf.numPages, interesting })}`);
  } finally { await task.destroy().catch(() => {}); }
}
