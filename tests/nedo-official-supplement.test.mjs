import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  NEDO_SEARCH_URL,
  parseNedoCompanyHtml,
  parseNedoListingHtml,
  refreshNedoOfficialSupplement,
} from "../scripts/nedo-official-supplement.mjs";

function listingHtml(count = 50) {
  return `<html><body>${Array.from({ length: count }, (_, index) => {
    const slug = index % 2 === 0 ? `company${64 + index}` : `company_${String(index).padStart(5, "0")}`;
    return `<a href="/activities/startups/${slug}.html?from=test#detail">company ${index}</a>`;
  }).join("\n")}<!--${"x".repeat(20_000)}--></body></html>`;
}

function companyHtml({
  organization = "京都フュージョニアリング株式会社",
  program = "GX分野のディープテック・スタートアップに対する実用化研究開発・量産化実証支援事業",
  themeLabel = "研究開発テーマ",
  theme = "高出力・連続運転ミリ波発生装置の開発と深部地熱等への応用",
  phase = "STS",
  years = "2024～2026年度",
  amount = "499百万円",
} = {}) {
  return `<html><body>
<h1>${organization}</h1>
<h3>事業名</h3><p>${program}</p>
<h3>${themeLabel}</h3><p>${theme}</p>
<h3>事業概要</h3><p>概要</p>
<div>フェーズ</div><div>事業領域・分野</div><div>助成事業年度</div><div>交付決定額</div>
<div>${phase}</div><div>エネルギー・インフラ</div><div>${years}</div><div>${amount}</div>
<!--${"x".repeat(2_000)}-->
</body></html>`;
}

test("NEDO listing parser normalizes current and underscore company links and fails closed when the list is too small", () => {
  const links = parseNedoListingHtml(listingHtml(), NEDO_SEARCH_URL);
  assert.equal(links.length, 50);
  assert.equal(links[0], "https://www.nedo.go.jp/activities/startups/company100.html");
  assert.ok(links.includes("https://www.nedo.go.jp/activities/startups/company_00001.html"));
  assert.throws(() => parseNedoListingHtml(listingHtml(49), NEDO_SEARCH_URL), /少なすぎます/);
});

test("NEDO GX detail parser preserves grant-decision semantics", () => {
  const sourceUrl = "https://www.nedo.go.jp/activities/startups/company67.html";
  const row = parseNedoCompanyHtml(companyHtml(), sourceUrl);
  assert.deepEqual(row, {
    id: "nedo-startup-company67",
    organization: "京都フュージョニアリング株式会社",
    corporateNumber: "",
    fiscalYear: 2024,
    date: null,
    program: "GX分野のディープテック・スタートアップに対する実用化研究開発・量産化実証支援事業",
    theme: "高出力・連続運転ミリ波発生装置の開発と深部地熱等への応用",
    phase: "STS",
    supportYears: "2024～2026年度",
    category: "grant_decision",
    amountStage: "交付決定額",
    amount: 499_000_000,
    sourceUrl,
    sourcePageUrl: NEDO_SEARCH_URL,
    sourceKey: "nedo-startup-company67",
  });
});

test("NEDO DTSU parser accepts 助成事業名, underscore URLs, year variants and 万円", () => {
  const sourceUrl = "https://www.nedo.go.jp/activities/startups/company_00045.html";
  const row = parseNedoCompanyHtml(companyHtml({
    organization: "株式会社Holoway",
    program: "ディープテック・スタートアップ支援事業業",
    themeLabel: "助成事業名",
    theme: "次世代半導体パッケージ検査装置の開発及び実証",
    phase: "PCA",
    years: "2025年-2027年",
    amount: "29,200万円",
  }), sourceUrl);
  assert.equal(row.id, "nedo-startup-company_00045");
  assert.equal(row.program, "ディープテック・スタートアップ支援事業");
  assert.equal(row.theme, "次世代半導体パッケージ検査装置の開発及び実証");
  assert.equal(row.phase, "PCA");
  assert.equal(row.supportYears, "2025～2027年度");
  assert.equal(row.fiscalYear, 2025);
  assert.equal(row.amount, 292_000_000);
});

test("NEDO parser leaves non-public amounts out instead of converting them to zero", () => {
  const sourceUrl = "https://www.nedo.go.jp/activities/startups/company99.html";
  assert.equal(parseNedoCompanyHtml(companyHtml({ amount: "非公開" }), sourceUrl), null);
  assert.equal(parseNedoCompanyHtml(companyHtml({ amount: "ー" }), sourceUrl), null);
  assert.throws(
    () => parseNedoCompanyHtml(companyHtml({ amount: "未確認" }), sourceUrl),
    /交付決定額を解析できません/,
  );
  assert.throws(
    () => parseNedoCompanyHtml(companyHtml({ program: "別事業" }), sourceUrl),
    /事業名を判定できません/,
  );
});

test("NEDO refresh accounts for every listing page and refuses to overwrite an existing amount", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nedo-supplement-"));
  const outputPath = join(dir, "nedo.json");
  try {
    const existingUrl = "https://www.nedo.go.jp/activities/startups/company64.html";
    const existing = parseNedoCompanyHtml(companyHtml({ amount: "500百万円" }), existingUrl);
    await writeFile(outputPath, `${JSON.stringify({ schemaVersion: 1, id: "nedo", records: [existing] })}\n`);

    const fetchImpl = async (url) => {
      const value = String(url);
      if (value === NEDO_SEARCH_URL) return new Response(listingHtml(50), { status: 200 });
      const index = Number(value.match(/company(?:_0*)?(\d+)\.html/u)?.[1] ?? 0);
      const amount = index === 64 ? "499百万円" : index % 17 === 0 ? "非公開" : "100百万円";
      return new Response(companyHtml({
        organization: `株式会社テスト${index}`,
        theme: `研究開発テーマ${index}`,
        amount,
      }), { status: 200 });
    };

    await assert.rejects(
      refreshNedoOfficialSupplement({ fetchImpl, outputPath }),
      /既存行の識別項目が変わりました|既存行の公表金額が変わりました/,
    );
    const after = JSON.parse(await readFile(outputPath, "utf8"));
    assert.equal(after.records[0].amount, 500_000_000, "失敗時は既存の検証済みデータを保持する");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
