import { readFile, writeFile } from "node:fs/promises";

const path = "tests/smrj-official-supplement.test.mjs";
let source = await readFile(path, "utf8");
if (!source.includes("parseSmrjTsvText")) {
  source = source.replace(
    "  parseSmrjListingHtml,\n  validateSmrjCoverage,",
    "  parseSmrjListingHtml,\n  parseSmrjTsvText,\n  validateSmrjCoverage,",
  );
}
if (!source.includes("SMRJ TSV coordinate fallback preserves a verified contract row")) {
  source += String.raw`

test("SMRJ TSV coordinate fallback preserves a verified contract row", () => {
  const header = "level\tpage_num\tpar_num\tblock_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext";
  const words = [
    [5,1,1,1,1,1,4,10,20,10,100,"物品役務等の名称及び数量"],
    [5,1,1,1,1,2,32,10,12,10,100,"契約担当役"],
    [5,1,1,1,1,3,52,10,18,10,100,"契約を締結した日"],
    [5,1,1,1,1,4,75,10,18,10,100,"契約の相手方"],
    [5,1,1,1,1,5,110,10,12,10,100,"法人番号"],
    [5,1,1,1,1,6,135,10,12,10,100,"予定価格"],
    [5,1,1,1,1,7,155,10,12,10,100,"契約金額"],
    [5,1,1,1,1,8,175,10,12,10,100,"落札率"],
    [5,1,1,2,2,1,0,50,3,10,100,"1"],
    [5,1,1,2,2,2,4,50,20,10,100,"クラウド利用契約"],
    [5,1,1,2,2,3,52,50,18,10,100,"令和8年4月10日"],
    [5,1,1,2,2,4,75,50,20,10,100,"株式会社テスト"],
    [5,1,1,2,2,5,110,50,15,10,100,"1234567890123"],
    [5,1,1,2,2,6,135,50,15,10,100,"12,000,000"],
    [5,1,1,2,2,7,155,50,15,10,100,"11,000,000"],
    [5,1,1,2,2,8,175,50,10,10,100,"91.6%"],
  ].map((row) => row.join("\t"));
  const parsed = parseSmrjTsvText([header, ...words].join("\n"), document);
  assert.equal(parsed.printedRowCount, 1);
  assert.equal(parsed.amountUnavailableCount, 0);
  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.records[0].organization, "株式会社テスト");
  assert.equal(parsed.records[0].date, "2026-04-10");
  assert.equal(parsed.records[0].amount, 11_000_000);
});
`;
}
await writeFile(path, source);
console.log("Added SMRJ HQ TSV fallback fixture test.");
