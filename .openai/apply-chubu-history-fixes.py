from pathlib import Path


def replace_once(path, old, new):
    file = Path(path)
    text = file.read_text()
    if text.count(old) != 1:
        raise SystemExit(f"{path}: expected one patch target, found {text.count(old)}")
    file.write_text(text.replace(old, new, 1))


replace_once(
    "scripts/official-chubu-fy2019-sources.mjs",
    "  expectedNonRecordRows = [],\n}) {",
    "  expectedNonRecordRows = [],\n  dateRangeExceptions = [],\n  expectedMissingCorporateNumberRows = [],\n}) {",
)
replace_once(
    "scripts/official-chubu-fy2019-sources.mjs",
    "    expectedNonRecordRows: Object.freeze(expectedNonRecordRows.map((row) => Object.freeze(row))),\n    coverageClaim,",
    "    expectedNonRecordRows: Object.freeze(expectedNonRecordRows.map((row) => Object.freeze(row))),\n    dateRangeExceptions: Object.freeze(dateRangeExceptions.map((exception) => Object.freeze(exception))),\n    expectedMissingCorporateNumberRows: Object.freeze(expectedMissingCorporateNumberRows.map((row) => Object.freeze(row))),\n    coverageClaim,",
)
replace_once(
    "scripts/official-chubu-fy2019-sources.mjs",
    "    expectedRecordCount: 237,\n    sheetName: \"（R1fy前期）補助金\",\n    coverageClaim:",
    "    expectedRecordCount: 237,\n    sheetName: \"（R1fy前期）補助金\",\n    dateRangeExceptions: [\n      { sheetName: \"（R1fy前期）補助金\", rowNumber: 191, raw: \"2018-06-29\", parsed: \"2018-06-29\" },\n    ],\n    expectedMissingCorporateNumberRows: [\n      { sheetName: \"（R1fy前期）補助金\", rowNumber: 158, raw: \"-\" },\n    ],\n    coverageClaim:",
)

replace_once(
    "scripts/update-official-data.mjs",
    "  if (document.expectedRecordCount !== undefined\n    && (!Number.isSafeInteger(document.expectedRecordCount) || records.length !== document.expectedRecordCount)) {\n    throw new Error(`${document.id}: XLSX掲載行数が検証済み値と一致しません (${records.length}/${document.expectedRecordCount})`);\n  }\n  Object.defineProperty(records, \"emptySentinelFound\", { value: emptySentinelFound, enumerable: false });",
    "  if (document.expectedRecordCount !== undefined\n    && (!Number.isSafeInteger(document.expectedRecordCount) || records.length !== document.expectedRecordCount)) {\n    throw new Error(`${document.id}: XLSX掲載行数が検証済み値と一致しません (${records.length}/${document.expectedRecordCount})`);\n  }\n  assertWorkbookDateRangeExceptions(records, document);\n  assertWorkbookCorporateNumberReceipts(records, document);\n  Object.defineProperty(records, \"emptySentinelFound\", { value: emptySentinelFound, enumerable: false });",
)
replace_once(
    "scripts/update-official-data.mjs",
    "  if (fiscalYearOfDate(date) !== document.fiscalYear) {\n    throw new Error(`${document.id}/${worksheet.name}/${rowNumber}行目: 日付が資料年度外です: ${normalizeText(dateRaw)}`);\n  }",
    "  if (fiscalYearOfDate(date) !== document.fiscalYear\n    && !isAllowedWorkbookDateRangeException(document, worksheet.name, rowNumber, normalizeText(dateRaw), date)) {\n    throw new Error(`${document.id}/${worksheet.name}/${rowNumber}行目: 日付が資料年度外です: ${normalizeText(dateRaw)}`);\n  }",
)
replace_once(
    "scripts/update-official-data.mjs",
    "function assertRequiredOfficialRowValues({ document, worksheet, rowNumber, program, organization, dateRaw }) {",
    """function isAllowedWorkbookDateRangeException(document, sheetName, rowNumber, raw, parsed) {
  return (document.dateRangeExceptions ?? []).some((exception) =>
    exception?.sheetName === sheetName
    && exception.rowNumber === rowNumber
    && exception.raw === raw
    && exception.parsed === parsed);
}

function assertWorkbookDateRangeExceptions(records, document) {
  const exceptions = document.dateRangeExceptions ?? [];
  if (!Array.isArray(exceptions)
    || exceptions.some((exception) => !exception
      || typeof exception.sheetName !== \"string\" || !exception.sheetName
      || !Number.isSafeInteger(exception.rowNumber) || exception.rowNumber < 1
      || typeof exception.raw !== \"string\" || !/^\\d{4}-\\d{2}-\\d{2}$/.test(exception.raw)
      || typeof exception.parsed !== \"string\" || !/^\\d{4}-\\d{2}-\\d{2}$/.test(exception.parsed))
    || new Set(exceptions.map((exception) => `${exception.sheetName}:${exception.rowNumber}`)).size !== exceptions.length) {
    throw new Error(`${document.id}: XLSX日付範囲例外receiptが不正です`);
  }
  for (const exception of exceptions) {
    const matches = records.filter((record) => record.sourceSheet === exception.sheetName
      && record.sourceRowNumber === exception.rowNumber
      && record.dateRaw === exception.raw
      && record.date === exception.parsed);
    if (matches.length !== 1) {
      throw new Error(`${document.id}: XLSX日付範囲例外が検証済み行と一致しません (${exception.sheetName}/${exception.rowNumber})`);
    }
  }
}

function assertWorkbookCorporateNumberReceipts(records, document) {
  if (document.expectedMissingCorporateNumberRows === undefined) return;
  const expected = document.expectedMissingCorporateNumberRows;
  if (!Array.isArray(expected)
    || expected.some((row) => !row
      || typeof row.sheetName !== \"string\" || !row.sheetName
      || !Number.isSafeInteger(row.rowNumber) || row.rowNumber < 1
      || typeof row.raw !== \"string\" || !row.raw)
    || new Set(expected.map((row) => `${row.sheetName}:${row.rowNumber}`)).size !== expected.length) {
    throw new Error(`${document.id}: XLSX法人番号未掲載receiptが不正です`);
  }
  const order = (left, right) => left.sheetName.localeCompare(right.sheetName, \"ja\") || left.rowNumber - right.rowNumber;
  const normalizedExpected = expected.map((row) => ({
    sheetName: row.sheetName,
    rowNumber: row.rowNumber,
    raw: row.raw,
  })).sort(order);
  const observed = records.filter((record) => record.corporateNumbers.length === 0).map((record) => ({
    sheetName: record.sourceSheet,
    rowNumber: record.sourceRowNumber,
    raw: record.corporateNumberRaw,
  })).sort(order);
  if (JSON.stringify(observed) !== JSON.stringify(normalizedExpected)) {
    throw new Error(`${document.id}: XLSX法人番号未掲載行が検証済みreceiptと一致しません`);
  }
}

function assertRequiredOfficialRowValues({ document, worksheet, rowNumber, program, organization, dateRaw }) {""",
)

replace_once(
    "tests/official-chubu-history.test.mjs",
    "  assert.equal(eraDates.find((record) => record.dateRaw === \"平成31年04月01日\")?.date, \"2019-04-01\");",
    "  assert.equal(eraDates.find((record) => record.dateRaw === \"平成31年04月01日\")?.date, \"2019-04-01\");\n  const priorYearReceipt = eraDates.find((record) => record.sourceRowNumber === 191);\n  assert.equal(priorYearReceipt?.dateRaw, \"2018-06-29\");\n  assert.equal(priorYearReceipt?.date, \"2018-06-29\");\n  assert.match(priorYearReceipt?.program ?? \"\", /平成３０年度電源立地地域対策交付金/);",
)
replace_once(
    "tests/official-chubu-history.test.mjs",
    "  assert.equal(records.filter((record) => record.fiscalYear === 2019 && !record.corporateNumber).length, 0);",
    """  const unlistedCorporateNumbers = records.filter((record) =>
    record.fiscalYear === 2019 && !record.corporateNumber);
  assert.deepEqual(unlistedCorporateNumbers.map((record) => ({
    datasetId: record.datasetId,
    sourceSheet: record.sourceSheet,
    sourceRowNumber: record.sourceRowNumber,
    organization: record.organization,
    corporateNumberRaw: record.corporateNumberRaw,
  })), [{
    datasetId: \"chubu-2019-grant-decisions-h1\",
    sourceSheet: \"（R1fy前期）補助金\",
    sourceRowNumber: 158,
    organization: \"越中福岡の菅笠振興会\",
    corporateNumberRaw: \"-\",
  }]);""",
)
replace_once(
    "tests/official-evidence-receipts.test.mjs",
    "assert.equal(evidenceDocuments.length, 366); // prior receipted sources + 6 Chubu FY2023 verified PDFs",
    "assert.equal(evidenceDocuments.length, 384); // prior receipted sources + 18 Chubu FY2019-FY2021 verified originals",
)

print("Applied asserted Chubu FY2019-FY2021 candidate fixes")
