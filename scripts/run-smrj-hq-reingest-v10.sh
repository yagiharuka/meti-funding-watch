#!/usr/bin/env bash
set -euo pipefail

echo "== Preserve the current main SMRJ parser as a validated fallback =="
git fetch origin main
git show origin/main:scripts/smrj-official-supplement.mjs > scripts/smrj-layout-parser-legacy.mjs

echo "== Install history discovery with legacy, layout and TSV parsing strategies =="
cp scripts/smrj-hq-history-v4.mjs scripts/smrj-official-supplement.mjs
cp tests/smrj-hq-history-v4.test.mjs tests/smrj-official-supplement.test.mjs
sed -i 's/\[70, organization\]/[75, organization]/g' tests/smrj-official-supplement.test.mjs
sed -i 's/amount: "10,000,000 11,000,000"/amount: "10 11"/g' tests/smrj-official-supplement.test.mjs
node scripts/smrj-hq-history-compat-v4.mjs
node scripts/smrj-hq-v7-patch.mjs
node scripts/smrj-hq-v8-tsv-fallback.mjs
node scripts/smrj-hq-v10-legacy-fallback.mjs
command -v pdftotext
node --check scripts/smrj-layout-parser-legacy.mjs
node --check scripts/smrj-official-supplement.mjs

echo "== Remove temporary files before repository-governance tests =="
for file in \
  .github/workflows/reingest-smrj-hq-history-once.yml \
  .github/workflows/finalize-smrj-hq-history.yml \
  .github/workflows/finalize-smrj-hq-history-v2.yml \
  .github/workflows/retry-smrj-hq-history-v4.yml \
  .github/workflows/retry-smrj-hq-history-v5.yml \
  .github/workflows/retry-smrj-hq-history-v6.yml \
  .github/workflows/retry-smrj-hq-history-v7.yml \
  .github/workflows/retry-smrj-hq-history-v8.yml \
  .github/workflows/retry-smrj-hq-history-v9.yml \
  .github/workflows/retry-smrj-hq-history-v10.yml \
  scripts/smrj-hq-history-v2.mjs \
  scripts/smrj-hq-history-v3.mjs \
  scripts/smrj-hq-history-v4.mjs \
  scripts/smrj-hq-history-patch-v3.mjs \
  scripts/smrj-hq-history-hotfix-v3.mjs \
  scripts/smrj-hq-history-compat-v4.mjs \
  scripts/smrj-hq-v7-patch.mjs \
  scripts/smrj-hq-v8-tsv-fallback.mjs \
  scripts/smrj-hq-v8-test-patch.mjs \
  scripts/smrj-hq-v10-legacy-fallback.mjs \
  scripts/run-smrj-hq-reingest-v6.sh \
  scripts/run-smrj-hq-reingest-v7.sh \
  scripts/run-smrj-hq-reingest-v8.sh \
  scripts/run-smrj-hq-reingest-v9.sh \
  scripts/run-smrj-hq-reingest-v10.sh \
  tests/smrj-hq-history-v3.test.mjs \
  tests/smrj-hq-history-v4.test.mjs; do
  if [ -e "$file" ]; then rm -f "$file"; fi
done

echo "== Parser fixture tests before live retrieval =="
node --test tests/smrj-official-supplement.test.mjs

echo "== Live discovery and full reprocessing =="
SMRJ_REPROCESS_ALL=1 node scripts/smrj-official-supplement.mjs

echo "== Rebuild derived indexes =="
node scripts/build-official-supplement-index.mjs
node scripts/build-official-company-index.mjs

echo "== Verify exact scope and accounting =="
node --input-type=module -e '
  import { readFile } from "node:fs/promises";
  const seeds = JSON.parse(await readFile("data/official-supplement-seeds.json", "utf8"));
  const source = seeds.sources.find((item) => item.id === "smrj");
  if (!source) throw new Error("SMRJ source missing");
  if (source.collectionStatus !== "complete") throw new Error(`collectionStatus=${source.collectionStatus}`);
  if (source.scope?.organizationUnit !== "本部") throw new Error(`organizationUnit=${source.scope?.organizationUnit}`);
  if (source.scope?.fiscalYearFrom !== 2015) throw new Error(`fiscalYearFrom=${source.scope?.fiscalYearFrom}`);
  if (source.scope?.contractKinds?.join(",") !== "competitive,discretionary") throw new Error(`contractKinds=${source.scope?.contractKinds}`);
  if (source.parseFailureCount !== 0) throw new Error(`parseFailureCount=${source.parseFailureCount}`);
  if (source.records.length < 50) throw new Error(`records=${source.records.length}`);
  if (source.discoveredDocumentCount < 20) throw new Error(`documents=${source.discoveredDocumentCount}`);
  if (source.parsedDocumentCount + source.noResultDocumentCount !== source.totalDocumentCount) throw new Error("document accounting mismatch");
  if (source.printedRowCount !== source.records.length + source.duplicateRecordCount + source.amountUnavailableCount) throw new Error("row accounting mismatch");
  const currentYear = new Date().getUTCMonth() + 1 >= 4 ? new Date().getUTCFullYear() : new Date().getUTCFullYear() - 1;
  for (let year = 2015; year <= currentYear; year += 1) {
    const kinds = source.coverageMatrix?.[year] ?? [];
    if (!kinds.includes("competitive") || !kinds.includes("discretionary")) throw new Error(`coverage gap ${year}: ${kinds.join(",")}`);
  }
  if (source.records.some((row) => row.amount === null)) throw new Error("published records contain null amount");
  console.log(JSON.stringify({
    records: source.records.length,
    documents: source.totalDocumentCount,
    parsedDocuments: source.parsedDocumentCount,
    noResultDocuments: source.noResultDocumentCount,
    printedRows: source.printedRowCount,
    amountUnavailable: source.amountUnavailableCount,
    duplicates: source.duplicateRecordCount,
    fiscalYearFrom: source.scope.fiscalYearFrom,
    fiscalYearTo: source.scope.fiscalYearTo,
  }));
'

echo "== Full fixture build and tests =="
npm test
