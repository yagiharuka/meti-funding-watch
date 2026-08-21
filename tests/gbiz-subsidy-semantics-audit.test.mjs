import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

function normalizeProgram(value = "") {
  return String(value)
    .normalize("NFKC")
    .toLocaleLowerCase("ja-JP")
    .replace(/[\s　]+/g, "")
    .trim();
}

async function loadAllRows() {
  const manifest = JSON.parse(await readFile(new URL("../data/pages/manifest.json", import.meta.url), "utf8"));
  const files = Object.values(manifest.commitments);
  const chunks = await Promise.all(files.map(async (filename) =>
    JSON.parse(await readFile(new URL(`../data/pages/${filename}`, import.meta.url), "utf8"))));
  return chunks.flat();
}

function grouped(rows, keyFn) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    const current = groups.get(key);
    if (current) current.push(row);
    else groups.set(key, [row]);
  }
  return [...groups.values()].filter((items) => items.length > 1);
}

const rows = await loadAllRows();
const subsidies = rows.filter((row) => row.stage === "subsidy_published");

test("emit subsidy semantics audit metrics", () => {
  assert.ok(subsidies.length > 0);

  const missingDateByPublisher = Object.fromEntries(
    [...new Set(subsidies.map((row) => row.publisherCanonical))]
      .sort((a, b) => String(a).localeCompare(String(b), "ja"))
      .map((publisher) => {
        const items = subsidies.filter((row) => row.publisherCanonical === publisher);
        return [publisher, {
          rows: items.length,
          missingDateRows: items.filter((row) => row.fiscalYear === null).length,
        }];
      }),
  );

  const yearCounts = Object.fromEntries(
    [...new Set(subsidies.map((row) => row.fiscalYear))]
      .sort((a, b) => (a === null ? 1 : b === null ? -1 : a - b))
      .map((year) => [String(year), subsidies.filter((row) => row.fiscalYear === year).length]),
  );

  const cashless = subsidies
    .filter((row) => row.organization.includes("キャッシュレス推進協議会") && row.program.includes("キャッシュレス・消費者還元事業費補助金"))
    .map((row) => ({
      fiscalYear: row.fiscalYear,
      date: row.date,
      amount: row.amount,
      amountRaw: row.amountRaw,
      sourceKey: row.sourceKey,
      sourceRetrievedAt: row.sourceRetrievedAt,
      sourceUpdatedAt: row.sourceUpdatedAt,
      sourceSystem: row.sourceSystem,
      publisherCanonical: row.publisherCanonical,
      program: row.program,
      notes: row.notes,
    }))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || Number(a.amount) - Number(b.amount));

  const claudeSameCorpAmountStage = grouped(
    rows.filter((row) => row.amount !== null),
    (row) => [row.corporateNumber, row.amount, row.stage].join("\u001f"),
  );
  const weakSameCorpAmount = grouped(
    subsidies.filter((row) => row.amount !== null),
    (row) => [row.corporateNumber, row.publisherCanonical, row.amount].join("\u001f"),
  );
  const exactProgramAmount = grouped(
    subsidies.filter((row) => row.amount !== null),
    (row) => [row.corporateNumber, row.publisherCanonical, normalizeProgram(row.program), row.amount].join("\u001f"),
  );
  const exactProgram = grouped(
    subsidies,
    (row) => [row.corporateNumber, row.publisherCanonical, normalizeProgram(row.program)].join("\u001f"),
  );

  const claudeExcessRows = claudeSameCorpAmountStage.reduce((sum, items) => sum + items.length - 1, 0);
  const claudeExcessAmount = claudeSameCorpAmountStage.reduce((sum, items) => sum + (items.length - 1) * Number(items[0].amount ?? 0), 0);
  const weakExcessRows = weakSameCorpAmount.reduce((sum, items) => sum + items.length - 1, 0);
  const weakExcessAmount = weakSameCorpAmount.reduce((sum, items) => sum + (items.length - 1) * Number(items[0].amount ?? 0), 0);
  const exactProgramAmountExcessRows = exactProgramAmount.reduce((sum, items) => sum + items.length - 1, 0);
  const exactProgramAmountExcessAmount = exactProgramAmount.reduce((sum, items) => sum + (items.length - 1) * Number(items[0].amount ?? 0), 0);

  const allKnownAmount = rows.reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
  const totalKnownAmount = subsidies.reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
  const topRows = subsidies
    .filter((row) => row.amount !== null)
    .sort((a, b) => Number(b.amount) - Number(a.amount))
    .slice(0, 12)
    .map((row) => ({
      organization: row.organization,
      corporateNumber: row.corporateNumber,
      amount: row.amount,
      fiscalYear: row.fiscalYear,
      date: row.date,
      program: row.program,
      publisherCanonical: row.publisherCanonical,
      sourceKey: row.sourceKey,
    }));

  const audit = {
    totalRows: rows.length,
    allKnownAmount,
    subsidyRows: subsidies.length,
    subsidyKnownAmount: totalKnownAmount,
    missingDateRows: subsidies.filter((row) => row.fiscalYear === null).length,
    missingDateByPublisher,
    yearCounts,
    cashless,
    claudeSameCorpAmountStage: {
      groups: claudeSameCorpAmountStage.length,
      excessRows: claudeExcessRows,
      excessAmount: claudeExcessAmount,
      excessAmountShareOfAllRows: allKnownAmount ? claudeExcessAmount / allKnownAmount : null,
    },
    weakSameCorpAmount: {
      groups: weakSameCorpAmount.length,
      excessRows: weakExcessRows,
      excessAmount: weakExcessAmount,
      excessAmountShare: totalKnownAmount ? weakExcessAmount / totalKnownAmount : null,
    },
    exactProgramAmount: {
      groups: exactProgramAmount.length,
      excessRows: exactProgramAmountExcessRows,
      excessAmount: exactProgramAmountExcessAmount,
      excessAmountShare: totalKnownAmount ? exactProgramAmountExcessAmount / totalKnownAmount : null,
    },
    exactProgram: {
      groups: exactProgram.length,
      rows: exactProgram.reduce((sum, items) => sum + items.length, 0),
    },
    topRows,
    top8KnownAmountShare: totalKnownAmount
      ? topRows.slice(0, 8).reduce((sum, row) => sum + Number(row.amount ?? 0), 0) / totalKnownAmount
      : null,
  };

  console.log(`GBIZ_SUBSIDY_SEMANTICS_AUDIT=${JSON.stringify(audit)}`);
});
