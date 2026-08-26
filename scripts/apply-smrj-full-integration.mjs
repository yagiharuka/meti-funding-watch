import { readFile, writeFile } from "node:fs/promises";

function replaceOnce(source, search, replacement, label) {
  if (!source.includes(search)) throw new Error(`${label}: replacement target not found`);
  if (source.indexOf(search) !== source.lastIndexOf(search)) throw new Error(`${label}: replacement target is not unique`);
  return source.replace(search, replacement);
}

function insertAfterOnce(source, marker, insertion, label) {
  if (source.includes(insertion.trim())) return source;
  const index = source.indexOf(marker);
  if (index < 0) throw new Error(`${label}: insertion marker not found`);
  if (source.indexOf(marker, index + marker.length) >= 0) throw new Error(`${label}: insertion marker is not unique`);
  return `${source.slice(0, index + marker.length)}${insertion}${source.slice(index + marker.length)}`;
}

async function patch(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after === before) console.log(`${path}: already integrated`);
  else {
    await writeFile(path, after);
    console.log(`${path}: patched`);
  }
}

const SMRJ_NULL_STAGES = ["契約金額の記載なし", "単価・変動額（契約総額の記載なし）"];

await patch("scripts/build-official-supplement-index.mjs", (input) => {
  let source = input;
  if (!source.includes('const smrj = JSON.parse(await readFile("data/official-supplement-smrj.json", "utf8"));')) {
    source = insertAfterOnce(
      source,
      'const nedo = JSON.parse(await readFile("data/official-supplement-nedo.json", "utf8"));',
      '\nconst smrj = JSON.parse(await readFile("data/official-supplement-smrj.json", "utf8"));',
      "supplement smrj read",
    );
  }
  source = source.replace(
    'for (const source of [nedo, jetro, aist, inpit, nite, ipa, rieti]) {',
    'for (const source of [nedo, smrj, jetro, aist, inpit, nite, ipa, rieti]) {',
  );
  if (!source.includes('if (smrj.id !== "smrj")')) {
    source = insertAfterOnce(
      source,
      'if (nedo.id !== "nedo") throw new Error("NEDO公式補足のIDが不正です");',
      '\nif (smrj.id !== "smrj") throw new Error("中小機構公式補足のIDが不正です");',
      "supplement smrj id",
    );
  }
  if (!source.includes('...seeds.sources.filter((source) => !["nedo", "smrj"].includes(source.id))')) {
    source = source.replace(
      '  nedo,\n  ...seeds.sources.filter((source) => source.id !== "nedo"),',
      '  nedo,\n  smrj,\n  ...seeds.sources.filter((source) => !["nedo", "smrj"].includes(source.id)),',
    );
  }
  if (!source.includes("function minimumFiscalYearForSource")) {
    source = insertAfterOnce(
      source,
      'function validCorporateNumber(value) {\n  return typeof value === "string" && /^\\d{13}$/.test(value);\n}',
      '\n\nfunction minimumFiscalYearForSource(sourceId) {\n  return sourceId === "smrj" ? 2015 : MIN_FISCAL_YEAR;\n}\n\nfunction validPublishedRow(row, sourceId) {\n  if (validAmount(row.amount)) return true;\n  if (row.amount !== null) return false;\n  if (row.category === "implementation_decision") return true;\n  return sourceId === "smrj" && ["契約金額の記載なし", "単価・変動額（契約総額の記載なし）"].includes(row.amountStage);\n}',
      "supplement source floor and nullable rows",
    );
  }
  source = source.replace(
    '!row.id || !row.organization || !validPublishedAmount(row.amount, row.category) || Number(row.fiscalYear) < MIN_FISCAL_YEAR || !row.sourceUrl?.startsWith("https://")',
    '!row.id || !row.organization || !validPublishedRow(row, source.id) || Number(row.fiscalYear) < minimumFiscalYearForSource(source.id) || !row.sourceUrl?.startsWith("https://")',
  );
  source = source.replace(
    'generatedAt: [officialManifest.generatedAt, seeds.updatedAt, nedo.updatedAt, jetro.updatedAt, aist.updatedAt, inpit.updatedAt, nite.updatedAt, ipa.updatedAt, rieti.updatedAt]',
    'generatedAt: [officialManifest.generatedAt, seeds.updatedAt, nedo.updatedAt, smrj.updatedAt, jetro.updatedAt, aist.updatedAt, inpit.updatedAt, nite.updatedAt, ipa.updatedAt, rieti.updatedAt]',
  );
  source = source.replace(
    '  minFiscalYear: MIN_FISCAL_YEAR,',
    '  minFiscalYear: Math.min(...records.map((row) => row.fiscalYear)),\n  defaultMinFiscalYear: MIN_FISCAL_YEAR,\n  sourceMinFiscalYears: { smrj: 2015 },',
  );
  source = source.replace(
    /scopeNote: "公式補足は、[^"]+",/u,
    'scopeNote: "公式補足は、経済産業省本省・資源エネルギー庁・中小企業庁・特許庁・NEDO・中小企業基盤整備機構・JOGMEC・JETRO・産業技術総合研究所・工業所有権情報・研修館（INPIT）・製品評価技術基盤機構（NITE）・情報処理推進機構（IPA）・経済産業研究所（RIETI）の検証済み公表行を表示する。原則2021年度以降だが、中小機構本部は公式ページで現在公開される2015年度以降の競争入札・随意契約を対象とする。金額非公表・単価契約は0円にせず金額なしとして区別する。各機関の全制度・全契約を一律に網羅するものではなく、GビズINFO掲載値や行政事業レビュー支出額とは合算しない。",',
  );
  if (!source.includes("validPublishedRow(row, source.id)")) throw new Error("supplement nullable SMRJ integration missing");
  return source;
});

await patch("scripts/build-official-company-index.mjs", (input) => {
  let source = input;
  if (!source.includes('const smrj = JSON.parse(await readFile("data/official-supplement-smrj.json", "utf8"));')) {
    source = insertAfterOnce(
      source,
      'const nedo = JSON.parse(await readFile("data/official-supplement-nedo.json", "utf8"));',
      '\nconst smrj = JSON.parse(await readFile("data/official-supplement-smrj.json", "utf8"));',
      "company smrj read",
    );
  }
  source = source.replace(
    'for (const source of [nedo, jetro, aist, inpit, nite, ipa, rieti]) {',
    'for (const source of [nedo, smrj, jetro, aist, inpit, nite, ipa, rieti]) {',
  );
  if (!source.includes('if (smrj.id !== "smrj")')) {
    source = insertAfterOnce(
      source,
      'if (nedo.id !== "nedo") throw new Error("NEDO公式補足のIDが不正です");',
      '\nif (smrj.id !== "smrj") throw new Error("中小機構公式補足のIDが不正です");',
      "company smrj id",
    );
  }
  source = source.replace(
    'const seedSources = [nedo, ...seeds.sources.filter((source) => source.id !== "nedo"), jetro, aist, inpit, nite, ipa, rieti];',
    'const seedSources = [nedo, smrj, ...seeds.sources.filter((source) => !["nedo", "smrj"].includes(source.id)), jetro, aist, inpit, nite, ipa, rieti];',
  );
  if (!source.includes("function minimumFiscalYearForSource")) {
    source = insertAfterOnce(
      source,
      'function validHttps(value) {\n  return typeof value === "string" && value.startsWith("https://");\n}',
      '\nfunction minimumFiscalYearForSource(sourceId) {\n  return sourceId === "smrj" ? 2015 : MIN_FISCAL_YEAR;\n}\nfunction validPublishedRow(row, sourceId) {\n  if (validAmount(row.amount)) return true;\n  if (row.amount !== null) return false;\n  if (row.category === "implementation_decision") return true;\n  return sourceId === "smrj" && ["契約金額の記載なし", "単価・変動額（契約総額の記載なし）"].includes(row.amountStage);\n}',
      "company source floor and nullable rows",
    );
  }
  source = source.replace(
    '    || Number(row.fiscalYear) < MIN_FISCAL_YEAR\n    || !validPublishedAmount(row.amount, row.category)',
    '    || Number(row.fiscalYear) < minimumFiscalYearForSource(sourceId)\n    || !validPublishedRow(row, sourceId)',
  );
  if (!source.includes('.filter((row) => row.sourceId !== "smrj")\n  .map((row) => normalizeOfficialRow')) {
    source = source.replace(
      'const centralHistoryRecords = centralHistory.records\n  .map((row) => normalizeOfficialRow',
      'const centralHistoryRecords = centralHistory.records\n  .filter((row) => row.sourceId !== "smrj")\n  .map((row) => normalizeOfficialRow',
    );
  }
  source = source.replace(
    'if (centralHistoryRecords.length !== 599) throw new Error(`中央機関旧資料の企業索引行数が不正です: ${centralHistoryRecords.length}/599`);',
    'const expectedCentralHistoryRows = centralHistory.records.filter((row) => row.sourceId !== "smrj").length;\nif (centralHistoryRecords.length !== expectedCentralHistoryRows) throw new Error(`中央機関旧資料の企業索引行数が不正です: ${centralHistoryRecords.length}/${expectedCentralHistoryRows}`);',
  );
  source = source.replace(
    'coverageNote = `中小機構本部の2017～2019年度競争入札・随意契約公式PDFから、単一法人番号・契約日・契約金額を一意に検証できた577行を追加。${seed?.coverageNote ?? ""} 地域本部等を含む全契約の網羅データではありません。`;',
    'coverageNote = `${seed?.coverageNote ?? ""} 対象は中小機構本部に限定し、地域本部・大学校は含まない。`;',
  );
  source = source.replace(
    'const generatedCandidates = [officialManifest.generatedAt, seeds.updatedAt, nedo.updatedAt, jetro.updatedAt, aist.updatedAt, inpit.updatedAt, nite.updatedAt, ipa.updatedAt, rieti.updatedAt, centralHistory.generatedAt, metiLegacy.verifiedAt]',
    'const generatedCandidates = [officialManifest.generatedAt, seeds.updatedAt, nedo.updatedAt, smrj.updatedAt, jetro.updatedAt, aist.updatedAt, inpit.updatedAt, nite.updatedAt, ipa.updatedAt, rieti.updatedAt, centralHistory.generatedAt, metiLegacy.verifiedAt]',
  );
  source = source.replace(
    '  minFiscalYear: MIN_FISCAL_YEAR,',
    '  minFiscalYear: Math.min(...records.map((row) => row.fiscalYear)),\n  defaultMinFiscalYear: MIN_FISCAL_YEAR,\n  sourceMinFiscalYears: { smrj: 2015 },',
  );
  source = source.replace(
    /scopeNote: "企業検索用の公式資料索引。[^"]+",/u,
    'scopeNote: "企業検索用の公式資料索引。経済産業省本省、資源エネルギー庁、中小企業庁、特許庁、NEDO、中小企業基盤整備機構、JOGMEC、JETRO、産業技術総合研究所、工業所有権情報・研修館（INPIT）、製品評価技術基盤機構（NITE）、情報処理推進機構（IPA）、経済産業研究所（RIETI）の検証済み公表資料だけを使用する。原則2017年度以降だが、中小機構本部は2015年度以降を収録する。金額非公表・単価契約は0円にせず金額なしとして区別する。地方経済産業局・沖縄総合事務局は企業検索の対象外。ここで見つからないことは支出がないことを意味せず、GビズINFO・行政事業レビュー・公式資料の金額は相互に合算しない。",',
  );
  if (!source.includes('const smrj = JSON.parse')) throw new Error("company SMRJ integration missing");
  return source;
});

await patch("pages-site/company-evidence-ui.ts", (input) => {
  let source = input;
  const oldCell = '<td><strong>${row.amount !== null ? escapeHtml(yen.format(row.amount)) : "個社額の記載なし"}</strong><small>${escapeHtml(row.amountStage)}</small></td>';
  const newCell = '<td><strong>${row.amount !== null ? escapeHtml(yen.format(row.amount)) : escapeHtml(row.amountStage || "金額の記載なし")}</strong>${row.amount !== null ? `<small>${escapeHtml(row.amountStage)}</small>` : ""}</td>';
  if (source.includes(oldCell)) source = source.replace(oldCell, newCell);
  return source;
});

await patch(".github/workflows/update-data.yml", (input) => {
  let source = input;
  if (!source.includes('      - "data/official-supplement-smrj.json"')) {
    source = source.replace(
      '      - "data/official-supplement-nedo.json"',
      '      - "data/official-supplement-nedo.json"\n      - "data/official-supplement-smrj.json"',
    );
  }
  return source;
});

await patch(".github/workflows/refresh-official-data.yml", (input) => {
  let source = input;
  if (!source.includes("data/official-supplement-smrj.json")) {
    source = source.replaceAll(
      "data/official-supplement-nedo.json",
      "data/official-supplement-nedo.json data/official-supplement-smrj.json",
    );
  }
  return source;
});

await patch("tests/official-supplement.test.mjs", (input) => {
  let source = input;
  source = source.replace(
    /assert\.equal\(index\.minFiscalYear,\s*2021\);/g,
    'assert.equal(index.minFiscalYear, 2015);',
  );
  source = source.replace(
    '    if (row.category === "implementation_decision") assert.equal(row.amount, null, `${row.id}: implementation amount`);\n    else assert.ok(Number.isSafeInteger(row.amount), `${row.id}: amount`);',
    '    if (row.category === "implementation_decision" || (row.sourceId === "smrj" && row.amount === null)) assert.equal(row.amount, null, `${row.id}: unpublished amount`);\n    else assert.ok(Number.isSafeInteger(row.amount), `${row.id}: amount`);',
  );
  return source;
});

await patch("tests/company-evidence-ui.test.mjs", (input) => {
  let source = input;
  if (!source.includes("SMRJ full HQ history is searchable from FY2015")) {
    source += `\n\ntest("SMRJ full HQ history is searchable from FY2015", async () => {\n  const index = await json("public/data/official-company-index.json");\n  const rows = index.records.filter((row) => row.sourceId === "smrj");\n  const years = [...new Set(rows.map((row) => row.fiscalYear))].sort((a, b) => a - b);\n  assert.equal(years[0], 2015);\n  assert.ok(years.at(-1) >= 2026);\n  assert.ok(rows.length > 577);\n  assert.ok(rows.some((row) => row.amount === null && ["契約金額の記載なし", "単価・変動額（契約総額の記載なし）"].includes(row.amountStage)));\n});\n`;
  }
  return source;
});

await writeFile("tests/smrj-full-history-integration.test.mjs", `import assert from "node:assert/strict";\nimport { readFile } from "node:fs/promises";\nimport test from "node:test";\n\nasync function json(path) { return JSON.parse(await readFile(path, "utf8")); }\n\ntest("SMRJ HQ dedicated supplement covers every currently published fiscal year and both contract types", async () => {\n  const data = await json("data/official-supplement-smrj.json");\n  assert.equal(data.schemaVersion, 1);\n  assert.equal(data.id, "smrj");\n  assert.equal(data.collectionStatus, "complete");\n  assert.equal(data.scope?.organizationUnit, "本部");\n  assert.equal(data.scope?.fiscalYearFrom, 2015);\n  assert.ok(data.scope?.fiscalYearTo >= 2026);\n  assert.ok(Array.isArray(data.documents) && data.documents.length >= 100);\n  assert.ok(Array.isArray(data.records) && data.records.length > 577);\n  const years = [...new Set(data.documents.map((row) => row.fiscalYear))].sort((a, b) => a - b);\n  assert.deepEqual(years, Array.from({ length: data.scope.fiscalYearTo - 2015 + 1 }, (_, index) => 2015 + index));\n  for (const year of years) {\n    const types = new Set(data.documents.filter((row) => row.fiscalYear === year).map((row) => row.contractType));\n    assert.ok(types.has("competitive"), \`FY\${year}: competitive\`);\n    assert.ok(types.has("discretionary"), \`FY\${year}: discretionary\`);\n  }\n  assert.ok(data.records.every((row) => row.sourcePageUrl === "https://www.smrj.go.jp/procurement/bid/contract/hq.html"));\n  assert.ok(data.records.every((row) => row.amount !== 0));\n});\n\ntest("SMRJ HQ rows are included in both published official indexes without legacy duplication", async () => {\n  const source = await json("data/official-supplement-smrj.json");\n  const supplement = await json("data/official-supplement-index.json");\n  const company = await json("public/data/official-company-index.json");\n  const supplementRows = supplement.records.filter((row) => row.sourceId === "smrj");\n  const companyRows = company.records.filter((row) => row.sourceId === "smrj");\n  assert.equal(supplementRows.length, source.records.length);\n  assert.equal(companyRows.length, source.records.length);\n  assert.equal(new Set(companyRows.map((row) => row.sourceKey)).size, companyRows.length);\n  assert.equal(Math.min(...companyRows.map((row) => row.fiscalYear)), 2015);\n});\n`);

await patch("package.json", (input) => {
  const packageJson = JSON.parse(input);
  if (!packageJson.scripts["test:pages"].includes("tests/smrj-full-history-integration.test.mjs")) {
    packageJson.scripts["test:pages"] = packageJson.scripts["test:pages"].replace(
      "tests/smrj-official-supplement.test.mjs",
      "tests/smrj-official-supplement.test.mjs tests/smrj-full-history-integration.test.mjs",
    );
  }
  return `${JSON.stringify(packageJson, null, 2)}\n`;
});

console.log(`SMRJ null amount stages: ${SMRJ_NULL_STAGES.join(" / ")}`);
console.log("Applied SMRJ full-history integration.");
