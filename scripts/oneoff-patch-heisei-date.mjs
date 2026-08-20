import { readFile, writeFile } from "node:fs/promises";

const target = "scripts/update-official-data.mjs";
let source = await readFile(target, "utf8");
const oldBlock = `  match = text.match(/^令和(\\d{1,2})年(\\d{1,2})月(\\d{1,2})日$/);\n  if (match) return validDate(2018 + Number(match[1]), Number(match[2]), Number(match[3]));\n  match = text.match(/^(\\d{4})[-/.](\\d{1,2})[-/.](\\d{1,2})$/);`;
const newBlock = `  match = text.match(/^令和(\\d{1,2})年(\\d{1,2})月(\\d{1,2})日$/);\n  if (match) return validDate(2018 + Number(match[1]), Number(match[2]), Number(match[3]));\n  match = text.match(/^平成(\\d{1,2})年(\\d{1,2})月(\\d{1,2})日$/);\n  if (match) return validDate(1988 + Number(match[1]), Number(match[2]), Number(match[3]));\n  match = text.match(/^(\\d{4})[-/.](\\d{1,2})[-/.](\\d{1,2})$/);`;
if (!source.includes(oldBlock)) throw new Error("parseDate patch anchor not found");
source = source.replace(oldBlock, newBlock);
await writeFile(target, source);

await writeFile("tests/official-heisei-date.test.mjs", `import assert from "node:assert/strict";\nimport test from "node:test";\nimport ExcelJS from "exceljs";\nimport { parseOfficialWorkbook } from "../scripts/update-official-data.mjs";\n\ntest("parses Heisei dates in historical METI grant workbooks", async () => {\n  const workbook = new ExcelJS.Workbook();\n  const sheet = workbook.addWorksheet("4月～9月");\n  sheet.addRow(["事業名", "交付先名", "法人番号", "交付決定額", "交付決定日"]);\n  sheet.addRow(["補助事業", "法人A", "6010001030403", "1,000", "平成29年04月03日"]);\n  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());\n  const parsed = await parseOfficialWorkbook(buffer, {\n    id: "heisei-fixture", executorId: "meti", executorName: "経済産業省（本省）", fiscalYear: 2017,\n    category: "grant_decision", kind: "補助金等の交付決定", amountStage: "交付決定額",\n    sourcePageUrl: "https://www.meti.go.jp/", url: "https://www.meti.go.jp/example.xlsx",\n  });\n  assert.equal(parsed.length, 1);\n  assert.equal(parsed[0].date, "2017-04-03");\n  assert.equal(parsed[0].dateRaw, "平成29年04月03日");\n});\n`);
console.log("Heisei date parser patch applied");
