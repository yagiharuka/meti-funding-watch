import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import {
  CHUBU_COVERAGE_GAPS,
  CHUBU_CONTRACT_DOCUMENTS,
  CHUBU_GRANT_DOCUMENTS,
} from "../scripts/official-chubu-sources.mjs";
import { parseOfficialPdf } from "../scripts/official-pdf.mjs";
import {
  fetchOfficialDocuments,
  OFFICIAL_ARCHIVE_DEFINITION_MIGRATION,
  OFFICIAL_DOCUMENTS,
  officialDocumentDefinitionSha256,
} from "../scripts/update-official-data.mjs";

const publishedManifest = JSON.parse(await readFile(new URL("../data/official/manifest.json", import.meta.url), "utf8"));
const published2024Records = JSON.parse(await readFile(new URL("../data/official/records-2024.json", import.meta.url), "utf8"));

const discretionaryEvidenceDirectory = new URL("../evidence/chubu-2024-discretionary/", import.meta.url);
const grants2024 = CHUBU_GRANT_DOCUMENTS.filter((document) => document.fiscalYear === 2024);
const contracts2024 = CHUBU_CONTRACT_DOCUMENTS.filter((document) => document.fiscalYear === 2024);
const grants2023 = CHUBU_GRANT_DOCUMENTS.filter((document) => document.fiscalYear === 2023);
const contracts2023 = CHUBU_CONTRACT_DOCUMENTS.filter((document) => document.fiscalYear === 2023);

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

test("registers and strictly replays six FY2023 Chubu PDFs from exact committed originals", { timeout: 30000 }, async () => {
 assert.equal(grants2023.length,2); assert.equal(contracts2023.length,4); const records=[]; for(const d of [...grants2023,...contracts2023]){const b=await readFile(new URL(`../evidence/official-bootstrap/${d.id}.pdf`,import.meta.url)); const r=await parseOfficialPdf(b,d); assert.equal(r.length,d.evidenceReceipt.expectedRecordCount); records.push(...r);} assert.equal(records.length,306); const h2=records.filter(r=>r.datasetId==="chubu-2023-grant-decisions-h2"); assert.deepEqual(h2.filter(r=>r.sourceOrganizationBlank===true).map(r=>r.sourceRowNumber),[27,28,29]); assert.ok(h2.filter(r=>r.sourceOrganizationBlank===true).every(r=>r.organization==="（原資料の交付先名欄は空欄）")); assert.ok([11,12,15,17].every(n=>!h2.some(r=>r.sourceRowNumber===n)));
});

test("registers two FY2024 Chubu grant PDFs with exact individual receipts", () => {
  assert.equal(grants2024.length, 2);
  assert.equal(grants2024.reduce((sum, document) =>
    sum + document.evidenceReceipt.expectedRecordCount, 0), 425);
  assert.ok(grants2024.every((document) => OFFICIAL_DOCUMENTS.includes(document)));

  for (const document of grants2024) {
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
  assert.equal(contractGap?.status, "verified_official_files_four_categories");
  assert.match(contractGap?.included ?? "", /競争入札・随意契約.*4資料.*75掲載行/);
  assert.match(contractGap?.missing ?? "", /完全性は主張しない/);
});

test("registers four byte-pinned FY2024 Chubu contract PDFs", () => {
  assert.equal(contracts2024.length, 4);
  assert.deepEqual(
    contracts2024.map((document) => document.id),
    [
      "chubu-2024-competitive-commission",
      "chubu-2024-competitive-goods",
      "chubu-2024-discretionary-commission",
      "chubu-2024-discretionary-goods",
    ],
  );
  assert.deepEqual(
    contracts2024.map((document) => document.pdfSchema.expectedRecordCount),
    [10, 32, 28, 5],
  );
  assert.deepEqual(
    contracts2024.map((document) => document.pdfSchema.expectedPositionedTextItemCount),
    [199, 564, 628, 141],
  );
  assert.ok(contracts2024.every((document) => document.pdfSchema.rowAnchorMode === "date"));
  assert.ok(contracts2024.every((document) => document.pdfSchema.expectedBytes > 100_000));
  assert.ok(contracts2024.every((document) => /^[0-9a-f]{64}$/.test(document.pdfSchema.expectedSha256)));
  assert.deepEqual(
    contracts2024.map((document) => document.pdfSchema.recordMapping.methodColumn),
    ["method", "method", "legalReason", "legalReason"],
  );
});

test("pins the official Chubu index hrefs and both discretionary PDF receipts", async () => {
  const receipt = JSON.parse(await readFile(new URL("receipt.json", discretionaryEvidenceDirectory), "utf8"));
  const indexBytes = await readFile(new URL("index.html", discretionaryEvidenceDirectory));
  assert.equal(indexBytes.length, receipt.indexExpectedBytes);
  assert.equal(createHash("sha256").update(indexBytes).digest("hex"), receipt.indexExpectedSha256);
  const indexHtml = indexBytes.toString("utf8");
  const documents = contracts2024.filter((document) => document.id.includes("discretionary"));
  assert.equal(receipt.documents.length, 2);
  assert.equal(documents.length, 2);

  for (const document of documents) {
    const evidence = receipt.documents.find((item) => item.id === document.id);
    assert.ok(evidence, document.id);
    assert.ok(indexHtml.includes(evidence.originalUrl));
    assert.equal(document.originalUrl, evidence.originalUrl);
    assert.equal(document.url, evidence.transportUrl);
    assert.match(document.archiveProvider, /WARP/);
    assert.equal(document.archiveExpectedBytes, evidence.expectedBytes);
    assert.equal(document.archiveExpectedSha256, evidence.expectedSha256);
    assert.equal(document.archiveExpectedRecordCount, evidence.expectedRecordCount);
    assert.equal(document.pdfSchema.expectedBytes, evidence.expectedBytes);
    assert.equal(document.pdfSchema.expectedSha256, evidence.expectedSha256);
    assert.equal(document.pdfSchema.expectedRecordCount, evidence.expectedRecordCount);
    assert.equal(document.pdfSchema.expectedPositionedTextItemCount, evidence.expectedPositionedTextItemCount);
    const pdf = await readFile(new URL(evidence.filename, discretionaryEvidenceDirectory));
    assert.equal(pdf.subarray(0, 5).toString("ascii"), "%PDF-");
    assert.equal(pdf.length, evidence.expectedBytes);
    assert.equal(createHash("sha256").update(pdf).digest("hex"), evidence.expectedSha256);
    const parsed = await parseOfficialPdf(pdf, document);
    assert.equal(parsed.length, evidence.expectedRecordCount);
  }
});

test("carries both exact Chubu WARP PDFs forward only with their complete archive receipts", async () => {
  const documents = contracts2024.filter((document) => document.id.includes("discretionary"));
  for (const document of documents) {
    const priorRecords = published2024Records.filter((record) => record.datasetId === document.id);
    const publishedReceipt = publishedManifest.sourceDocuments.find((source) => source.id === document.id);
    const migrationDefinition = OFFICIAL_ARCHIVE_DEFINITION_MIGRATION.documents[document.id];
    assert.equal(priorRecords.length, document.archiveExpectedRecordCount);
    assert.ok(publishedReceipt);
    assert.ok(migrationDefinition);
    const oldReceipt = {
      ...publishedReceipt,
      carryForwardUsed: false,
      primaryFailureReasonCode: null,
      lastSuccessfulRetrievedAt: null,
      attemptedAt: null,
      archiveProvider: null,
      archiveVerifiedAt: null,
      archiveVerification: null,
      archiveExpectedBytes: null,
      archiveExpectedSha256: null,
      archiveExpectedRecordCount: null,
      definitionSha256: migrationDefinition.previousDefinitionSha256,
    };
    const migrationResult = await fetchOfficialDocuments(
      [document],
      priorRecords,
      async () => new Response("WARP unavailable".padEnd(600), { status: 403 }),
      [document.id],
      [oldReceipt],
      OFFICIAL_ARCHIVE_DEFINITION_MIGRATION.previousManifestSha256,
    );
    assert.deepEqual(migrationResult.sourceFailures, []);
    assert.equal(migrationResult.fetched[0].records.length, priorRecords.length);
    assert.equal(migrationResult.fetched[0].carryForward.primaryFailureReasonCode, "archive_http_403");
    await assert.rejects(
      fetchOfficialDocuments(
        [document],
        priorRecords,
        async () => new Response("WARP unavailable".padEnd(600), { status: 403 }),
        [document.id],
        [oldReceipt],
        "0".repeat(64),
      ),
      /receiptまたは明細/,
    );

    const migratedReceipt = publishedReceipt;
    assert.equal(migratedReceipt.definitionSha256, officialDocumentDefinitionSha256(document));
    const result = await fetchOfficialDocuments(
      [document],
      priorRecords,
      async () => new Response("WARP unavailable".padEnd(600), { status: 403 }),
      [document.id],
      [migratedReceipt],
    );
    assert.deepEqual(result.sourceFailures, []);
    assert.equal(result.fetched[0].records.length, priorRecords.length);
    assert.equal(result.fetched[0].carryForward.primaryFailureReasonCode, "archive_http_403");

    await assert.rejects(
      fetchOfficialDocuments(
        [document],
        priorRecords,
        async () => new Response("WARP unavailable".padEnd(600), { status: 403 }),
        [document.id],
        [{ ...migratedReceipt, archiveExpectedSha256: "0".repeat(64) }],
      ),
      /WARP receipt|receiptまたは明細/,
    );
  }
});

test("strictly replays four individually receipted FY2024 Chubu contract PDFs", { timeout: 30_000 }, async (t) => {
  const fixtureDirectory = process.env.OFFICIAL_CHUBU_EVIDENCE_DIRECTORY?.trim();
  if (!fixtureDirectory) return t.skip("set OFFICIAL_CHUBU_EVIDENCE_DIRECTORY to the exact official PDFs");
  const expectedContracts = new Map([
    ["chubu-2024-competitive-commission", { filename: "nyusatsu_24-nyusatsu-itaku.pdf", rows: 10 }],
    ["chubu-2024-competitive-goods", { filename: "nyusatsu_24-nyusatsu-ukeoi.pdf", rows: 32 }],
    ["chubu-2024-discretionary-commission", { filename: "24-zuikei-itaku.pdf", rows: 28 }],
    ["chubu-2024-discretionary-goods", { filename: "24-zuikei-ukeoi.pdf", rows: 5 }],
  ]);
  const allRecords = [];

  for (const document of contracts2024) {
    const expectedContract = expectedContracts.get(document.id);
    assert.ok(expectedContract, document.id);
    assert.equal(document.pdfSchema.rowAnchorMode, "date");
    assert.equal(document.evidenceReceipt.expectedRecordCount, expectedContract.rows);
    const bytes = await readFile(join(fixtureDirectory, expectedContract.filename));
    const records = await parseOfficialPdf(bytes, document);
    assert.equal(records.length, expectedContract.rows, document.id);
    allRecords.push(...records);
  }

  assert.equal(allRecords.length, 75);
  assert.equal(new Set(allRecords.map((record) => record.id)).size, allRecords.length);
  assert.equal(new Set(allRecords.map((record) => record.sourceKey)).size, allRecords.length);
  assert.ok(allRecords.every((record) => record.category === "contract_result"));
  assert.ok(allRecords.every((record) => record.executorId === "chubu"));
  assert.ok(allRecords.every((record) => record.fiscalYear === 2024));
  assert.ok(allRecords.every((record) => /^\d{13}$/.test(record.corporateNumber)));
  assert.ok(allRecords.every((record) => Number.isSafeInteger(record.amount) && record.amount > 0));
  assert.ok(allRecords.every((record) => record.method.length > 0));
  assert.equal(allRecords.filter((record) => record.kind.startsWith("競争入札")).length, 42);
  assert.equal(allRecords.filter((record) => record.kind.startsWith("随意契約")).length, 33);
});

test("replays both Chubu PDFs through the production positioned-text parser", { timeout: 30_000 }, async (t) => {
  const fixtureDirectory = process.env.OFFICIAL_CHUBU_EVIDENCE_DIRECTORY?.trim();
  if (!fixtureDirectory) return t.skip("set OFFICIAL_CHUBU_EVIDENCE_DIRECTORY to the exact two official PDFs");

  const records = [];
  for (const document of grants2024) {
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
  const document = grants2024[0];
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
