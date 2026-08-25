import { readFile, writeFile } from "node:fs/promises";

function replaceOnce(source, search, replacement, label) {
  const index = source.indexOf(search);
  if (index < 0) throw new Error(`${label}: replacement target not found`);
  if (source.indexOf(search, index + search.length) >= 0) throw new Error(`${label}: replacement target is not unique`);
  return `${source.slice(0, index)}${replacement}${source.slice(index + search.length)}`;
}

function replaceRegexOnce(source, pattern, replacement, label) {
  const matches = [...source.matchAll(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`))];
  if (matches.length !== 1) throw new Error(`${label}: expected one regex match, got ${matches.length}`);
  return source.replace(pattern, replacement);
}

async function updateText(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after === before) throw new Error(`${path}: no change produced`);
  await writeFile(path, after);
}

await updateText("pages-site/company-search-ui.ts", (input) => {
  let source = input;
  source = replaceOnce(
    source,
    'const note = (s: Stage) => s === "contracted" ? "受注額" : "GビズINFO補助金掲載額";',
    'const note = (s: Stage) => s === "contracted" ? "受注額" : "GビズINFO掲載額";',
    "company-search subsidy note",
  );
  source = replaceRegexOnce(
    source,
    /function moneyCell\(x: AmountSummary, s: Stage\) \{[\s\S]*?\n\}\n\nfunction yearTable/,
    `function moneyCell(x: AmountSummary, s: Stage) {\n  return x.amountKnownCount ? \`<strong title="\${esc(yen.format(x.amount))}">\${esc(amount(x.amount))}</strong><small>※\${note(s)}</small>\` : \`<strong>—</strong><small>※\${note(s)}</small>\`;\n}\n\nfunction yearTable`,
    "company-search money cell",
  );
  source = replaceRegexOnce(
    source,
    /function yearTable\(o: OrganizationSummary\) \{[\s\S]*?\n\}\n\nfunction programTable/,
    `function yearTable(o: OrganizationSummary) {\n  return \`<div class="company-search-table-scroll"><table class="company-search-breakdown-table"><thead><tr><th>認定日・受注日の年度</th><th>調達・委託（件数／受注額）</th><th>補助金（件数／掲載額）</th><th>金額の記載なし</th></tr></thead><tbody>\${o.byYear.map((y) => \`<tr><td>\${y.fiscalYear === null ? "年度不明" : \`\${y.fiscalYear}年度\`}</td><td><strong>\${y.contracted.records}件</strong><small>\${y.contracted.amountKnownCount ? esc(amount(y.contracted.amount)) : "—"}／受注額</small></td><td><strong>\${y.subsidy_published.records}件</strong><small>\${y.subsidy_published.amountKnownCount ? esc(amount(y.subsidy_published.amount)) : "—"}／掲載額</small></td><td>\${y.amountUnknownCount}件</td></tr>\`).join("")}</tbody></table></div>\`;\n}\n\nfunction programTable`,
    "company-search year table",
  );
  source = replaceRegexOnce(
    source,
    /function fundingLine\(o: OrganizationSummary, s: Stage\) \{[\s\S]*?\n\}\n\nfunction card/,
    `function fundingLine(o: OrganizationSummary, s: Stage) {\n  const x = stage(o, s);\n  return \`<div class="company-search-funding-line"><span class="company-search-funding-kind">\${label(s)}</span><strong class="company-search-count">\${x.records}件</strong><strong class="company-search-amount\${x.amountKnownCount ? "" : " empty"}" title="\${x.amountKnownCount ? esc(yen.format(x.amount)) : ""}">\${x.amountKnownCount ? esc(amount(x.amount)) : "—"}</strong><small>※\${note(s)}\${x.records > x.amountKnownCount ? \`／金額記載 \${x.amountKnownCount}件\` : ""}</small></div>\`;\n}\n\nfunction card`,
    "company-search funding line",
  );
  if (source.includes("合計しません") || source.includes("個別の掲載額は明細で確認")) {
    throw new Error("company-search-ui still suppresses subsidy amounts");
  }
  return source;
});

await updateText("pages-site/subsidy-semantics-ui.ts", (input) => {
  let source = input;
  source = replaceRegexOnce(
    source,
    /function replaceCell\([\s\S]*?\n\}\n\nfunction setText/,
    "function setText",
    "remove subsidy summary override helper",
  );
  source = replaceRegexOnce(
    source,
    /function patchReactSummary\(\) \{[\s\S]*?\n\}\n\nfunction renderYearWarning/,
    `function patchReactSummary() {\n  const region = document.querySelector<HTMLElement>('[aria-label="企業検索結果サマリー"]');\n  if (!region) return;\n\n  let foundStageTable = false;\n  for (const table of region.querySelectorAll("table")) {\n    const headers = [...table.querySelectorAll("thead th")];\n    const labels = headers.map((header) => header.textContent?.trim() ?? "");\n\n    if (labels[0] === "情報種別") {\n      foundStageTable = true;\n      if (labels[2] !== "掲載値合計" && labels[2] !== "掲載値") {\n        throw new Error(\`Unexpected stage summary amount header: \${labels[2] ?? "missing"}\`);\n      }\n      setText(headers[2], "掲載値合計");\n    }\n\n    if (labels[0] === "直近5年度") setText(headers[0], "認定日・受注日の直近5年度");\n    if (labels[0] === "掲載行の多い活動名称・件名") setText(headers[0], "活動名称・件名（参考）");\n  }\n\n  if (!foundStageTable) throw new Error("Stage summary table contract was not found");\n  region.classList.add("subsidy-semantics-ready");\n}\n\nfunction renderYearWarning`,
    "React subsidy summary patch",
  );
  if (source.includes("合計しません") || source.includes("個別の掲載額は明細で確認")) {
    throw new Error("subsidy-semantics-ui still suppresses subsidy amounts");
  }
  return source;
});

await updateText("pages-site/company-evidence-ui.ts", (input) => {
  let source = input;
  source = replaceOnce(
    source,
    '  category: "grant_decision" | "contract_result" | "bid_result";',
    '  category: "grant_decision" | "contract_result" | "bid_result" | "implementation_decision";',
    "official record category type",
  );
  source = replaceOnce(
    source,
    "  amount: number;\n  sourceUrl: string;",
    "  amount: number | null;\n  sourceUrl: string;",
    "official record nullable amount",
  );
  source = replaceOnce(
    source,
    'function officialCategoryLabel(category: OfficialRecord["category"]) {\n  if (category === "grant_decision") return "交付決定";\n  if (category === "bid_result") return "入札結果";\n  return "契約結果";\n}',
    'function officialCategoryLabel(category: OfficialRecord["category"]) {\n  if (category === "grant_decision") return "交付決定";\n  if (category === "implementation_decision") return "実施予定先";\n  if (category === "bid_result") return "入札結果";\n  return "契約結果";\n}',
    "official implementation category label",
  );
  source = replaceOnce(
    source,
    '    intro.innerHTML = `${matches.length.toLocaleString("ja-JP")}行を確認。共同受注・連名の行は公表行全体の金額で、各社への配分額ではありません。 <a class="data-reading-guide-link" href="#data-reading-guide">↓ 読み方</a>`;',
    '    intro.innerHTML = `${matches.length.toLocaleString("ja-JP")}行を確認。共同受注・連名の行は公表行全体の金額で、各社への配分額ではありません。NEDOの実施予定先行は参加を確認するもので、個社別金額が公表されていない場合は「個社額の記載なし」と表示します。 <a class="data-reading-guide-link" href="#data-reading-guide">↓ 読み方</a>`;',
    "official participation note",
  );
  source = replaceOnce(
    source,
    '<td><strong>${escapeHtml(yen.format(row.amount))}</strong><small>${escapeHtml(row.amountStage)}</small></td>',
    '<td><strong>${row.amount !== null ? escapeHtml(yen.format(row.amount)) : "個社額の記載なし"}</strong><small>${escapeHtml(row.amountStage)}</small></td>',
    "official nullable amount rendering",
  );
  return source;
});

await updateText("scripts/build-official-supplement-index.mjs", (input) => {
  let source = input;
  source = replaceOnce(
    source,
    'function validAmount(value) {\n  return typeof value === "number" && Number.isFinite(value) && Number.isSafeInteger(value);\n}\n',
    'function validAmount(value) {\n  return typeof value === "number" && Number.isFinite(value) && Number.isSafeInteger(value);\n}\n\nfunction validPublishedAmount(value, category) {\n  return validAmount(value) || (value === null && category === "implementation_decision");\n}\n',
    "official supplement nullable amount validator",
  );
  source = replaceOnce(
    source,
    '!row.id || !row.organization || !validAmount(row.amount) || Number(row.fiscalYear) < MIN_FISCAL_YEAR',
    '!row.id || !row.organization || !validPublishedAmount(row.amount, row.category) || Number(row.fiscalYear) < MIN_FISCAL_YEAR',
    "official supplement seed validation",
  );
  source = replaceOnce(
    source,
    '    || b.amount - a.amount\n',
    '    || (b.amount ?? -1) - (a.amount ?? -1)\n',
    "official supplement nullable amount sort",
  );
  source = replaceRegexOnce(
    source,
    /  scopeNote: "公式補足は、[^"]+",/,
    '  scopeNote: "公式補足は、経済産業省本省・資源エネルギー庁・中小企業庁・特許庁・NEDO・中小企業基盤整備機構・JOGMEC・JETRO・産業技術総合研究所・工業所有権情報・研修館（INPIT）・製品評価技術基盤機構（NITE）・情報処理推進機構（IPA）・経済産業研究所（RIETI）について、2021年度以降を基本対象とする。受取先と金額を確認できた公表行に加え、実施予定先として受取先を確認できても個社別金額が公表されていない行は金額なしとして区別して表示する。機関ごとに実際の収録開始年度は異なり、各機関の全制度・全契約を網羅するものではない。GビズINFO掲載値や行政事業レビュー支出額とは合算しない。",',
    "official supplement scope note",
  );
  return source;
});

await updateText("scripts/build-official-company-index.mjs", (input) => {
  let source = input;
  source = replaceOnce(
    source,
    'const seeds = JSON.parse(await readFile("data/official-supplement-seeds.json", "utf8"));\nconst jetro =',
    'const seeds = JSON.parse(await readFile("data/official-supplement-seeds.json", "utf8"));\nconst nedo = JSON.parse(await readFile("data/official-supplement-nedo.json", "utf8"));\nconst jetro =',
    "official company dedicated NEDO source",
  );
  source = replaceOnce(
    source,
    'for (const source of [jetro, aist, inpit, nite, ipa, rieti]) {',
    'for (const source of [nedo, jetro, aist, inpit, nite, ipa, rieti]) {',
    "official company source validation list",
  );
  source = replaceOnce(
    source,
    'if (jetro.id !== "jetro") throw new Error("JETRO公式補足のIDが不正です");',
    'if (nedo.id !== "nedo") throw new Error("NEDO公式補足のIDが不正です");\nif (jetro.id !== "jetro") throw new Error("JETRO公式補足のIDが不正です");',
    "official company NEDO id validation",
  );
  source = replaceOnce(
    source,
    'const seedSources = [...seeds.sources, jetro, aist, inpit, nite, ipa, rieti];',
    'const seedSources = [nedo, ...seeds.sources.filter((source) => source.id !== "nedo"), jetro, aist, inpit, nite, ipa, rieti];',
    "official company NEDO source precedence",
  );
  source = replaceOnce(
    source,
    'function validAmount(value) {\n  return typeof value === "number" && Number.isSafeInteger(value);\n}\n',
    'function validAmount(value) {\n  return typeof value === "number" && Number.isSafeInteger(value);\n}\nfunction validPublishedAmount(value, category) {\n  return validAmount(value) || (value === null && category === "implementation_decision");\n}\n',
    "official company nullable amount validator",
  );
  source = replaceOnce(
    source,
    '    || !validAmount(row.amount)\n',
    '    || !validPublishedAmount(row.amount, row.category)\n',
    "official company nullable amount validation",
  );
  source = replaceOnce(
    source,
    '    || b.amount - a.amount\n',
    '    || (b.amount ?? -1) - (a.amount ?? -1)\n',
    "official company nullable amount sort",
  );
  source = replaceOnce(
    source,
    'const generatedCandidates = [officialManifest.generatedAt, seeds.updatedAt, jetro.updatedAt, aist.updatedAt, inpit.updatedAt, nite.updatedAt, ipa.updatedAt, rieti.updatedAt, centralHistory.generatedAt, metiLegacy.verifiedAt]',
    'const generatedCandidates = [officialManifest.generatedAt, seeds.updatedAt, nedo.updatedAt, jetro.updatedAt, aist.updatedAt, inpit.updatedAt, nite.updatedAt, ipa.updatedAt, rieti.updatedAt, centralHistory.generatedAt, metiLegacy.verifiedAt]',
    "official company generated time",
  );
  source = replaceRegexOnce(
    source,
    /  scopeNote: "企業検索用の公式資料索引。[^"]+",/,
    '  scopeNote: "企業検索用の公式資料索引。2017年度以降を対象方針とし、経済産業省本省、資源エネルギー庁、中小企業庁、特許庁、NEDO、中小企業基盤整備機構、JOGMEC、JETRO、産業技術総合研究所、工業所有権情報・研修館（INPIT）、製品評価技術基盤機構（NITE）、情報処理推進機構（IPA）、経済産業研究所（RIETI）の検証済み公表資料だけを使用する。実施予定先だけを確認でき、個社別金額が公表されていない行は金額なしとして表示する。地方経済産業局・沖縄総合事務局は企業検索の対象外。機関ごと・年度ごとに実際の収録範囲は異なり、2017年度以降の全年度・全制度・全契約を網羅するものではない。ここで見つからないことは支出がないことを意味しない。GビズINFO掲載値、行政事業レビュー支出額、公式資料の金額は相互に合算しない。",',
    "official company scope note",
  );
  return source;
});

await updateText("scripts/nedo-official-supplement.mjs", (input) => {
  let source = input;
  source = replaceOnce(
    source,
    '  if (parsed.length < previous.records.length || parsed.length < 5) {\n    throw new Error(`NEDO GX解析件数が既存収録を下回りました: ${parsed.length}/${previous.records.length}`);\n  }',
    '  const previousStartupCount = previous.records.filter((row) =>\n    row.sourcePageUrl === NEDO_SEARCH_URL\n    || /^https:\\/\\/www\\.nedo\\.go\\.jp\\/activities\\/startups\\/company[\\w-]*\\.html$/u.test(row.sourceUrl),\n  ).length;\n  if (parsed.length < previousStartupCount || parsed.length < 5) {\n    throw new Error(`NEDO GX解析件数が既存スタートアップ収録を下回りました: ${parsed.length}/${previousStartupCount}`);\n  }',
    "NEDO parser startup-only floor",
  );
  source = replaceOnce(
    source,
    '  const records = mergeNedoRecords(previous.records, parsed);\n  const output = {',
    '  const records = mergeNedoRecords(previous.records, parsed);\n  const publicResultCount = records.filter((row) => row.category === "implementation_decision").length;\n  const output = {',
    "NEDO public-result count",
  );
  source = replaceRegexOnce(
    source,
    /    coverageNote: `NEDOのDTSU・GX採択事業者検索サイトから、[\s\S]*?NEDO全事業・全契約を網羅するものではない。`,/,
    '    coverageNote: `NEDOのDTSU・GX採択事業者検索サイトから、GX分野のディープテック・スタートアップ支援について企業名・研究開発テーマ・フェーズ・事業年度・交付決定額を定型HTMLで継続取得。今回 ${links.length}ページを確認し、GX ${parsed.length}件を解析。加えて、NEDO公募結果資料で実施予定先を確認できる行を${publicResultCount}件保持し、個社別金額が公表されていない行は0円にせず金額なしとして区別する。過去に確認済みの行は一覧掲載終了後も保持する。NEDO全事業・全契約を網羅するものではない。`,',
    "NEDO coverage note",
  );
  return source;
});

const nedoPath = "data/official-supplement-nedo.json";
const nedo = JSON.parse(await readFile(nedoPath, "utf8"));
const toyotaRows = [
  {
    id: "nedo-public-result-2021-toyota-chubu-imported-hydrogen",
    organization: "トヨタ自動車株式会社",
    corporateNumber: "1180301018771",
    fiscalYear: 2021,
    date: "2021-07-28",
    program: "水素社会構築技術開発事業／地域水素利活用技術開発",
    theme: "中部圏における海外輸入水素の受入・配送事業に関する実現可能性調査",
    phase: "",
    supportYears: "2021～2022年度",
    category: "implementation_decision",
    amountStage: "個社別金額は公表資料に記載なし",
    amount: null,
    sourceUrl: "https://www.nedo.go.jp/koubo/HY3_00047.html",
    sourcePageUrl: "https://www.nedo.go.jp/koubo/HY3_00047.html",
    sourceKey: "nedo-public-result-2021-toyota-chubu-imported-hydrogen",
  },
  {
    id: "nedo-public-result-2021-toyota-innovative-ev-battery",
    organization: "トヨタ自動車株式会社",
    corporateNumber: "1180301018771",
    fiscalYear: 2021,
    date: "2021-06-03",
    program: "電気自動車用革新型蓄電池開発",
    theme: "フッ化物電池の研究開発／亜鉛負極電池の研究開発",
    phase: "",
    supportYears: "2021～2025年度",
    category: "implementation_decision",
    amountStage: "個社別金額は公表資料に記載なし",
    amount: null,
    sourceUrl: "https://www.nedo.go.jp/koubo/HY3_00043.html",
    sourcePageUrl: "https://www.nedo.go.jp/koubo/HY3_00043.html",
    sourceKey: "nedo-public-result-2021-toyota-innovative-ev-battery",
  },
  {
    id: "nedo-public-result-2021-toyota-onsite-hydrogen",
    organization: "トヨタ自動車株式会社",
    corporateNumber: "1180301018771",
    fiscalYear: 2021,
    date: "2021-12-03",
    program: "水素社会構築技術開発事業／地域水素利活用技術開発",
    theme: "水素のオンサイト製造と燃焼利用による工場脱炭素化技術の開発と地域展開原単位の提案",
    phase: "",
    supportYears: "2021～2025年度",
    category: "implementation_decision",
    amountStage: "個社別金額は公表資料に記載なし",
    amount: null,
    sourceUrl: "https://www.nedo.go.jp/koubo/SE3_100001_00009.html",
    sourcePageUrl: "https://www.nedo.go.jp/koubo/SE3_100001_00009.html",
    sourceKey: "nedo-public-result-2021-toyota-onsite-hydrogen",
  },
];
const byId = new Map(nedo.records.map((row) => [row.id, row]));
for (const row of toyotaRows) byId.set(row.id, row);
nedo.records = [...byId.values()].sort((a, b) =>
  b.fiscalYear - a.fiscalYear
  || (b.date ?? "").localeCompare(a.date ?? "")
  || a.organization.localeCompare(b.organization, "ja"));
nedo.updatedAt = new Date().toISOString();
nedo.coverageNote = "NEDOのDTSU/GXスタートアップ支援で個社別交付決定額を確認できた行に加え、NEDO公募結果資料で実施予定先を確認できる行を収録する。実施予定先のみ公表され、個社別金額が記載されていない行は0円にせず金額なしとして区別する。NEDO全事業・全契約を網羅するものではない。";
await writeFile(nedoPath, `${JSON.stringify(nedo)}\n`);

await updateText("tests/subsidy-semantics-ui.test.mjs", (input) => {
  let source = input;
  source = replaceOnce(
    source,
    `  // Company cards natively suppress subsidy aggregates, but no longer carry the long explanation.\n  assert.match(company, /if \\(s === "subsidy_published"\\)/);\n  assert.match(company, /合計しません/);\n  assert.match(company, /個別の掲載額は明細で確認/);\n  assert.match(company, /認定日・受注日の年度/);\n  assert.match(company, /補助金（掲載件数）/);\n  assert.match(company, /事業別を見る/);\n  assert.match(company, /href="#data-reading-guide">↓ 読み方/);\n  assert.doesNotMatch(company, /subsidySemanticsNote|subsidy-semantics-note/);\n  assert.doesNotMatch(company, /金額の大きい事業を見る/);`,
    `  // Company cards display same-corporation subsidy published amounts while keeping cross-corporation aggregation blocked.\n  assert.doesNotMatch(company, /合計しません/);\n  assert.doesNotMatch(company, /個別の掲載額は明細で確認/);\n  assert.match(company, /認定日・受注日の年度/);\n  assert.match(company, /補助金（件数／掲載額）/);\n  assert.match(company, /subsidy_published\\.amountKnownCount/);\n  assert.match(company, /事業別を見る/);\n  assert.match(company, /href="#data-reading-guide">↓ 読み方/);\n  assert.doesNotMatch(company, /subsidySemanticsNote|subsidy-semantics-note/);\n  assert.doesNotMatch(company, /金額の大きい事業を見る/);`,
    "subsidy semantics company assertions",
  );
  source = replaceOnce(
    source,
    '  assert.match(guard, /row\\.children\\.length !== 3/);',
    '  assert.doesNotMatch(guard, /replaceCell|合計しません|個別の掲載額は明細で確認|row\\.children\\.length !== 3/);\n  assert.match(guard, /setText\\(headers\\[2\\], "掲載値合計"\\)/);',
    "subsidy semantics guard assertions",
  );
  return source;
});

await updateText("tests/company-search-safety.test.mjs", (input) => {
  const marker = 'test("same-corporation subsidy amounts are visible in the company summary"';
  if (input.includes(marker)) return input;
  return `${input}\n\ntest("same-corporation subsidy amounts are visible in the company summary", async () => {\n  const source = await readFile(new URL("../pages-site/company-search-ui.ts", import.meta.url), "utf8");\n  assert.doesNotMatch(source, /合計しません/);\n  assert.doesNotMatch(source, /個別の掲載額は明細で確認/);\n  assert.match(source, /補助金（件数／掲載額）/);\n  assert.match(source, /y\\.subsidy_published\\.amountKnownCount/);\n  assert.match(source, /x\\.amountKnownCount \\? esc\\(amount\\(x\\.amount\\)\\) : "—"/);\n});\n`;
});

await updateText("tests/company-evidence-ui.test.mjs", (input) => {
  const marker = 'test("Toyota NEDO implementation rows stay searchable without inventing a company amount"';
  if (input.includes(marker)) return input;
  return `${input}\n\ntest("Toyota NEDO implementation rows stay searchable without inventing a company amount", async () => {\n  const index = await json("public/data/official-company-index.json");\n  const rows = index.records.filter((row) => row.sourceId === "nedo" && row.corporateNumber === "1180301018771");\n  assert.equal(rows.length, 3);\n  assert.ok(rows.every((row) => row.organization === "トヨタ自動車株式会社"));\n  assert.ok(rows.every((row) => row.category === "implementation_decision"));\n  assert.ok(rows.every((row) => row.amount === null));\n  assert.ok(rows.some((row) => row.program === "電気自動車用革新型蓄電池開発"));\n  assert.ok(rows.some((row) => row.theme.includes("海外輸入水素")));\n  assert.ok(rows.some((row) => row.theme.includes("工場脱炭素化")));\n\n  const source = await text("pages-site/company-evidence-ui.ts");\n  assert.match(source, /implementation_decision/);\n  assert.match(source, /実施予定先/);\n  assert.match(source, /個社額の記載なし/);\n  assert.match(source, /row\\.amount !== null/);\n});\n`;
});

await updateText("tests/nedo-official-supplement.test.mjs", (input) => {
  let source = input;
  source = replaceOnce(
    source,
    'import assert from "node:assert/strict";\nimport test from "node:test";',
    'import assert from "node:assert/strict";\nimport { readFile } from "node:fs/promises";\nimport test from "node:test";',
    "NEDO test readFile import",
  );
  const marker = 'test("NEDO refresh compares the parser floor only with prior startup rows"';
  if (!source.includes(marker)) {
    source += `\n\ntest("NEDO refresh compares the parser floor only with prior startup rows", async () => {\n  const source = await readFile(new URL("../scripts/nedo-official-supplement.mjs", import.meta.url), "utf8");\n  assert.match(source, /previousStartupCount/);\n  assert.match(source, /implementation_decision/);\n  assert.doesNotMatch(source, /parsed\\.length < previous\\.records\\.length/);\n});\n`;
  }
  return source;
});

await updateText("tests/official-supplement.test.mjs", (input) => {
  let source = input;
  source = replaceOnce(
    source,
    '    assert.ok(Number.isSafeInteger(row.amount), `${row.id}: amount`);',
    '    if (row.category === "implementation_decision") assert.equal(row.amount, null, `${row.id}: implementation amount`);\n    else assert.ok(Number.isSafeInteger(row.amount), `${row.id}: amount`);',
    "official supplement nullable amount assertion",
  );
  const marker = 'test("Toyota NEDO implementation destinations are published without a fabricated amount"';
  if (!source.includes(marker)) {
    source += `\n\ntest("Toyota NEDO implementation destinations are published without a fabricated amount", async () => {\n  const index = await readJson("data/official-supplement-index.json");\n  const rows = index.records.filter((row) => row.sourceId === "nedo" && row.corporateNumber === "1180301018771");\n  assert.equal(rows.length, 3);\n  assert.ok(rows.every((row) => row.category === "implementation_decision"));\n  assert.ok(rows.every((row) => row.amount === null));\n  assert.ok(rows.every((row) => row.amountStage === "個社別金額は公表資料に記載なし"));\n  assert.match(index.scopeNote, /個社別金額が公表されていない行は金額なし/);\n});\n`;
  }
  return source;
});

console.log("Applied Toyota NEDO participation and subsidy-summary fixes.");
