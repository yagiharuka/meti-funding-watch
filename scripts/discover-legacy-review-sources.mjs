import { writeFile, mkdir } from "node:fs/promises";

const years = [2021, 2022, 2023];
const candidates = (year) => [
  `https://www.meti.go.jp/information_2/publicoffer/review${year}/html/index.html`,
  `https://www.meti.go.jp/information_2/publicoffer/review${year}/html/publication_reviewsheet.html`,
];

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
async function fetchText(url) {
  const response = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 meti-funding-watch/1.0", accept: "text/html,*/*" } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

const result = [];
for (const year of years) {
  const all = new Set();
  const roots = [];
  const errors = [];
  for (const url of candidates(year)) {
    try {
      const html = await fetchText(url);
      roots.push(url);
      for (const link of linksFromHtml(html, url)) all.add(link);
    } catch (error) {
      errors.push({ url, error: error instanceof Error ? error.message : String(error) });
    }
  }
  const pages = [...all].filter((url) => url.includes(`/review${year}/`) && /\.html?(?:$|[?#])/.test(url)).slice(0, 250);
  for (const page of pages) {
    try {
      const body = await fetchText(page);
      for (const link of linksFromHtml(body, page)) all.add(link);
    } catch (error) {
      errors.push({ url: page, error: error instanceof Error ? error.message : String(error) });
    }
  }
  const files = [...all].filter((url) => /\.(?:xlsx?|csv|zip|pdf)(?:$|[?#])/i.test(url));
  const counts = {};
  for (const url of files) counts[ext(url)] = (counts[ext(url)] ?? 0) + 1;
  result.push({ year, roots, scannedHtmlPages: pages.length + roots.length, counts, files, errors });
}
await mkdir("data/audits", { recursive: true });
await writeFile("data/audits/legacy-review-source-discovery.json", JSON.stringify({ generatedAt: new Date().toISOString(), result }, null, 2) + "\n");
console.log(JSON.stringify(result.map(({year, roots, scannedHtmlPages, counts, files, errors}) => ({ year, roots, scannedHtmlPages, counts, sample: files.slice(0, 20), errors: errors.slice(0, 10) })), null, 2));
