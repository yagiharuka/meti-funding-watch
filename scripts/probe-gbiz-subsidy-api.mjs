import { mkdir, writeFile } from "node:fs/promises";

const token = process.env.GBIZINFO_API_TOKEN?.trim();
if (!token) throw new Error("GBIZINFO_API_TOKEN is not configured");

const outputDirectory = new URL("../gbiz-api-probe/", import.meta.url);
const corporateNumbers = [
  "1000020140007",
  "1000020290009",
  "1010505000765",
  "2230005000235",
  "5000020240001",
];
const versions = ["v1", "v2"];

await mkdir(outputDirectory, { recursive: true });

const startedAt = new Date().toISOString();
const requests = [];

for (const version of versions) {
  for (const corporateNumber of corporateNumbers) {
    const url = `https://info.gbiz.go.jp/hojin/${version}/hojin/${corporateNumber}/subsidy`;
    const fetchedAt = new Date().toISOString();
    let response;
    let text;
    try {
      response = await fetch(url, {
        headers: {
          accept: "application/json",
          "X-hojinInfo-api-token": token,
          "user-agent": "meti-funding-watch/0.1 (+public-data-research)",
        },
        signal: AbortSignal.timeout(60_000),
      });
      text = await response.text();
    } catch (error) {
      requests.push({
        version,
        corporateNumber,
        url,
        fetchedAt,
        fetchError: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = { nonJsonBody: text.slice(0, 10_000) };
    }

    requests.push({
      version,
      corporateNumber,
      url,
      fetchedAt,
      httpStatus: response.status,
      contentType: response.headers.get("content-type"),
      responseBytes: Buffer.byteLength(text, "utf8"),
      rootKeys: isObject(body) ? Object.keys(body) : [],
      keyPaths: collectKeyPaths(body),
      body,
    });
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

const report = {
  startedAt,
  completedAt: new Date().toISOString(),
  corporateNumbers,
  authentication: {
    configured: true,
    tokenValueRecorded: false,
    headerName: "X-hojinInfo-api-token",
  },
  requests,
};

await writeFile(
  new URL("report.json", outputDirectory),
  `${JSON.stringify(report, null, 2)}\n`,
);

const summary = renderSummary(report);
await writeFile(new URL("summary.md", outputDirectory), summary);
console.log(summary);

if (!requests.some((request) => request.httpStatus >= 200 && request.httpStatus < 300)) {
  throw new Error("No authenticated Gbiz subsidy API request succeeded");
}

function collectKeyPaths(value) {
  const paths = new Set();
  visit(value, "$");
  return [...paths].sort();

  function visit(current, path) {
    if (Array.isArray(current)) {
      paths.add(`${path}[]`);
      for (const item of current) visit(item, `${path}[]`);
      return;
    }
    if (!isObject(current)) return;
    for (const [key, item] of Object.entries(current)) {
      const childPath = `${path}.${key}`;
      paths.add(childPath);
      visit(item, childPath);
    }
  }
}

function renderSummary({ startedAt: start, completedAt, requests: items }) {
  const lines = [
    "# GビズINFO 補助金API 実データ検証",
    "",
    `- 開始: ${start}`,
    `- 完了: ${completedAt}`,
    "- 認証: GitHub Actions Secret `GBIZINFO_API_TOKEN` を `X-hojinInfo-api-token` ヘッダーに設定（値は記録していません）",
    "",
    "| API | 法人番号 | HTTP | bytes | ルートキー |",
    "|---|---:|---:|---:|---|",
  ];
  for (const item of items) {
    lines.push(
      `| ${item.version} | ${item.corporateNumber} | ${item.httpStatus ?? "取得失敗"} | ${item.responseBytes ?? "-"} | ${(item.rootKeys ?? []).join(" / ") || "-"} |`,
    );
  }
  lines.push("", "## レスポンス内のキーパス", "");
  for (const item of items) {
    lines.push(`### ${item.version} / ${item.corporateNumber}`, "");
    if (item.fetchError) {
      lines.push(`- 取得エラー: ${item.fetchError}`, "");
      continue;
    }
    for (const path of item.keyPaths ?? []) lines.push(`- \`${path}\``);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
