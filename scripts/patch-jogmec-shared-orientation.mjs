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
    && Math.abs(primaryHeader.y - secondaryHeader.y) > 0.10);`;

if (parser.includes(current)) {
  parser = parser.replace(current, shared);
  await writeFile(parserPath, parser);
} else if (!parser.includes("const secondaryHeader = headerItem(page.items, /契約を締結した日|落札価格")) {
  throw new Error("JOGMEC shared orientation: normalization target not found");
}

await import("./patch-jogmec-appendix-contract-layout.mjs");
