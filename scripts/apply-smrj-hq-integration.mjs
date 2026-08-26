import { readFile, writeFile } from "node:fs/promises";

function replaceOnce(source, search, replacement, label) {
  const index = source.indexOf(search);
  if (index < 0) throw new Error(`${label}: replacement target not found`);
  if (source.indexOf(search, index + search.length) >= 0) throw new Error(`${label}: replacement target is not unique`);
  return `${source.slice(0, index)}${replacement}${source.slice(index + search.length)}`;
}

function replaceRegexOnce(source, pattern, replacement, label) {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const matches = [...source.matchAll(new RegExp(pattern.source, flags))];
  if (matches.length !== 1) throw new Error(`${label}: expected one regex match, got ${matches.length}`);
  return source.replace(pattern, replacement);
}

async function updateText(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (before === after) throw new Error(`${path}: no change produced`);
  await writeFile(path, after);
}

await updateText("scripts/build-official-supplement-index.mjs", (input) => {
  let source = input;
  source = replaceOnce(
    source,
    'import { readFile, writeFile } from "node:fs/promises";\n\nconst MIN_FISCAL_YEAR = 2021;',
    `import { readFile, writeFile } from "node:fs/promises";\n\nconst MIN_FISCAL_YEAR = 2021;\nconst SMRJ_MIN_FISCAL_YEAR = 2015;\n\nasync function readOptionalJson(path, fallback = null) {\n  try {\n    return JSON.parse(await readFile(path, "utf8"));\n  } catch (error) {\n    if (error?.code === "ENOENT") return fallback;\n    throw error;\n  }\n}`,
    "supplement optional JSON",
  );
  source = replaceOnce(
    source,
    'const nedo = JSON.parse(await readFile("data/official-supplement-nedo.json", "utf8"));\nconst jetro =',
    'const nedo = JSON.parse(await readFile("data/official-supplement-nedo.json", "utf8"));\nconst dedicatedSmrj = await readOptionalJson("data/official-supplement-smrj.json");\nconst seededSmrj = seeds.sources.find((source) => source.id === "smrj");\nconst smrj = dedicatedSmrj ?? seededSmrj;\nconst jetro =',
    "supplement load SMRJ",
  );
  source = replaceOnce(source, 'for (const source of [nedo, jetro, aist, inpit, nite, ipa, rieti]) {', 'for (const source of [nedo, smrj, jetro, aist, inpit, nite, ipa, rieti]) {', "supplement validate SMRJ");
  source = replaceOnce(source, 'if (nedo.id !== "nedo") throw new Error("NEDO公式補足のIDが不正です");\nif (jetro.id', 'if (nedo.id !== "nedo") throw new Error("NEDO公式補足のIDが不正です");\nif (smrj.id !== "smrj") throw new Error("中小機構公式補足のIDが不正です");\nif (jetro.id', "supplement SMRJ id");
  source = replaceOnce(source, 'const seedSources = [\n  nedo,\n  ...seeds.sources.filter((source) => source.id !== "nedo"),', 'const seedSources = [\n  nedo,\n  smrj,\n  ...seeds.sources.filter((source) => !["nedo", "smrj"].includes(source.id)),', "supplement SMRJ precedence");
  source = replaceOnce(
    source,
    `function validPublishedAmount(value, category) {\n  return validAmount(value) || (value === null && category === "implementation_decision");\n}`,
    `function validPublishedAmount(value, category, sourceId, amountStage) {\n  if (validAmount(value)) return true;\n  if (value !== null) return false;\n  if (category === "implementation_decision") return true;\n  return sourceId === "smrj" && ["契約金額の記載なし", "単価・変動額（契約総額の記載なし）"].includes(amountStage);\n}`,
    "supplement nullable SMRJ amount",
  );
  source = replaceOnce(
    source,
    '    if (!row.id || !row.organization || !validPublishedAmount(row.amount, row.category) || Number(row.fiscalYear) < MIN_FISCAL_YEAR || !row.sourceUrl?.startsWith("https://")) {',
    '    const sourceMinimumFiscalYear = source.id === "smrj" ? SMRJ_MIN_FISCAL_YEAR : MIN_FISCAL_YEAR;\n    if (!row.id || !row.organization || !validPublishedAmount(row.amount, row.category, source.id, row.amountStage) || Number(row.fiscalYear) < sourceMinimumFiscalYear || !row.sourceUrl?.startsWith("https://")) {',
    "supplement source-specific floor",
  );
  source = replaceOnce(
    source,
    '  generatedAt: [officialManifest.generatedAt, seeds.updatedAt, nedo.updatedAt, jetro.updatedAt, aist.updatedAt, inpit.updatedAt, nite.updatedAt, ipa.updatedAt, rieti.updatedAt].filter(Boolean).sort().at(-1) ?? seeds.updatedAt,\n  minFiscalYear: MIN_FISCAL_YEAR,\n  scopeNote: "公式補足は、経済産業省本省・資源エネルギー庁・中小企業庁・特許庁・NEDO・中小企業基盤整備機構・JOGMEC・JETRO・産業技術総合研究所・工業所有権情報・研修館（INPIT）・製品評価技術基盤機構（NITE）・情報処理推進機構（IPA）・経済産業研究所（RIETI）について、2021年度以降を基本対象とする。受取先と金額を確認できた公表行に加え、実施予定先として受取先を確認できても個社別金額が公表されていない行は金額なしとして区別して表示する。機関ごとに実際の収録開始年度は異なり、各機関の全制度・全契約を網羅するものではない。GビズINFO掲載値や行政事業レビュー支出額とは合算しない。",',
    '  generatedAt: [officialManifest.generatedAt, seeds.updatedAt, nedo.updatedAt, smrj.updatedAt, jetro.updatedAt, aist.updatedAt, inpit.updatedAt, nite.updatedAt, ipa.updatedAt, rieti.updatedAt].filter(Boolean).sort().at(-1) ?? seeds.updatedAt,\n  minFiscalYear: dedicatedSmrj ? SMRJ_MIN_FISCAL_YEAR : MIN_FISCAL_YEAR,\n  scopeNote: "公式補足は、経済産業省本省・資源エネルギー庁・中小企業庁・特許庁・NEDO・中小企業基盤整備機構・JOGMEC・JETRO・産業技術総合研究所・工業所有権情報・研修館（INPIT）・製品評価技術基盤機構（NITE）・情報処理推進機構（IPA）・経済産業研究所（RIETI）の確認済み公表資料を扱う。中小機構は本部の2015年度以降の競争入札・随意契約を対象とし、他機関は2021年度以降を基本対象とする。契約金額非公表、単価・月額、実施予定先のみの行は0円にせず金額なしとして区別する。機関ごとに実際の収録開始年度は異なり、各機関の全制度・全契約を網羅するものではない。GビズINFO掲載値や行政事業レビュー支出額とは合算しない。",',
    "supplement output metadata",
  );
  return source;
});

await updateText("scripts/build-official-company-index.mjs", (input) => {
  let source = input;
  source = replaceOnce(source, 'const MIN_FISCAL_YEAR = 2017;', 'const MIN_FISCAL_YEAR = 2017;\nconst SMRJ_MIN_FISCAL_YEAR = 2015;', "company SMRJ floor");
  source = replaceOnce(source, 'const nedo = JSON.parse(await readFile("data/official-supplement-nedo.json", "utf8"));\nconst jetro =', 'const nedo = JSON.parse(await readFile("data/official-supplement-nedo.json", "utf8"));\nconst dedicatedSmrj = await readOptionalJson("data/official-supplement-smrj.json", null);\nconst seededSmrj = seeds.sources.find((source) => source.id === "smrj");\nconst smrj = dedicatedSmrj ?? seededSmrj;\nconst jetro =', "company load SMRJ");
  source = replaceOnce(source, 'for (const source of [nedo, jetro, aist, inpit, nite, ipa, rieti]) {', 'for (const source of [nedo, smrj, jetro, aist, inpit, nite, ipa, rieti]) {', "company validate SMRJ");
  source = replaceOnce(source, 'if (nedo.id !== "nedo") throw new Error("NEDO公式補足のIDが不正です");\nif (jetro.id', 'if (nedo.id !== "nedo") throw new Error("NEDO公式補足のIDが不正です");\nif (smrj.id !== "smrj") throw new Error("中小機構公式補足のIDが不正です");\nif (jetro.id', "company SMRJ id");
  source = replaceOnce(source, 'const seedSources = [nedo, ...seeds.sources.filter((source) => source.id !== "nedo"), jetro, aist, inpit, nite, ipa, rieti];', 'const seedSources = [nedo, smrj, ...seeds.sources.filter((source) => !["nedo", "smrj"].includes(source.id)), jetro, aist, inpit, nite, ipa, rieti];\nconst hasDedicatedSmrj = Boolean(dedicatedSmrj);', "company SMRJ precedence");
  source = replaceOnce(
    source,
    `function validPublishedAmount(value, category) {\n  return validAmount(value) || (value === null && category === "implementation_decision");\n}`,
    `function validPublishedAmount(value, category, sourceId, amountStage) {\n  if (validAmount(value)) return true;\n  if (value !== null) return false;\n  if (category === "implementation_decision") return true;\n  return sourceId === "smrj" && ["契約金額の記載なし", "単価・変動額（契約総額の記載なし）"].includes(amountStage);\n}`,
    "company nullable SMRJ amount",
  );
  source = replaceOnce(
    source,
    '  if (\n    !SOURCE_ORDER.includes(sourceId)\n    || EXCLUDED_EXECUTORS.has(sourceId)\n    || Number(row.fiscalYear) < MIN_FISCAL_YEAR\n    || !validPublishedAmount(row.amount, row.category)',
    '  const sourceMinimumFiscalYear = sourceId === "smrj" ? SMRJ_MIN_FISCAL_YEAR : MIN_FISCAL_YEAR;\n  if (\n    !SOURCE_ORDER.includes(sourceId)\n    || EXCLUDED_EXECUTORS.has(sourceId)\n    || Number(row.fiscalYear) < sourceMinimumFiscalYear\n    || !validPublishedAmount(row.amount, row.category, sourceId, row.amountStage)',
    "company source-specific validation",
  );
  source = replaceOnce(source, 'const centralHistoryRecords = centralHistory.records\n  .map((row) => normalizeOfficialRow(row, "official-company-central-", row.sourceId, row.sourceName))', 'const centralHistoryRecords = centralHistory.records\n  .filter((row) => !(hasDedicatedSmrj && row.sourceId === "smrj"))\n  .map((row) => normalizeOfficialRow(row, "official-company-central-", row.sourceId, row.sourceName))', "company avoid SMRJ history duplicates");
  source = replaceOnce(source, 'if (centralHistoryRecords.length !== 599) throw new Error(`中央機関旧資料の企業索引行数が不正です: ${centralHistoryRecords.length}/599`);', 'const expectedCentralHistoryRows = hasDedicatedSmrj ? centralHistory.records.filter((row) => row.sourceId !== "smrj").length : 599;\nif (centralHistoryRecords.length !== expectedCentralHistoryRows) throw new Error(`中央機関旧資料の企業索引行数が不正です: ${centralHistoryRecords.length}/${expectedCentralHistoryRows}`);', "company central history count");
  source = replaceRegexOnce(source, /  } else if \(id === "smrj"\) \{[\s\S]*?  } else \{\n    coverageNote = seed\?\.coverageNote/, '  } else if (id === "smrj") {\n    coverageNote = `${seed?.coverageNote ?? "中小機構本部の確認済み契約情報を収録。"} 地域本部・中小企業大学校は対象外。`;\n  } else {\n    coverageNote = seed?.coverageNote', "company SMRJ coverage note");
  source = replaceOnce(source, 'const generatedCandidates = [officialManifest.generatedAt, seeds.updatedAt, nedo.updatedAt, jetro.updatedAt, aist.updatedAt, inpit.updatedAt, nite.updatedAt, ipa.updatedAt, rieti.updatedAt, centralHistory.generatedAt, metiLegacy.verifiedAt]', 'const generatedCandidates = [officialManifest.generatedAt, seeds.updatedAt, nedo.updatedAt, smrj.updatedAt, jetro.updatedAt, aist.updatedAt, inpit.updatedAt, nite.updatedAt, ipa.updatedAt, rieti.updatedAt, centralHistory.generatedAt, metiLegacy.verifiedAt]', "company generated time");
  source = replaceOnce(source, '  minFiscalYear: MIN_FISCAL_YEAR,\n  recordCount: records.length,', '  minFiscalYear: hasDedicatedSmrj ? SMRJ_MIN_FISCAL_YEAR : MIN_FISCAL_YEAR,\n  recordCount: records.length,', "company output floor");
  source = replaceRegexOnce(source, /  scopeNote: "企業検索用の公式資料索引。[^"]+",/, '  scopeNote: "企業検索用の公式資料索引。経済産業省本省、資源エネルギー庁、中小企業庁、特許庁、NEDO、中小企業基盤整備機構、JOGMEC、JETRO、産業技術総合研究所、工業所有権情報・研修館（INPIT）、製品評価技術基盤機構（NITE）、情報処理推進機構（IPA）、経済産業研究所（RIETI）の検証済み公表資料だけを使用する。中小機構は本部の2015年度以降、他機関は2017年度以降を対象方針とする。契約金額非公表、単価・月額、実施予定先のみの行は0円にせず金額なしとして表示する。地方経済産業局・沖縄総合事務局は企業検索の対象外。機関ごと・年度ごとに実際の収録範囲は異なり、対象年度の全制度・全契約を網羅するものではない。ここで見つからないことは支出がないことを意味しない。GビズINFO掲載値、行政事業レビュー支出額、公式資料の金額は相互に合算しない。",', "company scope note");
  return source;
});

await updateText("pages-site/company-evidence-ui.ts", (input) => replaceOnce(
  input,
  '<td><strong>${row.amount !== null ? escapeHtml(yen.format(row.amount)) : "個社額の記載なし"}</strong><small>${escapeHtml(row.amountStage)}</small></td>',
  '<td><strong>${row.amount !== null ? escapeHtml(yen.format(row.amount)) : escapeHtml(row.amountStage)}</strong>${row.amount !== null ? `<small>${escapeHtml(row.amountStage)}</small>` : ""}</td>',
  "official nullable amount copy",
));

await updateText(".github/workflows/update-data.yml", (input) => replaceOnce(
  input,
  '      - "data/official-supplement-seeds.json"\n      - "data/official-supplement-jetro.json"',
  '      - "data/official-supplement-seeds.json"\n      - "data/official-supplement-smrj.json"\n      - "data/official-supplement-jetro.json"',
  "publish SMRJ path",
));

await updateText(".github/workflows/refresh-official-data.yml", (input) => {
  const source = input.replaceAll('data/official-supplement-nedo.json data/official-supplement-jetro.json', 'data/official-supplement-nedo.json data/official-supplement-smrj.json data/official-supplement-jetro.json');
  if (!source.includes("data/official-supplement-smrj.json")) throw new Error("refresh workflow: SMRJ path was not added");
  return source;
});

await updateText("tests/official-supplement.test.mjs", (input) => {
  let source = input;
  source = replaceOnce(source, "  assert.equal(index.minFiscalYear, 2021);", "  assert.equal(index.minFiscalYear, 2015);", "supplement test min year");
  source = replaceOnce(source, '    assert.ok(Number.isInteger(row.fiscalYear) && row.fiscalYear >= 2021, `${row.id}: fiscal year`);\n    if (row.category === "implementation_decision") assert.equal(row.amount, null, `${row.id}: implementation amount`);\n    else assert.ok(Number.isSafeInteger(row.amount), `${row.id}: amount`);', '    const minimumYear = row.sourceId === "smrj" ? 2015 : 2021;\n    assert.ok(Number.isInteger(row.fiscalYear) && row.fiscalYear >= minimumYear, `${row.id}: fiscal year`);\n    if (row.category === "implementation_decision" || (row.sourceId === "smrj" && row.amountStage !== "契約金額")) assert.equal(row.amount, null, `${row.id}: unpublished amount`);\n    else assert.ok(Number.isSafeInteger(row.amount), `${row.id}: amount`);', "supplement test nullable SMRJ");
  source = source.replace('assert.ok(bundle.includes("2021年度以降を基本対象"));', 'assert.ok(bundle.includes("中小機構は本部の2015年度以降"));');
  if (!source.includes('test("中小機構本部の専用補足は全PDF・全行を会計する"')) source += `\n\ntest("中小機構本部の専用補足は全PDF・全行を会計する", async () => {\n  const data = await readJson("data/official-supplement-smrj.json");\n  assert.equal(data.collectionStatus, "complete");\n  assert.equal(data.documentCount, data.parsedDocumentCount);\n  assert.ok(data.documentCount >= 158);\n  assert.equal(data.records.length, data.totalRows);\n  assert.equal(data.publishedRowCount + data.amountUnavailableRowCount + data.nonTotalAmountRowCount, data.totalRows);\n  assert.equal(data.parseFailureCount, 0);\n  assert.ok(data.records.some((row) => row.fiscalYear === 2015));\n  assert.ok(data.records.some((row) => row.fiscalYear === 2026));\n});\n`;
  return source;
});

await updateText("tests/company-evidence-ui.test.mjs", (input) => {
  let source = input;
  source = replaceOnce(source, 'test("official company index uses central bodies only with a FY2017 target floor", async () => {', 'test("official company index uses central bodies and the complete SMRJ HQ history", async () => {', "company evidence test title");
  source = replaceOnce(source, "  assert.equal(index.minFiscalYear, 2017);", "  assert.equal(index.minFiscalYear, 2015);", "company evidence min year");
  source = replaceOnce(source, '  assert.match(index.scopeNote, /2017年度以降を対象方針/);', '  assert.match(index.scopeNote, /中小機構は本部の2015年度以降/);', "company evidence scope");
  source = replaceOnce(source, '  const smrj = index.records.find((row) => row.sourceId === "smrj" && row.corporateNumber === "1010401023102");\n  assert.ok(smrj, "known SMRJ company record must remain searchable");', '  const smrj = index.records.find((row) => row.sourceId === "smrj" && row.corporateNumber === "1010401023102");\n  assert.ok(smrj, "known SMRJ company record must remain searchable");\n  const smrjSource = index.sources.find((source) => source.id === "smrj");\n  assert.ok(smrjSource.fiscalYears.includes(2015));\n  assert.ok(smrjSource.fiscalYears.includes(2026));\n  assert.ok(smrjSource.recordCount > 1_000);\n  assert.ok(index.records.some((row) => row.sourceId === "smrj" && row.amount === null));', "company evidence SMRJ breadth");
  source = replaceOnce(source, '  assert.match(source, /個社額の記載なし/);', '  assert.match(source, /row\\.amountStage/);', "company evidence nullable copy");
  return source;
});

console.log("Applied SMRJ HQ index, UI, workflow, and test integration.");
