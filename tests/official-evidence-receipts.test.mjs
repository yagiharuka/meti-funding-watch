import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { CHUBU_CONTRACT_DOCUMENTS, CHUBU_GRANT_DOCUMENTS } from "../scripts/official-chubu-sources.mjs";
import {
  KANSAI_KYUSHU_CONTRACT_DOCUMENTS,
  KANSAI_KYUSHU_GRANT_DOCUMENTS,
} from "../scripts/official-kansai-kyushu-sources.mjs";
import {
  METI_ANRE_ARCHIVE_RECEIPTS,
  METI_ANRE_OFFICIAL_DOCUMENTS,
} from "../scripts/official-meti-anre-history.mjs";
import { REGIONAL_OFFICIAL_DOCUMENTS } from "../scripts/official-regional-history.mjs";
import { REGIONAL_PDF_DOCUMENTS } from "../scripts/official-regional-pdf-sources.mjs";
import {
  assertOfficialEvidenceRecordCount,
  assertOfficialEvidenceSourceReceipt,
  fetchOfficialDocuments,
  isApprovedOfficialParserMigration,
  OFFICIAL_DOCUMENTS,
  OFFICIAL_PARSER_MIGRATION,
  OFFICIAL_PARSER_REVISION,
  officialDocumentDefinitionSha256,
} from "../scripts/update-official-data.mjs";

const evidenceDocuments = [
  ...METI_ANRE_OFFICIAL_DOCUMENTS,
  ...REGIONAL_OFFICIAL_DOCUMENTS,
  ...REGIONAL_PDF_DOCUMENTS,
  ...CHUBU_GRANT_DOCUMENTS,
  ...CHUBU_CONTRACT_DOCUMENTS,
  ...KANSAI_KYUSHU_GRANT_DOCUMENTS,
  ...KANSAI_KYUSHU_CONTRACT_DOCUMENTS,
];

const publishedManifest = JSON.parse(await readFile(new URL("../data/official/manifest.json", import.meta.url), "utf8"));

test("binds every receipted production document to one complete evidence receipt", () => {
  assert.equal(evidenceDocuments.length, 360); // Okinawa is retained only as historical data
  assert.ok(evidenceDocuments.every((document) => OFFICIAL_DOCUMENTS.includes(document)));
  for (const document of evidenceDocuments) {
    assert.deepEqual(Object.keys(document.evidenceReceipt).sort(), [
      "expectedBytes", "expectedMagic", "expectedRecordCount", "expectedSha256",
    ]);
    assert.ok(Number.isSafeInteger(document.evidenceReceipt.expectedBytes));
    assert.match(document.evidenceReceipt.expectedSha256, /^[0-9a-f]{64}$/);
    assert.ok(Number.isSafeInteger(document.evidenceReceipt.expectedRecordCount));
  }
});

test("keeps the deterministic evidence override limited to receipted documents", async () => {
  const updaterSource = await (await import("node:fs/promises")).readFile(
    new URL("../scripts/update-official-data.mjs", import.meta.url), "utf8",
  );
  assert.match(updaterSource, /evidenceDirectory && document\.evidenceReceipt/);
  assert.match(updaterSource, /OFFICIAL_EVIDENCE_DIRECTORY/);
  assert.match(updaterSource, /allowBootstrapEvidence && bootstrapEvidenceDirectory && document\.evidenceReceipt/);
  assert.match(updaterSource, /OFFICIAL_BOOTSTRAP_EVIDENCE_DIRECTORY/);
  const workflowSource = await (await import("node:fs/promises")).readFile(
    new URL("../.github/workflows/refresh-official-data.yml", import.meta.url), "utf8",
  );
  assert.match(workflowSource, /OFFICIAL_BOOTSTRAP_EVIDENCE_DIRECTORY: evidence\/official-bootstrap/);
});

test("uses committed bootstrap evidence only before a source has been published", async () => {
  const document = REGIONAL_OFFICIAL_DOCUMENTS.find((source) => source.id === "chugoku-2025-grant-decisions-part-2");
  assert.ok(document);
  const previous = process.env.OFFICIAL_BOOTSTRAP_EVIDENCE_DIRECTORY;
  process.env.OFFICIAL_BOOTSTRAP_EVIDENCE_DIRECTORY = new URL("../evidence/official-bootstrap", import.meta.url).pathname;
  let networkCalls = 0;
  try {
    const firstRun = await fetchOfficialDocuments([document], [], async () => {
      networkCalls += 1;
      return new Response("network must not be used", { status: 500 });
    });
    assert.equal(networkCalls, 0);
    assert.equal(firstRun.sourceFailures.length, 0);
    assert.equal(firstRun.fetched[0].records.length, 11);

    await assert.rejects(
      fetchOfficialDocuments(
        [document],
        [],
        async () => {
          networkCalls += 1;
          return new Response("missing", { status: 404 });
        },
        [document.id],
      ),
      /検証済み公式資料を再検証できませんでした/,
    );
    assert.equal(networkCalls, 1);
  } finally {
    if (previous === undefined) delete process.env.OFFICIAL_BOOTSTRAP_EVIDENCE_DIRECTORY;
    else process.env.OFFICIAL_BOOTSTRAP_EVIDENCE_DIRECTORY = previous;
  }
});

test("allows the parser revision transition only for the exact previous public manifest and unchanged definition", () => {
  const document = METI_ANRE_OFFICIAL_DOCUMENTS[0];
  const receipt = {
    parserRevision: OFFICIAL_PARSER_MIGRATION.fromRevision,
    definitionSha256: officialDocumentDefinitionSha256(document, OFFICIAL_PARSER_MIGRATION.fromRevision),
  };
  assert.equal(isApprovedOfficialParserMigration(
    document,
    receipt,
    OFFICIAL_PARSER_MIGRATION.previousManifestSha256,
  ), true);
  assert.equal(isApprovedOfficialParserMigration(document, receipt, "0".repeat(64)), false);
  assert.equal(isApprovedOfficialParserMigration(document, {
    ...receipt,
    definitionSha256: "0".repeat(64),
  }, OFFICIAL_PARSER_MIGRATION.previousManifestSha256), false);
  assert.equal(isApprovedOfficialParserMigration({ ...document, coverageClaim: `${document.coverageClaim} changed` }, receipt,
    OFFICIAL_PARSER_MIGRATION.previousManifestSha256), false);
  assert.equal(OFFICIAL_PARSER_MIGRATION.toRevision, OFFICIAL_PARSER_REVISION);
});

test("replays all 88 METI and ANRE archive receipts through the production strict parser", { timeout: 30_000 }, async (t) => {
  const fixtureDirectory = process.env.OFFICIAL_METI_ANRE_EVIDENCE_DIRECTORY?.trim();
  if (!fixtureDirectory) return t.skip("set OFFICIAL_METI_ANRE_EVIDENCE_DIRECTORY to the exact 88 archived XLSX files");
  const receiptIds = new Set(METI_ANRE_ARCHIVE_RECEIPTS.map((receipt) => receipt.id));
  const documents = METI_ANRE_OFFICIAL_DOCUMENTS.filter((document) => receiptIds.has(document.id));
  const byUrl = new Map(documents.map((document) => [document.url, document]));
  const result = await fetchOfficialDocuments(documents, [], async (url) => {
    const document = byUrl.get(String(url));
    assert.ok(document, `unexpected evidence URL: ${url}`);
    return new Response(await readFile(join(fixtureDirectory, `${document.id}.xlsx`)));
  });
  assert.deepEqual(result.sourceFailures, []);
  assert.equal(result.fetched.length, 88);
  assert.equal(result.fetched.flatMap((item) => item.records).length, 7_163);
});

test("rejects magic and byte tampering before parsing", () => {
  const document = METI_ANRE_OFFICIAL_DOCUMENTS[0];
  const receipt = document.evidenceReceipt;
  const wrongMagic = Buffer.alloc(receipt.expectedBytes);
  assert.throws(() => assertOfficialEvidenceSourceReceipt(document, {
    buffer: wrongMagic,
    bytes: wrongMagic.length,
    sha256: createHash("sha256").update(wrongMagic).digest("hex"),
  }), /応答magic/);

  const wrongBytes = Buffer.alloc(receipt.expectedBytes - 1);
  wrongBytes.set(Buffer.from("504b0304", "hex"));
  assert.throws(() => assertOfficialEvidenceSourceReceipt(document, {
    buffer: wrongBytes,
    bytes: wrongBytes.length,
    sha256: createHash("sha256").update(wrongBytes).digest("hex"),
  }), /応答バイト数/);
});

test("rejects source SHA drift and parsed-row drift", () => {
  const document = METI_ANRE_OFFICIAL_DOCUMENTS[0];
  const receipt = document.evidenceReceipt;
  const wrongSha = Buffer.alloc(receipt.expectedBytes);
  wrongSha.set(Buffer.from("504b0304", "hex"));
  assert.throws(() => assertOfficialEvidenceSourceReceipt(document, {
    buffer: wrongSha,
    bytes: wrongSha.length,
    sha256: createHash("sha256").update(wrongSha).digest("hex"),
  }), /応答SHA-256/);
  assert.throws(
    () => assertOfficialEvidenceRecordCount(document, Array(receipt.expectedRecordCount - 1)),
    /明細数がevidence receiptと一致しません/,
  );
});

test("rejects incomplete evidence tuples", () => {
  const original = METI_ANRE_OFFICIAL_DOCUMENTS[0];
  const document = { ...original, evidenceReceipt: { ...original.evidenceReceipt } };
  delete document.evidenceReceipt.expectedMagic;
  assert.throws(
    () => assertOfficialEvidenceRecordCount(document, []),
    /完全なevidence receipt定義がありません/,
  );
});

test("isolates a first-run evidence mismatch as an explicit source failure", async () => {
  const original = METI_ANRE_OFFICIAL_DOCUMENTS[0];
  const document = { ...original, evidenceReceipt: { ...original.evidenceReceipt, expectedSha256: "0".repeat(64) } };
  const buffer = Buffer.alloc(document.evidenceReceipt.expectedBytes);
  buffer.set(Buffer.from("504b0304", "hex"));
  const previousBootstrapDirectory = process.env.OFFICIAL_BOOTSTRAP_EVIDENCE_DIRECTORY;
  delete process.env.OFFICIAL_BOOTSTRAP_EVIDENCE_DIRECTORY;
  let result;
  try {
    result = await (await import("../scripts/update-official-data.mjs")).fetchOfficialDocuments(
      [document], [], async () => new Response(buffer),
    );
  } finally {
    if (previousBootstrapDirectory === undefined) delete process.env.OFFICIAL_BOOTSTRAP_EVIDENCE_DIRECTORY;
    else process.env.OFFICIAL_BOOTSTRAP_EVIDENCE_DIRECTORY = previousBootstrapDirectory;
  }
  const { fetched, sourceFailures } = result;
  assert.deepEqual(fetched, []);
  assert.equal(sourceFailures.length, 1);
  assert.equal(sourceFailures[0].reasonCode, "evidence_mismatch");
});

test("carries forward a published evidence source after repeated HTTP 202", async () => {
  const document = METI_ANRE_OFFICIAL_DOCUMENTS[0];
  const records = Array.from({ length: document.evidenceReceipt.expectedRecordCount }, (_, index) => ({
    id: `fixture-${index}`,
    sourceKey: `${document.id}:fixture:${index}`,
    datasetId: document.id,
    executorId: document.executorId,
    executorName: document.executorName,
    category: document.category,
    kind: document.kind,
    amountStage: document.amountStage,
    fiscalYear: document.fiscalYear,
    sourcePageUrl: document.sourcePageUrl,
    sourceDocumentUrl: document.url,
  }));
  const priorReceipt = {
    id: document.id,
    url: document.url,
    primaryUrl: document.url,
    transportUrl: document.url,
    originalUrl: document.url,
    sourcePageUrl: document.sourcePageUrl,
    format: "xlsx",
    discoveryStatus: document.discoveryStatus ?? "linked_from_official_index",
    coverageClaim: document.coverageClaim ?? "公式資料に掲載された行",
    parserRevision: OFFICIAL_PARSER_REVISION,
    definitionSha256: officialDocumentDefinitionSha256(document),
    executorId: document.executorId,
    category: document.category,
    kind: document.kind,
    fiscalYear: document.fiscalYear,
    bytes: document.evidenceReceipt.expectedBytes,
    sha256: document.evidenceReceipt.expectedSha256,
    records: records.length,
    retrievedAt: "2026-08-12T00:00:00.000Z",
    evidenceExpectedMagic: document.evidenceReceipt.expectedMagic,
    evidenceExpectedBytes: document.evidenceReceipt.expectedBytes,
    evidenceExpectedSha256: document.evidenceReceipt.expectedSha256,
    evidenceExpectedRecordCount: document.evidenceReceipt.expectedRecordCount,
    evidenceVerified: true,
  };
  const result = await fetchOfficialDocuments(
    [document], records, async () => new Response("AWS WAF challenge".padEnd(600), { status: 202 }),
    [document.id], [priorReceipt],
  );
  assert.equal(result.sourceFailures.length, 0);
  assert.equal(result.fetched[0].carryForward.primaryFailureReasonCode, "transient_http");
  assert.equal(result.fetched[0].records.length, records.length);

  const migrationReceipt = {
    ...priorReceipt,
    parserRevision: OFFICIAL_PARSER_MIGRATION.fromRevision,
    definitionSha256: officialDocumentDefinitionSha256(document, OFFICIAL_PARSER_MIGRATION.fromRevision),
  };
  const migrationResult = await fetchOfficialDocuments(
    [document], records, async () => new Response("AWS WAF challenge".padEnd(600), { status: 202 }),
    [document.id], [migrationReceipt], OFFICIAL_PARSER_MIGRATION.previousManifestSha256,
  );
  assert.equal(migrationResult.sourceFailures.length, 0);
  assert.equal(migrationResult.fetched[0].records.length, records.length);
  await assert.rejects(
    fetchOfficialDocuments(
      [document], records, async () => new Response("AWS WAF challenge".padEnd(600), { status: 202 }),
      [document.id], [migrationReceipt], "0".repeat(64),
    ),
    /receiptまたは明細が資料定義と一致しません/,
  );
});

test("publishes all currently published receipted sources with their exact audit tuple", () => {
  assert.equal(publishedManifest.coverage.attemptedSourceDocumentCount, publishedManifest.coverage.sourceDocumentCount);
  assert.ok(publishedManifest.coverage.sourceDocumentCount <= OFFICIAL_DOCUMENTS.length);
  assert.equal(publishedManifest.coverage.failedSourceDocumentCount, 0);
  assert.deepEqual(publishedManifest.sourceFailures, []);
  const publishedById = new Map(publishedManifest.sourceDocuments.map((source) => [source.id, source]));
  for (const document of evidenceDocuments.filter((document) => publishedById.has(document.id))) {
    const source = publishedById.get(document.id);
    assert.ok(source, document.id);
    assert.equal(source.bytes, document.evidenceReceipt.expectedBytes, document.id);
    assert.equal(source.sha256, document.evidenceReceipt.expectedSha256, document.id);
    assert.equal(source.records, document.evidenceReceipt.expectedRecordCount, document.id);
    assert.equal(source.evidenceExpectedMagic, document.evidenceReceipt.expectedMagic, document.id);
    assert.equal(source.evidenceExpectedBytes, document.evidenceReceipt.expectedBytes, document.id);
    assert.equal(source.evidenceExpectedSha256, document.evidenceReceipt.expectedSha256, document.id);
    assert.equal(source.evidenceExpectedRecordCount, document.evidenceReceipt.expectedRecordCount, document.id);
    assert.equal(source.evidenceVerified, true, document.id);
  }
});
