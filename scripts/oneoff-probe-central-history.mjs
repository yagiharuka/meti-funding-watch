const headers = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36",
  accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/html;q=0.9,*/*;q=0.1",
};

const candidates = [];
const add = (agency, year, kind, url) => candidates.push({ agency, year, kind, url });

const metiSeries = ["buppin_bid", "itaku_bid", "kouji_bid", "buppin_zuikei", "itaku_zuikei", "kouji_zuikei"];
for (const year of [2017, 2018, 2019, 2020]) {
  const era = year === 2017 ? "H29" : year === 2018 ? "H30" : year === 2019 ? "R1" : "R2";
  for (const series of metiSeries) add("meti", year, `contract:${series}`, `https://www.meti.go.jp/information_2/downloadfiles/${series}_${era}.xlsx`);
}
for (const year of [2017, 2018, 2019, 2020, 2021]) {
  const y = String(year).slice(-2);
  const n = String(year + 1).slice(-2);
  add("meti", year, "grant:h1", `https://www.meti.go.jp/information_2/downloadfiles/subs${y}04_${y}09.xlsx`);
  add("meti", year, "grant:h2", `https://www.meti.go.jp/information_2/downloadfiles/subs${y}10_${n}03.xlsx`);
}

for (const year of [2017, 2018, 2019]) {
  for (const cls of ["kyosonyusatu", "zuikeyaku"]) {
    for (const slug of ["ukeoi", "itaku", "kokyokoji"]) {
      add("jpo", year, `${cls}:${slug}`, `https://www.jpo.go.jp/news/chotatsu/rakusatu/${cls}/document/${year}/${year}_${slug}.xlsx`);
    }
  }
  add("jpo", year, "grant:h1", `https://www.jpo.go.jp/news/chotatsu/rakusatu/hojokin/document/${year}/${year}_04_09.xlsx`);
  add("jpo", year, "grant:h2", `https://www.jpo.go.jp/news/chotatsu/rakusatu/hojokin/document/${year}/${year}_10_03.xlsx`);
}

const smeaSeries = [
  ["competitive-goods", (y) => `nyuusatu_chouhi_${y}.html`],
  ["competitive-commission", (y) => `koukyounyuusatuitaku${y}.html`],
  ["discretionary-goods", (y) => `zuikei_chouhi_${y}.html`],
  ["discretionary-commission", (y) => `zuikei_itaku_${y}.html`],
];
for (const year of [2017, 2018, 2019]) {
  for (const [kind, filename] of smeaSeries) add("smea", year, kind, `https://www.chusho.meti.go.jp/koukai/nyusatsu/zuikei/${filename(year)}`);
  const era = year === 2017 ? "h29" : year === 2018 ? "h30" : "r1";
  add("smea", year, "grant:era-full", `https://www.chusho.meti.go.jp/koukai/nyusatsu/zuikei/zuikei_hojo_${era}fy04_3.html`);
  add("smea", year, "grant:era-h1", `https://www.chusho.meti.go.jp/koukai/nyusatsu/zuikei/zuikei_hojo_${era}fy04_9.html`);
}

for (const year of [2017, 2018, 2019, 2020, 2021, 2022]) {
  for (const half of ["4-9", "10-3", "4_9", "10_3", "04_09", "10_03"]) {
    add("anre", year, `grant:${half}`, `https://www.enecho.meti.go.jp/appli/conclusion/hojokinkoufu/${year}/${year}_${half}.xlsx`);
  }
  for (const dir of ["ippankyousou_chouhi", "ippankyousou_itaku", "zuiikeiyaku_chouhi", "zuiikeiyaku_itaku"]) {
    add("anre", year, `index:${dir}`, `https://www.enecho.meti.go.jp/appli/conclusion/${dir}/${year}/`);
  }
}

async function probe(candidate) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(candidate.url, { headers, redirect: "follow", signal: controller.signal });
    const buffer = Buffer.from(await response.arrayBuffer());
    const magic = buffer.subarray(0, 4).toString("hex");
    const text = buffer.subarray(0, Math.min(buffer.length, 400)).toString("utf8").replace(/\s+/g, " ");
    const xlsx = magic === "504b0304";
    const html = /<!doctype html|<html/i.test(text);
    return { ...candidate, status: response.status, ok: response.ok, bytes: buffer.length, xlsx, html, finalUrl: response.url, contentType: response.headers.get("content-type") };
  } catch (error) {
    return { ...candidate, status: null, ok: false, bytes: 0, xlsx: false, html: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

const results = [];
for (let i = 0; i < candidates.length; i += 8) {
  results.push(...await Promise.all(candidates.slice(i, i + 8).map(probe)));
}

const usable = results.filter((row) => row.ok && (row.xlsx || row.html));
console.log(`CENTRAL_HISTORY_PROBE_SUMMARY=${JSON.stringify({ total: results.length, usable: usable.length, byAgency: Object.fromEntries([...new Set(results.map((r) => r.agency))].map((agency) => [agency, { total: results.filter((r) => r.agency === agency).length, usable: usable.filter((r) => r.agency === agency).length }])) })}`);
for (const row of usable) console.log(`CENTRAL_HISTORY_USABLE=${JSON.stringify(row)}`);
for (const row of results.filter((r) => !r.ok || (!r.xlsx && !r.html))) console.log(`CENTRAL_HISTORY_REJECTED=${JSON.stringify(row)}`);
