import assert from "node:assert/strict";
import test from "node:test";

import ExcelJS from "exceljs";

import {
  ANRE_OFFICIAL_DOCUMENTS,
  ANRE_CANDIDATE_DOCUMENTS,
  METI_ANRE_CANDIDATE_DOCUMENTS,
  METI_ANRE_OFFICIAL_DOCUMENTS,
  METI_ANRE_REGISTRY_GAPS,
  METI_ANRE_SCHEMA_RECEIPTS,
  METI_ANRE_UNVERIFIED_CANDIDATES,
  METI_CANDIDATE_DOCUMENTS,
  METI_OFFICIAL_DOCUMENTS,
} from "../scripts/official-meti-anre-history.mjs";
import { OFFICIAL_DOCUMENTS, parseOfficialWorkbook } from "../scripts/update-official-data.mjs";

const ids = new Set(METI_ANRE_CANDIDATE_DOCUMENTS.map((document) => document.id));
const productionIds = new Set(METI_ANRE_OFFICIAL_DOCUMENTS.map((document) => document.id));

test("keeps the 94-URL inventory separate and registers only six receipted workbooks", () => {
  assert.equal(METI_CANDIDATE_DOCUMENTS.length, 38);
  assert.equal(ANRE_CANDIDATE_DOCUMENTS.length, 56);
  assert.equal(METI_ANRE_CANDIDATE_DOCUMENTS.length, 94);
  assert.equal(METI_OFFICIAL_DOCUMENTS.length, 4);
  assert.equal(ANRE_OFFICIAL_DOCUMENTS.length, 2);
  assert.equal(METI_ANRE_OFFICIAL_DOCUMENTS.length, 6);
  assert.equal(METI_ANRE_UNVERIFIED_CANDIDATES.length, 88);
  assert.equal(ids.size, METI_ANRE_CANDIDATE_DOCUMENTS.length);
  assert.equal(new Set(METI_ANRE_CANDIDATE_DOCUMENTS.map((document) => document.url)).size, METI_ANRE_CANDIDATE_DOCUMENTS.length);
  assert.ok(Object.isFrozen(METI_ANRE_CANDIDATE_DOCUMENTS));
  assert.ok(Object.isFrozen(METI_ANRE_OFFICIAL_DOCUMENTS));

  for (const fiscalYear of [2021, 2022, 2023, 2024, 2025]) {
    for (const suffix of [
      "competitive-goods", "competitive-commission", "competitive-public-works",
      "discretionary-goods", "discretionary-commission", "discretionary-public-works",
    ]) {
      assert.ok(ids.has(`meti-${fiscalYear}-${suffix}`));
    }
  }
  for (const fiscalYear of [2022, 2023, 2024, 2025]) {
    assert.ok(ids.has(`meti-${fiscalYear}-grant-decisions-h1`));
    assert.ok(ids.has(`meti-${fiscalYear}-grant-decisions-h2`));
  }
  assert.ok(ids.has("anre-2025-competitive-commission-04"));
  assert.ok(ids.has("anre-2024-competitive-commission-03"));
  assert.ok(ids.has("anre-2024-discretionary-commission-12"));
  assert.ok(ids.has("anre-2023-grant-decisions-h1"));
  assert.ok(ids.has("anre-2023-grant-decisions-h2"));
  assert.ok(ids.has("anre-2025-grant-decisions-h1"));
  assert.ok(ids.has("anre-2025-grant-decisions-h2"));

  assert.match(
    METI_CANDIDATE_DOCUMENTS.find((document) => document.id === "meti-2021-competitive-goods").url,
    /buppin_bid_R3\.xlsx$/,
  );
  assert.match(
    METI_CANDIDATE_DOCUMENTS.find((document) => document.id === "meti-2023-discretionary-commission").url,
    /itaku_zuikei_R5\.xlsx$/,
  );
  assert.match(
    METI_CANDIDATE_DOCUMENTS.find((document) => document.id === "meti-2024-competitive-goods").url,
    /buppin_bid_r6\.xlsx$/,
  );

  const updaterIds = new Set(OFFICIAL_DOCUMENTS.map((document) => document.id));
  assert.deepEqual([...productionIds].sort(), Object.keys(METI_ANRE_SCHEMA_RECEIPTS).sort());
  assert.ok([...productionIds].every((id) => updaterIds.has(id)));
  assert.ok(METI_ANRE_UNVERIFIED_CANDIDATES.every((document) => !updaterIds.has(document.id)));
  assert.ok(METI_ANRE_OFFICIAL_DOCUMENTS.every((document) =>
    document.discoveryStatus === "full_get_and_strict_parse_verified"
    && document.evidenceReceipt.expectedMagic === METI_ANRE_SCHEMA_RECEIPTS[document.id].magic
    && document.evidenceReceipt.expectedBytes === METI_ANRE_SCHEMA_RECEIPTS[document.id].bytes
    && document.evidenceReceipt.expectedSha256 === METI_ANRE_SCHEMA_RECEIPTS[document.id].sha256
    && document.evidenceReceipt.expectedRecordCount === METI_ANRE_SCHEMA_RECEIPTS[document.id].records));
});

test("keeps every candidate official, typed, and separate from G Biz INFO", () => {
  for (const document of METI_ANRE_CANDIDATE_DOCUMENTS) {
    assert.ok(Object.isFrozen(document), document.id);
    assert.ok(["meti", "anre"].includes(document.executorId), document.id);
    assert.equal(document.format, "xlsx");
    assert.equal(document.verifiedAt, "2026-08-12");
    assert.ok(["contract_result", "grant_decision"].includes(document.category));
    assert.match(document.amountStage, document.category === "contract_result" ? /契約金額/ : /交付決定額/);
    assert.equal(document.multiplePartyPolicy, "one_official_row");
    assert.ok(Number.isSafeInteger(document.expectedSheetCount) && document.expectedSheetCount > 0);
    assert.doesNotMatch(`${document.url} ${document.sourcePageUrl}`, /gbiz|info\.gbiz/i);
    assert.doesNotMatch(document.coverageClaim, /実支払|全支出|下流|全年度/);

    const url = new URL(document.url);
    assert.equal(url.protocol, "https:");
    assert.ok(["www.meti.go.jp", "www.enecho.meti.go.jp"].includes(url.hostname));
    assert.ok(url.pathname.endsWith(".xlsx"));
  }
});

test("pins parser receipts for the six native XLSX shapes inspected in this increment", () => {
  assert.equal(Object.keys(METI_ANRE_SCHEMA_RECEIPTS).length, 6);
  assert.equal(Object.values(METI_ANRE_SCHEMA_RECEIPTS).reduce((sum, receipt) => sum + receipt.records, 0), 1_503);
  for (const [id, receipt] of Object.entries(METI_ANRE_SCHEMA_RECEIPTS)) {
    assert.ok(ids.has(id), id);
    assert.ok(productionIds.has(id), id);
    assert.equal(receipt.magic, "504b0304", id);
    assert.ok(Number.isSafeInteger(receipt.bytes) && receipt.bytes > 10_000, id);
    assert.match(receipt.sha256, /^[0-9a-f]{64}$/, id);
    assert.ok(Number.isSafeInteger(receipt.records) && receipt.records > 0, id);
  }
});

test("parses METI public-works repeated headers without publishing a header as a contract", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("04月競争（公共工事）");
  sheet.addRow(["公共調達の適正化について"]);
  sheet.addRow(["（別紙様式１）"]);
  const header = [
    "公共工事の名称、場所、期間及び種別", "契約担当官等", "契約を締結した日",
    "契約の相手方の商号または名称", "契約の相手方の法人番号", "住所",
    "一般競争入札・指名競争入札の別（総合評価の実施）", "予定価格", "契約金額", "落札率", "備考",
  ];
  sheet.addRow(header);
  sheet.addRow(header);
  sheet.addRow([
    "庁舎改修工事", "担当官", "2025年4月18日", "施工株式会社", "6010001030403", "東京都",
    "一般競争入札", "非公表", 12_345_678, "非公表", "",
  ]);
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const definition = METI_OFFICIAL_DOCUMENTS.find((document) => document.id === "meti-2025-competitive-public-works");
  const parsed = await parseOfficialWorkbook(buffer, { ...definition, expectedSheetCount: 1 });

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].program, "庁舎改修工事");
  assert.equal(parsed[0].organization, "施工株式会社");
  assert.equal(parsed[0].corporateNumber, "6010001030403");
  assert.equal(parsed[0].amount, 12_345_678);
  assert.equal(parsed[0].date, "2025-04-18");
});

test("parses ANRE's repeated grant headers, Japanese-era dates, and joint recipients as one official row", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("令和７年度１０月～３月");
  sheet.addRow(["令和7年度 補助金等の情報"]);
  sheet.addRow([]);
  sheet.addRow(["【資源エネルギー庁】"]);
  const header = ["番号", "事業名", "交付先名", "法人番号", "交付決定額", "支出元会計区分", "支出元(目)名称", "交付決定日"];
  sheet.addRow(header);
  sheet.addRow(header);
  sheet.addRow(header);
  sheet.addRow([
    1, "共同実証補助金", "法人A／法人B", "6010001030403／3010405006142", 9_000_000,
    "エネルギー対策特別会計", "設備導入促進対策費補助金", "令和7年10月23日",
  ]);
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const definition = ANRE_OFFICIAL_DOCUMENTS.find((document) => document.id === "anre-2025-grant-decisions-h2");
  const parsed = await parseOfficialWorkbook(buffer, definition);

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].date, "2025-10-23");
  assert.equal(parsed[0].amount, 9_000_000);
  assert.equal(parsed[0].corporateNumber, null);
  assert.deepEqual(parsed[0].corporateNumbers, ["6010001030403", "3010405006142"]);
  assert.equal(parsed[0].multiplePartyListing, true);
  assert.match(parsed[0].notes, /エネルギー対策特別会計/);
});

test("states the archive and FY2026 work still required instead of claiming completion", () => {
  assert.deepEqual(METI_ANRE_REGISTRY_GAPS, [
    "候補URL94資料のうち、実バイトと厳密parse receiptが未検証の88資料",
    "経済産業省本省のFY2020契約結果",
    "経済産業省本省のFY2020・FY2021補助金等交付決定",
    "資源エネルギー庁のFY2020～FY2023月別契約結果",
    "資源エネルギー庁のFY2020～FY2022補助金等交付決定",
    "FY2026は年度途中で、本省・資源エネルギー庁の全公表系列を検証できていないため未登録",
  ]);
});
