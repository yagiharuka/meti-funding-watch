import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  AIST_LIST_URLS,
  parseAistAwardHtml,
  parseAistListingHtml,
  refreshAistOfficialSupplement,
} from "../scripts/aist-official-supplement.mjs";

const LIST_URL = AIST_LIST_URLS[0];

function listingHtml(count = 5, prefix = "TEST") {
  return `<html><body>${Array.from({ length: count }, (_, index) =>
    `<a href="/aist_j/procure/supplyinfo/pub/detail/${prefix}${index}">テスト装置${index}の落札者等の公表</a>`).join("\n")}<!--${"x".repeat(1200)}--></body></html>`;
}

function detailFor(id, { amount = "12,980,000", organization = "株式会社セック", corporateNumber = "1010901026918" } = {}) {
  return `
<html><body>
<h1>AIモデルと研究データの実装共有プラットフォームの主システムの作成の落札者等の公表 - 産総研：調達情報</h1>
<div>2025年12月25日付けで入札公告した上記の件について、下記の者が落札しましたので公表いたします。<br>
契約日：2026年1月29日<br>
契約相手方：${organization}（東京都世田谷区用賀4丁目10番1号）<br>
（法人番号：${corporateNumber}）<br>
競争入札の区分：一般競争入札<br>
予定価格：非公表<br>
契約金額：${amount}円（税込額）<br>
落札率：非公表</div>
<!-- ${id} ${"x".repeat(1200)} -->
</body></html>`;
}

const detailHtml = detailFor("IRVBWXCN");

test("AIST listing parser keeps only award detail links and fails closed on too few links", () => {
  const rows = parseAistListingHtml(listingHtml(5), LIST_URL);
  assert.equal(rows.length, 5);
  assert.equal(rows[0].url, "https://www.aist.go.jp/aist_j/procure/supplyinfo/pub/detail/TEST0");
  assert.equal(rows[0].title, "テスト装置0");
  assert.throws(() => parseAistListingHtml(listingHtml(4), LIST_URL), /少なすぎます/);
  assert.throws(() => parseAistListingHtml("<html><body>layout changed</body></html>", LIST_URL), /少なすぎます/);
});

test("AIST detail parser preserves contract amount semantics and fiscal year", () => {
  const row = parseAistAwardHtml(detailHtml, "https://www.aist.go.jp/aist_j/procure/supplyinfo/pub/detail/IRVBWXCN");
  assert.deepEqual(row, {
    id: "aist-IRVBWXCN",
    organization: "株式会社セック",
    corporateNumber: "1010901026918",
    fiscalYear: 2025,
    date: "2026-01-29",
    program: "AIモデルと研究データの実装共有プラットフォームの主システムの作成",
    theme: "",
    phase: "",
    supportYears: "",
    category: "contract_result",
    amountStage: "契約金額（税込額）",
    amount: 12_980_000,
    sourceUrl: "https://www.aist.go.jp/aist_j/procure/supplyinfo/pub/detail/IRVBWXCN",
    sourcePageUrl: "https://www.aist.go.jp/aist_j/procure/supplyinfo/pub/detail/IRVBWXCN",
    sourceKey: "aist-IRVBWXCN",
  });
});

test("AIST detail parser rejects missing identity or amount fields instead of publishing partial rows", () => {
  assert.throws(
    () => parseAistAwardHtml(detailHtml.replace("（法人番号：1010901026918）", ""), "https://www.aist.go.jp/aist_j/procure/supplyinfo/pub/detail/BAD1"),
    /法人番号を取得できません/,
  );
  assert.throws(
    () => parseAistAwardHtml(detailHtml.replace("契約金額：12,980,000円（税込額）", "契約金額：非公表"), "https://www.aist.go.jp/aist_j/procure/supplyinfo/pub/detail/BAD2"),
    /契約金額を取得できません/,
  );
});

test("AIST refresh refuses to overwrite a previously verified amount for the same detail ID", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aist-supplement-"));
  const outputPath = join(dir, "aist.json");
  try {
    const sourceUrl = "https://www.aist.go.jp/aist_j/procure/supplyinfo/pub/detail/I0";
    const previous = parseAistAwardHtml(detailFor("I0", { amount: "12,980,001" }), sourceUrl);
    await writeFile(outputPath, `${JSON.stringify({ schemaVersion: 1, records: [previous] })}\n`);

    const fetchImpl = async (url) => {
      const value = String(url);
      if (value === AIST_LIST_URLS[0]) return new Response(listingHtml(10, "I"), { status: 200 });
      if (value === AIST_LIST_URLS[1]) return new Response(listingHtml(10, "G"), { status: 200 });
      const id = new URL(value).pathname.split("/").at(-1);
      return new Response(detailFor(id), { status: 200 });
    };

    await assert.rejects(
      refreshAistOfficialSupplement({ fetchImpl, outputPath }),
      /既存行の公表金額が変わりました: aist-I0/,
    );
    const after = JSON.parse(await readFile(outputPath, "utf8"));
    assert.equal(after.records[0].amount, 12_980_001, "失敗時は既存の検証済みデータを保持する");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("committed AIST supplement contains only verified contract rows and explicit non-coverage", async () => {
  const data = JSON.parse(await readFile("data/official-supplement-aist.json", "utf8"));
  assert.equal(data.schemaVersion, 1);
  assert.equal(data.id, "aist");
  assert.ok(data.records.length >= 4);
  assert.match(data.coverageNote, /全契約.*網羅.*ものではない/);
  for (const row of data.records) {
    assert.match(row.id, /^aist-/);
    assert.equal(row.category, "contract_result");
    assert.match(row.amountStage, /^契約金額（.+）$/u);
    assert.match(row.corporateNumber, /^\d{13}$/);
    assert.ok(Number.isSafeInteger(row.amount));
    assert.match(row.sourceUrl, /^https:\/\/www\.aist\.go\.jp\/aist_j\/procure\/supplyinfo\/pub\/detail\//);
  }
});
