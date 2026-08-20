import { readFile, writeFile } from "node:fs/promises";

const updaterPath = "scripts/update-official-data.mjs";
let updater = await readFile(updaterPath, "utf8");
const importAnchor = 'import { METI_ANRE_OFFICIAL_DOCUMENTS } from "./official-meti-anre-history.mjs";\n';
const importLine = 'import { METI_LEGACY_OFFICIAL_DOCUMENTS } from "./official-meti-legacy-history.mjs";\n';
if (!updater.includes(importLine)) {
  if (!updater.includes(importAnchor)) throw new Error("legacy import anchor not found");
  updater = updater.replace(importAnchor, importAnchor + importLine);
}
const spreadAnchor = '  ...METI_ANRE_OFFICIAL_DOCUMENTS,\n';
const spreadLine = '  ...METI_LEGACY_OFFICIAL_DOCUMENTS,\n';
if (!updater.includes(spreadLine)) {
  if (!updater.includes(spreadAnchor)) throw new Error("legacy spread anchor not found");
  updater = updater.replace(spreadAnchor, spreadAnchor + spreadLine);
}
await writeFile(updaterPath, updater);

await writeFile("tests/official-meti-legacy.test.mjs", `import assert from "node:assert/strict";\nimport { readFile } from "node:fs/promises";\nimport test from "node:test";\nimport { METI_LEGACY_OFFICIAL_DOCUMENTS, METI_LEGACY_EVIDENCE_METADATA } from "../scripts/official-meti-legacy-history.mjs";\n\nconst evidence = JSON.parse(await readFile(new URL("../data/official-meti-legacy-evidence.json", import.meta.url), "utf8"));\n\ntest("pins verified METI headquarters history back to FY2017", () => {\n  assert.equal(evidence.schemaVersion, 1);\n  assert.equal(evidence.documentCount, 27);\n  assert.equal(evidence.recordCount, 3598);\n  assert.equal(METI_LEGACY_EVIDENCE_METADATA.documentCount, evidence.documentCount);\n  assert.equal(METI_LEGACY_EVIDENCE_METADATA.recordCount, evidence.recordCount);\n  assert.equal(METI_LEGACY_OFFICIAL_DOCUMENTS.length, evidence.documentCount);\n  assert.ok(METI_LEGACY_OFFICIAL_DOCUMENTS.some((row) => row.fiscalYear === 2017 && row.category === "contract_result"));\n  assert.ok(METI_LEGACY_OFFICIAL_DOCUMENTS.some((row) => row.fiscalYear === 2017 && row.category === "grant_decision"));\n  for (const row of METI_LEGACY_OFFICIAL_DOCUMENTS) {\n    assert.equal(row.executorId, "meti");\n    assert.ok(row.fiscalYear >= 2017 && row.fiscalYear <= 2021);\n    assert.match(row.url, /^https:\\/\\/warp\\.ndl\\.go\\.jp\\/20260602\\/20260601000000\\/https:\\/\\/www\\.meti\\.go\\.jp\\//);\n    assert.match(row.originalUrl, /^https:\\/\\/www\\.meti\\.go\\.jp\\//);\n    assert.ok(Number.isSafeInteger(row.expectedSheetCount) && row.expectedSheetCount >= 1);\n    assert.ok(Number.isSafeInteger(row.archiveExpectedBytes) && row.archiveExpectedBytes > 1000);\n    assert.match(row.archiveExpectedSha256, /^[0-9a-f]{64}$/);\n    assert.ok(Number.isSafeInteger(row.archiveExpectedRecordCount) && row.archiveExpectedRecordCount > 0);\n    assert.deepEqual(row.evidenceReceipt, {\n      expectedMagic: "504b0304",\n      expectedBytes: row.archiveExpectedBytes,\n      expectedSha256: row.archiveExpectedSha256,\n      expectedRecordCount: row.archiveExpectedRecordCount,\n    });\n  }\n});\n`);

const packagePath = "package.json";
const pkg = JSON.parse(await readFile(packagePath, "utf8"));
for (const testFile of ["tests/official-heisei-date.test.mjs", "tests/official-meti-legacy.test.mjs"]) {
  if (!pkg.scripts["test:pages"].includes(testFile)) {
    pkg.scripts["test:pages"] = pkg.scripts["test:pages"].replace("tests/official-golden-records.test.mjs", `tests/official-golden-records.test.mjs ${testFile}`);
  }
}
await writeFile(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
console.log("METI legacy history wired into production official updater");
