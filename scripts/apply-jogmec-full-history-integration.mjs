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

await updateText("scripts/jogmec-official-supplement.mjs", (input) => replaceOnce(
  input,
  `    current[index] = {
      ...row,
      id: prior.id,
      corporateNumber: prior.corporateNumber || row.corporateNumber,
    };`,
  `    current[index] = {
      ...row,
      id: prior.id,
      organization: prior.organization || row.organization,
      corporateNumber: prior.corporateNumber || row.corporateNumber,
      date: prior.date ?? row.date,
      category: prior.category ?? row.category,
      amountStage: prior.amountStage ?? row.amountStage,
      sourceUrl: prior.sourceUrl ?? row.sourceUrl,
      sourcePageUrl: prior.sourcePageUrl ?? row.sourcePageUrl,
      sourceKey: prior.sourceKey ?? row.sourceKey,
    };`,
  "JOGMEC verified bid-result preservation",
));

await updateText("tests/jogmec-official-supplement.test.mjs", (input) => {
  let source = replaceOnce(
    input,
    '  assert.equal(alpha.category, "contract_result");',
    '  assert.equal(alpha.category, "bid_result");\n  assert.equal(alpha.date, "2026-03-20");',
    "JOGMEC merge semantics assertion",
  );
  source = replaceOnce(
    source,
    '    category: "bid_result",\n    amountStage: "落札金額（税抜）",\n    amount: 12_345_678,',
    '    category: "bid_result",\n    amountStage: "落札金額（税抜）",\n    amount: 12_345_678,\n    sourceUrl: "https://www.jogmec.go.jp/content/verified-bid.pdf",\n    sourcePageUrl: "https://www.jogmec.go.jp/bid/verified.html",\n    sourceKey: "verified-bid-key",',
    "JOGMEC prior source assertion fixture",
  );
  source = replaceOnce(
    source,
    '  assert.equal(alpha.date, "2026-03-20");\n  assert.equal(merged.length, 4);',
    '  assert.equal(alpha.date, "2026-03-20");\n  assert.equal(alpha.sourceKey, "verified-bid-key");\n  assert.match(alpha.sourceUrl, /verified-bid\\.pdf$/);\n  assert.equal(merged.length, 4);',
    "JOGMEC preserved source assertion",
  );
  return source;
});

await updateText("scripts/build-official-supplement-index.mjs", (input) => {
  let source = input;
  source = replaceOnce(
    source,
    'const MIN_FISCAL_YEAR = 2021;\nconst OFFICIAL_SUPPLEMENT_EXECUTORS',
    `const MIN_FISCAL_YEAR = 2021;

async function readOptionalJson(path, fallback = null) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

const OFFICIAL_SUPPLEMENT_EXECUTORS`,
    "supplement optional JSON helper",
  );
  source = replaceOnce(
    source,
    'const nedo = JSON.parse(await readFile("data/official-supplement-nedo.json", "utf8"));\nconst jetro =',
    'const nedo = JSON.parse(await readFile("data/official-supplement-nedo.json", "utf8"));\nconst dedicatedJogmec = await readOptionalJson("data/official-supplement-jogmec.json");\nconst seededJogmec = seeds.sources.find((source) => source.id === "jogmec");\nconst jogmec = dedicatedJogmec ?? seededJogmec;\nconst jetro =',
    "supplement load dedicated JOGMEC",
  );
  source = replaceOnce(
    source,
    'for (const source of [nedo, jetro, aist, inpit, nite, ipa, rieti]) {',
    'for (const source of [nedo, jogmec, jetro, aist, inpit, nite, ipa, rieti]) {',
    "supplement validate JOGMEC",
  );
  source = replaceOnce(
    source,
    'if (nedo.id !== "nedo") throw new Error("NEDO公式補足のIDが不正です");\nif (jetro.id',
    'if (nedo.id !== "nedo") throw new Error("NEDO公式補足のIDが不正です");\nif (jogmec.id !== "jogmec") throw new Error("JOGMEC公式補足のIDが不正です");\nif (jetro.id',
    "supplement JOGMEC id",
  );
  source = replaceOnce(
    source,
    `const seedSources = [
  nedo,
  ...seeds.sources.filter((source) => source.id !== "nedo"),`,
    `const seedSources = [
  nedo,
  jogmec,
  ...seeds.sources.filter((source) => !["nedo", "jogmec"].includes(source.id)),`,
    "supplement JOGMEC precedence",
  );
  source = replaceOnce(
    source,
    `function validPublishedAmount(value, category) {
  return validAmount(value) || (value === null && category === "implementation_decision");
}`,
    `function validPublishedAmount(value, category, sourceId, amountStage) {
  if (validAmount(value)) return true;
  if (value !== null) return false;
  if (category === "implementation_decision") return true;
  return sourceId === "jogmec" && [
    "契約金額の記載なし",
    "単価・変動額（契約総額の記載なし）",
    "外貨建て金額（円換算なし）",
  ].includes(amountStage);
}`,
    "supplement nullable JOGMEC amounts",
  );
  source = replaceOnce(
    source,
    '    if (!row.id || !row.organization || !validPublishedAmount(row.amount, row.category) || Number(row.fiscalYear) < MIN_FISCAL_YEAR || !row.sourceUrl?.startsWith("https://")) {',
    '    if (!row.id || !row.organization || !validPublishedAmount(row.amount, row.category, source.id, row.amountStage) || Number(row.fiscalYear) < MIN_FISCAL_YEAR || !row.sourceUrl?.startsWith("https://")) {',
    "supplement source-aware amount validation",
  );
  source = replaceOnce(
    source,
    '  generatedAt: [officialManifest.generatedAt, seeds.updatedAt, nedo.updatedAt, jetro.updatedAt, aist.updatedAt, inpit.updatedAt, nite.updatedAt, ipa.updatedAt, rieti.updatedAt].filter(Boolean).sort().at(-1) ?? seeds.updatedAt,',
    '  generatedAt: [officialManifest.generatedAt, seeds.updatedAt, nedo.updatedAt, jogmec.updatedAt, jetro.updatedAt, aist.updatedAt, inpit.updatedAt, nite.updatedAt, ipa.updatedAt, rieti.updatedAt].filter(Boolean).sort().at(-1) ?? seeds.updatedAt,',
    "supplement generated time",
  );
  source = replaceRegexOnce(
    source,
    /  scopeNote: "公式補足は、[^"]+",/,
    '  scopeNote: "公式補足は、経済産業省本省・資源エネルギー庁・中小企業庁・特許庁・NEDO・中小企業基盤整備機構・JOGMEC・JETRO・産業技術総合研究所・工業所有権情報・研修館（INPIT）・製品評価技術基盤機構（NITE）・情報処理推進機構（IPA）・経済産業研究所（RIETI）の確認済み公表資料を扱う。JOGMECは2023年度以降の競争入札結果・随意契約結果を対象とし、他機関は2021年度以降を基本対象とする。契約金額非公表、単価・変動額、外貨建てで円換算額がない行、実施予定先のみの行は0円にせず金額なしとして区別する。機関ごとに実際の収録開始年度は異なり、各機関の全制度・全契約・全支出を網羅するものではない。GビズINFO掲載値や行政事業レビュー支出額とは合算しない。",',
    "supplement scope note",
  );
  return source;
});

await updateText("scripts/build-official-company-index.mjs", (input) => {
  let source = input;
  source = replaceOnce(
    source,
    'const nedo = JSON.parse(await readFile("data/official-supplement-nedo.json", "utf8"));\nconst jetro =',
    'const nedo = JSON.parse(await readFile("data/official-supplement-nedo.json", "utf8"));\nconst dedicatedJogmec = await readOptionalJson("data/official-supplement-jogmec.json", null);\nconst seededJogmec = seeds.sources.find((source) => source.id === "jogmec");\nconst jogmec = dedicatedJogmec ?? seededJogmec;\nconst jetro =',
    "company load dedicated JOGMEC",
  );
  source = replaceOnce(
    source,
    'for (const source of [nedo, jetro, aist, inpit, nite, ipa, rieti]) {',
    'for (const source of [nedo, jogmec, jetro, aist, inpit, nite, ipa, rieti]) {',
    "company validate JOGMEC",
  );
  source = replaceOnce(
    source,
    'if (nedo.id !== "nedo") throw new Error("NEDO公式補足のIDが不正です");\nif (jetro.id',
    'if (nedo.id !== "nedo") throw new Error("NEDO公式補足のIDが不正です");\nif (jogmec.id !== "jogmec") throw new Error("JOGMEC公式補足のIDが不正です");\nif (jetro.id',
    "company JOGMEC id",
  );
  source = replaceOnce(
    source,
    'const seedSources = [nedo, ...seeds.sources.filter((source) => source.id !== "nedo"), jetro, aist, inpit, nite, ipa, rieti];',
    'const seedSources = [nedo, jogmec, ...seeds.sources.filter((source) => !["nedo", "jogmec"].includes(source.id)), jetro, aist, inpit, nite, ipa, rieti];',
    "company JOGMEC precedence",
  );
  source = replaceOnce(
    source,
    `function validPublishedAmount(value, category) {
  return validAmount(value) || (value === null && category === "implementation_decision");
}`,
    `function validPublishedAmount(value, category, sourceId, amountStage) {
  if (validAmount(value)) return true;
  if (value !== null) return false;
  if (category === "implementation_decision") return true;
  return sourceId === "jogmec" && [
    "契約金額の記載なし",
    "単価・変動額（契約総額の記載なし）",
    "外貨建て金額（円換算なし）",
  ].includes(amountStage);
}`,
    "company nullable JOGMEC amounts",
  );
  source = replaceOnce(
    source,
    '    || !validPublishedAmount(row.amount, row.category)\n    || !row.organization',
    '    || !validPublishedAmount(row.amount, row.category, sourceId, row.amountStage)\n    || !row.organization',
    "company source-aware amount validation",
  );
  source = replaceOnce(
    source,
    `  } else if (id === "smrj") {
    coverageNote = \`中小機構本部の2017～2019年度競争入札・随意契約公式PDFから、単一法人番号・契約日・契約金額を一意に検証できた577行を追加。\${seed?.coverageNote ?? ""} 地域本部等を含む全契約の網羅データではありません。\`;
  } else {`,
    `  } else if (id === "smrj") {
    coverageNote = \`中小機構本部の2017～2019年度競争入札・随意契約公式PDFから、単一法人番号・契約日・契約金額を一意に検証できた577行を追加。\${seed?.coverageNote ?? ""} 地域本部等を含む全契約の網羅データではありません。\`;
  } else if (id === "jogmec") {
    coverageNote = seed?.coverageNote ?? "JOGMECの確認済み競争入札・随意契約結果のみを収録。全契約・全支出を網羅しません。";
  } else {`,
    "company JOGMEC coverage note",
  );
  source = replaceOnce(
    source,
    'const generatedCandidates = [officialManifest.generatedAt, seeds.updatedAt, nedo.updatedAt, jetro.updatedAt, aist.updatedAt, inpit.updatedAt, nite.updatedAt, ipa.updatedAt, rieti.updatedAt, centralHistory.generatedAt, metiLegacy.verifiedAt]',
    'const generatedCandidates = [officialManifest.generatedAt, seeds.updatedAt, nedo.updatedAt, jogmec.updatedAt, jetro.updatedAt, aist.updatedAt, inpit.updatedAt, nite.updatedAt, ipa.updatedAt, rieti.updatedAt, centralHistory.generatedAt, metiLegacy.verifiedAt]',
    "company generated time",
  );
  source = replaceRegexOnce(
    source,
    /  scopeNote: "企業検索用の公式資料索引。[^"]+",/,
    '  scopeNote: "企業検索用の公式資料索引。2017年度以降を対象方針とし、経済産業省本省、資源エネルギー庁、中小企業庁、特許庁、NEDO、中小企業基盤整備機構、JOGMEC、JETRO、産業技術総合研究所、工業所有権情報・研修館（INPIT）、製品評価技術基盤機構（NITE）、情報処理推進機構（IPA）、経済産業研究所（RIETI）の検証済み公表資料だけを使用する。JOGMECは2023年度以降の競争入札結果・随意契約結果を対象とし、契約金額非公表・単価等・外貨建て円換算なしは金額なしとして表示する。実施予定先だけを確認でき、個社別金額が公表されていない行も金額なしとして表示する。地方経済産業局・沖縄総合事務局は企業検索の対象外。機関ごと・年度ごとに実際の収録範囲は異なり、全年度・全制度・全契約・全支出を網羅するものではない。ここで見つからないことは支出がないことを意味しない。GビズINFO掲載値、行政事業レビュー支出額、公式資料の金額は相互に合算しない。",',
    "company scope note",
  );
  return source;
});

await updateText("pages-site/company-evidence-ui.ts", (input) => {
  let source = replaceOnce(
    input,
    '    intro.innerHTML = `${matches.length.toLocaleString("ja-JP")}行を確認。共同受注・連名の行は公表行全体の金額で、各社への配分額ではありません。NEDOの実施予定先行は参加を確認するもので、個社別金額が公表されていない場合は「個社額の記載なし」と表示します。 <a class="data-reading-guide-link" href="#data-reading-guide">↓ 読み方</a>`;',
    '    intro.innerHTML = `${matches.length.toLocaleString("ja-JP")}行を確認。共同受注・連名の行は公表行全体の金額で、各社への配分額ではありません。NEDOの実施予定先行は個社別金額がなければ「個社額の記載なし」、JOGMEC等の契約金額非公表・単価等・外貨建て円換算なしは「—」と表示します。 <a class="data-reading-guide-link" href="#data-reading-guide">↓ 読み方</a>`;',
    "official null-amount note",
  );
  source = replaceOnce(
    source,
    '${row.amount !== null ? escapeHtml(yen.format(row.amount)) : "個社額の記載なし"}',
    '${row.amount !== null ? escapeHtml(yen.format(row.amount)) : row.category === "implementation_decision" ? "個社額の記載なし" : "—"}',
    "official null-amount display",
  );
  return source;
});

await updateText(".github/workflows/update-data.yml", (input) => {
  if (input.includes('data/official-supplement-jogmec.json')) throw new Error("update-data already contains dedicated JOGMEC data");
  return replaceOnce(
    input,
    '      - "data/official-supplement-nite.json"\n      - "data/official-supplement-ipa.json"',
    '      - "data/official-supplement-nite.json"\n      - "data/official-supplement-jogmec.json"\n      - "data/official-supplement-ipa.json"',
    "publication JOGMEC path",
  );
});

await updateText(".github/workflows/refresh-official-data.yml", (input) => {
  if (input.includes('data/official-supplement-jogmec.json')) throw new Error("official refresh already contains dedicated JOGMEC data");
  const needle = 'data/official-supplement-nite.json data/official-supplement-ipa.json';
  const replacement = 'data/official-supplement-nite.json data/official-supplement-jogmec.json data/official-supplement-ipa.json';
  const count = input.split(needle).length - 1;
  if (count !== 2) throw new Error(`official refresh JOGMEC path: expected 2 matches, got ${count}`);
  return input.replaceAll(needle, replacement);
});

await updateText("tests/official-supplement.test.mjs", (input) => {
  let source = replaceOnce(
    input,
    '    if (row.category === "implementation_decision") assert.equal(row.amount, null, `${row.id}: implementation amount`);\n    else assert.ok(Number.isSafeInteger(row.amount), `${row.id}: amount`);',
    '    const jogmecNullStages = new Set(["契約金額の記載なし", "単価・変動額（契約総額の記載なし）", "外貨建て金額（円換算なし）"]);\n    if (row.category === "implementation_decision" || (row.sourceId === "jogmec" && jogmecNullStages.has(row.amountStage))) assert.equal(row.amount, null, `${row.id}: non-numeric published amount`);\n    else assert.ok(Number.isSafeInteger(row.amount), `${row.id}: amount`);',
    "official index nullable JOGMEC assertion",
  );
  if (!source.includes('test("JOGMEC dedicated contract history accounts for every published PDF and row"')) {
    source += `

test("JOGMEC dedicated contract history accounts for every published PDF and row", async () => {
  const data = await readJson("data/official-supplement-jogmec.json");
  assert.equal(data.schemaVersion, 1);
  assert.equal(data.id, "jogmec");
  assert.equal(data.collectionStatus, "complete");
  assert.equal(data.minFiscalYear, 2023);
  assert.ok(data.maxFiscalYear >= 2026);
  assert.equal(data.documentCount, data.parsedDocumentCount);
  assert.ok(data.documentCount >= 82);
  assert.equal(data.parseFailureCount, 0);
  assert.equal(data.records.length, data.totalRows);
  assert.equal(
    data.publishedRowCount + data.amountUnavailableRowCount + data.nonTotalAmountRowCount + data.nonJpyAmountRowCount,
    data.totalRows,
  );
  assert.ok(data.totalRows > 100);
  assert.ok(data.records.some((row) => row.contractType === "competitive"));
  assert.ok(data.records.some((row) => row.contractType === "discretionary"));
  assert.ok(data.records.some((row) => row.amount === null && row.amountStage === "契約金額の記載なし"));
  assert.ok(data.records.some((row) => row.amount === null && row.amountStage === "単価・変動額（契約総額の記載なし）"));
  assert.ok(data.records.some((row) => row.amount === null && row.amountStage === "外貨建て金額（円換算なし）"));
  for (const document of data.documents) {
    assert.equal(
      document.totalRows,
      document.publishedRows + document.unavailableRows + document.nonTotalRows + document.nonJpyRows,
      document.url,
    );
    assert.match(document.sha256, /^[0-9a-f]{64}$/u);
    assert.ok(document.pageCount >= 1);
  }

  const index = await readJson("data/official-supplement-index.json");
  const indexed = index.records.filter((row) => row.sourceId === "jogmec");
  assert.equal(indexed.length, data.records.length);
  assert.ok(indexed.some((row) => row.amount === null && row.amountStage === "外貨建て金額（円換算なし）"));
});
`;
  }
  return source;
});

await updateText("tests/company-evidence-ui.test.mjs", (input) => {
  let source = replaceOnce(
    input,
    '  assert.match(source, /row\\.amountStage/);',
    '  assert.match(source, /row\\.amountStage/);\n  assert.match(source, /row\\.category === "implementation_decision" \\? "個社額の記載なし" : "—"/);\n  assert.match(source, /JOGMEC等の契約金額非公表/);',
    "official UI nullable JOGMEC assertions",
  );
  if (!source.includes('test("JOGMEC dedicated rows are searchable in the official company index"')) {
    source += `

test("JOGMEC dedicated rows are searchable in the official company index", async () => {
  const dedicated = await json("data/official-supplement-jogmec.json");
  const index = await json("public/data/official-company-index.json");
  const rows = index.records.filter((row) => row.sourceId === "jogmec");
  assert.equal(rows.length, dedicated.records.length);
  assert.ok(rows.some((row) => row.contractType === "competitive"));
  assert.ok(rows.some((row) => row.contractType === "discretionary"));
  assert.ok(rows.some((row) => row.amount === null && row.amountStage === "外貨建て金額（円換算なし）"));
  const known = rows.find((row) => row.corporateNumber === "4010001104241");
  assert.ok(known);
  assert.equal(known.category, "bid_result");
  assert.equal(known.amount, 22_682_889);
});
`;
  }
  return source;
});

console.log("Applied JOGMEC dedicated index, UI, workflow, and strict data-test integration.");
