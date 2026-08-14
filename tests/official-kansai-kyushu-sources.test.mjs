import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import {
  KANSAI_KYUSHU_CONTRACT_DOCUMENTS,
  KANSAI_KYUSHU_COVERAGE_GAPS,
  KANSAI_KYUSHU_GRANT_DOCUMENTS,
  KANSAI_KYUSHU_OFFICIAL_DOCUMENTS,
  KYUSHU_ADDITIONAL_CONTRACT_DOCUMENTS,
} from "../scripts/official-kansai-kyushu-sources.mjs";
import { parseOfficialPdf } from "../scripts/official-pdf.mjs";

const kansaiDiscretionaryEvidenceDirectory = new URL("../evidence/kansai-2025-discretionary/", import.meta.url);
const kyushuContractEvidenceDirectory = new URL("../evidence/kyushu-2025-contracts/", import.meta.url);

test("pins four archived Kansai and Kyushu FY2025 grant-decision PDFs", () => {
  assert.equal(KANSAI_KYUSHU_GRANT_DOCUMENTS.length, 4);
  assert.equal(
    KANSAI_KYUSHU_GRANT_DOCUMENTS.reduce(
      (sum, document) => sum + document.evidenceReceipt.expectedRecordCount, 0,
    ),
    573,
  );
  assert.deepEqual(
    Object.fromEntries(["kansai", "kyushu"].map((executorId) => [
      executorId,
      KANSAI_KYUSHU_GRANT_DOCUMENTS
        .filter((document) => document.executorId === executorId)
        .reduce((sum, document) => sum + document.evidenceReceipt.expectedRecordCount, 0),
    ])),
    { kansai: 264, kyushu: 309 },
  );
  for (const document of KANSAI_KYUSHU_GRANT_DOCUMENTS) {
    assert.equal(document.category, "grant_decision");
    assert.equal(document.format, "pdf");
    assert.equal(document.discoveryStatus, "archived_official_file");
    assert.ok(document.url.startsWith("https://warp.ndl.go.jp/20260613/20260601093442/https://www."));
    assert.ok(document.originalUrl.startsWith(`https://www.${document.executorId === "kansai" ? "kansai" : "kyushu"}.meti.go.jp/`));
    assert.equal(document.archiveExpectedBytes, document.pdfSchema.expectedBytes);
    assert.equal(document.archiveExpectedSha256, document.pdfSchema.expectedSha256);
    assert.equal(document.archiveExpectedRecordCount, document.pdfSchema.expectedRecordCount);
    assert.deepEqual(document.evidenceReceipt, {
      expectedMagic: "%PDF-",
      expectedBytes: document.pdfSchema.expectedBytes,
      expectedSha256: document.pdfSchema.expectedSha256,
      expectedRecordCount: document.pdfSchema.expectedRecordCount,
    });
  }
});

test("pins thirty-one archived Kansai and Kyushu FY2025 contract PDFs", () => {
  assert.equal(KANSAI_KYUSHU_CONTRACT_DOCUMENTS.length, 31);
  assert.equal(KANSAI_KYUSHU_OFFICIAL_DOCUMENTS.length, 35);
  assert.equal(
    KANSAI_KYUSHU_CONTRACT_DOCUMENTS.reduce(
      (sum, document) => sum + document.evidenceReceipt.expectedRecordCount, 0,
    ),
    119,
  );
  assert.deepEqual(
    Object.fromEntries(["kansai", "kyushu"].map((executorId) => [
      executorId,
      KANSAI_KYUSHU_CONTRACT_DOCUMENTS
        .filter((document) => document.executorId === executorId)
        .reduce((sum, document) => sum + document.evidenceReceipt.expectedRecordCount, 0),
    ])),
    { kansai: 61, kyushu: 58 },
  );
  for (const document of KANSAI_KYUSHU_CONTRACT_DOCUMENTS) {
    assert.equal(document.category, "contract_result");
    assert.ok(["競争入札（委託費）", "競争入札（庁費）", "随意契約（委託費）"].includes(document.kind));
    assert.equal(document.pdfSchema.recordGranularity, "date_anchor_rows");
    assert.ok(document.pdfSchema.expectedPageCount >= 1);
    assert.equal(document.archiveExpectedBytes, document.pdfSchema.expectedBytes);
    assert.equal(document.archiveExpectedSha256, document.pdfSchema.expectedSha256);
    assert.equal(document.archiveExpectedRecordCount, document.pdfSchema.expectedRecordCount);
    assert.ok(document.url.startsWith("https://warp.ndl.go.jp/20260613/20260601093442/https://www."));
    assert.match(document.coverageClaim, /(?:競争入札（(?:委託費|庁費)）|随意契約（委託費）).*掲載された\d+件/);
  }
});

test("binds Kyushu's saved FY2025 contract index and thirteen added PDFs to exact receipts", async () => {
  const receipt = JSON.parse(await readFile(new URL("receipt.json", kyushuContractEvidenceDirectory), "utf8"));
  const index = await readFile(new URL("index.html", kyushuContractEvidenceDirectory));
  assert.equal(index.length, receipt.indexExpectedBytes);
  assert.equal(createHash("sha256").update(index).digest("hex"), receipt.indexExpectedSha256);
  assert.equal(receipt.documents.length, 13);
  assert.equal(KYUSHU_ADDITIONAL_CONTRACT_DOCUMENTS.length, 13);
  assert.equal(KYUSHU_ADDITIONAL_CONTRACT_DOCUMENTS.reduce(
    (sum, document) => sum + document.evidenceReceipt.expectedRecordCount, 0,
  ), 50);
  const indexText = index.toString("utf8");
  const discretionaryGoodsSection = indexText.split("随意契約（物品役務等）</h2>")[1]
    .split("随意契約（委託契約）</h2>")[0];
  assert.ok(discretionaryGoodsSection);
  assert.doesNotMatch(discretionaryGoodsSection, /\.pdf/);
  for (const document of KYUSHU_ADDITIONAL_CONTRACT_DOCUMENTS) {
    const evidence = receipt.documents.find((item) => item.id === document.id);
    assert.ok(evidence, document.id);
    assert.ok(indexText.includes(evidence.filename));
    assert.equal(document.sourcePageUrl, receipt.sourcePageUrl);
    assert.equal(document.originalUrl, evidence.originalUrl);
    assert.equal(document.pdfSchema.expectedBytes, evidence.expectedBytes);
    assert.equal(document.pdfSchema.expectedSha256, evidence.expectedSha256);
    assert.equal(document.pdfSchema.expectedPageCount, evidence.expectedPageCount);
    assert.deepEqual(document.pdfSchema.expectedRowsPerPage, evidence.expectedRowsPerPage);
    assert.equal(document.pdfSchema.expectedRecordCount, evidence.expectedRecordCount);
    assert.equal(document.pdfSchema.expectedPositionedTextItemCount, evidence.expectedPositionedTextItemCount);
    const pdf = await readFile(new URL(evidence.filename, kyushuContractEvidenceDirectory));
    assert.equal(pdf.subarray(0, 5).toString("ascii"), "%PDF-");
    assert.equal(pdf.length, evidence.expectedBytes);
    assert.equal(createHash("sha256").update(pdf).digest("hex"), evidence.expectedSha256);
    const records = await parseOfficialPdf(pdf, document);
    assert.equal(records.length, evidence.expectedRecordCount);
  }
});

test("binds Kansai's FY2025 discretionary-contract index and six PDFs to exact receipts", async () => {
  const receipt = JSON.parse(await readFile(new URL("receipt.json", kansaiDiscretionaryEvidenceDirectory), "utf8"));
  const top = await readFile(new URL("top.html", kansaiDiscretionaryEvidenceDirectory));
  const index = await readFile(new URL("index.html", kansaiDiscretionaryEvidenceDirectory));
  assert.equal(top.length, receipt.topExpectedBytes);
  assert.equal(createHash("sha256").update(top).digest("hex"), receipt.topExpectedSha256);
  assert.equal(index.length, receipt.indexExpectedBytes);
  assert.equal(createHash("sha256").update(index).digest("hex"), receipt.indexExpectedSha256);
  assert.ok(top.toString("utf8").includes(receipt.sourcePageUrl));

  const documents = KANSAI_KYUSHU_CONTRACT_DOCUMENTS.filter((document) =>
    document.id.startsWith("kansai-2025-discretionary-commission-"));
  assert.equal(receipt.documents.length, 6);
  assert.equal(documents.length, 6);
  for (const document of documents) {
    const evidence = receipt.documents.find((item) => item.id === document.id);
    assert.ok(evidence, document.id);
    assert.ok(index.toString("utf8").includes(evidence.filename));
    assert.equal(document.sourcePageUrl, receipt.sourcePageUrl);
    assert.equal(document.originalUrl, evidence.originalUrl);
    assert.equal(document.pdfSchema.expectedBytes, evidence.expectedBytes);
    assert.equal(document.pdfSchema.expectedSha256, evidence.expectedSha256);
    assert.equal(document.pdfSchema.expectedPageCount, evidence.expectedPageCount);
    assert.deepEqual(document.pdfSchema.expectedRowsPerPage, evidence.expectedRowsPerPage);
    assert.equal(document.pdfSchema.expectedRecordCount, evidence.expectedRecordCount);
    assert.equal(document.pdfSchema.expectedPositionedTextItemCount, evidence.expectedPositionedTextItemCount);
    const pdf = await readFile(new URL(evidence.filename, kansaiDiscretionaryEvidenceDirectory));
    assert.equal(pdf.subarray(0, 5).toString("ascii"), "%PDF-");
    assert.equal(pdf.length, evidence.expectedBytes);
    assert.equal(createHash("sha256").update(pdf).digest("hex"), evidence.expectedSha256);
    const records = await parseOfficialPdf(pdf, document);
    assert.equal(records.length, evidence.expectedRecordCount);
  }
});

test("pins Kansai's multi-recipient amount-line receipt without treating printed ordinals as amounts", () => {
  const document = KANSAI_KYUSHU_GRANT_DOCUMENTS.find(
    (candidate) => candidate.id === "kansai-2025-grant-decisions-h1",
  );
  assert.ok(document);
  assert.equal(document.pdfSchema.recordGranularity, "aligned_amount_rows");
  assert.deepEqual(document.pdfSchema.expectedRowNumbers, { start: 1, end: 231 });
  assert.equal(document.pdfSchema.expectedRecordCount, 250);
  assert.deepEqual(document.pdfSchema.expectedRowsPerPage, [31, 33, 33, 80, 73]);
  assert.equal(document.pdfSchema.expectedPartyCountsByOrdinal[83], 4);
  assert.equal(document.pdfSchema.expectedMissingCorporateNumberCount, 2);
  assert.equal(document.pdfSchema.rowBoundaryOverrides.length, 2);
  assert.match(document.coverageClaim, /掲載番号1～231.*250行/);
});

test("keeps older years and unparsed contract series explicit as gaps", () => {
  for (const executorId of ["kansai", "kyushu"]) {
    assert.ok(KANSAI_KYUSHU_COVERAGE_GAPS.some((gap) =>
      gap.executorId === executorId
      && gap.category === "grant_decision"
      && gap.missing.includes("2024年度以前")
      && gap.missing.includes("2026年度")));
    assert.ok(KANSAI_KYUSHU_COVERAGE_GAPS.some((gap) =>
      gap.executorId === executorId
      && gap.category === "contract_result"
      && gap.status === "verified_archived_official_files_partial_series"
      && gap.missing.includes("2024年度以前")
      && gap.missing.includes("2026年度")));
  }
});

test("replays all thirty-five exact PDFs through the production positioned-text parser", { timeout: 30_000 }, async (t) => {
  const fixtureDirectory = process.env.OFFICIAL_KANSAI_KYUSHU_EVIDENCE_DIRECTORY?.trim();
  if (!fixtureDirectory) return t.skip("set OFFICIAL_KANSAI_KYUSHU_EVIDENCE_DIRECTORY to the thirty-five exact PDF files");
  let recordCount = 0;
  for (const document of KANSAI_KYUSHU_OFFICIAL_DOCUMENTS) {
    const records = await parseOfficialPdf(
      await readFile(join(fixtureDirectory, `${document.id}.pdf`)), document,
    );
    assert.equal(records.length, document.evidenceReceipt.expectedRecordCount, document.id);
    recordCount += records.length;
  }
  assert.equal(recordCount, 692);
});
