import { createHash } from "node:crypto";

const CAPTURE = "20260602/20260601000000";
const headers = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36",
  accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/html;q=0.9,*/*;q=0.1",
};
const candidates = [
  ["meti", 2017, "contract", "https://www.meti.go.jp/information_2/downloadfiles/buppin_bid_H29.xlsx"],
  ["meti", 2017, "grant", "https://www.meti.go.jp/information_2/downloadfiles/subs1704_1709.xlsx"],
  ["meti", 2019, "contract", "https://www.meti.go.jp/information_2/downloadfiles/buppin_bid_R1.xlsx"],
  ["meti", 2019, "grant", "https://www.meti.go.jp/information_2/downloadfiles/subs1904_1909.xlsx"],
  ["jpo", 2017, "contract", "https://www.jpo.go.jp/news/chotatsu/rakusatu/kyosonyusatu/document/2017/2017_ukeoi.xlsx"],
  ["jpo", 2019, "contract", "https://www.jpo.go.jp/news/chotatsu/rakusatu/kyosonyusatu/document/2019/2019_ukeoi.xlsx"],
  ["smea", 2017, "grant", "https://www.chusho.meti.go.jp/koukai/nyusatsu/zuikei/zuikei_hojo_h29fy04_3.html"],
  ["smea", 2019, "grant", "https://www.chusho.meti.go.jp/koukai/nyusatsu/zuikei/zuikei_hojo_r1fy04_3.html"],
  ["anre", 2017, "grant", "https://www.enecho.meti.go.jp/appli/conclusion/hojokinkoufu/2017/2017_4-9.xlsx"],
  ["anre", 2019, "grant", "https://www.enecho.meti.go.jp/appli/conclusion/hojokinkoufu/2019/2019_4-9.xlsx"],
];

function sha256(buffer) { return createHash("sha256").update(buffer).digest("hex"); }
function warp(url) { return `https://warp.ndl.go.jp/${CAPTURE}/${url}`; }

async function probe([agency, year, kind, originalUrl]) {
  const url = warp(originalUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, { headers, redirect: "follow", signal: controller.signal });
    const buffer = Buffer.from(await response.arrayBuffer());
    const text = buffer.subarray(0, Math.min(buffer.length, 2000)).toString("utf8");
    const xlsx = buffer.subarray(0, 4).toString("hex") === "504b0304";
    const officialHtml = buffer.length > 5000 && /<html|<!doctype/i.test(text) && /契約|補助金|交付決定/.test(buffer.toString("utf8"));
    return { agency, year, kind, originalUrl, warpUrl: url, status: response.status, finalUrl: response.url, bytes: buffer.length, sha256: sha256(buffer), xlsx, officialHtml };
  } catch (error) {
    return { agency, year, kind, originalUrl, warpUrl: url, status: null, bytes: 0, xlsx: false, officialHtml: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

const results = await Promise.all(candidates.map(probe));
console.log(`CENTRAL_WARP_QUICK_SUMMARY=${JSON.stringify({ total: results.length, actual: results.filter((r) => r.xlsx || r.officialHtml).length })}`);
for (const row of results) console.log(`CENTRAL_WARP_QUICK=${JSON.stringify(row)}`);
