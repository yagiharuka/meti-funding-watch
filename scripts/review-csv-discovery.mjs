export const REVIEW_CSV_INDEX_URL = "https://rssystem.go.jp/download-csv";

const MAX_MODULE_SCRIPTS = 4;
const MAX_SOURCE_BYTES = 12 * 1024 * 1024;
const CSV_CAPTION_KEY = /\bbudgetAndExecutionCaption\s*:\s*[\w$]+\(\s*["']ps-download-csv-(20\d{2})-page-caption-budget-and-execution["']/;

// The project-search API includes years whose bulk CSVs have not been published.
// Discover the download page's actual catalog instead; never execute its scripts.
export async function discoverPublishedReviewSheetYears({
  fetchResponse = fetch,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  previousYears = [],
} = {}) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const html = await fetchOfficialText(REVIEW_CSV_INDEX_URL, "html", fetchResponse);
      let years = publishedYearsFromHtml(html);
      if (!years.length) {
        const urls = moduleScriptUrls(html);
        if (!urls.length) throw new Error("公式CSVページに年度リンクまたは対応する配布カタログがありません");
        const catalogs = [];
        for (const url of urls) {
          const catalog = publishedYearsFromModule(await fetchOfficialText(url, "javascript", fetchResponse));
          if (catalog.length) catalogs.push(catalog);
        }
        years = consistentCatalog(catalogs);
      }
      if (!years.length) throw new Error("公式CSV配布カタログに2024年度以降がありません");
      const missing = previousYears.filter((year) => !years.includes(year));
      if (missing.length) throw new Error(`公式CSV配布カタログから前回収録年度が欠落しています（${missing.join("・")}年度）`);
      return years;
    } catch (error) {
      lastError = error;
    }
    if (attempt < 3) await sleep(attempt * 1_500);
  }
  throw lastError;
}

export function publishedYearsFromHtml(html) {
  const years = [];
  for (const [tag] of html.matchAll(/<a\b[^>]*>/gi)) {
    const href = attribute(tag, "href");
    if (!href) continue;
    const url = safeOfficialUrl(href);
    const match = url?.pathname.match(/^\/download-csv\/(20\d{2})\/?$/);
    if (match && !url.search && !url.hash) years.push(Number(match[1]));
  }
  return sortedYears(years);
}

export function publishedYearsFromModule(source) {
  const catalogs = [];
  // Only flat catalog arrays containing the CSV-specific caption field qualify.
  // Match values and public property names, not build-dependent minified names.
  for (const [array] of source.matchAll(/\[\s*(?:\{[^{}]{1,2000}\}\s*,?\s*)+\]/g)) {
    const entries = [...array.matchAll(/\{[^{}]*\}/g)].map(([entry]) => entry);
    if (!entries.some((entry) => CSV_CAPTION_KEY.test(entry))) continue;
    const years = entries.map((entry) => {
      const year = entry.match(/\byear\s*:\s*(?:["'](20\d{2})["']|(20\d{2}))\s*[,}]/);
      const caption = entry.match(CSV_CAPTION_KEY);
      const value = Number(year?.[1] ?? year?.[2]);
      if (!year || !caption || value !== Number(caption[1]) || value < 2024) {
        throw new Error("公式CSV配布カタログの年度と配布情報が一致しません");
      }
      return value;
    });
    if (new Set(years).size !== years.length) throw new Error("公式CSV配布カタログに年度の重複があります");
    catalogs.push(sortedYears(years));
  }
  return consistentCatalog(catalogs);
}

export function moduleScriptUrls(html) {
  const urls = [];
  for (const [tag] of html.matchAll(/<script\b[^>]*>/gi)) {
    if (attribute(tag, "type")?.toLowerCase() !== "module") continue;
    const src = attribute(tag, "src");
    if (!src) continue;
    const url = safeOfficialUrl(src);
    if (url && /^\/assets\/[\w.-]+-[\w-]+\.js$/.test(url.pathname) && !url.search && !url.hash) urls.push(url.href);
  }
  const unique = [...new Set(urls)];
  if (unique.length > MAX_MODULE_SCRIPTS) throw new Error("公式CSVページのモジュール数が取得上限を超えています");
  return unique;
}

function attribute(tag, name) {
  return tag.match(new RegExp(`\\s${name}\\s*=\\s*(["'])(.*?)\\1`, "i"))?.[2] ?? null;
}

function safeOfficialUrl(value) {
  // Reject encoded/normalized path tricks rather than interpreting them as links.
  if (/[\\\\%\s]/.test(value) || value.split(/[/?#]/).some((part) => part === "." || part === "..")) return null;
  try {
    const url = new URL(value, REVIEW_CSV_INDEX_URL);
    if (url.origin !== new URL(REVIEW_CSV_INDEX_URL).origin || url.username || url.password) return null;
    return url;
  } catch { return null; }
}

function sortedYears(years) { return [...new Set(years)].filter((year) => year >= 2024).sort((a, b) => a - b); }

function consistentCatalog(catalogs) {
  if (catalogs.some((catalog) => JSON.stringify(catalog) !== JSON.stringify(catalogs[0]))) {
    throw new Error("公式CSVページの配布年度一覧が一致しません");
  }
  return catalogs[0] ?? [];
}

async function fetchOfficialText(url, type, fetchResponse) {
  const response = await fetchResponse(url, {
    headers: {
      accept: type === "html" ? "text/html" : "text/javascript, application/javascript",
      "cache-control": "no-cache",
      "user-agent": "meti-funding-watch/0.1 (+public-data-research)",
    },
    redirect: "error",
    signal: AbortSignal.timeout(3 * 60_000),
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  const contentType = response.headers.get("content-type") ?? "";
  const expectedType = type === "html" ? /^(?:text\/html|application\/xhtml\+xml)(?:;|$)/i : /^(?:text|application)\/(?:x-)?javascript(?:;|$)/i;
  if (!expectedType.test(contentType)) throw new Error(`公式CSV配布情報の形式が不正です（${contentType || "content-type不明"}）`);
  if (Number(response.headers.get("content-length")) > MAX_SOURCE_BYTES) throw new Error("公式CSV配布情報が取得上限サイズを超えています");
  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_SOURCE_BYTES) throw new Error("公式CSV配布情報が取得上限サイズを超えています");
  return text;
}
