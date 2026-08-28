import { readFile, writeFile } from "node:fs/promises";

function replaceOnce(source, search, replacement, label, { optional = false } = {}) {
  const index = source.indexOf(search);
  if (index < 0) {
    if (source.includes(replacement) || optional) return source;
    throw new Error(`${label}: replacement target not found`);
  }
  if (source.indexOf(search, index + search.length) >= 0) throw new Error(`${label}: replacement target is not unique`);
  return `${source.slice(0, index)}${replacement}${source.slice(index + search.length)}`;
}

const parserPath = "scripts/jogmec-official-supplement.mjs";
let parser = await readFile(parserPath, "utf8");

parser = replaceOnce(
  parser,
  "  const secondaryHeader = headerItem(page.items, /契約を締結した日|落札価格/u);",
  "  const secondaryHeader = headerItem(page.items, /契約を締結した日|落札価格|契約価格/u);",
  "JOGMEC appendix contract-layout orientation",
  { optional: true },
);

parser = replaceOnce(
  parser,
  `function buildAppendixSchema(page, document, previous = null) {
  const target = headerItem(page.items, /対象基地・事業所/u);
  const organization = headerItem(page.items, /^落札者$/u);
  const amount = headerItem(page.items, /^落札価格$/u);
  if (!target || !organization || !amount) {
    if (previous) return previous;
    throw new Error(\`JOGMEC: \${document.url} p\${page.pageNumber} の別紙列見出しを確定できません\`);
  }
  return {
    headerY: Math.max(target.y, organization.y, amount.y),
    bounds: {
      target: { left: Math.max(0, target.x - 0.12), right: (target.x + organization.x) / 2 },
      organization: { left: (target.x + organization.x) / 2, right: (organization.x + amount.x) / 2 },
      amount: { left: (organization.x + amount.x) / 2, right: 1.05 },
    },
  };
}`,
  `function buildAppendixSchema(page, document, previous = null) {
  const found = {
    target: headerItem(page.items, /対象基地・事業所/u),
    officer: headerItem(page.items, /契約担当役の氏名及び所在地/u),
    date: headerItem(page.items, /契約を締結した日/u),
    organization: headerItem(page.items, /落札者|契約の相手先の商号又は名称及び所在地/u),
    method: headerItem(page.items, /一般競争入札(?:及び)?/u),
    planned: headerItem(page.items, /^予定価格/u),
    amount: headerItem(page.items, /^(?:落札価格|契約価格)/u),
    rate: headerItem(page.items, /^落札率/u),
  };
  const required = ["target", "organization", "amount"];
  if (required.some((key) => !found[key])) {
    if (previous) return previous;
    throw new Error(\`JOGMEC: \${document.url} p\${page.pageNumber} の別紙列見出しを確定できません\`);
  }
  const ordered = Object.values(found)
    .filter(Boolean)
    .sort((left, right) => left.x - right.x);
  const leftBoundary = (item) => {
    const index = ordered.indexOf(item);
    const previousItem = index > 0 ? ordered[index - 1] : null;
    return previousItem ? (previousItem.x + item.x) / 2 : Math.max(0, item.x - 0.12);
  };
  const rightBoundary = (item) => {
    const index = ordered.indexOf(item);
    const nextItem = index >= 0 && index + 1 < ordered.length ? ordered[index + 1] : null;
    return nextItem ? (item.x + nextItem.x) / 2 : 1.05;
  };
  return {
    headerY: Math.max(...required.map((key) => found[key].y)),
    amountKind: /^落札価格/u.test(compact(found.amount.text)) ? "award" : "contract",
    bounds: {
      target: { left: leftBoundary(found.target), right: rightBoundary(found.target) },
      date: found.date ? { left: leftBoundary(found.date), right: rightBoundary(found.date) } : null,
      organization: { left: leftBoundary(found.organization), right: rightBoundary(found.organization) },
      amount: { left: leftBoundary(found.amount), right: rightBoundary(found.amount) },
    },
  };
}`,
  "JOGMEC appendix contract-layout schema",
);

parser = replaceOnce(
  parser,
  '    const title = groupLines(page.items).find((line) => /入札結果/u.test(line.text))?.text ?? "JOGMEC入札結果";',
  '    const title = groupLines(page.items).find((line) => /競争入札に係る情報の公表|入札結果/u.test(line.text))?.text ?? "JOGMEC競争契約結果";',
  "JOGMEC appendix title",
);

parser = replaceOnce(
  parser,
  `      const organizationCell = cellText(rowItems, schema.bounds.organization);
      const organization = normalizeOrganization(organizationCell);
      if (!target || !organization) {`,
  `      const organizationCell = cellText(rowItems, schema.bounds.organization);
      const organization = normalizeOrganization(organizationCell);
      const date = schema.bounds.date ? japaneseDate(cellText(rowItems, schema.bounds.date)) : null;
      if (!target || !organization) {`,
  "JOGMEC appendix contract date",
);

parser = replaceOnce(
  parser,
  '      const sourceKey = `${document.url}#p${page.pageNumber}-appendix-r${index + 1}-y${anchor.y.toFixed(6)}`;',
  '      const sourceKey = `${document.url}#p${page.pageNumber}-appendix-r${index + 1}-y${anchor.y.toFixed(6)}-${date ?? "date-unavailable"}`;',
  "JOGMEC appendix dated source key",
);

parser = replaceOnce(
  parser,
  `        fiscalYear: document.fiscalYear,
        date: null,`,
  `        fiscalYear: date ? fiscalYearFromDate(date) : document.fiscalYear,
        date,`,
  "JOGMEC appendix fiscal date",
);

parser = replaceOnce(
  parser,
  `        category: "bid_result",
        amountStage: "落札価格",`,
  `        category: schema.amountKind === "award" ? "bid_result" : "contract_result",
        amountStage: schema.amountKind === "award" ? "落札価格" : AMOUNT_STAGE.competitive,`,
  "JOGMEC appendix amount semantics",
);

await writeFile(parserPath, parser);

const testPath = "tests/jogmec-official-supplement.test.mjs";
let tests = await readFile(testPath, "utf8");
if (!tests.includes("function contractAppendixPage()")) tests += `

function contractAppendixPage() {
  const logical = {
    pageNumber: 1,
    items: [
      item("対象基地・事業所", 0.08, 0.90, 0.10),
      item("契約担当役の氏名及び所在地", 0.23, 0.90, 0.11),
      item("契約を締結した日", 0.38, 0.90, 0.08),
      item("契約の相手先の商号又は名称及び所在地", 0.49, 0.90, 0.15),
      item("一般競争入札及び", 0.67, 0.90, 0.06),
      item("指名競争入札の別", 0.67, 0.88, 0.06),
      item("予定価格", 0.78, 0.90, 0.05),
      item("契約価格", 0.85, 0.90, 0.05),
      item("落札率", 0.92, 0.90, 0.04),
      item("競争入札に係る情報の公表（別紙 令和8年度国家備蓄石油の品質分析等に関する業務）", 0.08, 0.96, 0.50),
      item("むつ小川原国家石油備蓄基地", 0.08, 0.72, 0.14),
      item("資源備蓄本部長", 0.23, 0.72, 0.08),
      item("令和8年4月1日", 0.38, 0.72, 0.08),
      item("一般社団法人日本海事検定協会 東京都中央区八丁堀1-9-7", 0.49, 0.72, 0.15),
      item("一般競争入札", 0.67, 0.72, 0.08),
      item("-", 0.78, 0.72, 0.03),
      item("¥1,850,578", 0.85, 0.72, 0.07),
      item("-", 0.92, 0.72, 0.03),
      item("上五島国家石油備蓄基地", 0.08, 0.52, 0.14),
      item("資源備蓄本部長", 0.23, 0.52, 0.08),
      item("令和8年4月1日", 0.38, 0.52, 0.08),
      item("一般財団法人新日本検定協会 東京都港区高輪3-25-23", 0.49, 0.52, 0.15),
      item("一般競争入札", 0.67, 0.52, 0.08),
      item("-", 0.78, 0.52, 0.03),
      item("¥1,812,670", 0.85, 0.52, 0.07),
      item("-", 0.92, 0.52, 0.03),
    ],
  };
  return {
    ...logical,
    items: logical.items.map((entry) => ({
      ...entry,
      x: 1 - entry.y,
      y: entry.x,
      w: entry.h,
      h: entry.w,
    })),
  };
}

test("JOGMEC appendix parser supports site-level competitive contract tables with contract dates", () => {
  const parsed = parseJogmecAppendixPages({
    ...document("competitive"),
    appendix: true,
    fiscalYear: 2026,
  }, [contractAppendixPage()]);
  assert.equal(parsed.totalRows, 2);
  assert.equal(parsed.records[0].category, "contract_result");
  assert.equal(parsed.records[0].amountStage, "契約価格（税抜）");
  assert.equal(parsed.records[0].date, "2026-04-01");
  assert.equal(parsed.records[0].organization, "一般社団法人日本海事検定協会");
  assert.equal(parsed.records[0].amount, 1_850_578);
  assert.equal(parsed.records[0].theme, "むつ小川原国家石油備蓄基地");
  assert.equal(parsed.records[1].organization, "一般財団法人新日本検定協会");
  assert.equal(parsed.records[1].amount, 1_812_670);
});
`;
await writeFile(testPath, tests);

console.log("Patched JOGMEC appendix parser for site-level competitive contract tables.");