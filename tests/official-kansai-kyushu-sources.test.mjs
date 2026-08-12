import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import {
  KANSAI_KYUSHU_CONTRACT_DOCUMENTS,
  KANSAI_KYUSHU_COVERAGE_GAPS,
  KANSAI_KYUSHU_GRANT_DOCUMENTS,
  KANSAI_KYUSHU_OFFICIAL_DOCUMENTS,
} from "../scripts/official-kansai-kyushu-sources.mjs";
import { parseOfficialPdf } from "../scripts/official-pdf.mjs";

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

test("pins twelve archived Kansai and Kyushu FY2025 competitive-commission PDFs", () => {
  assert.equal(KANSAI_KYUSHU_CONTRACT_DOCUMENTS.length, 12);
  assert.equal(KANSAI_KYUSHU_OFFICIAL_DOCUMENTS.length, 16);
  assert.equal(
    KANSAI_KYUSHU_CONTRACT_DOCUMENTS.reduce(
      (sum, document) => sum + document.evidenceReceipt.expectedRecordCount, 0,
    ),
    29,
  );
  assert.deepEqual(
    Object.fromEntries(["kansai", "kyushu"].map((executorId) => [
      executorId,
      KANSAI_KYUSHU_CONTRACT_DOCUMENTS
        .filter((document) => document.executorId === executorId)
        .reduce((sum, document) => sum + document.evidenceReceipt.expectedRecordCount, 0),
    ])),
    { kansai: 21, kyushu: 8 },
  );
  for (const document of KANSAI_KYUSHU_CONTRACT_DOCUMENTS) {
    assert.equal(document.category, "contract_result");
    assert.equal(document.kind, "競争入札（委託費）");
    assert.equal(document.pdfSchema.recordGranularity, "date_anchor_rows");
    assert.equal(document.pdfSchema.expectedPageCount, 1);
    assert.equal(document.archiveExpectedBytes, document.pdfSchema.expectedBytes);
    assert.equal(document.archiveExpectedSha256, document.pdfSchema.expectedSha256);
    assert.equal(document.archiveExpectedRecordCount, document.pdfSchema.expectedRecordCount);
    assert.ok(document.url.startsWith("https://warp.ndl.go.jp/20260613/20260601093442/https://www."));
    assert.match(document.coverageClaim, /競争入札（委託費）.*掲載された\d+件/);
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

test("replays all sixteen exact PDFs through the production positioned-text parser", { timeout: 30_000 }, async (t) => {
  const fixtureDirectory = process.env.OFFICIAL_KANSAI_KYUSHU_EVIDENCE_DIRECTORY?.trim();
  if (!fixtureDirectory) return t.skip("set OFFICIAL_KANSAI_KYUSHU_EVIDENCE_DIRECTORY to the sixteen exact PDF files");
  let recordCount = 0;
  for (const document of KANSAI_KYUSHU_OFFICIAL_DOCUMENTS) {
    const records = await parseOfficialPdf(
      await readFile(join(fixtureDirectory, `${document.id}.pdf`)), document,
    );
    assert.equal(records.length, document.evidenceReceipt.expectedRecordCount, document.id);
    recordCount += records.length;
  }
  assert.equal(recordCount, 602);
});
