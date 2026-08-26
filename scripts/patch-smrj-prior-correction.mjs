import { readFile, writeFile } from "node:fs/promises";

function replaceOnce(source, search, replacement, label) {
  const index = source.indexOf(search);
  if (index < 0) throw new Error(`${label}: replacement target not found`);
  if (source.indexOf(search, index + search.length) >= 0) throw new Error(`${label}: replacement target is not unique`);
  return `${source.slice(0, index)}${replacement}${source.slice(index + search.length)}`;
}

const parserPath = "scripts/smrj-official-supplement.mjs";
let parser = await readFile(parserPath, "utf8");
parser = replaceOnce(
  parser,
  `  for (const prior of previousRecords) {
    const candidates = current
      .map((row, index) => ({ row, index }))
      .filter(({ row, index }) =>
        !used.has(index)
        && row.date === prior.date
        && row.amount === prior.amount
        && row.category === prior.category
        && rowHasPriorParty(row, prior));
    let matches = candidates.filter(({ row }) => programComparable(row.program, prior.program));
    if (!matches.length && candidates.length === 1) matches = candidates;
    if (matches.length !== 1) {
      throw new Error(\`中小機構本部: 既存検証行を現在資料へ一意に対応できません (\${prior.id}: \${matches.length}/\${candidates.length})\`);
    }
    const { row, index } = matches[0];`,
  `  for (const prior of previousRecords) {
    const partyCandidates = current
      .map((row, index) => ({ row, index }))
      .filter(({ row, index }) =>
        !used.has(index)
        && row.date === prior.date
        && row.category === prior.category
        && row.fiscalYear === prior.fiscalYear
        && rowHasPriorParty(row, prior));
    const amountCandidates = partyCandidates.filter(({ row }) => row.amount === prior.amount);
    let matches = amountCandidates.filter(({ row }) => programComparable(row.program, prior.program));
    if (!matches.length && amountCandidates.length === 1) matches = amountCandidates;

    if (!matches.length) {
      const nonTotalCandidates = partyCandidates.filter(({ row }) =>
        row.amount === null && row.amountStatus === "non_total");
      const comparableNonTotal = nonTotalCandidates.filter(({ row }) =>
        programComparable(row.program, prior.program));
      if (comparableNonTotal.length === 1) matches = comparableNonTotal;
      else if (!comparableNonTotal.length && nonTotalCandidates.length === 1) matches = nonTotalCandidates;
    }

    if (matches.length !== 1) {
      const diagnostic = partyCandidates.map(({ row }) => ({
        program: row.program,
        amount: row.amount,
        amountStatus: row.amountStatus,
        sourceUrl: row.sourceUrl,
      }));
      throw new Error(\`中小機構本部: 既存検証行を現在資料へ一意に対応できません (\${prior.id}: \${matches.length}/\${amountCandidates.length}/\${partyCandidates.length}; \${JSON.stringify(diagnostic)})\`);
    }
    const { row, index } = matches[0];`,
  "SMRJ prior non-total correction",
);
parser = replaceOnce(
  parser,
  `  return current.sort((a, b) =>
    b.fiscalYear - a.fiscalYear
    || (b.date ?? "").localeCompare(a.date ?? "")
    || a.organization.localeCompare(b.organization, "ja")
    || a.id.localeCompare(b.id));
}

async function parseDocument`,
  `  return current.sort((a, b) =>
    b.fiscalYear - a.fiscalYear
    || (b.date ?? "").localeCompare(a.date ?? "")
    || a.organization.localeCompare(b.organization, "ja")
    || a.id.localeCompare(b.id));
}

export function mergeSmrjWithPrevious(currentRecords, previousRecords) {
  return mergeWithPrevious(currentRecords, previousRecords);
}

async function parseDocument`,
  "SMRJ merge test export",
);
await writeFile(parserPath, parser);

const testPath = "tests/smrj-official-supplement.test.mjs";
let tests = await readFile(testPath, "utf8");
tests = replaceOnce(
  tests,
  `  parseSmrjPartyLines,
  parseSmrjPositionedPages,`,
  `  mergeSmrjWithPrevious,
  parseSmrjPartyLines,
  parseSmrjPositionedPages,`,
  "SMRJ merge test import",
);
if (tests.includes("previous numeric amendment amount")) throw new Error("SMRJ prior correction regression test already exists");
tests = `${tests.trimEnd()}

test("SMRJ merge corrects a previous numeric amendment amount to non-total without losing the verified row identity", () => {
  const prior = {
    id: "central-history-e176bf7dab03df150e87dbc3",
    organization: "(株)日本経済廣告社",
    corporateNumber: "7010001033082",
    fiscalYear: 2019,
    date: "2020-03-30",
    program: "『Japan Venture Awards 2020』に係る業務請負 (第2回変更)",
    category: "contract_result",
    amount: 988_125,
    sourceKey: "verified-prior-key",
  };
  const current = {
    ...prior,
    id: "new-layout-id",
    organization: "株式会社日本経済廣告社",
    program: "PDF配置差で旧文字列と一致しない変更契約行",
    amount: null,
    amountStatus: "non_total",
    amountStage: "単価・変動額（契約総額の記載なし）",
    sourceKey: "new-layout-key",
  };
  const merged = mergeSmrjWithPrevious([current], [prior]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, prior.id);
  assert.equal(merged[0].sourceKey, prior.sourceKey);
  assert.equal(merged[0].amount, null);
  assert.equal(merged[0].amountStatus, "non_total");
  assert.equal(merged[0].amountStage, "単価・変動額（契約総額の記載なし）");
});

test("SMRJ merge still fails closed when multiple non-total rows share the same party and date", () => {
  const prior = {
    id: "prior-ambiguous-row",
    organization: "株式会社テスト",
    corporateNumber: "1000000000001",
    fiscalYear: 2026,
    date: "2026-04-10",
    program: "旧件名",
    category: "contract_result",
    amount: 10_000_000,
  };
  const current = ["変更A", "変更B"].map((program, index) => ({
    ...prior,
    id: `current-non-total-${index}`,
    program,
    amount: null,
    amountStatus: "non_total",
    amountStage: "単価・変動額（契約総額の記載なし）",
  }));
  assert.throws(
    () => mergeSmrjWithPrevious(current, [prior]),
    /既存検証行を現在資料へ一意に対応できません/,
  );
});

test("SMRJ merge still fails closed on an unexplained published-amount change", () => {
  const prior = {
    id: "prior-published-row",
    organization: "株式会社テスト",
    corporateNumber: "1000000000001",
    fiscalYear: 2026,
    date: "2026-04-10",
    program: "テスト業務",
    category: "contract_result",
    amount: 10_000_000,
  };
  const current = {
    ...prior,
    id: "current-published-row",
    amount: 11_000_000,
    amountStatus: "published",
    amountStage: "契約金額",
  };
  assert.throws(
    () => mergeSmrjWithPrevious([current], [prior]),
    /既存検証行を現在資料へ一意に対応できません/,
  );
});
`;
await writeFile(testPath, tests);

console.log("Patched SMRJ prior non-total corrections and added fail-closed regression tests.");
