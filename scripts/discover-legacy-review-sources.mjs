import { writeFile, mkdir } from "node:fs/promises";

const years = [2021, 2022, 2023];
const bases = years.map((year) => ({
  year,
  index: `https://www.meti.go.jp/information_2/publicoffer/review${year}/html/index.html`,
}));

function absolutize(base, href) {
  try { return new URL(href, base).href; } catch { return null; }
}
function linksFromHtml(html, base) {
  const out = [];
  const re = /href=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    const url = absolutize(base, m[1]);
    if (url) out.push(url);
  }
  return [...new Set(out)];
}
function ext(url) {
  const p = new URL(url).pathname.toLowerCase();
  const m = p.match(/\.([a-z0-9]+)$/);
  return m?.[1] ?? "html";
}

const result = [];
for (const item of bases) {
  const response = await fetch(item.index, { headers: { "user-agent": "meti-funding-watch/1.0" } });
  if (!response.ok) throw new Error(`${item.index}: HTTP ${response.status}`);
  const html = await response.text();
  const firstLinks = linksFromHtml(html, item.index).filter((url) => url.includes(`/review${item.year}/`));
  const pages = firstLinks.filter((url) => /\.html?(?:$|[?#])/.test(url)).slice(0, 100);
  const all = new Set(firstLinks);
  for (const page of pages) {
    try {
      const r = await fetch(page, { headers: { "user-agent": "meti-funding-watch/1.0" } });
      if (!r.ok) continue;
      const body = await r.text();
      for (const link of linksFromHtml(body, page)) all.add(link);
    } catch {}
  }
  const files = [...all].filter((url) => /\.(?:xlsx?|csv|zip|pdf)(?:$|[?#])/i.test(url));
  const counts = {};
  for (const url of files) counts[ext(url)] = (counts[ext(url)] ?? 0) + 1;
  result.push({ year: item.year, index: item.index, scannedHtmlPages: pages.length + 1, counts, files });
}
await mkdir("data/audits", { recursive: true });
await writeFile("data/audits/legacy-review-source-discovery.json", JSON.stringify({ generatedAt: new Date().toISOString(), result }, null, 2) + "\n");
console.log(JSON.stringify(result.map(({year, scannedHtmlPages, counts, files}) => ({ year, scannedHtmlPages, counts, sample: files.slice(0, 20) })), null, 2));
