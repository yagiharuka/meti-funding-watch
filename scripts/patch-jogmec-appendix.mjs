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

async function updateText(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after === before) return;
  await writeFile(path, after);
}

await updateText("scripts/jogmec-official-supplement.mjs", (input) => {
  let source = input;
  source = replaceOnce(
    source,
    `function normalizeJogmecPage(page) {
  const programHeader = headerItem(page.items, /物品等又は役務の名称/u);
  const dateHeader = headerItem(page.items, /契約を締結した日/u);
  if (!programHeader || !dateHeader) return page;
  const isQuarterTurn = Math.abs(programHeader.x - dateHeader.x) < 0.04
    && Math.abs(programHeader.y - dateHeader.y) > 0.10;`,
    `function normalizeJogmecPage(page) {
  const primaryHeader = headerItem(page.items, /物品等又は役務の名称|対象基地・事業所/u);
  const secondaryHeader = headerItem(page.items, /契約を締結した日|落札価格/u);
  if (!primaryHeader || !secondaryHeader) return page;
  const isQuarterTurn = Math.abs(primaryHeader.x - secondaryHeader.x) < 0.04
    && Math.abs(primaryHeader.y - secondaryHeader.y) > 0.10;`,
    "JOGMEC appendix orientation detection",
    { optional: true },
  );
  source = replaceOnce(
    source,
    `function rowId(sourceKey) {
  return \`jogmec-\${sha256(sourceKey).slice(0, 24)}\`;
}

export function parseJogmecPositionedPages(document, pages) {`,
    `function rowId(sourceKey) {
  return \`jogmec-\${sha256(sourceKey).slice(0, 24)}\`;
}

function buildAppendixSchema(page, document, previous = null) {
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
}

export function parseJogmecAppendixPages(document, pages) {
  if (!document?.appendix || document.contractType !== "competitive") {
    throw new Error("JOGMEC: 別紙資料メタデータが不正です");
  }
  const records = [];
  const pageReceipts = [];
  let schema = null;
  for (const rawPage of pages) {
    const page = normalizeJogmecPage(rawPage);
    schema = buildAppendixSchema(page, document, schema);
    const amountLines = groupLines(page.items.filter((item) => inBounds(item, schema.bounds.amount)))
      .filter((line) => /[¥￥\\]?\s*[0-9][0-9,]{3,}/u.test(line.text) && line.y < schema.headerY - 0.003)
      .sort((left, right) => right.y - left.y);
    if (!amountLines.length) throw new Error(\`JOGMEC: \${document.url} p\${page.pageNumber} の別紙明細行を検出できません\`);
    const title = groupLines(page.items).find((line) => /入札結果/u.test(line.text))?.text ?? "JOGMEC入札結果";
    const pageRows = [];
    for (let index = 0; index < amountLines.length; index += 1) {
      const anchor = amountLines[index];
      const upper = index === 0 ? (schema.headerY + anchor.y) / 2 : (amountLines[index - 1].y + anchor.y) / 2;
      const lower = index + 1 < amountLines.length ? (anchor.y + amountLines[index + 1].y) / 2 : 0.01;
      const rowItems = page.items.filter((item) => item.y <= upper && item.y > lower);
      const target = cellText(rowItems, schema.bounds.target);
      const organizationCell = cellText(rowItems, schema.bounds.organization);
      const organization = normalizeOrganization(organizationCell);
      if (!target || !organization) {
        throw new Error(\`JOGMEC: \${document.url} p\${page.pageNumber} 別紙row\${index + 1} の対象基地または落札者が空です\`);
      }
      const parsedAmount = classifyJogmecAmount(cellText(rowItems, schema.bounds.amount), "competitive");
      if (parsedAmount.amountStatus !== "published") {
        throw new Error(\`JOGMEC: \${document.url} p\${page.pageNumber} 別紙row\${index + 1} の落札価格が数値ではありません\`);
      }
      const sourceKey = \`\${document.url}#p\${page.pageNumber}-appendix-r\${index + 1}-y\${anchor.y.toFixed(6)}\`;
      pageRows.push({
        id: rowId(sourceKey),
        organization,
        organizations: [organization],
        corporateNumber: "",
        fiscalYear: document.fiscalYear,
        date: null,
        program: \`\${title}／\${target}\`,
        theme: target,
        phase: "",
        supportYears: "",
        category: "bid_result",
        amountStage: "落札価格",
        amount: parsedAmount.amount,
        amountStatus: "published",
        publishedAmountText: parsedAmount.publishedText,
        contractType: "competitive",
        sourceUrl: document.url,
        sourcePageUrl: document.sourcePageUrl,
        sourceKey,
        sourcePageNumber: page.pageNumber,
        sourceRowNumber: index + 1,
      });
    }
    pageReceipts.push({
      pageNumber: page.pageNumber,
      totalRows: pageRows.length,
      publishedRows: pageRows.length,
      unavailableRows: 0,
      nonTotalRows: 0,
      nonJpyRows: 0,
    });
    records.push(...pageRows);
  }
  const totalRows = records.length;
  if (!totalRows || new Set(records.map((row) => row.sourceKey)).size !== totalRows) {
    throw new Error(\`JOGMEC: \${document.url} の別紙行会計または識別子が不正です\`);
  }
  return {
    records,
    pageReceipts,
    totalRows,
    publishedRows: totalRows,
    unavailableRows: 0,
    nonTotalRows: 0,
    nonJpyRows: 0,
  };
}

export function parseJogmecPositionedPages(document, pages) {`,
    "JOGMEC appendix parser",
  );
  source = replaceOnce(
    source,
    `  const pages = await positionedPagesFromPdf(buffer, document);
  const parsed = parseJogmecPositionedPages(document, pages);`,
    `  const pages = await positionedPagesFromPdf(buffer, document);
  const parsed = document.appendix
    ? parseJogmecAppendixPages(document, pages)
    : parseJogmecPositionedPages(document, pages);`,
    "JOGMEC appendix dispatch",
  );
  return source;
});

await updateText("tests/jogmec-official-supplement.test.mjs", (input) => {
  let source = input;
  source = replaceOnce(
    source,
    `  mergeJogmecWithPrevious,
  parseJogmecListingHtml,`,
    `  mergeJogmecWithPrevious,
  parseJogmecAppendixPages,
  parseJogmecListingHtml,`,
    "JOGMEC appendix test import",
  );
  source = replaceOnce(
    source,
    `function document(contractType) {`,
    `function appendixPage() {
  const logical = {
    pageNumber: 1,
    items: [
      item("対象基地・事業所", 0.12, 0.90, 0.10),
      item("落札者", 0.52, 0.90, 0.06),
      item("落札価格", 0.84, 0.90, 0.06),
      item("（円）", 0.86, 0.87, 0.04),
      item("令和8年度国家備蓄石油の品質分析等に関する業務 入札結果", 0.12, 0.96, 0.50),
      item("むつ小川原国家石油備蓄基地", 0.12, 0.72, 0.20),
      item("一般社団法人日本海事検定協会 東京都中央区八丁堀1丁目9番7号", 0.52, 0.72, 0.24),
      item("¥1,585,056", 0.84, 0.72, 0.08),
      item("上五島国家石油備蓄基地", 0.12, 0.52, 0.18),
      item("一般財団法人新日本検定協会 東京都港区高輪3丁目25番23号", 0.52, 0.52, 0.24),
      item("¥1,569,341", 0.84, 0.52, 0.08),
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

function document(contractType) {`,
    "JOGMEC appendix fixture",
  );
  source = replaceOnce(
    source,
    `test("JOGMEC quarter-turn PDF coordinates are normalized before row parsing", () => {`,
    `test("JOGMEC competitive appendix parser publishes each site-level award without inventing a contract date", () => {
  const parsed = parseJogmecAppendixPages({
    ...document("competitive"),
    appendix: true,
    fiscalYear: 2026,
  }, [appendixPage()]);
  assert.equal(parsed.totalRows, 2);
  assert.equal(parsed.publishedRows, 2);
  assert.equal(parsed.records[0].category, "bid_result");
  assert.equal(parsed.records[0].date, null);
  assert.equal(parsed.records[0].organization, "一般社団法人日本海事検定協会");
  assert.equal(parsed.records[0].amount, 1_585_056);
  assert.match(parsed.records[0].program, /むつ小川原国家石油備蓄基地/);
});

test("JOGMEC quarter-turn PDF coordinates are normalized before row parsing", () => {`,
    "JOGMEC appendix parser test",
  );
  return source;
});

await updateText("scripts/build-official-company-index.mjs", (input) => replaceOnce(
  input,
  `    amountStage: row.amountStage || (row.category === "grant_decision" ? "交付決定額" : "契約額"),
    amount: row.amount,
    sourceUrl,`,
  `    amountStage: row.amountStage || (row.category === "grant_decision" ? "交付決定額" : "契約額"),
    amount: row.amount,
    amountStatus: row.amountStatus ?? (row.amount === null ? "unavailable" : "published"),
    contractType: row.contractType ?? "",
    publishedAmountText: row.publishedAmountText ?? "",
    sourceUrl,`,
  "JOGMEC company index metadata",
));

console.log("Patched JOGMEC appendix PDFs and preserved contract metadata in the company index.");