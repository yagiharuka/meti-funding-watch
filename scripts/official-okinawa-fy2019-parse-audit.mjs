import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { parseOfficialPdf } from "./official-pdf.mjs";

const DIRECTORY = path.resolve(".audit/okinawa-historical");
const TABLE_COLUMNS = Object.freeze([
  { key: "ordinal", leftRatio: 0.03, headerAliases: ["番号"] },
  { key: "program", leftRatio: 0.055, headerAliases: ["事業名"] },
  { key: "organization", leftRatio: 0.25, headerAliases: ["交付先"] },
  { key: "amount", leftRatio: 0.38, headerAliases: ["交付決定額"] },
  { key: "account", leftRatio: 0.448, headerAliases: ["支出元会計区分"] },
  { key: "budgetItem", leftRatio: 0.57, headerAliases: ["支出元（目）名称"] },
  { key: "date", leftRatio: 0.75, headerAliases: ["交付決定日"] },
  { key: "publicInterestClass", leftRatio: 0.822, headerAliases: ["公益法人の区分", "公益法人の区"] },
  { key: "jurisdictionClass", leftRatio: 0.89, headerAliases: ["国所管、都道府", "国所管、都道"] },
]);

const document = Object.freeze({
  id: "okinawa-2019-grant-decisions-h2",
  executorId: "okinawa",
  executorName: "沖縄総合事務局（経済産業部）",
  fiscalYear: 2019,
  category: "grant_decision",
  kind: "補助金等の交付決定（10月～3月）",
  amountStage: "交付決定額欄の掲載値",
  format: "pdf",
  sourcePageUrl: "https://www.ogb.go.jp/keisan/3842/saitaku/f_03/014671",
  url: "https://www.ogb.go.jp/-/media/Files/OGB/Keisan/move/kobo/hojyokin/31fyhojoshimoki.pdf",
  pdfSchema: Object.freeze({
    schemaVersion: 1,
    extractionMode: "positioned_text_only",
    expectedBytes: 50170,
    expectedSha256: "cc0dee7fffdc496913a88ef241f3b572f87560e7f98b32077cd3ac7f329621b3",
    expectedPageCount: 1,
    expectedPageSize: { width: 841.68, height: 595.2, tolerance: 0.2 },
    expectedRowsPerPage: [3],
    expectedRecordCount: 3,
    expectedRowNumbers: { start: 1, end: 3 },
    bodyMinimumYRatio: 0.04,
    cellAssignmentCoordinate: "left",
    requiredPageText: ["平成31年度補助金等の情報", "沖縄総合事務局経済産業部"],
    requiredFirstPageText: [],
    columns: TABLE_COLUMNS,
    recordMapping: {
      ordinalColumn: "ordinal",
      programColumn: "program",
      organizationColumn: "organization",
      amountColumn: "amount",
      dateColumn: "date",
      notesColumns: ["account", "budgetItem"],
    },
    corporateNumberOmitted: true,
    allowedDateFormats: ["reiwa_ymd_ja"],
    dateRange: { start: "2019-10-01", end: "2020-03-31" },
    minimumPositionedTextItems: 51,
    expectedPositionedTextItemCount: 51,
  }),
});

const bytes = await readFile(path.join(DIRECTORY, "2019-31fyhojoshimoki.pdf"));
const records = await parseOfficialPdf(bytes, document);
const report = {
  schemaVersion: 2,
  checkedAt: new Date().toISOString(),
  documentId: document.id,
  fixedPublicInterestBoundaryRatio: 0.822,
  recordCount: records.length,
  records,
};
await writeFile(path.join(DIRECTORY, "fy2019-h2-production-parse.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ documentId: document.id, recordCount: records.length }));
