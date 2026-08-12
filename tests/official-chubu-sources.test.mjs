import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import {
  CHUBU_COVERAGE_GAPS,
  CHUBU_CONTRACT_DOCUMENTS,
  CHUBU_GRANT_DOCUMENTS,
} from "../scripts/official-chubu-sources.mjs";
import { parseOfficialPdf } from "../scripts/official-pdf.mjs";
import { fetchOfficialDocuments, OFFICIAL_DOCUMENTS } from "../scripts/update-official-data.mjs";

const publishedManifest = JSON.parse(await readFile(new URL("../data/official/manifest.json", import.meta.url), "utf8"));
const published2024Records = JSON.parse(await readFile(new URL("../data/official/records-2024.json", import.meta.url), "utf8"));

const expected = new Map([
  ["chubu-2024-grant-decisions-h1", {
    filename: "hojyokin_r6fy_4-9.pdf",
    url: "https://www.chubu.meti.go.jp/a41kaikei/kouhyou/data/hojyokin/r6fy_4-9.pdf",
    pages: 18,
    rows: 207,
    pageRows: [...Array(17).fill(12), 3],
  }],
  ["chubu-2024-grant-decisions-h2", {
    filename: "hojyokin_r6fy_10-3.pdf",
    url: "https://www.chubu.meti.go.jp/a41kaikei/kouhyou/data/hojyokin/r6fy_10-3.pdf",
    pages: 5,
    rows: 218,
    pageRows: [42, 45, 45, 45, 41],
  }],
]);

test("registers two FY2024 Chubu grant PDFs with exact individual receipts", () => {
  assert.equal(CHUBU_GRANT_DOCUMENTS.length, 2);
  assert.equal(CHUBU_GRANT_DOCUMENTS.reduce((sum, document) =>
    sum + document.evidenceReceipt.expectedRecordCount, 0), 425);
  assert.ok(CHUBU_GRANT_DOCUMENTS.every((document) => OFFICIAL_DOCUMENTS.includes(document)));

  for (const document of CHUBU_GRANT_DOCUMENTS) {
    const receipt = expected.get(document.id);
    assert.ok(receipt, document.id);
    assert.equal(document.url, receipt.url);
    assert.equal(document.sourcePageUrl, "https://www.chubu.meti.go.jp/a41kaikei/kouhyou/index.html");
    assert.equal(document.executorId, "chubu");
    assert.equal(document.fiscalYear, 2024);
    assert.equal(document.category, "grant_decision");
    assert.equal(document.format, "pdf");
    assert.equal(document.discoveryStatus, "linked_from_official_index_and_byte_pinned");
    assert.equal(document.pdfSchema.extractionMode, "positioned_text_only");
    assert.equal(document.pdfSchema.expectedPageCount, receipt.pages);
    assert.deepEqual(document.pdfSchema.expectedRowsPerPage, receipt.pageRows);
    assert.equal(document.pdfSchema.expectedRecordCount, receipt.rows);
    assert.equal(document.evidenceReceipt.expectedRecordCount, receipt.rows);
    assert.equal(document.evidenceReceipt.expectedBytes, document.pdfSchema.expectedBytes);
    assert.equal(document.evidenceReceipt.expectedSha256, document.pdfSchema.expectedSha256);
    assert.equal(document.evidenceReceipt.expectedMagic, "%PDF-");
    assert.match(document.evidenceReceipt.expectedSha256, /^[0-9a-f]{64}$/);
  }

  const grantGap = CHUBU_COVERAGE_GAPS.find((gap) =>
    gap.fiscalYear === 2024 && gap.category === "grant_decision");
  const contractGap = CHUBU_COVERAGE_GAPS.find((gap) =>
    gap.fiscalYear === 2024 && gap.category === "contract_result");
  assert.equal(grantGap?.status, "verified_official_period_pair");
  assert.equal(contractGap?.status, "verified_official_files_partial_categories");
  assert.match(contractGap?.included ?? "", /競争入札.*2資料.*42掲載行/);
  assert.match(contractGap?.missing ?? "", /随意契約.*2資料/);
});

test("registers two byte-pinned FY2024 Chubu competitive-contract PDFs", () => {
  assert.equal(CHUBU_CONTRACT_DOCUMENTS.length, 2);
  assert.deepEqual(
    CHUBU_CONTRACT_DOCUMENTS.map((document) => document.id),
    ["chubu-2024-competitive-commission", "chubu-2024-competitive-goods"],
  );
  assert.deepEqual(
    CHUBU_CONTRACT_DOCUMENTS.map((document) => document.pdfSchema.expectedRecordCount),
    [10, 32],
  );
  assert.deepEqual(
    CHUBU_CONTRACT_DOCUMENTS.map((document) => document.pdfSchema.expectedPositionedTextItemCount),
    [199, 564],
  );
  assert.ok(CHUBU_CONTRACT_DOCUMENTS.every((document) => document.pdfSchema.rowAnchorMode === "date"));
  assert.ok(CHUBU_CONTRACT_DOCUMENTS.every((document) => document.pdfSchema.expectedBytes > 100_000));
  assert.ok(CHUBU_CONTRACT_DOCUMENTS.every((document) => /^[0-9a-f]{64}$/.test(document.pdfSchema.expectedSha256)));
  assert.ok(CHUBU_CONTRACT_DOCUMENTS.every((document) => document.pdfSchema.recordMapping.methodColumn === "method"));
});

test("strictly replays two individually receipted FY2024 Chubu competitive-contract PDFs", { timeout: 30_000 }, async (t) => {
  const fixtureDirectory = process.env.OFFICIAL_CHUBU_EVIDENCE_DIRECTORY?.trim();
  if (!fixtureDirectory) return t.skip("set OFFICIAL_CHUBU_EVIDENCE_DIRECTORY to the exact official PDFs");
  const expectedContracts = new Map([
    ["chubu-2024-competitive-commission", { filename: "nyusatsu_24-nyusatsu-itaku.pdf", rows: 10 }],
    ["chubu-2024-competitive-goods", { filename: "nyusatsu_24-nyusatsu-ukeoi.pdf", rows: 32 }],
  ]);
  const allRecords = [];

  for (const document of CHUBU_CONTRACT_DOCUMENTS) {
    const expectedContract = expectedContracts.get(document.id);
    assert.ok(expectedContract, document.id);
    assert.equal(document.pdfSchema.rowAnchorMode, "date");
    assert.equal(document.evidenceReceipt.expectedRecordCount, expectedContract.rows);
    const bytes = await readFile(join(fixtureDirectory, expectedContract.filename));
    const records = await parseOfficialPdf(bytes, document);
    assert.equal(records.length, expectedContract.rows, document.id);
    allRecords.push(...records);
  }

  assert.equal(allRecords.length, 42);
  assert.equal(new Set(allRecords.map((record) => record.id)).size, allRecords.length);
  assert.equal(new Set(allRecords.map((record) => record.sourceKey)).size, allRecords.length);
  assert.ok(allRecords.every((record) => record.category === "contract_result"));
  assert.ok(allRecords.every((record) => record.executorId === "chubu"));
  assert.ok(allRecords.every((record) => record.fiscalYear === 2024));
  assert.ok(allRecords.every((record) => /^\d{13}$/.test(record.corporateNumber)));
  assert.ok(allRecords.every((record) => Number.isSafeInteger(record.amount) && record.amount > 0));
  assert.ok(allRecords.every((record) => /一般競争/.test(record.method)));
});

test("replays both Chubu PDFs through the production positioned-text parser", { timeout: 30_000 }, async (t) => {
  const fixtureDirectory = process.env.OFFICIAL_CHUBU_EVIDENCE_DIRECTORY?.trim();
  if (!fixtureDirectory) return t.skip("set OFFICIAL_CHUBU_EVIDENCE_DIRECTORY to the exact two official PDFs");

  const records = [];
  for (const document of CHUBU_GRANT_DOCUMENTS) {
    const fixture = expected.get(document.id);
    const bytes = await readFile(join(fixtureDirectory, fixture.filename));
    const parsed = await parseOfficialPdf(bytes, document);
    assert.equal(parsed.length, fixture.rows, document.id);
    records.push(...parsed);

    const tampered = Buffer.from(bytes);
    tampered[tampered.length - 1] ^= 1;
    await assert.rejects(parseOfficialPdf(tampered, document), /SHA-256/);
  }

  assert.equal(records.length, 425);
  assert.equal(new Set(records.map((record) => record.id)).size, records.length);
  assert.equal(new Set(records.map((record) => record.sourceKey)).size, records.length);
  assert.ok(records.every((record) => record.executorId === "chubu"));
  assert.ok(records.every((record) => record.fiscalYear === 2024));
  assert.ok(records.every((record) => Number.isSafeInteger(record.amount) && record.amount >= 0));
  assert.ok(records.every((record) => record.corporateNumbers.every((number) => /^\d{13}$/.test(number))));
});

test("carries a published Chubu receipt forward after a repeated WAF challenge", async () => {
  const document = CHUBU_GRANT_DOCUMENTS[0];
  const priorRecords = published2024Records.filter((record) => record.datasetId === document.id);
  const priorReceipt = publishedManifest.sourceDocuments.find((source) => source.id === document.id);
  assert.equal(priorRecords.length, document.evidenceReceipt.expectedRecordCount);
  assert.ok(priorReceipt);

  const result = await fetchOfficialDocuments(
    [document],
    priorRecords,
    async () => new Response("", { status: 202 }),
    [document.id],
    [priorReceipt],
  );
  assert.deepEqual(result.sourceFailures, []);
  assert.equal(result.fetched.length, 1);
  assert.equal(result.fetched[0].carryForward.primaryFailureReasonCode, "transient_http");
  assert.equal(result.fetched[0].records.length, priorRecords.length);
});
