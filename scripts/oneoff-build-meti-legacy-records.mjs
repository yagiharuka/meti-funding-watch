import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";

import { METI_LEGACY_EVIDENCE_METADATA, METI_LEGACY_OFFICIAL_DOCUMENTS } from "./official-meti-legacy-history.mjs";
import { parseOfficialWorkbook } from "./update-official-data.mjs";

const headers = {
  accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,*/*;q=0.1",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36",
};
const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

const allRecords = [];
for (const [index, document] of METI_LEGACY_OFFICIAL_DOCUMENTS.entries()) {
  const response = await fetch(document.url, { headers, redirect: "follow", signal: AbortSignal.timeout(30_000) });
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!response.ok) throw new Error(`${document.id}: WARP HTTP ${response.status}`);
  if (buffer.length !== document.archiveExpectedBytes) throw new Error(`${document.id}: bytes mismatch ${buffer.length}/${document.archiveExpectedBytes}`);
  if (sha256(buffer) !== document.archiveExpectedSha256) throw new Error(`${document.id}: SHA-256 mismatch`);
  if (buffer.subarray(0, 4).toString("hex") !== "504b0304") throw new Error(`${document.id}: XLSX signature missing`);
  const records = await parseOfficialWorkbook(buffer, document);
  if (records.length !== document.archiveExpectedRecordCount) throw new Error(`${document.id}: record count mismatch ${records.length}/${document.archiveExpectedRecordCount}`);
  allRecords.push(...records);
  console.error(`[legacy METI ${index + 1}/${METI_LEGACY_OFFICIAL_DOCUMENTS.length}] ${document.id}: ${records.length}`);
}

if (allRecords.length !== METI_LEGACY_EVIDENCE_METADATA.recordCount) {
  throw new Error(`legacy METI total mismatch: ${allRecords.length}/${METI_LEGACY_EVIDENCE_METADATA.recordCount}`);
}
if (new Set(allRecords.map((row) => row.id)).size !== allRecords.length) throw new Error("legacy METI ids duplicate");
if (new Set(allRecords.map((row) => row.sourceKey)).size !== allRecords.length) throw new Error("legacy METI source keys duplicate");
for (const row of allRecords) {
  if (row.executorId !== "meti" || row.fiscalYear < 2017 || row.fiscalYear > 2021) throw new Error(`legacy METI identity mismatch: ${row.id}`);
  if (!row.organization || !row.program || !Number.isSafeInteger(row.amount)) throw new Error(`legacy METI required value missing: ${row.id}`);
}

const output = {
  schemaVersion: 1,
  verifiedAt: METI_LEGACY_EVIDENCE_METADATA.verifiedAt,
  verification: METI_LEGACY_EVIDENCE_METADATA.verification,
  capture: METI_LEGACY_EVIDENCE_METADATA.capture,
  documentCount: METI_LEGACY_EVIDENCE_METADATA.documentCount,
  recordCount: allRecords.length,
  records: allRecords.sort((a, b) => b.fiscalYear - a.fiscalYear || (b.date ?? "").localeCompare(a.date ?? "") || a.organization.localeCompare(b.organization, "ja")),
};
await writeFile("data/official-meti-legacy-records.json", `${JSON.stringify(output)}\n`);
console.log(`Verified METI legacy company records: ${allRecords.length}`);
