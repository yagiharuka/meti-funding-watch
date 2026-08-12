import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  auditOkinawaContractWorkbook,
  OKINAWA_CONTRACT_SOURCE_AUDIT,
  OKINAWA_COVERAGE_GAPS,
  OKINAWA_GRANT_DOCUMENTS,
} from "../scripts/official-okinawa-sources.mjs";
import { parseOfficialPdf } from "../scripts/official-pdf.mjs";
import { OFFICIAL_DOCUMENTS } from "../scripts/update-official-data.mjs";

const registry = JSON.parse(await readFile(new URL("../data/official-source-registry.json", import.meta.url), "utf8"));
const pageSource = await readFile(new URL("../app/official/page.tsx", import.meta.url), "utf8");

const expectedGrantSources = [
  ["https://www.ogb.go.jp/-/media/Files/OGB/Keisan/move/kobo/hojyokin/R2FY_firsthojokin.pdf", 108326, "c182f5cf85254d2424747f91cd69d7a3c88a893373fb49e0537b2dc5a654cd5d", 28],
  ["https://www.ogb.go.jp/-/media/Files/OGB/Keisan/move/kobo/hojyokin/R2FY_secondhojokin.pdf", 53923, "dc24e2fff65eaded675c7aba2b7ffd578c44fc172f62003adadc66e633a5bb96", 5],
  ["https://www.ogb.go.jp/-/media/Files/OGB/Keisan/move/kobo/hojyokin/R3FY_firsthojokin.pdf", 110618, "74971b12885357a571388830d94db67468689ed1a17103d9d6ba28adaa9f4c4e", 31],
  ["https://www.ogb.go.jp/-/media/Files/OGB/Keisan/move/kobo/hojyokin/R3FY_secondhojokin.pdf", 63004, "7f55f283f65afc032aefca9117df4909fff3d24d2d40e653e72f0a2f39ac4a26", 6],
  ["https://www.ogb.go.jp/-/media/Files/OGB/Keisan/move/kobo/hojyokin/R4FY_firsthojokin.pdf", 104738, "b79cd33aa2bf522a1e2f5ad37a8a357495568b6184d06d41760a9dc4bef97a4c", 25],
  ["https://www.ogb.go.jp/-/media/Files/OGB/Keisan/move/kobo/hojyokin/R4FY_secondhojokin.pdf", 64538, "32e3590adc88633dd2e3552941741ab73b33e390018cc53de2fd189806f284df", 7],
  ["https://www.ogb.go.jp/-/media/Files/OGB/Keisan/move/kobo/hojyokin/R5FY_firsthojokin.pdf", 117264, "5e1ed7c256f4f57f9db8322e1c6a9992f9c1f55ded9b2f809172bba7eda57182", 33],
  ["https://www.ogb.go.jp/-/media/Files/OGB/Keisan/move/kobo/hojyokin/R5FY_secondhojokin.pdf", 64242, "562de00f1a444a5c52ff29871d7e7f7d1f3ad00663e94dbd4ec47a43ceb9b596", 4],
  ["https://www.ogb.go.jp/-/media/Files/OGB/Keisan/move/kobo/hojyokin/R6FY_firsthojokin.pdf", 123539, "f3fe7a90bcaebede65918f5a4b78fe0cdd076e06459450f112b79c87217b1282", 50],
  ["https://www.ogb.go.jp/-/media/Files/OGB/Keisan/move/kobo/250514_01/R6FY_secondhojokin.pdf", 64198, "9b398d26392853946c6ffe00ecc9e8754a3f9a6e1ec0b9769575a3c27ce2b815", 5],
];

test("registers only the ten indexed Economic Industry Department grant PDFs", () => {
  assert.equal(OKINAWA_GRANT_DOCUMENTS.length, 10);
  assert.deepEqual([...new Set(OKINAWA_GRANT_DOCUMENTS.map((document) => document.fiscalYear))], [2020, 2021, 2022, 2023, 2024]);
  assert.equal(OKINAWA_GRANT_DOCUMENTS.reduce((sum, document) => sum + document.evidenceReceipt.expectedRecordCount, 0), 194);
  assert.ok(OKINAWA_GRANT_DOCUMENTS.every((document) => OFFICIAL_DOCUMENTS.includes(document)));
  assert.ok(OKINAWA_GRANT_DOCUMENTS.every((document) => document.executorId === "okinawa"));
  assert.ok(OKINAWA_GRANT_DOCUMENTS.every((document) => document.executorName === "沖縄総合事務局（経済産業部）"));
  assert.ok(OKINAWA_GRANT_DOCUMENTS.every((document) => document.category === "grant_decision"));
  assert.ok(OKINAWA_GRANT_DOCUMENTS.every((document) => document.pdfSchema.extractionMode === "positioned_text_only"));
  assert.ok(OKINAWA_GRANT_DOCUMENTS.every((document) => document.pdfSchema.corporateNumberOmitted === true));
  assert.ok(OKINAWA_GRANT_DOCUMENTS.every((document) => document.coverageClaim.includes("原資料に法人番号欄なし")));
  assert.ok(OKINAWA_GRANT_DOCUMENTS.every((document) => document.sourcePageUrl === "https://www.ogb.go.jp/keisan/3842/saitaku/f_03/014671"));
  assert.equal(new Set(OKINAWA_GRANT_DOCUMENTS.map((document) => document.id)).size, 10);
  for (const [index, document] of OKINAWA_GRANT_DOCUMENTS.entries()) {
    const [expectedUrl, expectedBytes, expectedSha256, expectedRecords] = expectedGrantSources[index];
    assert.equal(document.url, expectedUrl, document.id);
    assert.equal(document.evidenceReceipt.expectedBytes, expectedBytes, document.id);
    assert.equal(document.evidenceReceipt.expectedSha256, expectedSha256, document.id);
    assert.equal(document.evidenceReceipt.expectedRecordCount, expectedRecords, document.id);
    assert.deepEqual(Object.keys(document.evidenceReceipt).sort(), [
      "expectedBytes", "expectedMagic", "expectedRecordCount", "expectedSha256",
    ]);
    assert.equal(document.evidenceReceipt.expectedMagic, "%PDF-");
    assert.match(document.evidenceReceipt.expectedSha256, /^[0-9a-f]{64}$/);
    assert.equal(document.pdfSchema.expectedSha256, document.evidenceReceipt.expectedSha256);
    assert.equal(document.pdfSchema.expectedBytes, document.evidenceReceipt.expectedBytes);
    assert.equal(document.pdfSchema.expectedRecordCount, document.evidenceReceipt.expectedRecordCount);
    assert.equal(document.pdfSchema.crossColumnSplitRules.length, 1, document.id);
    assert.equal(document.pdfSchema.crossColumnSplitRules[0].kind, "date_then_text", document.id);
    assert.equal(document.pdfSchema.crossColumnSplitRules[0].expectedMatches, expectedRecords, document.id);
    assert.ok(document.pdfSchema.expectedPositionedTextItemCount > document.pdfSchema.minimumPositionedTextItems, document.id);
  }
});

test("keeps Okinawa contracts excluded because whole-bureau rows are not attributable", () => {
  assert.equal(OKINAWA_CONTRACT_SOURCE_AUDIT.length, 4);
  assert.deepEqual(OKINAWA_CONTRACT_SOURCE_AUDIT.map((source) => source.expectedWorkbookRows), [235, 200, 220, 137]);
  assert.ok(OKINAWA_CONTRACT_SOURCE_AUDIT.every((source) => source.economicIndustryDepartmentOfficerRows === 0));
  assert.ok(OKINAWA_CONTRACT_SOURCE_AUDIT.every((source) => !OFFICIAL_DOCUMENTS.some((document) => document.url === source.url)));
  const r7 = OKINAWA_CONTRACT_SOURCE_AUDIT.find((source) => source.officialIndexLabel === "令和7年度");
  assert.deepEqual(r7.observedFiscalYears, [2026]);
  assert.match(r7.status, /year_mismatch/);
  const gap = OKINAWA_COVERAGE_GAPS.find((item) => item.category === "contract_result");
  assert.equal(gap.status, "not_ingested_unattributable");
  assert.match(gap.missing, /共通調達の配賦もない/);
  const executor = registry.executors.find((item) => item.id === "okinawa");
  assert.match(executor.contractScopeNote, /経済産業部を行単位で識別できず/);
  assert.match(executor.contractScopeNote, /共通調達も配賦不能/);
  assert.match(executor.grantScopeNote, /FY2020～FY2024/);
  assert.match(pageSource, /contractScopeNote/);
  assert.match(pageSource, /grantScopeNote/);
});

test("replays all ten exact grant PDFs with the strict positioned-text parser", {
  skip: !process.env.OKINAWA_EVIDENCE_DIRECTORY,
}, async () => {
  const allRows = [];
  for (const document of OKINAWA_GRANT_DOCUMENTS) {
    const buffer = await readFile(`${process.env.OKINAWA_EVIDENCE_DIRECTORY}/${document.id}.pdf`);
    assert.equal(buffer.length, document.evidenceReceipt.expectedBytes, document.id);
    assert.equal(createHash("sha256").update(buffer).digest("hex"), document.evidenceReceipt.expectedSha256, document.id);
    const rows = await parseOfficialPdf(buffer, document);
    assert.equal(rows.length, document.evidenceReceipt.expectedRecordCount, document.id);
    assert.ok(rows.every((row) => row.corporateNumber === null && row.corporateNumberRaw === ""), document.id);
    assert.ok(rows.every((row) => row.amountStage === "交付決定額欄の掲載値"), document.id);
    assert.ok(rows.every((row) => row.executorId === "okinawa" && row.category === "grant_decision"), document.id);
    allRows.push(...rows);
  }
  assert.equal(allRows.length, 194);
  assert.equal(new Set(allRows.map((row) => row.sourceKey)).size, 194);

  const document = OKINAWA_GRANT_DOCUMENTS[0];
  const tampered = Buffer.from(await readFile(`${process.env.OKINAWA_EVIDENCE_DIRECTORY}/${document.id}.pdf`));
  tampered[tampered.length - 1] ^= 1;
  await assert.rejects(parseOfficialPdf(tampered, document), /SHA-256/);
});

test("strictly audits the four exact whole-bureau contract workbooks without emitting rows", {
  skip: !process.env.OKINAWA_CONTRACT_EVIDENCE_DIRECTORY,
}, async () => {
  for (const [index, source] of OKINAWA_CONTRACT_SOURCE_AUDIT.entries()) {
    const buffer = await readFile(`${process.env.OKINAWA_CONTRACT_EVIDENCE_DIRECTORY}/okinawa-contracts-fy${2022 + index}.xlsx`);
    const result = await auditOkinawaContractWorkbook(buffer, source);
    assert.equal(result.rows, source.expectedWorkbookRows);
    assert.deepEqual(result.observedFiscalYears, source.observedFiscalYears);
    assert.equal(result.economicIndustryDepartmentOfficerRows, 0);
    assert.equal(result.attributableRows, 0);
    assert.equal(result.commonProcurementAllocationAvailable, false);
  }
});

test("contract exclusion audit fails closed on byte drift and unregistered definitions", async () => {
  const source = OKINAWA_CONTRACT_SOURCE_AUDIT[0];
  const wrong = Buffer.alloc(source.expectedBytes, 0);
  await assert.rejects(auditOkinawaContractWorkbook(wrong, source), /XLSXのZIPシグネチャ/);
  const clone = { ...source };
  await assert.rejects(auditOkinawaContractWorkbook(Buffer.from("PK\u0003\u0004".padEnd(600)), clone), /未登録または変更された/);
});

test("states the FY2025 and payment-stage gaps without inventing zero records", () => {
  const grantGap = OKINAWA_COVERAGE_GAPS.find((item) => item.category === "grant_decision");
  assert.match(grantGap.included, /194掲載行/);
  assert.match(grantGap.missing, /FY2025以降/);
  assert.match(grantGap.missing, /公式索引にリンクなし/);
  assert.ok(OKINAWA_GRANT_DOCUMENTS.every((document) => !document.coverageClaim.includes("実支払")));
  assert.ok(OKINAWA_GRANT_DOCUMENTS.every((document) => !document.coverageClaim.includes("全支出")));
});
