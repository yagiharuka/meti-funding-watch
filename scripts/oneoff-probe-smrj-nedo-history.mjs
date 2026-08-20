import { createHash } from "node:crypto";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const docs = [
  ...[2017, 2018, 2019].flatMap((year) => [
    {
      agency: "smrj", year, kind: "discretionary",
      url: `https://www.smrj.go.jp/procurement/bid/contract/fbrion000000dvwx-att/zuiikeiyakuhonbu${year}all.pdf`,
    },
    {
      agency: "smrj", year, kind: "competitive",
      url: `https://www.smrj.go.jp/procurement/bid/contract/fbrion000000dvwx-att/nyuusatuhonbu${year}all.pdf`,
    },
  ]),
  { agency: "nedo", year: 2017, kind: "noncompetitive-q1", url: "https://www.nedo.go.jp/content/100867505.pdf" },
  { agency: "nedo", year: 2017, kind: "noncompetitive-q2", url: "https://www.nedo.go.jp/content/100870810.pdf" },
  { agency: "nedo", year: 2017, kind: "noncompetitive-q3", url: "https://www.nedo.go.jp/content/100873968.pdf" },
  { agency: "nedo", year: 2017, kind: "noncompetitive-q4", url: "https://www.nedo.go.jp/content/100878277.pdf" },
  { agency: "nedo", year: 2018, kind: "noncompetitive-q1", url: "https://www.nedo.go.jp/content/100882213.pdf" },
  { agency: "nedo", year: 2018, kind: "noncompetitive-q2", url: "https://www.nedo.go.jp/content/100885610.pdf" },
  { agency: "nedo", year: 2018, kind: "noncompetitive-q3", url: "https://www.nedo.go.jp/content/100888602.pdf" },
  { agency: "nedo", year: 2018, kind: "noncompetitive-q4", url: "https://www.nedo.go.jp/content/100892809.pdf" },
];

const headers = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36",
  accept: "application/pdf,*/*;q=0.1",
};

function sha256(buf) { return createHash("sha256").update(buf).digest("hex"); }
function clean(s) { return String(s ?? "").replace(/[\t\r\n]+/g, " ").replace(/[ 　]+/g, " ").trim(); }

for (const doc of docs) {
  let response;
  try {
    response = await fetch(doc.url, { headers, redirect: "follow", signal: AbortSignal.timeout(20_000) });
  } catch (error) {
    console.log("AGENCY_PDF_FETCH=" + JSON.stringify({ ...doc, ok: false, error: error instanceof Error ? error.message : String(error) }));
    continue;
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const pdfMagic = buffer.subarray(0, 5).toString("ascii") === "%PDF-";
  const meta = { ...doc, status: response.status, ok: response.ok && pdfMagic, bytes: buffer.length, sha256: sha256(buffer), pdfMagic };
  if (!meta.ok) {
    console.log("AGENCY_PDF_FETCH=" + JSON.stringify(meta));
    continue;
  }
  const task = getDocument({ data: new Uint8Array(buffer), disableFontFace: true, isEvalSupported: false, useSystemFonts: false });
  try {
    const pdf = await task.promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent({ disableNormalization: false, includeMarkedContent: false });
    const items = tc.items
      .filter((item) => typeof item.str === "string" && clean(item.str))
      .map((item) => ({
        t: clean(item.str),
        x: Number((item.transform[4] / viewport.width).toFixed(4)),
        y: Number((item.transform[5] / viewport.height).toFixed(4)),
        w: Number(((item.width || 0) / viewport.width).toFixed(4)),
      }));
    const interesting = items.filter((item) =>
      /契約締結日|契約を締結した日|契約金額|法人番号|商号|名称及び数量|契約名称/.test(item.t)
      || /^\d{1,3}$/.test(item.t)
      || /^(?:平成\d+年|\d{2}\.\d{1,2}\.\d{1,2})/.test(item.t)
      || /\d{13}/.test(item.t)
    ).slice(0, 80);
    console.log("AGENCY_PDF_META=" + JSON.stringify({ ...meta, pages: pdf.numPages, width: viewport.width, height: viewport.height, interesting }));
    page.cleanup();
  } catch (error) {
    console.log("AGENCY_PDF_META=" + JSON.stringify({ ...meta, parseError: error instanceof Error ? error.message : String(error) }));
  } finally {
    await task.destroy().catch(() => {});
  }
}
