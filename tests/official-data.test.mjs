import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import ExcelJS from "exceljs";

import {
  OFFICIAL_DOCUMENTS,
  OFFICIAL_PARSER_REVISION,
  assertOfficialContinuity,
  fetchOfficialDocuments,
  officialDocumentDefinitionSha256,
  parseOfficialWorkbook,
} from "../scripts/update-official-data.mjs";

const manifest = JSON.parse(await readFile(new URL("../data/official/manifest.json", import.meta.url), "utf8"));
const records = (await Promise.all(Object.values(manifest.files).map(async (filename) =>
  JSON.parse(await readFile(new URL(`../data/official/${filename}`, import.meta.url), "utf8"))))).flat();

test("publishes a reconciled set of verified official rows without mixing amount stages", () => {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(records.length, manifest.recordCount);
  assert.equal(new Set(records.map((row) => row.id)).size, records.length);
  assert.equal(new Set(records.map((row) => row.sourceKey)).size, records.length);
  assert.deepEqual(manifest.seriesCounts, countBy(records, (row) => row.category));
  assert.equal(manifest.sourceDocuments.reduce((sum, source) => sum + source.records, 0), records.length);
  const executorCounts = countBy(records, (row) => row.executorId);
  for (const [executorId, coverage] of Object.entries(manifest.coverage.executors)) {
    assert.equal(
      coverage.contractResults.records + coverage.grantDecisions.records,
      executorCounts[executorId],
      `${executorId} coverage must be derived from published rows`,
    );
  }
  const publishedYears = [...new Set(records.map((row) => row.fiscalYear))].sort((a, b) => a - b);
  assert.deepEqual(publishedYears, manifest.coverage.fiscalYears ?? publishedYears);
  assert.ok(records.every((row) => row.amountStage.includes(row.category === "contract_result" ? "契約" : "交付決定")));
  assert.ok(records.every((row) => row.program !== "事業名" && !row.program.includes("物品役務等の 名称及び数量")));
  assert.ok(records.every((row) => row.program !== "交付決定なし"));
  assert.ok(records.some((row) => row.corporateNumber === null && row.corporateNumberRaw));
  assert.ok(records.some((row) => row.notes.includes("単価")), "amount semantics in official notes must be preserved");
  assert.ok(records.some((row) => row.multiplePartyListing && row.corporateNumbers.length > 1));
  assert.equal(
    records.find((row) => row.datasetId === "jpo-2025-grant-decisions-h1" && row.dateRaw === "45757")?.date,
    "2025-04-10",
    "Excel serial dates must be converted to their displayed calendar date",
  );
});

test("binds every published source document to a SHA, row count, and registered official URL", () => {
  assert.ok(OFFICIAL_DOCUMENTS.length >= 7);
  assert.equal(manifest.sourceDocuments.length, manifest.coverage.sourceDocumentCount ?? manifest.sourceDocuments.length);
  const definitions = new Map(OFFICIAL_DOCUMENTS.map((item) => [item.id, item]));
  const receipts = new Map(manifest.sourceDocuments.map((item) => [item.id, item]));
  const sourceFailures = manifest.sourceFailures ?? [];
  assert.equal(receipts.size, manifest.sourceDocuments.length);
  assert.equal(new Set(sourceFailures.map((failure) => failure.id)).size, sourceFailures.length);
  assert.ok(sourceFailures.every((failure) => !receipts.has(failure.id)));
  assert.equal(sourceFailures.length, manifest.coverage.failedSourceDocumentCount ?? 0);
  assert.equal(
    manifest.sourceDocuments.length + sourceFailures.length,
    manifest.coverage.attemptedSourceDocumentCount ?? manifest.sourceDocuments.length,
  );
  const fallbackReceipts = manifest.sourceDocuments.filter((receipt) => receipt.fallbackUsed);
  assert.equal(
    manifest.coverage.fallbackSourceDocumentCount ?? fallbackReceipts.length,
    fallbackReceipts.length,
    "fallback count must be derived from the published source receipts",
  );
  const carryForwardReceipts = manifest.sourceDocuments.filter((receipt) => receipt.carryForwardUsed);
  assert.equal(
    manifest.coverage.carryForwardSourceDocumentCount ?? carryForwardReceipts.length,
    carryForwardReceipts.length,
    "carry-forward count must be derived from the published source receipts",
  );
  assert.ok(manifest.sourceDocuments.every((receipt) => !(receipt.fallbackUsed && receipt.carryForwardUsed)));
  for (const receipt of manifest.sourceDocuments) {
    const document = definitions.get(receipt.id);
    assert.ok(document, receipt.id);
    assert.equal(
      receipt.originalUrl ?? receipt.url,
      document.originalUrl ?? document.url,
      `${receipt.id}: official source identity changed`,
    );
    if (Object.hasOwn(receipt, "primaryUrl")) {
      assert.equal(receipt.primaryUrl, document.url, `${receipt.id}: primary URL changed`);
    }
    const expectedTransportUrl = receipt.fallbackUsed ? document.verifiedFallback?.url : document.url;
    if (Object.hasOwn(receipt, "transportUrl")) {
      assert.equal(receipt.transportUrl, expectedTransportUrl, `${receipt.id}: transport URL changed`);
      assert.equal(receipt.url, expectedTransportUrl, `${receipt.id}: compatibility URL must be the actual transport`);
    }
    assert.match(receipt.sha256, /^[0-9a-f]{64}$/);
    assert.equal(receipt.parserRevision, OFFICIAL_PARSER_REVISION, `${receipt.id}: parser revision drifted`);
    assert.equal(receipt.definitionSha256, officialDocumentDefinitionSha256(document), `${receipt.id}: definition digest drifted`);
    assert.ok(receipt.bytes > 1_000);
    assert.ok(Number.isSafeInteger(receipt.records));
    if (receipt.fallbackUsed) {
      assert.ok(document.verifiedFallback, `${receipt.id}: fallback receipt has no allowlisted definition`);
      assert.ok(["empty_response", "transient_http", "fetch_failed"].includes(receipt.primaryFailureReasonCode));
      assert.equal(receipt.archiveExpectedBytes, document.verifiedFallback.expectedBytes);
      assert.equal(receipt.archiveExpectedSha256, document.verifiedFallback.expectedSha256);
      assert.equal(receipt.archiveExpectedRecordCount, document.verifiedFallback.expectedRecordCount);
      assert.equal(receipt.bytes, document.verifiedFallback.expectedBytes);
      assert.equal(receipt.sha256, document.verifiedFallback.expectedSha256);
      assert.equal(receipt.records, document.verifiedFallback.expectedRecordCount);
    } else if (receipt.carryForwardUsed) {
      assert.ok(["empty_response", "transient_http", "fetch_failed", "archive_http_403"].includes(receipt.primaryFailureReasonCode));
      assert.equal(receipt.retrievedAt, receipt.lastSuccessfulRetrievedAt);
      assert.match(receipt.lastSuccessfulRetrievedAt, /^\d{4}-\d{2}-\d{2}T/);
      assert.match(receipt.attemptedAt, /^\d{4}-\d{2}-\d{2}T/);
      assert.notEqual(receipt.retrievedAt, receipt.attemptedAt);
      if (document.archiveProvider) {
        assert.equal(receipt.archiveProvider, document.archiveProvider);
        assert.equal(receipt.archiveExpectedBytes, document.archiveExpectedBytes);
        assert.equal(receipt.archiveExpectedSha256, document.archiveExpectedSha256);
        assert.equal(receipt.archiveExpectedRecordCount, document.archiveExpectedRecordCount);
        assert.equal(receipt.bytes, document.archiveExpectedBytes);
        assert.equal(receipt.sha256, document.archiveExpectedSha256);
        assert.equal(receipt.records, document.archiveExpectedRecordCount);
      } else {
        assert.equal(receipt.archiveProvider, null);
      }
    } else if (receipt.archiveExpectedSha256) {
      assert.equal(receipt.archiveExpectedBytes, document.archiveExpectedBytes);
      assert.equal(receipt.archiveExpectedSha256, document.archiveExpectedSha256);
      assert.equal(receipt.archiveExpectedRecordCount, document.archiveExpectedRecordCount);
    }
    if (document.archiveProvider && receipt.url === document.url) {
      assert.equal(receipt.bytes, document.archiveExpectedBytes, `${receipt.id}: existing archive byte receipt changed`);
      assert.equal(receipt.sha256, document.archiveExpectedSha256, `${receipt.id}: existing archive SHA changed`);
      assert.equal(receipt.records, document.archiveExpectedRecordCount, `${receipt.id}: existing archive row count changed`);
    }
  }
  if (receipts.has("jpo-2025-grant-decisions-h2")) {
    assert.equal(receipts.get("jpo-2025-grant-decisions-h2").records, 0);
    assert.equal(receipts.get("jpo-2025-grant-decisions-h2").emptySentinelFound, true);
  }
});

test("archiving the three published JPO sources must preserve every semantic field and source identity", { timeout: 30_000 }, async (t) => {
  const fixtureDirectory = process.env.OFFICIAL_ARCHIVE_EQUIVALENCE_DIRECTORY?.trim();
  if (!fixtureDirectory) return t.skip("set OFFICIAL_ARCHIVE_EQUIVALENCE_DIRECTORY to the exact archived JPO source files");
  const ids = [
    "jpo-2020-competitive-goods",
    "jpo-2020-competitive-commission",
    "jpo-2020-competitive-public-works",
  ];
  const expected = records.filter((row) => ids.includes(row.datasetId));
  assert.equal(expected.length, 162, "baseline must contain all three previously published JPO sources");
  const selected = OFFICIAL_DOCUMENTS.filter((document) => ids.includes(document.id));
  assert.equal(selected.length, ids.length);

  const { fetched, sourceFailures } = await fetchOfficialDocuments(selected, [], null, []);
  assert.deepEqual(sourceFailures, []);
  const candidate = fetched.flatMap((item) => item.records);
  assert.equal(candidate.length, expected.length);
  const ignoredTransportFields = new Set(["sourceDocumentUrl"]);
  const normalize = (row) => Object.fromEntries(Object.entries(row)
    .filter(([field]) => !ignoredTransportFields.has(field))
    .sort(([left], [right]) => left.localeCompare(right)));
  assert.deepEqual(
    candidate.map(normalize).sort((left, right) => left.sourceKey.localeCompare(right.sourceKey)),
    expected.map(normalize).sort((left, right) => left.sourceKey.localeCompare(right.sourceKey)),
    "WARP replay may change only the transport URL; sourceKey, id, and all normalized semantics must remain exact",
  );
});

test("publishes other new documents while never dropping a previously published source", async () => {
  const unavailable = {
    id: "new-unavailable-source", executorId: "jpo", executorName: "特許庁", fiscalYear: 2020,
    category: "contract_result", kind: "競争入札", amountStage: "契約額", format: "xlsx",
    sourcePageUrl: "https://example.test/index.html", url: "https://example.test/empty.xlsx",
  };
  const valid = { ...unavailable, id: "new-valid-source", fiscalYear: 2025, url: "https://example.test/valid.xlsx" };
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("fixture");
  sheet.addRow(["事業名", "交付先名", "法人番号", "交付決定額", "交付決定日"]);
  sheet.addRow(["補助事業", "法人A", "6010001030403", "1,000", "2025年4月1日"]);
  const validBytes = Buffer.from(await workbook.xlsx.writeBuffer());
  const mixedResponse = async (url) => new Response(url.endsWith("valid.xlsx") ? validBytes : new Uint8Array(), { status: 200 });
  valid.category = "grant_decision";
  valid.kind = "補助金等の交付決定";
  valid.amountStage = "交付決定額";
  const partial = await fetchOfficialDocuments([unavailable, valid], [], mixedResponse);
  assert.equal(partial.fetched.length, 1);
  assert.equal(partial.fetched[0].document.id, valid.id);
  assert.equal(partial.sourceFailures.length, 1);
  assert.equal(partial.sourceFailures[0].reasonCode, "empty_response");
  assert.equal(partial.sourceFailures[0].id, unavailable.id);
  assert.doesNotMatch(JSON.stringify(partial.sourceFailures[0]), /ファイルサイズ|Error:/);

  await assert.rejects(
    fetchOfficialDocuments([unavailable], [], mixedResponse, [unavailable.id]),
    /前回公開済み資料を再検証できませんでした/,
  );
  await assert.rejects(
    fetchOfficialDocuments([], [], mixedResponse, ["previous-zero-row-source"]),
    /前回公開済み資料の定義がなくなりました/,
  );
});

test("parses an official contract sheet and preserves null, zero, raw, and provenance", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("4月競争（物品等）");
  sheet.addRow(["表題"]);
  sheet.addRow([]);
  sheet.addRow([
    "物品役務等の\n名称及び数量", "契約担当官等", "契約を締結\nした日",
    "契約の相手方の\n商号又は名称", "契約の相手方の\n法人番号", "住所",
    "一般競争入札・\n指名競争入札の別\n（総合評価の実施）", "予定価格\n（円）", "契約金額\n（円）", "落札率", "契約方式", "備考",
  ]);
  sheet.addRow(["案件A", "担当", "2025年4月1日", "法人A\n法人B", "1234567890123\n9876543210987", "住所", "一般競争", "非公表", 0, "", "総価", "注記"]);
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const parsed = await parseOfficialWorkbook(buffer, {
    id: "fixture", executorId: "smea", executorName: "中小企業庁", fiscalYear: 2025,
    category: "contract_result", kind: "競争入札", amountStage: "契約額", sourcePageUrl: "https://example.test/", url: "https://example.test/a.xlsx",
  });
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].amount, 0);
  assert.equal(parsed[0].corporateNumber, null);
  assert.match(parsed[0].corporateNumberRaw, /1234567890123/);
  assert.equal(parsed[0].sourceSheet, "4月競争（物品等）");
  assert.equal(parsed[0].sourceRowNumber, 4);
});

test("converts an unformatted Excel serial date without changing the raw evidence", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("7fy 4月-9月");
  sheet.addRow(["事業名", "交付先名", "法人番号", "交付決定額", "交付決定日"]);
  sheet.addRow(["補助事業", "法人A", "6010001030403", "2,940,000", 45_757]);
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const parsed = await parseOfficialWorkbook(buffer, {
    id: "fixture-grant", executorId: "jpo", executorName: "特許庁", fiscalYear: 2025,
    category: "grant_decision", kind: "補助金等の交付決定", amountStage: "交付決定額", sourcePageUrl: "https://example.test/", url: "https://example.test/a.xlsx",
  });
  assert.equal(parsed[0].date, "2025-04-10");
  assert.equal(parsed[0].dateRaw, "45757");
});

test("accepts only an exact repeated official zero-result sentinel row", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("10月-3月");
  sheet.addRow(["事業名", "交付先名", "法人番号", "交付決定額", "交付決定日"]);
  sheet.addRow(Array(5).fill("交付決定なし"));
  const document = {
    id: "zero-sentinel-fixture", executorId: "jpo", executorName: "特許庁", fiscalYear: 2025,
    category: "grant_decision", kind: "補助金等の交付決定", amountStage: "交付決定額",
    emptySentinel: "交付決定なし", sourcePageUrl: "https://example.test/", url: "https://example.test/a.xlsx",
  };
  const parsed = await parseOfficialWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()), document);
  assert.equal(parsed.length, 0);
  assert.equal(parsed.emptySentinelFound, true);

  sheet.getRow(2).getCell(5).value = "想定外";
  await assert.rejects(
    parseOfficialWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()), document),
    /0件表記の行に想定外の値/,
  );
});

test("fails closed on a nonblank XLSX row with missing required values or an invalid fiscal-year date", async () => {
  const document = {
    id: "strict-row-fixture", executorId: "jpo", executorName: "特許庁", fiscalYear: 2025,
    category: "grant_decision", kind: "補助金等の交付決定", amountStage: "交付決定額",
    sourcePageUrl: "https://example.test/", url: "https://example.test/a.xlsx",
  };
  const workbookBytes = async (...rows) => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("fixture");
    sheet.addRow(["事業名", "交付先名", "法人番号", "交付決定額", "交付決定日"]);
    sheet.addRow([]);
    for (const row of rows) sheet.addRow(row);
    return Buffer.from(await workbook.xlsx.writeBuffer());
  };

  await assert.rejects(
    parseOfficialWorkbook(await workbookBytes(["", "法人A", "6010001030403", "1,000", "2025年4月1日"]), document),
    /必須値programが空/,
  );
  await assert.rejects(
    parseOfficialWorkbook(await workbookBytes(["補助事業", "", "6010001030403", "1,000", "2025年4月1日"]), document),
    /必須値organizationが空/,
  );
  await assert.rejects(
    parseOfficialWorkbook(await workbookBytes(["補助事業", "法人A", "6010001030403", "1,000", "不明"]), document),
    /日付を解釈できません/,
  );
  await assert.rejects(
    parseOfficialWorkbook(await workbookBytes(["補助事業", "法人A", "6010001030403", "1,000", "2024年4月1日"]), document),
    /日付が資料年度外/,
  );
  await assert.rejects(
    parseOfficialWorkbook(await workbookBytes(
      ["補助事業", "法人A", "6010001030403", "1,000", "2025年4月1日"],
      ["", "", "", "", "", "予期しない欄外値"],
    ), document),
    /必須値programが空/,
    "a nonblank cell outside the mapped columns must not make a row look blank",
  );

  const january = await parseOfficialWorkbook(
    await workbookBytes(["補助事業", "法人A", "6010001030403", "", "2026年1月5日"]),
    document,
  );
  assert.equal(january.length, 1, "a truly blank row is allowed and ignored");
  assert.equal(january[0].date, "2026-01-05");
  assert.equal(january[0].amount, null, "a missing amount remains allowed and explicit");

  const footnote = await parseOfficialWorkbook(
    await workbookBytes(
      ["補助事業", "法人A", "6010001030403", "1,000", "2025年4月1日"],
      ["※公益法人の区分において、「公財」は「公益財団法人」をいう。", "", "", "", ""],
    ),
    document,
  );
  assert.equal(footnote.length, 1, "the exact official table footnote is structural text, not a data row");
  await assert.rejects(
    parseOfficialWorkbook(await workbookBytes(
      ["補助事業", "法人A", "6010001030403", "1,000", "2025年4月1日"],
      ["※別の注記", "", "", "", ""],
    ), document),
    /必須値organizationが空/,
    "an arbitrary single-cell note must not be silently skipped",
  );
});

test("accepts only an isolated exact grant zero-result sentinel", async () => {
  const document = {
    id: "zero-sentinel-fixture", executorId: "jpo", executorName: "特許庁", fiscalYear: 2025,
    category: "grant_decision", kind: "補助金等の交付決定", amountStage: "交付決定額",
    emptySentinel: "交付決定なし", sourcePageUrl: "https://example.test/", url: "https://example.test/a.xlsx",
  };
  const workbookBytes = async (rows) => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("fixture");
    sheet.addRow(["事業名", "交付先名", "法人番号", "交付決定額", "交付決定日"]);
    for (const row of rows) sheet.addRow(row);
    return Buffer.from(await workbook.xlsx.writeBuffer());
  };

  const zero = await parseOfficialWorkbook(await workbookBytes([["交付決定なし"]]), document);
  assert.equal(zero.length, 0);
  assert.equal(zero.emptySentinelFound, true);
  await assert.rejects(
    parseOfficialWorkbook(await workbookBytes([["交付決定なし", "想定外"]]), document),
    /0件表記の行に想定外の値/,
  );
  await assert.rejects(
    parseOfficialWorkbook(await workbookBytes([
      ["交付決定なし"],
      ["補助事業", "法人A", "6010001030403", "1,000", "2025年4月1日"],
    ]), document),
    /0件表記と交付決定明細が混在/,
  );
});

test("does not silently rewrite an already-published method during parser expansion", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("随意契約");
  sheet.addRow([
    "物品役務等の名称及び数量", "契約を締結した日", "契約の相手方の商号又は名称",
    "契約の相手方の法人番号", "随意契約によることとした会計法令の根拠条文及び理由（企画競争または公募）",
    "契約金額（円）",
  ]);
  sheet.addRow(["案件", "2025年4月1日", "法人A", "6010001030403", "長い法令上の理由", 1_000]);
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const parsed = await parseOfficialWorkbook(buffer, {
    id: "legacy-method", executorId: "jpo", executorName: "特許庁", fiscalYear: 2025,
    category: "contract_result", kind: "随意契約（物品・役務等）", amountStage: "契約額",
    preservePublishedMethod: true, sourcePageUrl: "https://example.test/", url: "https://example.test/a.xlsx",
  });
  assert.equal(parsed[0].method, "随意契約（物品・役務等）");
});

test("fails closed when a previously published official row disappears", () => {
  assert.throws(() => assertOfficialContinuity(records, records.slice(1)), /前回明細が消えました/);
  assert.doesNotThrow(() => assertOfficialContinuity(records, records));
});

test("tolerates row insertion and reordering only when prior semantics remain intact", () => {
  const moved = records.map((record, index) => ({
    ...record,
    id: `moved-${index}`,
    sourceKey: `${record.datasetId}:${record.sourceSheet}:${record.sourceRowNumber + 10}:moved-${index}`,
    sourceRowNumber: record.sourceRowNumber + 10,
  })).reverse();
  const result = assertOfficialContinuity(records, moved);
  assert.equal(result.retained, records.length);
  assert.equal(result.added, 0);
  assert.equal(result.changed.length, 0);

  const identityChange = moved.map((record, index) => index === 0 ? { ...record, organization: "別法人" } : record);
  assert.throws(() => assertOfficialContinuity(records, identityChange), /前回明細が消えました|識別項目/);
});

function countBy(items, key) {
  return items.reduce((result, item) => {
    const value = key(item);
    result[value] = (result[value] ?? 0) + 1;
    return result;
  }, {});
}
