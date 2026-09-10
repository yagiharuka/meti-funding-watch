import { readFile, writeFile } from "node:fs/promises";

function replaceOnce(source, search, replacement, label) {
  const index = source.indexOf(search);
  if (index < 0) throw new Error(`${label}: target not found`);
  if (source.indexOf(search, index + search.length) >= 0) throw new Error(`${label}: target is not unique`);
  return `${source.slice(0, index)}${replacement}${source.slice(index + search.length)}`;
}

function replaceRegexOnce(source, pattern, replacement, label) {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const matches = [...source.matchAll(new RegExp(pattern.source, flags))];
  if (matches.length !== 1) throw new Error(`${label}: expected one match, got ${matches.length}`);
  return source.replace(pattern, replacement);
}

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after === before) throw new Error(`${path}: no change produced`);
  await writeFile(path, after);
}

await update("scripts/jogmec-reingest-stage1-20260826.mjs", (input) => {
  let source = input;
  source = replaceOnce(
    source,
    `  const output = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    id: "jogmec",
    name: "JOGMEC",
    collectionStatus: remainingCandidateCount === 0 ? "complete" : "partial",`,
    `  const fiscalYears = records.map((row) => row.fiscalYear).filter(Number.isSafeInteger);
  const minFiscalYear = fiscalYears.length ? Math.min(...fiscalYears) : null;
  const maxFiscalYear = fiscalYears.length ? Math.max(...fiscalYears) : null;
  const output = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    id: "jogmec",
    name: "JOGMEC",
    collectionStatus: remainingCandidateCount === 0 ? "complete" : "partial",
    minFiscalYear,
    maxFiscalYear,`,
    "JOGMEC stage1 fiscal range",
  );
  return source;
});

await update("scripts/build-official-supplement-index.mjs", (input) => {
  let source = input;
  if (source.includes("official-supplement-jogmec.json")) throw new Error("supplement index already integrates dedicated JOGMEC");
  source = replaceRegexOnce(
    source,
    /(const dedicatedSmrj = await readOptionalJson\("data\/official-supplement-smrj\.json"[^\n]*\);[\s\S]*?const smrj = dedicatedSmrj \?\? seededSmrj;\n)/,
    `$1const dedicatedJogmec = await readOptionalJson("data/official-supplement-jogmec.json");
const seededJogmec = seeds.sources.find((source) => source.id === "jogmec");
const jogmec = dedicatedJogmec ?? seededJogmec;
`,
    "supplement load JOGMEC",
  );
  source = replaceOnce(source, "for (const source of [nedo, smrj, jetro,", "for (const source of [nedo, smrj, jogmec, jetro,", "supplement validate JOGMEC");
  source = replaceOnce(
    source,
    `if (smrj.id !== "smrj") throw new Error("中小機構公式補足のIDが不正です");`,
    `if (smrj.id !== "smrj") throw new Error("中小機構公式補足のIDが不正です");
if (jogmec.id !== "jogmec") throw new Error("JOGMEC公式補足のIDが不正です");`,
    "supplement JOGMEC id",
  );
  source = replaceRegexOnce(
    source,
    /const seedSources = \[\n\s*nedo,\n\s*smrj,\n\s*\.\.\.seeds\.sources\.filter\(\(source\) => !\["nedo", "smrj"\]\.includes\(source\.id\)\),/,
    `const seedSources = [
  nedo,
  smrj,
  jogmec,
  ...seeds.sources.filter((source) => !["nedo", "smrj", "jogmec"].includes(source.id)),`,
    "supplement JOGMEC precedence",
  );
  source = replaceRegexOnce(
    source,
    /function validPublishedAmount\(value, category, sourceId, amountStage\) \{[\s\S]*?\n\}/,
    `function validPublishedAmount(value, category, sourceId, amountStage) {
  if (validAmount(value)) return true;
  if (value !== null) return false;
  if (category === "implementation_decision") return true;
  if (sourceId === "smrj") return ["契約金額の記載なし", "単価・変動額（契約総額の記載なし）"].includes(amountStage);
  if (sourceId === "jogmec") return [
    "契約金額の記載なし",
    "単価・変動額（契約総額の記載なし）",
    "複数金額記載（個社総額を確定できず）",
    "個社別金額の記載なし",
  ].includes(amountStage);
  return false;
}`,
    "supplement nullable JOGMEC amount",
  );
  source = replaceRegexOnce(
    source,
    /const sourceMinimumFiscalYear = source\.id === "smrj" \? SMRJ_MIN_FISCAL_YEAR : MIN_FISCAL_YEAR;/,
    `const sourceMinimumFiscalYear = source.id === "smrj"
      ? SMRJ_MIN_FISCAL_YEAR
      : source.id === "jogmec"
        ? (jogmec.minFiscalYear ?? MIN_FISCAL_YEAR)
        : MIN_FISCAL_YEAR;`,
    "supplement JOGMEC fiscal floor",
  );
  source = source.replace("nedo.updatedAt, smrj.updatedAt, jetro.updatedAt", "nedo.updatedAt, smrj.updatedAt, jogmec.updatedAt, jetro.updatedAt");
  source = source.replace(
    "minFiscalYear: dedicatedSmrj ? SMRJ_MIN_FISCAL_YEAR : MIN_FISCAL_YEAR,",
    "minFiscalYear: Math.min(dedicatedSmrj ? SMRJ_MIN_FISCAL_YEAR : MIN_FISCAL_YEAR, dedicatedJogmec?.minFiscalYear ?? MIN_FISCAL_YEAR),",
  );
  return source;
});

await update("scripts/build-official-company-index.mjs", (input) => {
  let source = input;
  if (source.includes("official-supplement-jogmec.json")) throw new Error("company index already integrates dedicated JOGMEC");
  source = replaceRegexOnce(
    source,
    /(const dedicatedSmrj = await readOptionalJson\("data\/official-supplement-smrj\.json"[^\n]*\);[\s\S]*?const smrj = dedicatedSmrj \?\? seededSmrj;\n)/,
    `$1const dedicatedJogmec = await readOptionalJson("data/official-supplement-jogmec.json", null);
const seededJogmec = seeds.sources.find((source) => source.id === "jogmec");
const jogmec = dedicatedJogmec ?? seededJogmec;
`,
    "company load JOGMEC",
  );
  source = replaceOnce(source, "for (const source of [nedo, smrj, jetro,", "for (const source of [nedo, smrj, jogmec, jetro,", "company validate JOGMEC");
  source = replaceOnce(
    source,
    `if (smrj.id !== "smrj") throw new Error("中小機構公式補足のIDが不正です");`,
    `if (smrj.id !== "smrj") throw new Error("中小機構公式補足のIDが不正です");
if (jogmec.id !== "jogmec") throw new Error("JOGMEC公式補足のIDが不正です");`,
    "company JOGMEC id",
  );
  source = replaceRegexOnce(
    source,
    /const seedSources = \[nedo, smrj, \.\.\.seeds\.sources\.filter\(\(source\) => !\["nedo", "smrj"\]\.includes\(source\.id\)\),/,
    `const seedSources = [nedo, smrj, jogmec, ...seeds.sources.filter((source) => !["nedo", "smrj", "jogmec"].includes(source.id)),`,
    "company JOGMEC precedence",
  );
  source = replaceRegexOnce(
    source,
    /function validPublishedAmount\(value, category, sourceId, amountStage\) \{[\s\S]*?\n\}/,
    `function validPublishedAmount(value, category, sourceId, amountStage) {
  if (validAmount(value)) return true;
  if (value !== null) return false;
  if (category === "implementation_decision") return true;
  if (sourceId === "smrj") return ["契約金額の記載なし", "単価・変動額（契約総額の記載なし）"].includes(amountStage);
  if (sourceId === "jogmec") return [
    "契約金額の記載なし",
    "単価・変動額（契約総額の記載なし）",
    "複数金額記載（個社総額を確定できず）",
    "個社別金額の記載なし",
  ].includes(amountStage);
  return false;
}`,
    "company nullable JOGMEC amount",
  );
  source = replaceRegexOnce(
    source,
    /const sourceMinimumFiscalYear = sourceId === "smrj" \? SMRJ_MIN_FISCAL_YEAR : MIN_FISCAL_YEAR;/,
    `const sourceMinimumFiscalYear = sourceId === "smrj"
    ? SMRJ_MIN_FISCAL_YEAR
    : sourceId === "jogmec"
      ? (jogmec.minFiscalYear ?? MIN_FISCAL_YEAR)
      : MIN_FISCAL_YEAR;`,
    "company JOGMEC fiscal floor",
  );
  source = source.replace("nedo.updatedAt, smrj.updatedAt, jetro.updatedAt", "nedo.updatedAt, smrj.updatedAt, jogmec.updatedAt, jetro.updatedAt");
  source = source.replace(
    "minFiscalYear: hasDedicatedSmrj ? SMRJ_MIN_FISCAL_YEAR : MIN_FISCAL_YEAR,",
    "minFiscalYear: Math.min(hasDedicatedSmrj ? SMRJ_MIN_FISCAL_YEAR : MIN_FISCAL_YEAR, dedicatedJogmec?.minFiscalYear ?? MIN_FISCAL_YEAR),",
  );
  return source;
});

await update(".github/workflows/refresh-official-data.yml", (input) => {
  let source = input;
  if (source.includes("jogmec-reingest-stage1-20260826")) throw new Error("refresh workflow already runs JOGMEC stage1");
  source = replaceOnce(
    source,
    "      - name: Refresh official contract, grant and supplement sources\n        run: npm run update:official",
    `      - name: Refresh official contract, grant and supplement sources
        run: |
          npm run update:official
          node scripts/jogmec-inventory-20260826.mjs
          node scripts/jogmec-reingest-stage1-20260826.mjs`,
    "refresh workflow JOGMEC stage1",
  );
  source = source.replace("timeout-minutes: 35", "timeout-minutes: 50");
  source = source.replaceAll(
    "data/official-supplement-smrj.json",
    "data/official-supplement-smrj.json data/official-supplement-jogmec.json data/official-supplement-jogmec-inventory.json",
  );
  return source;
});

await update("tests/official-supplement.test.mjs", (input) => {
  let source = input;
  const marker = 'test("dedicated JOGMEC supplement is indexed without zero-filling unpublished amounts"';
  if (source.includes(marker)) throw new Error("JOGMEC supplement integration test already exists");
  source += `

test("dedicated JOGMEC supplement is indexed without zero-filling unpublished amounts", async () => {
  const dedicated = await readJson("data/official-supplement-jogmec.json");
  const index = await readJson("data/official-supplement-index.json");
  assert.equal(dedicated.id, "jogmec");
  assert.ok(["partial", "complete"].includes(dedicated.collectionStatus));
  assert.equal(dedicated.recordCount, dedicated.records.length);
  const indexed = index.records.filter((row) => row.sourceId === "jogmec");
  assert.equal(indexed.length, dedicated.records.length);
  assert.ok(indexed.every((row) => row.amount !== 0 || !/記載なし|非公表|単価|個社別/u.test(row.amountStage)));
  if (dedicated.collectionStatus === "partial") assert.ok(dedicated.unparsedDocumentCount > 0);
});
`;
  return source;
});

await update("tests/company-evidence-ui.test.mjs", (input) => {
  let source = input;
  const marker = 'test("JOGMEC dedicated records are searchable with partial-coverage metadata"';
  if (source.includes(marker)) throw new Error("JOGMEC company integration test already exists");
  source += `

test("JOGMEC dedicated records are searchable with partial-coverage metadata", async () => {
  const dedicated = await json("data/official-supplement-jogmec.json");
  const index = await json("public/data/official-company-index.json");
  const rows = index.records.filter((row) => row.sourceId === "jogmec");
  assert.equal(rows.length, dedicated.records.length);
  const source = index.sources.find((entry) => entry.id === "jogmec");
  assert.ok(source);
  assert.match(source.coverageNote, /JOGMEC|未解析|partial|完了を意味しない/u);
  assert.ok(rows.every((row) => row.amount !== 0 || !/記載なし|非公表|単価|個社別/u.test(row.amountStage)));
});
`;
  return source;
});

console.log("Applied dedicated JOGMEC stage-one integration.");
