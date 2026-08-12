import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CHUGOKU_DOCUMENTS,
  HOKKAIDO_DOCUMENTS,
  parseRegionalOfficialHtml,
  regionalSourceIdentityUrl,
  REGIONAL_CANDIDATE_DOCUMENTS,
  REGIONAL_DOCUMENTS,
  REGIONAL_EVIDENCE_RECEIPTS,
  REGIONAL_OFFICIAL_DOCUMENTS,
  SHIKOKU_DOCUMENTS,
} from "../scripts/official-regional-history.mjs";
import { fetchOfficialDocuments, OFFICIAL_DOCUMENTS, parseOfficialWorkbook } from "../scripts/update-official-data.mjs";

const officialPageSource = await readFile(new URL("../app/official/page.tsx", import.meta.url), "utf8");

test("registers only explicit official-index documents for the three structured regional bureaus", () => {
  assert.equal(CHUGOKU_DOCUMENTS.length, 41);
  assert.equal(HOKKAIDO_DOCUMENTS.length, 21);
  assert.equal(SHIKOKU_DOCUMENTS.length, 84);
  assert.equal(REGIONAL_DOCUMENTS.length, 146);
  assert.equal(REGIONAL_OFFICIAL_DOCUMENTS.length, 18);
  assert.equal(REGIONAL_CANDIDATE_DOCUMENTS.length, 128);
  assert.equal(REGIONAL_EVIDENCE_RECEIPTS.length, 18);
  assert.equal(REGIONAL_EVIDENCE_RECEIPTS.reduce((sum, receipt) => sum + receipt.expectedRecordCount, 0), 388);
  assert.equal(new Set(REGIONAL_DOCUMENTS.map((document) => document.id)).size, REGIONAL_DOCUMENTS.length);
  assert.deepEqual(
    [...REGIONAL_OFFICIAL_DOCUMENTS.map((document) => document.id)].sort(),
    [...REGIONAL_EVIDENCE_RECEIPTS.map((receipt) => receipt.id)].sort(),
  );
  assert.ok(REGIONAL_OFFICIAL_DOCUMENTS.every((document) => OFFICIAL_DOCUMENTS.includes(document)));
  assert.ok(REGIONAL_CANDIDATE_DOCUMENTS.every((document) => !OFFICIAL_DOCUMENTS.includes(document)));

  for (const document of REGIONAL_DOCUMENTS) {
    assert.ok(["chugoku", "hokkaido", "shikoku"].includes(document.executorId));
    assert.ok(["contract_result", "grant_decision"].includes(document.category));
    assert.ok(document.fiscalYear >= 2020 && document.fiscalYear <= 2026);
    assert.equal(new URL(document.url).protocol, "https:");
    assert.equal(new URL(document.sourcePageUrl).protocol, "https:");
    assert.match(document.amountStage, /^(?:契約金額欄|交付決定額欄)の掲載値$/);
    assert.doesNotMatch(document.coverageClaim, /実支払|全支出を網羅/);
  }
  assert.ok(REGIONAL_DOCUMENTS.filter((document) => document.fiscalYear === 2026).every((document) => document.coverageClaim.includes("年度途中")));
  assert.equal(regionalSourceIdentityUrl({ url: "https://warp.example/replay", originalUrl: "https://official.example/file" }), "https://official.example/file");
  assert.match(officialPageSource, /searchableExecutorNames/);
  assert.match(officialPageSource, /searchableSeriesCells/);
  assert.match(officialPageSource, /FY2026は年度途中で、完了年度の件数ではありません/);
  assert.doesNotMatch(officialPageSource, /現在の検索収録は中小企業庁・特許庁/);
});

test("binds every production regional source to one complete evidence receipt", () => {
  const receiptById = new Map(REGIONAL_EVIDENCE_RECEIPTS.map((receipt) => [receipt.id, receipt]));
  for (const document of REGIONAL_OFFICIAL_DOCUMENTS) {
    const receipt = receiptById.get(document.id);
    assert.equal(receipt.url, document.url);
    assert.ok(Number.isSafeInteger(receipt.expectedBytes) && receipt.expectedBytes >= 500);
    assert.match(receipt.expectedSha256, /^[0-9a-f]{64}$/);
    assert.ok(Number.isSafeInteger(receipt.expectedRecordCount) && receipt.expectedRecordCount >= 1);
  }
});

test("replays all 18 exact evidence responses through their strict parser", {
  skip: !process.env.REGIONAL_EVIDENCE_DIRECTORY,
}, async () => {
  const receiptById = new Map(REGIONAL_EVIDENCE_RECEIPTS.map((receipt) => [receipt.id, receipt]));
  const responseByUrl = new Map();
  for (const document of REGIONAL_OFFICIAL_DOCUMENTS) {
    const extension = document.format === "html" ? "html" : "xlsx";
    const buffer = await readFile(`${process.env.REGIONAL_EVIDENCE_DIRECTORY}/${document.id}.${extension}`);
    const receipt = receiptById.get(document.id);
    assert.equal(buffer.length, receipt.expectedBytes, document.id);
    assert.equal(createHash("sha256").update(buffer).digest("hex"), receipt.expectedSha256, document.id);
    const rows = document.format === "html"
      ? parseRegionalOfficialHtml(buffer, document)
      : await parseOfficialWorkbook(buffer, document);
    assert.equal(rows.length, receipt.expectedRecordCount, document.id);
    responseByUrl.set(document.url, buffer);
  }
  const result = await fetchOfficialDocuments(REGIONAL_OFFICIAL_DOCUMENTS, [], async (url) => {
    const buffer = responseByUrl.get(url);
    return new Response(buffer, { status: 200, headers: { "content-length": String(buffer.length) } });
  });
  assert.deepEqual(result.sourceFailures, []);
  assert.equal(result.fetched.length, 18);
  const rows = result.fetched.flatMap((item) => item.records);
  assert.equal(rows.length, 388);
  assert.ok(rows.every((row) => row.sourceKey && row.id && row.sourcePageUrl && row.sourceDocumentUrl));
  assert.equal(new Set(rows.map((row) => row.id)).size, rows.length);
});

test("keeps the exact linked-year gaps visible instead of inventing regional source URLs", () => {
  const categories = (documents, executorId, fiscalYear, category) => documents
    .filter((document) => document.executorId === executorId && document.fiscalYear === fiscalYear && document.category === category);

  assert.deepEqual([...new Set(CHUGOKU_DOCUMENTS.filter((document) => document.category === "contract_result").map((document) => document.fiscalYear))], [2020, 2021, 2022, 2023, 2024, 2025, 2026]);
  assert.equal(categories(CHUGOKU_DOCUMENTS, "chugoku", 2020, "grant_decision").length, 3);
  assert.equal(categories(CHUGOKU_DOCUMENTS, "chugoku", 2026, "grant_decision").length, 0);
  assert.ok(CHUGOKU_DOCUMENTS.every((document) => !document.format || document.format === "xlsx"));

  assert.deepEqual([...new Set(HOKKAIDO_DOCUMENTS.filter((document) => document.category === "contract_result").map((document) => document.fiscalYear))], [2023, 2024, 2025, 2026]);
  assert.deepEqual([...new Set(HOKKAIDO_DOCUMENTS.filter((document) => document.category === "grant_decision").map((document) => document.fiscalYear))], [2022, 2023, 2024, 2025]);
  assert.equal(categories(HOKKAIDO_DOCUMENTS, "hokkaido", 2020, "contract_result").length, 0);

  assert.ok(categories(SHIKOKU_DOCUMENTS, "shikoku", 2020, "contract_result").length > 0);
  for (const year of [2020, 2021, 2022, 2023, 2024, 2025]) {
    assert.equal(categories(SHIKOKU_DOCUMENTS, "shikoku", year, "grant_decision").length, 2);
  }
  assert.equal(categories(SHIKOKU_DOCUMENTS, "shikoku", 2026, "grant_decision").length, 0);
});

test("strictly parses a mapped monthly contract table and preserves null/amount/provenance semantics", () => {
  const document = SHIKOKU_DOCUMENTS.find((candidate) => candidate.id === "shikoku-2025-competitive-goods-202504");
  const rows = parseRegionalOfficialHtml(shikokuContractFixture(), document);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].date, "2025-04-01");
  assert.equal(rows[0].organization, "株式会社テスト");
  assert.equal(rows[0].corporateNumber, "1234567890123");
  assert.equal(rows[0].amount, 1234567);
  assert.equal(rows[0].amountRaw, "1,234,567");
  assert.equal(rows[0].methodRaw, "一般競争（最低価格）");
  assert.equal(rows[0].sourceUrl, document.url);
  assert.match(rows[0].sourceKey, /^shikoku-2025-competitive-goods-202504:[0-9a-f]{24}:1$/);
});

test("fails closed on a shifted mapped header, wrong month, missing charset, and WAF response", () => {
  const document = SHIKOKU_DOCUMENTS.find((candidate) => candidate.id === "shikoku-2025-competitive-goods-202504");
  assert.throws(
    () => parseRegionalOfficialHtml(Buffer.from(shikokuContractFixture().toString().replace("契約を締結した日</th><th>契約の相手方", "契約の相手方の商号又は名称</th><th>契約を締結した日</th><th>契約の相手方")), document),
    /見出しが資料定義と一致しません|主表見出しの列数が一致しません/,
  );
  assert.throws(
    () => parseRegionalOfficialHtml(Buffer.from(shikokuContractFixture().toString().replace("2025年4月1日", "2025年5月1日")), document),
    /月別資料と契約日が一致しません/,
  );
  assert.throws(
    () => parseRegionalOfficialHtml(Buffer.from(shikokuContractFixture().toString().replace('<meta charset="UTF-8">', "")), document),
    /文字コードが未宣言/,
  );
  assert.throws(
    () => parseRegionalOfficialHtml(Buffer.from(`<!doctype html><html><head><meta charset="UTF-8"><title>captcha</title></head><body>${"x".repeat(600)}<div class="awsWaf"></div></body></html>`), document),
    /WAF応答/,
  );
});

test("expands an explicit data rowspan without shifting mapped columns", () => {
  const document = SHIKOKU_DOCUMENTS.find((candidate) => candidate.id === "shikoku-2025-competitive-goods-202504");
  const html = shikokuContractFixture().toString()
    .replace("<td>株式会社テスト</td>", '<td rowspan="2">株式会社テスト</td>')
    .replace("</tr></tbody>", `</tr><tr>${[
      "令和7年度追加業務", "四国経済産業局", "2025年4月2日", "1234567890123", "香川県",
      "一般競争（最低価格）", "非公表", "2,000,000", "非公表", "", "非該当", "", "",
    ].map((value) => `<td>${value}</td>`).join("")}</tr></tbody>`);
  const rows = parseRegionalOfficialHtml(Buffer.from(html), document);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].organization, "株式会社テスト");
  assert.equal(rows[1].date, "2025-04-02");
  assert.equal(rows[1].amount, 2000000);
});

test("routes regional HTML through the official updater and emits the shared public schema", async () => {
  const document = SHIKOKU_DOCUMENTS.find((candidate) => candidate.id === "shikoku-2025-competitive-goods-202504");
  const { fetched, sourceFailures } = await fetchOfficialDocuments([document], [], async () => new Response(shikokuContractFixture(), {
    status: 200,
    headers: { "content-length": String(shikokuContractFixture().length) },
  }));
  assert.deepEqual(sourceFailures, []);
  assert.equal(fetched.length, 1);
  const [record] = fetched[0].records;
  assert.equal(record.executorId, "shikoku");
  assert.equal(record.kind, "競争入札（物品・役務等）");
  assert.equal(record.amountStage, "契約金額欄の掲載値");
  assert.equal(record.sourcePageUrl, document.sourcePageUrl);
  assert.equal(record.sourceDocumentUrl, document.url);
  assert.equal(record.amount, 1234567);
});

function shikokuContractFixture() {
  const headers = [
    "物品役務等の名称及び数量", "契約担当官等の氏名並びにその所属する部局の名称及び所在地", "契約を締結した日",
    "契約の相手方の商号又は名称", "契約の相手方の法人番号", "契約の相手方の住所",
    "一般競争入札・指名競争入札の別（総合評価の実施）", "予定価格（円）", "契約金額（円）", "落札率（％）", "備考",
  ].map((value) => `<th>${value}</th>`).join("");
  const values = [
    "令和7年度テスト業務", "四国経済産業局", "2025年4月1日", "株式会社テスト", "1234567890123", "香川県",
    "一般競争（最低価格）", "非公表", "1,234,567", "非公表", "単価契約", "非該当", "", "",
  ].map((value) => `<td>${value}</td>`).join("");
  return Buffer.from(`<!doctype html><html lang="ja"><head><meta charset="UTF-8"><title>契約締結状況 競争入札 請負契約 令和7年度4月</title></head><body><h1>契約締結状況 競争入札 請負契約 令和7年度4月</h1><table><thead><tr>${headers}<th colspan="3">公益法人の場合</th></tr><tr><th>公益法人の区分</th><th>国所管、都道府県所管の区分</th><th>応札・応募者数</th></tr></thead><tbody><tr>${values}</tr></tbody></table>${" ".repeat(600)}</body></html>`);
}
