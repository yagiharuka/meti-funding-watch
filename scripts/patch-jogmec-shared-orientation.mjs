import { readFile, writeFile } from "node:fs/promises";

const parserPath = "scripts/jogmec-official-supplement.mjs";
let parser = await readFile(parserPath, "utf8");

const current = `function normalizeJogmecPage(page) {
  const programHeader = headerItem(page.items, /物品等又は役務の名称/u);
  const dateHeader = headerItem(page.items, /契約を締結した日/u);
  const organizationHeader = headerItem(page.items, /契約の相手先の商号又は名称及び所在地/u);
  const methodHeader = headerItem(page.items, /一般競争入札(?:及び)?|随意契約/u);
  const classicQuarterTurn = Boolean(programHeader && dateHeader
    && Math.abs(programHeader.x - dateHeader.x) < 0.04
    && Math.abs(programHeader.y - dateHeader.y) > 0.10);`;

const shared = `function normalizeJogmecPage(page) {
  const primaryHeader = headerItem(page.items, /物品等又は役務の名称|対象基地・事業所/u);
  const secondaryHeader = headerItem(page.items, /契約を締結した日|落札価格/u);
  const organizationHeader = headerItem(page.items, /契約の相手先の商号又は名称及び所在地|^落札者$/u);
  const methodHeader = headerItem(page.items, /一般競争入札(?:及び)?|随意契約/u);
  const classicQuarterTurn = Boolean(primaryHeader && secondaryHeader
    && Math.abs(primaryHeader.x - secondaryHeader.x) < 0.04
    && Math.abs(primaryHeader.y - secondaryHeader.y) > 0.10);
  const contractDateItems = page.items.filter((item) => japaneseDate(item.text) && !/(?:作成|更新)/u.test(item.text));
  const dateAxisQuarterTurn = contractDateItems.length >= 3 && (() => {
    const xs = contractDateItems.map((item) => item.x);
    const ys = contractDateItems.map((item) => item.y);
    return Math.max(...xs) - Math.min(...xs) > 0.10
      && Math.max(...ys) - Math.min(...ys) < 0.04;
  })();`;

if (parser.includes(current)) {
  parser = parser.replace(current, shared);
} else if (!parser.includes("const dateAxisQuarterTurn = contractDateItems.length >= 3")) {
  const sharedStart = `function normalizeJogmecPage(page) {
  const primaryHeader = headerItem(page.items, /物品等又は役務の名称|対象基地・事業所/u);`;
  if (!parser.includes(sharedStart)) throw new Error("JOGMEC shared orientation: normalization target not found");
  const classicEnd = `  const classicQuarterTurn = Boolean(primaryHeader && secondaryHeader
    && Math.abs(primaryHeader.x - secondaryHeader.x) < 0.04
    && Math.abs(primaryHeader.y - secondaryHeader.y) > 0.10);`;
  if (!parser.includes(classicEnd)) throw new Error("JOGMEC shared orientation: classic detector not found");
  parser = parser.replace(classicEnd, `${classicEnd}
  const contractDateItems = page.items.filter((item) => japaneseDate(item.text) && !/(?:作成|更新)/u.test(item.text));
  const dateAxisQuarterTurn = contractDateItems.length >= 3 && (() => {
    const xs = contractDateItems.map((item) => item.x);
    const ys = contractDateItems.map((item) => item.y);
    return Math.max(...xs) - Math.min(...xs) > 0.10
      && Math.max(...ys) - Math.min(...ys) < 0.04;
  })();`);
}

const oldGuard = "  if (!classicQuarterTurn && !clusteredQuarterTurn) return page;";
const newGuard = "  if (!classicQuarterTurn && !clusteredQuarterTurn && !dateAxisQuarterTurn) return page;";
if (parser.includes(oldGuard)) parser = parser.replace(oldGuard, newGuard);
else if (!parser.includes(newGuard)) throw new Error("JOGMEC shared orientation: rotation guard not found");

await writeFile(parserPath, parser);
await import("./patch-jogmec-appendix-contract-layout.mjs");
