import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import { parseOfficialWorkbook } from "../scripts/update-official-data.mjs";

test("parses Heisei dates in historical METI grant workbooks", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("4月～9月");
  sheet.addRow(["事業名", "交付先名", "法人番号", "交付決定額", "交付決定日"]);
  sheet.addRow(["補助事業", "法人A", "6010001030403", "1,000", "平成29年04月03日"]);
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const parsed = await parseOfficialWorkbook(buffer, {
    id: "heisei-fixture", executorId: "meti", executorName: "経済産業省（本省）", fiscalYear: 2017,
    category: "grant_decision", kind: "補助金等の交付決定", amountStage: "交付決定額",
    sourcePageUrl: "https://www.meti.go.jp/", url: "https://www.meti.go.jp/example.xlsx",
  });
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].date, "2017-04-03");
  assert.equal(parsed[0].dateRaw, "平成29年04月03日");
});
