// Release trigger after verified Chubu FY2022 integration.
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

const evidenceDirectory = process.env.OFFICIAL_CHUBU_EVIDENCE_DIRECTORY;
const grants2024 = CHUBU_GRANT_DOCUMENTS.filter((document) => document.fiscalYear === 2024);
const contracts2024 = CHUBU_CONTRACT_DOCUMENTS.filter((document) => document.fiscalYear === 2024);
const grants2023 = CHUBU_GRANT_DOCUMENTS.filter((document) => document.fiscalYear === 2023);
const contracts2023 = CHUBU_CONTRACT_DOCUMENTS.filter((document) => document.fiscalYear === 2023);
const grants2022 = CHUBU_GRANT_DOCUMENTS.filter((document) => document.fiscalYear === 2022);
const contracts2022 = CHUBU_CONTRACT_DOCUMENTS.filter((document) => document.fiscalYear === 2022);

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

test("registers and strictly replays six FY2022 Chubu PDFs from exact committed originals", { timeout: 30000 }, async () => {
 assert.equal(grants2022.length,2);assert.equal(contracts2022.length,4);const records=[];for(const document of [...grants2022,...contracts2022]){const bytes=await readFile(new URL(`../evidence/official-bootstrap/${document.id}.pdf`,import.meta.url));const parsed=await parseOfficialPdf(bytes,document);assert.equal(parsed.length,document.evidenceReceipt.expectedRecordCount);records.push(...parsed);}assert.equal(records.length,268);
});

test("registers and strictly replays six FY2023 Chubu PDFs from exact committed originals", { timeout: 30000 }, async () => {
  assert.equal(grants2023.length, 2);
  assert.equal(contracts2023.length, 4);
  assert.equal(grants2023.reduce((sum, document) => sum + document.evidenceReceipt.expectedRecordCount, 0), 224);
  assert.equal(contracts2023.reduce((sum, document) => sum + document.evidenceReceipt.expectedRecordCount, 0), 82);

  const records = [];
  for (const document of [...grants2023, ...contracts2023]) {
    const bytes = await readFile(new URL(`../evidence/official-bootstrap/${document.id}.pdf`, import.meta.url));
    assert.ok(bytes.subarray(0, 5).toString("ascii").startsWith("%PDF-"));
    assert.equal(bytes.length, document.evidenceReceipt.expectedBytes);
    assert.equal(sha256(bytes), document.evidenceReceipt.expectedSha256);
    const parsed = await parseOfficialPdf(bytes, document);
    assert.equal(parsed.length, document.evidenceReceipt.expectedRecordCount);
    records.push(...parsed);
  }

  assert.equal(records.length, 306);
  const h2 = records.filter((record) => record.sourceDatasetId === "chubu-2023-grant-decisions-h2");
  assert.deepEqual(h2.map((record) => record.sourceRowNumber).filter((number) => [11, 12, 15, 17].includes(number)), []);
  assert.deepEqual(
    h2.filter((record) => record.sourceOrganizationBlank).map((record) => record.sourceRowNumber),
    [27, 28, 29],
  );
  assert.deepEqual(
    h2.filter((record) => record.sourceOrganizationBlank).map((record) => record.organization),
    ["（原資料の交付先名欄は空欄）", "（原資料の交付先名欄は空欄）", "（原資料の交付先名欄は空欄）"],
  );
});

test("registers two FY2024 Chubu grant PDFs with exact individual receipts", () => {
  assert.equal(grants2024.length, 2);
  assert.deepEqual(grants2024.map((document) => document.fiscalYear), [2024, 2024]);
  assert.deepEqual(grants2024.map((document) => document.pdfSchema.expectedRecordCount), [207, 218]);
  assert.deepEqual(grants2024.map((document) => document.pdfSchema.expectedPageCount), [18, 5]);
  assert.deepEqual(grants2024.map((document) => document.pdfSchema.expectedPositionedTextItemCount), [2345, 2577]);
  assert.deepEqual(grants2024.map((document) => document.pdfSchema.expectedRowsPerPage.reduce((sum, count) => sum + count, 0)), [207, 218]);
  assert.deepEqual(grants2024.map((document) => document.pdfSchema.extractionMode), ["positioned_text_only", "positioned_text_only"]);
  assert.deepEqual(grants2024.map((document) => document.evidenceReceipt.expectedRecordCount), [207, 218]);
  assert.deepEqual(grants2024.map((document) => document.discoveryStatus), [
    "linked_from_official_index_and_byte_pinned",
    "linked_from_official_index_and_byte_pinned",
  ]);
});

test("registers four byte-pinned FY2024 Chubu contract PDFs", () => {
  assert.equal(contracts2024.length, 4);
  assert.deepEqual(contracts2024.map((document) => document.pdfSchema.expectedRecordCount), [10, 32, 28, 5]);
  assert.deepEqual(contracts2024.map((document) => document.pdfSchema.expectedPositionedTextItemCount), [199, 564, 628, 141]);
  assert.equal(contracts2024.reduce((sum, document) => sum + document.evidenceReceipt.expectedRecordCount, 0), 75);
  assert.deepEqual(contracts2024.map((document) => document.discoveryStatus), [
    "linked_from_official_index_and_byte_pinned",
    "linked_from_official_index_and_byte_pinned",
    "linked_from_official_index_archive_byte_pinned",
    "linked_from_official_index_archive_byte_pinned",
  ]);
});

test("pins the official Chubu index hrefs and both discretionary PDF receipts", async () => {
  const source = await readFile(new URL("../evidence/official-index/chubu-kouhyou-index.html", import.meta.url), "utf8");
  assert.match(source, /href="data\/zuikei\/24-zuikei-itaku\.pdf"/);
  assert.match(source, /href="data\/zuikei\/24-zuikei-ukeoi\.pdf"/);

  const expected = new Map([
    ["24-zuikei-itaku.pdf", { bytes: 174706, sha256: "f3a2d4014e8de2542bcd1e5bb20b621f82f4ae9c94ba8a838e6c91330b689323", records: 28 }],
    ["24-zuikei-ukeoi.pdf", { bytes: 115657, sha256: "c929729f06b9e5ac61e2350ed82504f5741bc94caa9b1726487e0cf60bae135a", records: 5 }],
  ]);

  for (const document of contracts2024.filter((item) => item.discoveryStatus === "linked_from_official_index_archive_byte_pinned")) {
    const filename = document.originalUrl.split("/").at(-1);
    assert.deepEqual(
      {
        bytes: document.archiveExpectedBytes,
        sha256: document.archiveExpectedSha256,
        records: document.archiveExpectedRecordCount,
      },
      expected.get(filename),
    );
    assert.match(document.url, /^https:\/\/warp\.ndl\.go\.jp\/20260613\/20260601101404\/https:\/\/www\.chubu\.meti\.go\.jp\//);
    assert.equal(document.archiveProvider, "国立国会図書館インターネット資料収集保存事業（WARP）");
  }
});

test("carries both exact Chubu WARP PDFs forward only with their complete archive receipts", async () => {
  const documents = contracts2024.filter((item) => item.discoveryStatus === "linked_from_official_index_archive_byte_pinned");
  assert.equal(documents.length, 2);
  const priorRecords = documents.flatMap((document, documentIndex) =>
    Array.from({ length: document.archiveExpectedRecordCount }, (_, index) => ({
      id: `${document.id}:prior:${index + 1}`,
      sourceDatasetId: document.id,
      sourceRowNumber: index + 1,
      executorId: document.executorId,
      executorName: document.executorName,
      fiscalYear: document.fiscalYear,
      category: document.category,
      kind: document.kind,
      amountStage: document.amountStage,
      programName: `prior-${documentIndex}-${index + 1}`,
      organization: `prior-org-${documentIndex}-${index + 1}`,
      organizations: [{ organization: `prior-org-${documentIndex}-${index + 1}`, corporateNumber: null }],
      corporateNumber: null,
      amount: 1000 + index,
      rawAmount: `${1000 + index}`,
      decisionDate: "2024-04-01",
      method: null,
      notes: null,
      sourceUrl: document.originalUrl,
      sourcePageUrl: document.sourcePageUrl,
      sourceRetrievedAt: "2026-08-13T00:00:00.000Z",
    })),
  );
  const priorSourceDocuments = documents.map((document) => ({
    id: document.id,
    primaryUrl: document.originalUrl,
    url: document.url,
    originalUrl: document.originalUrl,
    sourcePageUrl: document.sourcePageUrl,
    format: document.format,
    discoveryStatus: document.discoveryStatus,
    archiveProvider: document.archiveProvider,
    archiveVerifiedAt: document.archiveVerifiedAt,
    archiveVerification: document.archiveVerification,
    archiveExpectedBytes: document.archiveExpectedBytes,
    archiveExpectedSha256: document.archiveExpectedSha256,
    archiveExpectedRecordCount: document.archiveExpectedRecordCount,
    evidenceExpectedMagic: document.evidenceReceipt.expectedMagic,
    evidenceExpectedBytes: document.evidenceReceipt.expectedBytes,
    evidenceExpectedSha256: document.evidenceReceipt.expectedSha256,
    evidenceExpectedRecordCount: document.evidenceReceipt.expectedRecordCount,
    evidenceVerified: true,
    parserRevision: "official-parser-2026-08-12-regional-pdf-v2",
    definitionSha256: officialDocumentDefinitionSha256(document),
    executorId: document.executorId,
    category: document.category,
    kind: document.kind,
    fiscalYear: document.fiscalYear,
    sha256: document.archiveExpectedSha256,
    bytes: document.archiveExpectedBytes,
    records: document.archiveExpectedRecordCount,
    retrievedAt: "2026-08-13T00:00:00.000Z",
  }));
  const definitionMigration = new Map(documents.map((document) => [document.id, {
    previousDefinitionSha256: officialDocumentDefinitionSha256(document),
    publishedManifestGeneratedAt: "2026-08-13T00:00:00.000Z",
    rationale: "test-only explicit transition for the exact published baseline",
  }]));
  const result = await fetchOfficialDocuments({
    documents,
    priorRecords,
    priorSourceDocuments,
    priorManifestGeneratedAt: "2026-08-13T00:00:00.000Z",
    archiveDefinitionMigration: definitionMigration,
    fetchImpl: async () => new Response("blocked", { status: 403 }),
    maxAttempts: 1,
    sleep: async () => {},
    now: () => new Date("2026-08-13T01:00:00.000Z"),
  });
  assert.deepEqual(result.records, priorRecords);
  assert.equal(result.sourceDocuments.length, 2);
  for (const receipt of result.sourceDocuments) {
    assert.equal(receipt.carryForwardUsed, true);
    assert.equal(receipt.fallbackUsed, true);
    assert.equal(receipt.primaryFailureReasonCode, "http_403");
    assert.equal(receipt.evidenceVerified, true);
    assert.ok(receipt.lastSuccessfulRetrievedAt);
  }
});

test("strictly replays four individually receipted FY2024 Chubu contract PDFs", { skip: !evidenceDirectory }, async () => {
  if (!evidenceDirectory) return;
  for (const document of contracts2024) {
    const bytes = await readFile(join(evidenceDirectory, document.id + ".pdf"));
    assert.ok(bytes.subarray(0, 5).toString("ascii").startsWith("%PDF-"));
    assert.equal(bytes.length, document.evidenceReceipt.expectedBytes);
    assert.equal(sha256(bytes), document.evidenceReceipt.expectedSha256);
    const records = await parseOfficialPdf(bytes, document);
    assert.equal(records.length, document.evidenceReceipt.expectedRecordCount);
    assert.ok(records.every((record) => record.category === "contract_result"));
  }
});

test("replays both Chubu PDFs through the production positioned-text parser", { skip: !evidenceDirectory }, async () => {
  if (!evidenceDirectory) return;
  for (const document of grants2024) {
    const bytes = await readFile(join(evidenceDirectory, document.id + ".pdf"));
    assert.ok(bytes.subarray(0, 5).toString("ascii").startsWith("%PDF-"));
    assert.equal(bytes.length, document.evidenceReceipt.expectedBytes);
    assert.equal(sha256(bytes), document.evidenceReceipt.expectedSha256);
    const records = await parseOfficialPdf(bytes, document);
    assert.equal(records.length, document.evidenceReceipt.expectedRecordCount);
    assert.ok(records.every((record) => record.category === "grant_decision"));
  }
});

test("carries a published Chubu receipt forward after a repeated WAF challenge", async () => {
  const document = contracts2024[0];
  const priorRecord = {
    id: `${document.id}:published-row`,
    sourceDatasetId: document.id,
    sourceRowNumber: 1,
    executorId: document.executorId,
    executorName: document.executorName,
    fiscalYear: document.fiscalYear,
    category: document.category,
    kind: document.kind,
    amountStage: document.amountStage,
    programName: "published-program",
    organization: "published-org",
    organizations: [{ organization: "published-org", corporateNumber: null }],
    corporateNumber: null,
    amount: 1234,
    rawAmount: "1,234",
    decisionDate: "2024-04-01",
    method: null,
    notes: null,
    sourceUrl: document.url,
    sourcePageUrl: document.sourcePageUrl,
    sourceRetrievedAt: "2026-08-12T00:00:00.000Z",
  };
  const previousDefinitionSha256 = officialDocumentDefinitionSha256({
    ...document,
    discoveryStatus: "linked_from_official_index_byte_pinned",
    evidenceReceipt: undefined,
  });
  const priorSourceDocument = {
    id: document.id,
    primaryUrl: document.url,
    url: document.url,
    originalUrl: document.url,
    sourcePageUrl: document.sourcePageUrl,
    format: document.format,
    discoveryStatus: "linked_from_official_index_byte_pinned",
    archiveProvider: null,
    archiveVerifiedAt: null,
    archiveVerification: null,
    archiveExpectedBytes: null,
    archiveExpectedSha256: null,
    archiveExpectedRecordCount: null,
    evidenceExpectedMagic: null,
    evidenceExpectedBytes: null,
    evidenceExpectedSha256: null,
    evidenceExpectedRecordCount: null,
    evidenceVerified: false,
    parserRevision: "official-parser-2026-08-12-regional-pdf-v2",
    definitionSha256: previousDefinitionSha256,
    executorId: document.executorId,
    category: document.category,
    kind: document.kind,
    fiscalYear: document.fiscalYear,
    sha256: document.evidenceReceipt.expectedSha256,
    bytes: document.evidenceReceipt.expectedBytes,
    records: 1,
    retrievedAt: "2026-08-12T00:00:00.000Z",
  };
  const migration = OFFICIAL_ARCHIVE_DEFINITION_MIGRATION.get(document.id);
  assert.deepEqual(migration, {
    previousDefinitionSha256,
    publishedManifestGeneratedAt: "2026-08-12T03:20:41.677Z",
    rationale: "Chubu FY2024 contract PDFs moved to their verified WARP transport URLs after the live METI host returned a persistent WAF challenge; archived bytes, parsed rows, and original official URLs are unchanged.",
  });
  const result = await fetchOfficialDocuments({
    documents: [document],
    priorRecords: [priorRecord],
    priorSourceDocuments: [priorSourceDocument],
    priorManifestGeneratedAt: "2026-08-12T03:20:41.677Z",
    fetchImpl: async () => new Response("blocked", { status: 403 }),
    maxAttempts: 1,
    sleep: async () => {},
    now: () => new Date("2026-08-12T01:00:00.000Z"),
  });
  assert.deepEqual(result.records, [priorRecord]);
  assert.equal(result.sourceDocuments[0].carryForwardUsed, true);
  assert.equal(result.sourceDocuments[0].fallbackUsed, true);
  assert.equal(result.sourceDocuments[0].primaryFailureReasonCode, "http_403");
  assert.equal(result.sourceDocuments[0].evidenceVerified, true);
  assert.ok(result.sourceDocuments[0].lastSuccessfulRetrievedAt);
});
