from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    if text.count(old) != 1:
        raise RuntimeError(f"{path}: expected one match, found {text.count(old)}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


def insert_once(path: str, anchor: str, addition: str) -> None:
    replace_once(path, anchor, addition + anchor)

worker_helpers = '''function normalizeCompanySearchTerm(value: string) {
  return value
    .normalize("NFKC")
    .replace(/\\(株\\)|㈱/g, "株式会社")
    .replace(/\\(有\\)|㈲/g, "有限会社")
    .toLocaleLowerCase("ja-JP")
    .replace(/[\\s　]+/g, "")
    .trim();
}

function matchesCompanySearch(row: FundingRecord, normalizedQuery: string) {
  if (!normalizedQuery) return true;
  if (/^\\d{13}$/.test(normalizedQuery)) return row.corporateNumber === normalizedQuery;
  return normalizeCompanySearchTerm(row.organization).includes(normalizedQuery);
}

'''
insert_once("app/funding-search.worker.ts", "function search(message: SearchMessage) {\n", worker_helpers)
replace_once("app/funding-search.worker.ts", '''    const needle = query.toLocaleLowerCase("ja-JP");
    const matching = records.filter((row) => {
      if (needle && !`${row.organization} ${row.corporateNumber} ${row.id} ${row.sourceKey}`.toLocaleLowerCase("ja-JP").includes(needle)) return false;
''', '''    const normalizedQuery = normalizeCompanySearchTerm(query);
    const matching = records.filter((row) => {
      if (!matchesCompanySearch(row, normalizedQuery)) return false;
''')

page_helpers = '''function normalizeCompanySearchTerm(value: string) {
  return value
    .normalize("NFKC")
    .replace(/\\(株\\)|㈱/g, "株式会社")
    .replace(/\\(有\\)|㈲/g, "有限会社")
    .toLocaleLowerCase("ja-JP")
    .replace(/[\\s　]+/g, "")
    .trim();
}

function matchesCompanySearch(row: FundingRecord, normalizedQuery: string) {
  if (!normalizedQuery) return true;
  if (/^\\d{13}$/.test(normalizedQuery)) return row.corporateNumber === normalizedQuery;
  return normalizeCompanySearchTerm(row.organization).includes(normalizedQuery);
}

'''
insert_once("app/page.tsx", "function initialSearchParam(name: string, fallback: string) {\n", page_helpers)
replace_once("app/page.tsx", '''    const needle = deferredQuery.trim().toLocaleLowerCase("ja-JP");
    const matching = fallbackRecordsRef.current.filter((row) => {
      if (needle && !`${row.organization} ${row.corporateNumber} ${row.id} ${row.sourceKey}`.toLocaleLowerCase("ja-JP").includes(needle)) return false;
''', '''    const normalizedQuery = normalizeCompanySearchTerm(deferredQuery);
    const matching = fallbackRecordsRef.current.filter((row) => {
      if (!matchesCompanySearch(row, normalizedQuery)) return false;
''')
replace_once("app/page.tsx", '''              <thead><tr><th>対象法人</th><th>掲載行</th><th>金額記載あり</th><th>GビズINFO掲載値合計</th></tr></thead>
              <tbody><tr><td><strong>{searchSummary.organizationCount.toLocaleString("ja-JP")}法人</strong><small>法人番号単位</small></td><td>{searchTotal.toLocaleString("ja-JP")}行</td><td>{searchSummary.amountKnownCount.toLocaleString("ja-JP")}行<small>{searchSummary.amountUnknownCount ? `／金額不明 ${searchSummary.amountUnknownCount.toLocaleString("ja-JP")}行` : ""}</small></td><td className="amount"><strong>{yen.format(searchSummary.amountKnownTotal)}</strong><small>金額記載のある掲載行のみ。総支出額ではありません。</small></td></tr></tbody>
''', '''              <thead><tr><th>対象法人</th><th>掲載行</th><th>金額記載あり</th><th>金額の記載なし</th></tr></thead>
              <tbody><tr><td><strong>{searchSummary.organizationCount.toLocaleString("ja-JP")}法人</strong><small>法人番号単位</small></td><td>{searchTotal.toLocaleString("ja-JP")}行</td><td>{searchSummary.amountKnownCount.toLocaleString("ja-JP")}行</td><td>{searchSummary.amountUnknownCount.toLocaleString("ja-JP")}行</td></tr></tbody>
''')
replace_once("app/page.tsx", '''              <thead><tr><th>直近5年度</th><th>掲載行</th><th>掲載値合計</th></tr></thead>
              <tbody>{searchSummary.byYear.map((item) => <tr key={item.fiscalYear ?? "unclassified"}><td>{item.fiscalYear === null ? "年度不明" : `${item.fiscalYear}年度`}</td><td>{item.records.toLocaleString("ja-JP")}行</td><td className="amount">{yen.format(item.amount)}<small>金額記載 {item.amountKnownCount.toLocaleString("ja-JP")}行</small></td></tr>)}</tbody>
''', '''              <thead><tr><th>直近5年度</th><th>掲載行</th><th>金額記載あり</th></tr></thead>
              <tbody>{searchSummary.byYear.map((item) => <tr key={item.fiscalYear ?? "unclassified"}><td>{item.fiscalYear === null ? "年度不明" : `${item.fiscalYear}年度`}</td><td>{item.records.toLocaleString("ja-JP")}行</td><td>{item.amountKnownCount.toLocaleString("ja-JP")}行</td></tr>)}</tbody>
''')
replace_once("app/page.tsx", '''              <thead><tr><th>掲載値上位の活動名称・件名</th><th>掲載行</th><th>掲載値合計</th></tr></thead>
              <tbody>{searchSummary.topPrograms.map((item) => <tr key={item.program}><td><span className="program-name">{item.program}</span></td><td>{item.records.toLocaleString("ja-JP")}行</td><td className="amount">{yen.format(item.amount)}<small>金額記載 {item.amountKnownCount.toLocaleString("ja-JP")}行</small></td></tr>)}</tbody>
''', '''              <thead><tr><th>掲載行の多い活動名称・件名</th><th>掲載行</th><th>金額記載あり</th></tr></thead>
              <tbody>{searchSummary.topPrograms.map((item) => <tr key={item.program}><td><span className="program-name">{item.program}</span></td><td>{item.records.toLocaleString("ja-JP")}行</td><td>{item.amountKnownCount.toLocaleString("ja-JP")}行</td></tr>)}</tbody>
''')

replace_once("pages-site/funding-search-enhanced.worker.js", '''function normalizeCompanyName(value) {
    return value
        .normalize("NFKC")
        .toLocaleLowerCase("ja-JP")
        .replace(/[\\s　]+/g, "")
        .trim();
}
''', '''function normalizeCompanyName(value) {
    return value
        .normalize("NFKC")
        .replace(/\\(株\\)|㈱/g, "株式会社")
        .replace(/\\(有\\)|㈲/g, "有限会社")
        .toLocaleLowerCase("ja-JP")
        .replace(/[\\s　]+/g, "")
        .trim();
}
''')

replace_once("pages-site/company-search-ui.ts", '''  const orgs = result.organizationSummaries ?? [];
  if (!orgs.length) return clear();
  let ui = document.getElementById("company-search-experience");
''', '''  const orgs = result.organizationSummaries ?? [];
  let ui = document.getElementById("company-search-experience");
''')
replace_once("pages-site/company-search-ui.ts", '''  ui.innerHTML = `${tabs()}<div class="company-search-gbiz-panel"><div class="company-search-query-heading"><p class="eyebrow">COMPANY SEARCH / GビズINFO</p><h3>「${esc(q)}」の検索結果</h3><p>該当法人 <strong>${orgs.length}件</strong>（法人番号で区別しています）</p>${result.organizationSummariesTruncated ? '<p class="company-search-warning">一致法人が多いため先頭50法人まで表示しています。</p>' : ""}</div><div class="company-search-organization-list">${orgs.map(card).join("")}</div></div>`;
''', '''  const gbizBody = orgs.length
    ? `<div class="company-search-organization-list">${orgs.map(card).join("")}</div>`
    : '<p class="filter-note">GビズINFOでは一致する法人を確認できませんでした。行政事業レビュー・公式資料のタブも確認できます。</p>';
  ui.innerHTML = `${tabs()}<div class="company-search-gbiz-panel"><div class="company-search-query-heading"><p class="eyebrow">COMPANY SEARCH / GビズINFO</p><h3>「${esc(q)}」の検索結果</h3><p>該当法人 <strong>${orgs.length}件</strong>（法人番号で区別しています）</p>${result.organizationSummariesTruncated ? '<p class="company-search-warning">一致法人が多いため先頭50法人まで表示しています。</p>' : ""}</div>${gbizBody}</div>`;
''')
replace_once("pages-site/company-search-ui.ts", '''  if (!q || !result?.totalRecords) return clear();
''', '''  if (!q || !result) return clear();
''')

replace_once("app/CombinedCompanyResults.tsx", '''                <td className="amount"><strong>{yen.format(reviewAmountKnownTotal)}</strong><small>企業検索用に重複行を整理した掲載値の単純合計。総支出額とは扱わず、GビズINFOとも合算しません。</small></td>
''', '''                <td className="amount">{reviewMatches.length === 1 ? <><strong>{yen.format(reviewAmountKnownTotal)}</strong><small>当該法人の金額記載行の単純合計。総支出額とは扱わず、GビズINFOとも合算しません。</small></> : <><strong>—</strong><small>複数法人が一致したため、法人をまたぐ金額は合算しません。</small></>}</td>
''')

test_path = Path("tests/company-search-safety.test.mjs")
test_path.write_text('''import assert from "node:assert/strict";\nimport { readFile } from "node:fs/promises";\nimport test from "node:test";\n\nconst page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");\nconst worker = await readFile(new URL("../app/funding-search.worker.ts", import.meta.url), "utf8");\nconst enhanced = await readFile(new URL("../pages-site/funding-search-enhanced.worker.js", import.meta.url), "utf8");\nconst ui = await readFile(new URL("../pages-site/company-search-ui.ts", import.meta.url), "utf8");\nconst review = await readFile(new URL("../app/CombinedCompanyResults.tsx", import.meta.url), "utf8");\n\ntest("company search never uses internal ids or source keys as query fields", () => {\n  for (const source of [page, worker, enhanced]) assert.doesNotMatch(source, /row\\.organization} \\${row\\.corporateNumber} \\${row\\.id} \\${row\\.sourceKey}/);\n  assert.match(page, /matchesCompanySearch\\(row, normalizedQuery\\)/);\n  assert.match(worker, /matchesCompanySearch\\(row, normalizedQuery\\)/);\n  assert.match(enhanced, /matchesCompany\\(row, query\\)/);\n});\n\ntest("13-digit corporate-number searches are exact and names normalize corporate designators", () => {\n  assert.match(page, /row\\.corporateNumber === normalizedQuery/);\n  assert.match(worker, /row\\.corporateNumber === normalizedQuery/);\n  assert.match(enhanced, /row\\.corporateNumber === normalized/);\n  for (const source of [page, worker, enhanced]) { assert.match(source, /㈱/); assert.match(source, /株式会社/); }\n});\n\ntest("Pages keeps source-series tabs when Gbiz has zero matches", () => {\n  assert.match(ui, /if \\(!q \\|\\| !result\\) return clear\\(\\)/);\n  assert.doesNotMatch(ui, /!result\\?\\.totalRecords/);\n  assert.match(ui, /行政事業レビュー・公式資料のタブも確認できます/);\n});\n\ntest("cross-stage and cross-corporation money totals are not displayed", () => {\n  assert.doesNotMatch(page, /GビズINFO掲載値合計/);\n  assert.match(page, /情報種別[\\s\\S]*掲載値合計/);\n  assert.match(review, /複数法人が一致したため、法人をまたぐ金額は合算しません/);\n  assert.match(ui, /意味が異なるため、金額は合計していません/);\n});\n''', encoding="utf-8")

package = Path("package.json")
package_text = package.read_text(encoding="utf-8")
needle = "tests/funding-data.test.mjs tests/gbiz-refresh.test.mjs"
if package_text.count(needle) != 1: raise RuntimeError("package.json test list anchor not found exactly once")
package.write_text(package_text.replace(needle, "tests/company-search-safety.test.mjs tests/funding-data.test.mjs tests/gbiz-refresh.test.mjs", 1), encoding="utf-8")
print("company-search hardening patch applied")
