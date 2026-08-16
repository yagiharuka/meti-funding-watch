import assert from "node:assert/strict";
import test from "node:test";

import { buildReviewGraphs, createReviewPayments } from "../scripts/review-data-model.mjs";

const reviewSheetYear = 2025;
const program = { id: "rs-2025-P1", name: "検証事業" };
const programById = new Map([["P1", program]]);
const base = {
  所管府省庁: "経済産業省",
  予算事業ID: "P1",
  支出先名: "公益財団法人テスト産業支援機構",
  支出先ブロック番号: "A",
  支出先の合計支出額: "100",
  法人番号: "",
  法人種別: "",
};

test("does not invent a METI route or intermediary status when no graph exists", () => {
  const { payments } = createReviewPayments({
    reviewSheetYear,
    rows: [{ row: base, rowNumber: 2 }],
    programById,
    graphByProject: new Map(),
  });
  assert.equal(payments.length, 1);
  assert.equal(payments[0].flowLevel, "unclassified");
  assert.equal(payments[0].sourceAgency, null);
  assert.equal(payments[0].route, null);
  assert.equal(payments[0].hasDisclosedDownstream, null);
});

test("uses disclosed outgoing edges, not an organization-name allowlist, for graph position", () => {
  const flowRows = [
    { row: { 所管府省庁: "経済産業省", 予算事業ID: "P1", 支出先の支出先ブロック: "A", 支出先の支出先ブロック名: "支援機構", 担当組織からの支出: "TRUE" }, rowNumber: 2 },
    { row: { 所管府省庁: "経済産業省", 予算事業ID: "P1", 支出元の支出先ブロック: "A", 支出元の支出先ブロック名: "支援機構", 支出先の支出先ブロック: "B", 支出先の支出先ブロック名: "企業", 担当組織からの支出: "FALSE" }, rowNumber: 3 },
  ];
  const rows = [
    { row: base, rowNumber: 2 },
    { row: { ...base, 支出先名: "株式会社テスト", 支出先ブロック番号: "B", 支出先の合計支出額: "50" }, rowNumber: 3 },
  ];
  const { payments } = createReviewPayments({ reviewSheetYear, rows, programById, graphByProject: buildReviewGraphs(flowRows) });
  const upstream = payments.find((row) => row.block === "A");
  const terminal = payments.find((row) => row.block === "B");
  assert.equal(upstream.flowLevel, "disclosed_intermediary");
  assert.equal(terminal.flowLevel, "terminal_in_disclosed_graph");
  assert.deepEqual(terminal.parentPaymentIds, [upstream.id]);
});

test("keeps zero, negative, and blank amounts and gives same-amount rows distinct IDs", () => {
  const rows = [
    { row: { ...base, 支出先の合計支出額: "0" }, rowNumber: 2 },
    { row: { ...base, 支出先の合計支出額: "-10" }, rowNumber: 3 },
    { row: { ...base, 支出先の合計支出額: "" }, rowNumber: 4 },
    { row: { ...base, 支出先の合計支出額: "100" }, rowNumber: 5 },
    { row: { ...base, 支出先の合計支出額: "100" }, rowNumber: 6 },
  ];
  const result = createReviewPayments({ reviewSheetYear, rows, programById, graphByProject: new Map() });
  assert.equal(result.payments.length, 5);
  assert.equal(result.accounting.sourcePaymentRowCount, 5);
  assert.equal(result.accounting.excludedPaymentRowCount, 0);
  assert.deepEqual(result.accounting.amountStatusCounts, { positive: 2, zero: 1, negative: 1, blank: 1, invalid: 0 });
  assert.equal(new Set(result.payments.map((row) => row.id)).size, 5);
});

test("records structurally excluded source rows with reason counts", () => {
  const rows = [
    { row: { ...base, 支出先名: "" }, rowNumber: 2 },
    { row: { ...base, 予算事業ID: "UNKNOWN", 支出先ブロック番号: "" }, rowNumber: 3 },
  ];
  const result = createReviewPayments({ reviewSheetYear, rows, programById, graphByProject: new Map() });
  assert.equal(result.payments.length, 0);
  assert.equal(result.excludedRows.length, 2);
  assert.deepEqual(result.accounting.excludedByReason, { organization_blank: 1, project_not_found: 1, block_blank: 1 });
});

test("does not collapse multiple upstream blocks into one route", () => {
  const flowRows = [
    { row: { 所管府省庁: "経済産業省", 予算事業ID: "P1", 支出先の支出先ブロック: "A", 支出先の支出先ブロック名: "A", 担当組織からの支出: "TRUE" }, rowNumber: 2 },
    { row: { 所管府省庁: "経済産業省", 予算事業ID: "P1", 支出先の支出先ブロック: "B", 支出先の支出先ブロック名: "B", 担当組織からの支出: "TRUE" }, rowNumber: 3 },
    { row: { 所管府省庁: "経済産業省", 予算事業ID: "P1", 支出元の支出先ブロック: "A", 支出元の支出先ブロック名: "A", 支出先の支出先ブロック: "C", 支出先の支出先ブロック名: "C", 担当組織からの支出: "FALSE" }, rowNumber: 4 },
    { row: { 所管府省庁: "経済産業省", 予算事業ID: "P1", 支出元の支出先ブロック: "B", 支出元の支出先ブロック名: "B", 支出先の支出先ブロック: "C", 支出先の支出先ブロック名: "C", 担当組織からの支出: "FALSE" }, rowNumber: 5 },
  ];
  const { payments } = createReviewPayments({
    reviewSheetYear,
    rows: [{ row: { ...base, 支出先ブロック番号: "C" }, rowNumber: 2 }],
    programById,
    graphByProject: buildReviewGraphs(flowRows),
  });
  assert.equal(payments[0].route, null);
  assert.equal(payments[0].sourceAgency, null);
  assert.deepEqual(payments[0].directUpstreamNames.sort(), ["A", "B"]);
});
