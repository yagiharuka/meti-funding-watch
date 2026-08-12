import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { METI_ANRE_OFFICIAL_DOCUMENTS } from "../scripts/official-meti-anre-history.mjs";
import { REGIONAL_OFFICIAL_DOCUMENTS } from "../scripts/official-regional-history.mjs";
import { REGIONAL_PDF_DOCUMENTS } from "../scripts/official-regional-pdf-sources.mjs";
import {
  assertOfficialEvidenceRecordCount,
  assertOfficialEvidenceSourceReceipt,
  fetchOfficialDocuments,
  OFFICIAL_DOCUMENTS,
} from "../scripts/update-official-data.mjs";

const evidenceDocuments = [
  ...METI_ANRE_OFFICIAL_DOCUMENTS,
  ...REGIONAL_OFFICIAL_DOCUMENTS,
  ...REGIONAL_PDF_DOCUMENTS,
];

const publishedManifest = JSON.parse(await readFile(new URL("../data/official/manifest.json", import.meta.url), "utf8"));

test("binds every phase-2 production document to one complete evidence receipt", () => {
  assert.equal(evidenceDocuments.length, 26);
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
  const { fetched, sourceFailures } = await (await import("../scripts/update-official-data.mjs")).fetchOfficialDocuments(
    [document], [], async () => new Response(buffer),
  );
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
});

test("publishes all 26 receipted phase-2 sources with their exact audit tuple", () => {
  assert.equal(publishedManifest.coverage.attemptedSourceDocumentCount, 100);
  assert.equal(publishedManifest.coverage.sourceDocumentCount, 100);
  assert.equal(publishedManifest.coverage.failedSourceDocumentCount, 0);
  assert.deepEqual(publishedManifest.sourceFailures, []);
  const publishedById = new Map(publishedManifest.sourceDocuments.map((source) => [source.id, source]));
  for (const document of evidenceDocuments) {
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
