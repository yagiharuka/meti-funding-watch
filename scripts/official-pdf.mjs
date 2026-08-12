import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

import { getDocument, Util } from "pdfjs-dist/legacy/build/pdf.mjs";

const STANDARD_FONT_DATA_URL = `${fileURLToPath(new URL("../node_modules/pdfjs-dist/standard_fonts/", import.meta.url))}/`;

const DATE_FORMATS = {
  western_ymd_ja: /^(\d{4})年(\d{1,2})月(\d{1,2})日$/,
  western_ymd_slash: /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/,
  reiwa_ymd_ja: /^令和([元\d]+)年(\d{1,2})月(\d{1,2})日$/,
};

/**
 * Parse only text PDFs whose table structure can be verified from positioned
 * text. No OCR, fuzzy column guessing or value repair is performed.
 */
export async function parseOfficialPdf(buffer, document) {
  validateDocumentDefinition(document);
  if (!Buffer.isBuffer(buffer) || buffer.length < 5 || buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error(`${document.id}: PDFシグネチャがありません`);
  }
  if (document.pdfSchema.expectedBytes && buffer.length !== document.pdfSchema.expectedBytes) {
    throw new Error(`${document.id}: PDFバイト数が検証済み値と一致しません (${buffer.length}/${document.pdfSchema.expectedBytes})`);
  }
  const expectedSha256 = document.pdfSchema.expectedSha256;
  if (expectedSha256 && sha256(buffer) !== expectedSha256) {
    throw new Error(`${document.id}: PDFのSHA-256が検証済み値と一致しません`);
  }

  const loadingTask = getDocument({
    data: new Uint8Array(buffer),
    disableFontFace: true,
    isEvalSupported: false,
    standardFontDataUrl: STANDARD_FONT_DATA_URL,
    useSystemFonts: false,
  });
  let pdf;
  try {
    pdf = await loadingTask.promise;
    const schema = document.pdfSchema;
    if (pdf.numPages !== schema.expectedPageCount) {
      throw new Error(`${document.id}: PDFページ数が検証済み値と一致しません (${pdf.numPages}/${schema.expectedPageCount})`);
    }
    if (await pdf.getPermissions() !== null) {
      throw new Error(`${document.id}: 暗号化または権限制限されたPDFは取り込みません`);
    }
    const records = [];
    let emptySentinelFound = false;
    let positionedTextItemCount = 0;
    let firstPageColumns = null;
    const parsingState = schemaUsesAlignedAmountRows(schema)
      ? { mode: "aligned_amount_rows", recipientCounts: new Map(), emptyFragments: [] }
      : schemaUsesDateAnchorRows(schema) ? { mode: "date_anchor_rows", nextRowNumber: 0 } : null;
    const splitRuleCounts = new Map((schema.crossColumnSplitRules ?? []).map((rule) => [rule.id, 0]));
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      assertPageSize(viewport, schema.expectedPageSize, document.id, pageNumber);
      const textContent = await page.getTextContent({ disableNormalization: false, includeMarkedContent: false });
      const items = extractPositionedItems(textContent.items, viewport, document, pageNumber, splitRuleCounts);
      positionedTextItemCount += items.length;
      const pageResult = parsePage(items, viewport, document, pageNumber, firstPageColumns, parsingState);
      if (pageNumber === 1 && schema.headersOnFirstPageOnly) firstPageColumns = pageResult.columns;
      if (pageResult.records.length !== schema.expectedRowsPerPage[pageNumber - 1]) {
        throw new Error(`${document.id}/p.${pageNumber}: ページ内掲載行数が検証済み値と一致しません (${pageResult.records.length}/${schema.expectedRowsPerPage[pageNumber - 1]})`);
      }
      records.push(...pageResult.records);
      emptySentinelFound ||= pageResult.emptySentinelFound;
      page.cleanup();
    }
    if (positionedTextItemCount < schema.minimumPositionedTextItems) {
      throw new Error(`${document.id}: 位置付き文字要素が不足しています (${positionedTextItemCount}/${schema.minimumPositionedTextItems})`);
    }
    if (schema.expectedPositionedTextItemCount !== undefined && positionedTextItemCount !== schema.expectedPositionedTextItemCount) {
      throw new Error(`${document.id}: 位置付き文字要素数が検証済み値と一致しません (${positionedTextItemCount}/${schema.expectedPositionedTextItemCount})`);
    }
    for (const rule of schema.crossColumnSplitRules ?? []) {
      const observed = splitRuleCounts.get(rule.id);
      if (observed !== rule.expectedMatches) {
        throw new Error(`${document.id}: PDF列跨ぎ分割数が検証済み値と一致しません (${rule.id}:${observed}/${rule.expectedMatches})`);
      }
    }
    if (records.length !== schema.expectedRecordCount) {
      throw new Error(`${document.id}: PDF掲載行数が検証済み値と一致しません (${records.length}/${schema.expectedRecordCount})`);
    }
    if (!records.length && !emptySentinelFound) {
      throw new Error(`${document.id}: 0件を示す所定表記がありません`);
    }
    if (records.length) {
      if (parsingState?.mode === "aligned_amount_rows") {
        assertAlignedAmountRows(records, schema, parsingState, document.id);
      }
      else assertExpectedRowNumbers(records, schema.expectedRowNumbers, document.id);
    }
    Object.defineProperty(records, "emptySentinelFound", { value: emptySentinelFound, enumerable: false });
    return records;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(`${document.id}:`)) throw error;
    const message = error instanceof Error ? error.message : "原因不明";
    throw new Error(`${document.id}: 文字PDFを検証できませんでした (${message})`);
  } finally {
    await loadingTask.destroy().catch(() => {});
  }
}

function validateDocumentDefinition(document) {
  if (!document?.id || document.format !== "pdf" || !document.pdfSchema) {
    throw new Error(`${document?.id ?? "(不明)"}: PDF資料定義が不正です`);
  }
  const schema = document.pdfSchema;
  if (
    schema.schemaVersion !== 1
    || schema.extractionMode !== "positioned_text_only"
    || !Number.isSafeInteger(schema.expectedPageCount) || schema.expectedPageCount < 1
    || !schema.expectedPageSize || !Number.isFinite(schema.expectedPageSize.width) || schema.expectedPageSize.width <= 0
    || !Number.isFinite(schema.expectedPageSize.height) || schema.expectedPageSize.height <= 0
    || !Number.isFinite(schema.expectedPageSize.tolerance) || schema.expectedPageSize.tolerance < 0
    || !Array.isArray(schema.expectedRowsPerPage) || schema.expectedRowsPerPage.length !== schema.expectedPageCount
    || schema.expectedRowsPerPage.some((count) => !Number.isSafeInteger(count) || count < 0)
    || schema.expectedRowsPerPage.reduce((sum, count) => sum + count, 0) !== schema.expectedRecordCount
    || !Number.isSafeInteger(schema.expectedRecordCount) || schema.expectedRecordCount < 0
    || (schema.expectedBytes !== undefined && (!Number.isSafeInteger(schema.expectedBytes) || schema.expectedBytes < 1))
    || !Number.isSafeInteger(schema.minimumPositionedTextItems) || schema.minimumPositionedTextItems < 1
    || (schema.expectedPositionedTextItemCount !== undefined
      && (!Number.isSafeInteger(schema.expectedPositionedTextItemCount) || schema.expectedPositionedTextItemCount < schema.minimumPositionedTextItems))
    || (schema.bodyMinimumYRatio !== undefined
      && (!Number.isFinite(schema.bodyMinimumYRatio) || schema.bodyMinimumYRatio < 0 || schema.bodyMinimumYRatio >= 0.5))
    || (schema.corporateNumberOmitted !== undefined && typeof schema.corporateNumberOmitted !== "boolean")
    || (schema.amountMissingSentinels !== undefined
      && (!Array.isArray(schema.amountMissingSentinels)
        || schema.amountMissingSentinels.some((value) => typeof value !== "string" || !value.trim())))
    || (schema.cellAssignmentCoordinate !== undefined && !["center", "left"].includes(schema.cellAssignmentCoordinate))
    || (schema.expectedBlankRowsPerPage !== undefined
      && (!Array.isArray(schema.expectedBlankRowsPerPage)
        || schema.expectedBlankRowsPerPage.length !== schema.expectedPageCount
        || schema.expectedBlankRowsPerPage.some((rows) => !Array.isArray(rows)
          || rows.some((value) => !Number.isSafeInteger(value) || value < 1)
          || new Set(rows).size !== rows.length)))
    || (schema.headersOnFirstPageOnly !== undefined && typeof schema.headersOnFirstPageOnly !== "boolean")
    || (schema.normalizeCompatibilityText !== undefined && typeof schema.normalizeCompatibilityText !== "boolean")
    || (schema.recordGranularity !== undefined
      && !["aligned_amount_rows", "date_anchor_rows"].includes(schema.recordGranularity))
    || (schema.joinDateAnchorFragments !== undefined && typeof schema.joinDateAnchorFragments !== "boolean")
    || (schema.expectedSplitOrdinalFragments !== undefined
      && (!Array.isArray(schema.expectedSplitOrdinalFragments)
        || schema.expectedSplitOrdinalFragments.some((fragment) => !fragment
          || !Number.isSafeInteger(fragment.page) || fragment.page < 1 || fragment.page > schema.expectedPageCount
          || !Number.isSafeInteger(fragment.ordinal) || fragment.ordinal < 1)))
    || (schema.expectedPartyCountsByOrdinal !== undefined
      && (!schema.expectedPartyCountsByOrdinal || typeof schema.expectedPartyCountsByOrdinal !== "object"
        || Array.isArray(schema.expectedPartyCountsByOrdinal)
        || Object.entries(schema.expectedPartyCountsByOrdinal).some(([ordinal, count]) => !/^\d+$/.test(ordinal)
          || !Number.isSafeInteger(count) || count < 1)))
    || (schema.expectedMissingCorporateNumberCount !== undefined
      && (!Number.isSafeInteger(schema.expectedMissingCorporateNumberCount)
        || schema.expectedMissingCorporateNumberCount < 0))
    || (schema.rowBoundaryOverrides !== undefined
      && (!Array.isArray(schema.rowBoundaryOverrides)
        || schema.rowBoundaryOverrides.some((override) => !override
          || !Number.isSafeInteger(override.page) || override.page < 1 || override.page > schema.expectedPageCount
          || !Number.isSafeInteger(override.upperOrdinal) || override.upperOrdinal < 1
          || !Number.isSafeInteger(override.lowerOrdinal) || override.lowerOrdinal < 1
          || override.upperOrdinal === override.lowerOrdinal
          || !Number.isFinite(override.yRatio) || override.yRatio <= 0 || override.yRatio >= 1)))
    || (schema.rowAnchorMode !== undefined && !["ordinal", "date"].includes(schema.rowAnchorMode))
    || !Array.isArray(schema.columns) || schema.columns.length < 6
    || new Set(schema.columns.map((column) => column.key)).size !== schema.columns.length
    || schema.columns.some((column) => !column.key || !Array.isArray(column.headerAliases) || !column.headerAliases.length
      || !Number.isFinite(column.leftRatio) || column.leftRatio < 0 || column.leftRatio >= 1)
    || !schema.recordMapping || !Array.isArray(schema.requiredPageText) || !Array.isArray(schema.requiredFirstPageText ?? [])
    || !Array.isArray(schema.allowedDateFormats) || !schema.allowedDateFormats.length
    || schema.allowedDateFormats.some((format) => !(format in DATE_FORMATS))
  ) throw new Error(`${document.id}: PDF表スキーマが不正です`);
  if (schemaUsesAlignedAmountRows(schema)
    && (!schema.expectedPartyCountsByOrdinal || !Array.isArray(schema.expectedSplitOrdinalFragments)
      || !Number.isSafeInteger(schema.expectedMissingCorporateNumberCount)
      || !Array.isArray(schema.rowBoundaryOverrides))) {
    throw new Error(`${document.id}: 金額行単位PDFの検証receiptが不完全です`);
  }
  if (schema.columns.some((column, index) => index > 0 && column.leftRatio <= schema.columns[index - 1].leftRatio)) {
    throw new Error(`${document.id}: PDF列境界が昇順ではありません`);
  }
  const keys = new Set(schema.columns.map((column) => column.key));
  const requiredMapping = ["programColumn", "organizationColumn", "amountColumn", "dateColumn"];
  if (!schemaUsesDateAnchorRows(schema)) requiredMapping.push("ordinalColumn");
  if (!schema.corporateNumberOmitted) requiredMapping.push("corporateNumberColumn");
  if (requiredMapping.some((field) => !keys.has(schema.recordMapping[field]))) {
    throw new Error(`${document.id}: PDF列対応が不正です`);
  }
  if (schema.corporateNumberOmitted && schema.recordMapping.corporateNumberColumn !== undefined) {
    throw new Error(`${document.id}: 法人番号欄省略資料に法人番号列対応を指定できません`);
  }
  if ((schema.recordMapping.notesColumns ?? []).some((key) => !keys.has(key))) {
    throw new Error(`${document.id}: PDF備考列対応が不正です`);
  }
  if (schema.recordMapping.methodColumn !== undefined && !keys.has(schema.recordMapping.methodColumn)) {
    throw new Error(`${document.id}: PDF契約方式列対応が不正です`);
  }
  const splitRuleIds = new Set();
  for (const rule of schema.crossColumnSplitRules ?? []) {
    if (
      !rule.id || splitRuleIds.has(rule.id) || !["amount_then_text", "date_then_text"].includes(rule.kind)
      || !keys.has(rule.fromColumn) || !keys.has(rule.toColumn)
      || !Number.isSafeInteger(rule.expectedMatches) || rule.expectedMatches < 1
    ) throw new Error(`${document.id}: PDF列跨ぎ分割規則が不正です`);
    splitRuleIds.add(rule.id);
  }
  if (!schema.dateRange?.start || !schema.dateRange?.end || schema.dateRange.start > schema.dateRange.end) {
    throw new Error(`${document.id}: PDF日付範囲が不正です`);
  }
  if (schema.expectedSha256 && !/^[0-9a-f]{64}$/.test(schema.expectedSha256)) {
    throw new Error(`${document.id}: PDFの期待SHA-256が不正です`);
  }
  if (document.category === "contract_result" && !document.amountStage.includes("契約")) {
    throw new Error(`${document.id}: 契約資料の金額段階が不正です`);
  }
  if (document.category === "grant_decision" && !document.amountStage.includes("交付決定")) {
    throw new Error(`${document.id}: 交付決定資料の金額段階が不正です`);
  }
}

function extractPositionedItems(rawItems, viewport, document, pageNumber, splitRuleCounts) {
  const items = [];
  for (const raw of rawItems) {
    if (!raw || typeof raw.str !== "string" || !raw.str.trim()) continue;
    const text = raw.str.normalize(document.pdfSchema.normalizeCompatibilityText ? "NFKC" : "NFC");
    if (/\uFFFD|[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u.test(text)) {
      throw new Error(`${document.id}/p.${pageNumber}: 置換文字または制御文字を検出しました`);
    }
    const rawTransform = raw.transform ?? [];
    const [scaleX, skewY, skewX, scaleY] = rawTransform;
    const [, , transformedSkewX, transformedScaleY, transformedX, transformedTopY] = Util.transform(viewport.transform, rawTransform);
    const x = transformedX;
    const y = viewport.height - transformedTopY;
    const width = Number(raw.width);
    const height = Math.max(Math.hypot(transformedSkewX, transformedScaleY), Math.abs(Number(raw.height)), 1);
    if (![scaleX, skewY, skewX, scaleY, x, y, width, height].every(Number.isFinite)) {
      throw new Error(`${document.id}/p.${pageNumber}: 文字座標が不正です`);
    }
    const centerX = x + Math.max(width, 0) / 2;
    const centerY = y + height / 2;
    if (x < -1 || y < -1 || centerX > viewport.width + 1 || centerY > viewport.height + 1) {
      throw new Error(`${document.id}/p.${pageNumber}: 文字座標がページ外です`);
    }
    const positioned = { text, x, y, width: Math.max(width, 0), height, centerX, centerY };
    const split = splitCrossColumnItem(positioned, viewport, document.pdfSchema, splitRuleCounts);
    items.push(...split);
  }
  return items;
}

function splitCrossColumnItem(item, viewport, schema, splitRuleCounts) {
  for (const rule of schema.crossColumnSplitRules ?? []) {
    const fromIndex = schema.columns.findIndex((column) => column.key === rule.fromColumn);
    const toIndex = schema.columns.findIndex((column) => column.key === rule.toColumn);
    if (toIndex !== fromIndex + 1) continue;
    const fromLeft = schema.columns[fromIndex].leftRatio * viewport.width;
    const toLeft = schema.columns[toIndex].leftRatio * viewport.width;
    const toRight = (schema.columns[toIndex + 1]?.leftRatio ?? 1) * viewport.width;
    if (item.x < fromLeft || item.x >= toLeft || item.x + item.width <= toLeft) continue;
    const normalized = normalizeCellText(item.text);
    const match = rule.kind === "date_then_text"
      ? normalized.match(/^((?:\d{4}年|令和[元\d]+年)\d{1,2}月\d{1,2}日)\s*(\S.*)$/u)
      : normalized.match(/^(0|[1-9]\d{0,2}(?:,\d{3})*)\s+(\S.*)$/u);
    if (!match) continue;
    splitRuleCounts.set(rule.id, (splitRuleCounts.get(rule.id) ?? 0) + 1);
    const firstWidth = Math.max(0.1, toLeft - item.x - 0.1);
    const secondX = toLeft + 0.1;
    const secondWidth = Math.max(0.1, Math.min(item.x + item.width, toRight) - secondX);
    return [
      { ...item, text: match[1], width: firstWidth, centerX: item.x + firstWidth / 2 },
      { ...item, text: match[2], x: secondX, width: secondWidth, centerX: secondX + secondWidth / 2 },
    ];
  }
  return [item];
}

function assertPageSize(viewport, expected, documentId, pageNumber) {
  if (Math.abs(viewport.width - expected.width) > expected.tolerance || Math.abs(viewport.height - expected.height) > expected.tolerance) {
    throw new Error(`${documentId}/p.${pageNumber}: ページ寸法が検証済み値と一致しません (${viewport.width}x${viewport.height})`);
  }
}

function parsePage(items, viewport, document, pageNumber, firstPageColumns = null, parsingState = null) {
  const schema = document.pdfSchema;
  if (!items.length) throw new Error(`${document.id}/p.${pageNumber}: 文字要素がありません（OCRは実行しません）`);
  const normalizedPageText = normalizeMatchText(items.map((item) => item.text).join(""));
  for (const required of schema.requiredPageText) {
    if (!normalizedPageText.includes(normalizeMatchText(required))) {
      throw new Error(`${document.id}/p.${pageNumber}: 必須表題がありません (${required})`);
    }
  }
  if (pageNumber === 1) {
    for (const required of schema.requiredFirstPageText ?? []) {
      if (!normalizedPageText.includes(normalizeMatchText(required))) {
        throw new Error(`${document.id}/p.1: 初頁の必須表題がありません (${required})`);
      }
    }
  }
  const columns = pageNumber > 1 && schema.headersOnFirstPageOnly
    ? reuseFirstPageColumns(firstPageColumns, viewport, document, pageNumber)
    : locateHeaders(items, viewport, schema, document, pageNumber);
  const rowAnchors = parsingState?.mode === "date_anchor_rows"
    ? dateRowAnchors(items, columns, schema, parsingState)
    : ordinalRowAnchors(items, columns, schema);

  if (!rowAnchors.length) {
    const sentinel = (schema.emptySentinels ?? []).find((value) => normalizedPageText.includes(normalizeMatchText(value)));
    if (schema.expectedRecordCount === 0 && sentinel) return { records: [], emptySentinelFound: true, columns };
    throw new Error(`${document.id}/p.${pageNumber}: 掲載番号行がありません`);
  }
  const seenOrdinals = new Set();
  for (const anchor of rowAnchors) {
    if (seenOrdinals.has(anchor.ordinal)) throw new Error(`${document.id}/p.${pageNumber}: 掲載番号が重複しています (${anchor.ordinal})`);
    seenOrdinals.add(anchor.ordinal);
  }
  const pageRows = [];
  const expectedBlankRows = new Set(schema.expectedBlankRowsPerPage?.[pageNumber - 1] ?? []);
  const observedBlankRows = new Set();
  for (let index = 0; index < rowAnchors.length; index += 1) {
    const anchor = rowAnchors[index];
    const top = index === 0 ? columns.headerBottom : rowBoundary(
      schema, pageNumber, rowAnchors[index - 1], anchor, viewport.height,
    );
    const bottom = index === rowAnchors.length - 1 ? 0 : rowBoundary(
      schema, pageNumber, anchor, rowAnchors[index + 1], viewport.height,
    );
    const bodyBottom = Math.max(bottom, (schema.bodyMinimumYRatio ?? 0) * viewport.height);
    const rowItems = items.filter((item) => item.centerY < top && item.centerY >= bodyBottom);
    const cells = Object.fromEntries(columns.map((column) => [
      column.key,
      makeCell(rowItems.filter((item) => {
        const coordinate = schema.cellAssignmentCoordinate === "left" ? item.x : item.centerX;
        return coordinate >= column.left && coordinate < column.right;
      })),
    ]));
    if (expectedBlankRows.has(anchor.ordinal)) {
      const nonOrdinalValues = Object.entries(cells)
        .filter(([key]) => key !== schema.recordMapping.ordinalColumn)
        .map(([, cell]) => normalizeMultilineCell(cell.text))
        .filter(Boolean);
      if (nonOrdinalValues.length) {
        throw new Error(`${document.id}/p.${pageNumber}/no.${anchor.ordinal}: 検証済み空欄行に値があります`);
      }
      observedBlankRows.add(anchor.ordinal);
      continue;
    }
    if (parsingState?.mode === "aligned_amount_rows") {
      pageRows.push(...makeAlignedAmountRecords(
        document, schema, cells, anchor.ordinal, pageNumber, parsingState,
      ));
    } else {
      pageRows.push(makeRecord(document, schema, cells, anchor.ordinal, pageNumber));
    }
  }
  if (observedBlankRows.size !== expectedBlankRows.size) {
    throw new Error(`${document.id}/p.${pageNumber}: 検証済み空欄行が一致しません`);
  }
  return { records: pageRows, emptySentinelFound: false, columns };
}

function ordinalRowAnchors(items, columns, schema) {
  const ordinalColumn = columns.find((column) => column.key === schema.recordMapping.ordinalColumn);
  return items
    .filter((item) => item.centerY < columns.headerBottom - 0.5)
    .filter((item) => item.centerX >= ordinalColumn.left && item.centerX < ordinalColumn.right)
    .filter((item) => /^\d+$/.test(normalizeCellText(item.text)))
    .map((item) => ({ ...item, ordinal: Number(normalizeCellText(item.text)) }))
    .filter((item) => Number.isSafeInteger(item.ordinal) && item.ordinal > 0)
    .sort((a, b) => b.centerY - a.centerY);
}

function dateRowAnchors(items, columns, schema, state) {
  const dateColumn = columns.find((column) => column.key === schema.recordMapping.dateColumn);
  const dateItems = items
    .filter((item) => item.centerY < columns.headerBottom - 0.5)
    .filter((item) => item.centerX >= dateColumn.left && item.centerX < dateColumn.right);
  const anchors = (schema.joinDateAnchorFragments
    ? dateItems.filter((item) => {
      const raw = compactCell(item.text);
      if (matchesAllowedDate(raw, schema.allowedDateFormats)) return true;
      if (!/^\d{4}年\d{1,2}月\d{1,2}$/.test(raw)) return false;
      return dateItems.some((suffix) => compactCell(suffix.text) === "日"
        && Math.abs(suffix.x - item.x) <= 1
        && suffix.centerY < item.centerY
        && item.centerY - suffix.centerY <= Math.max(12, item.height * 1.5));
    })
    : dateItems.filter((item) => matchesAllowedDate(compactCell(item.text), schema.allowedDateFormats)))
    .sort((a, b) => b.centerY - a.centerY);
  return anchors.map((anchor) => ({ ...anchor, ordinal: ++state.nextRowNumber }));
}

function rowBoundary(schema, pageNumber, upperAnchor, lowerAnchor, pageHeight) {
  const overrides = (schema.rowBoundaryOverrides ?? []).filter((override) =>
    override.page === pageNumber
    && override.upperOrdinal === upperAnchor.ordinal
    && override.lowerOrdinal === lowerAnchor.ordinal);
  if (overrides.length > 1) throw new Error("PDF行境界overrideが重複しています");
  return overrides.length === 1
    ? overrides[0].yRatio * pageHeight
    : (upperAnchor.centerY + lowerAnchor.centerY) / 2;
}

function reuseFirstPageColumns(firstPageColumns, viewport, document, pageNumber) {
  if (!Array.isArray(firstPageColumns) || !firstPageColumns.length) {
    throw new Error(`${document.id}/p.${pageNumber}: 初頁の検証済み列境界がありません`);
  }
  const columns = firstPageColumns.map((column) => ({ ...column }));
  columns.headerBottom = viewport.height;
  return columns;
}

function locateHeaders(items, viewport, schema, document, pageNumber) {
  const headerBand = items.filter((item) => item.centerY >= viewport.height * 0.5);
  const located = schema.columns.map((column) => {
    const candidates = headerBand.filter((item) => column.headerAliases.some((alias) =>
      normalizeMatchText(item.text) === normalizeMatchText(alias)));
    if (candidates.length !== 1) {
      throw new Error(`${document.id}/p.${pageNumber}: 見出しを一意に特定できません (${column.key}:${candidates.length})`);
    }
    return { ...column, item: candidates[0], anchorX: candidates[0].centerX };
  });
  for (let index = 1; index < located.length; index += 1) {
    if (located[index].anchorX <= located[index - 1].anchorX + viewport.width * 0.004) {
      throw new Error(`${document.id}/p.${pageNumber}: 見出しの列順または間隔が不正です`);
    }
  }
  const withBounds = located.map((column, index) => ({
    ...column,
    left: column.leftRatio * viewport.width,
    right: index === located.length - 1 ? viewport.width + 0.01 : located[index + 1].leftRatio * viewport.width,
  }));
  for (const column of withBounds) {
    if (column.anchorX < column.left || column.anchorX >= column.right) {
      throw new Error(`${document.id}/p.${pageNumber}: 見出し座標が検証済み列境界の外です (${column.key})`);
    }
  }
  withBounds.headerBottom = Math.min(...located.map((column) => column.item.y)) - 0.5;
  return withBounds;
}

function makeCell(items) {
  const lines = [];
  for (const item of [...items].sort((a, b) => b.centerY - a.centerY || a.x - b.x)) {
    let line = lines.find((candidate) => Math.abs(candidate.y - item.centerY) <= Math.max(1.5, item.height * 0.35));
    if (!line) {
      line = { y: item.centerY, items: [] };
      lines.push(line);
    }
    line.items.push(item);
  }
  lines.sort((a, b) => b.y - a.y);
  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x);
    line.text = joinLineItems(line.items);
  }
  return { lines, text: lines.map((line) => line.text).filter(Boolean).join("\n") };
}

function joinLineItems(items) {
  let result = "";
  let previous = null;
  for (const item of items) {
    const text = item.text.replace(/[\r\n\t]+/g, " ").trim();
    if (!text) continue;
    const gap = previous ? item.x - (previous.x + previous.width) : 0;
    const needsSpace = previous && gap > Math.max(1, previous.height * 0.12)
      && /[A-Za-z0-9)]$/.test(result) && /^[A-Za-z0-9(]/.test(text);
    result += `${needsSpace ? " " : ""}${text}`;
    previous = item;
  }
  return normalizeCellText(result);
}

function makeAlignedAmountRecords(document, schema, cells, ordinal, pageNumber, state) {
  const mapping = schema.recordMapping;
  const amountLines = cells[mapping.amountColumn].lines;
  if (!amountLines.length) {
    if (!normalizeMultilineCell(cells[mapping.programColumn].text)) {
      throw new Error(`${document.id}/p.${pageNumber}/no.${ordinal}: 分割掲載行の事業名が空です`);
    }
    state.emptyFragments.push({ page: pageNumber, ordinal });
    return [];
  }
  for (const line of amountLines) {
    if (!/^(?:0|[1-9]\d{0,2}(?:,\d{3})*)$/.test(compactCell(line.text))) {
      throw new Error(`${document.id}/p.${pageNumber}/no.${ordinal}: 金額行を一意に分割できません`);
    }
  }
  const anchors = amountLines.map((line) => line.y).sort((left, right) => right - left);
  const records = [];
  for (const anchorY of anchors) {
    const partyCells = Object.fromEntries(Object.entries(cells).map(([key, cell]) => {
      if (key === mapping.ordinalColumn || key === mapping.programColumn) return [key, cell];
      return [key, sliceCellAtAnchor(cell, anchors, anchorY)];
    }));
    const recipientIndex = (state.recipientCounts.get(ordinal) ?? 0) + 1;
    state.recipientCounts.set(ordinal, recipientIndex);
    records.push(makeRecord(
      document, schema, partyCells, ordinal, pageNumber, `:recipient-${recipientIndex}`,
    ));
  }
  return records;
}

function sliceCellAtAnchor(cell, anchors, anchorY) {
  const lines = cell.lines.filter((line) => {
    let nearest = anchors[0];
    let distance = Math.abs(line.y - nearest);
    for (let index = 1; index < anchors.length; index += 1) {
      const candidateDistance = Math.abs(line.y - anchors[index]);
      if (candidateDistance < distance) {
        nearest = anchors[index];
        distance = candidateDistance;
      }
    }
    return nearest === anchorY;
  });
  return { lines, text: lines.map((line) => line.text).filter(Boolean).join("\n") };
}

function makeRecord(document, schema, cells, ordinal, pageNumber, sourceKeySuffix = "") {
  const mapping = schema.recordMapping;
  const program = normalizeMultilineCell(cells[mapping.programColumn].text);
  const organizationCell = cells[mapping.organizationColumn];
  const corporateNumberCell = schema.corporateNumberOmitted ? null : cells[mapping.corporateNumberColumn];
  const dateRaw = compactCell(cells[mapping.dateColumn].text);
  const amountRaw = compactCell(cells[mapping.amountColumn].text);
  if (!program) throw new Error(`${document.id}/no.${ordinal}: 事業名・契約件名が空です`);
  if (!normalizeMultilineCell(organizationCell.text)) throw new Error(`${document.id}/no.${ordinal}: 交付先・契約相手が空です`);
  const date = parseStrictDate(dateRaw, schema.allowedDateFormats, document.id, ordinal);
  if (date < schema.dateRange.start || date > schema.dateRange.end) {
    throw new Error(`${document.id}/no.${ordinal}: 日付が資料の対象期間外です (${dateRaw})`);
  }
  const amount = parseStrictAmount(amountRaw, schema.amountMissingSentinels, document.id, ordinal);
  const corporate = schema.corporateNumberOmitted
    ? { raw: "", numbers: [], anchors: [] }
    : parseCorporateNumbers(corporateNumberCell, schema, document.id, ordinal);
  const organizations = schema.corporateNumberOmitted
    ? [normalizeMultilineCell(organizationCell.text)]
    : partitionOrganizations(organizationCell, corporate.anchors, corporate.numbers, document.id, ordinal);
  const notes = (mapping.notesColumns ?? [])
    .map((key) => normalizeMultilineCell(cells[key].text))
    .filter(Boolean)
    .join("／");
  const method = mapping.methodColumn
    ? normalizeMultilineCell(cells[mapping.methodColumn].text)
    : document.kind;
  if (!method) throw new Error(`${document.id}/no.${ordinal}: 契約方式・随意契約理由が空です`);
  const sourceKey = `${document.id}:no-${ordinal}${sourceKeySuffix}`;
  return {
    id: `official-${sha256(sourceKey).slice(0, 20)}`,
    sourceKey,
    datasetId: document.id,
    category: document.category,
    kind: document.kind,
    amountStage: document.amountStage,
    executorId: document.executorId,
    executorName: document.executorName,
    fiscalYear: document.fiscalYear,
    date,
    dateRaw,
    organization: organizations.join("\n"),
    organizations,
    corporateNumber: corporate.numbers.length === 1 ? corporate.numbers[0] : null,
    corporateNumbers: corporate.numbers,
    corporateNumberRaw: corporate.raw,
    multiplePartyListing: organizations.length > 1 || corporate.numbers.length > 1,
    program,
    amount,
    amountRaw,
    method,
    notes,
    sourcePageUrl: document.sourcePageUrl,
    sourceDocumentUrl: document.originalUrl ?? document.url,
    sourceSheet: `PDF ${pageNumber}/${schema.expectedPageCount}`,
    sourceRowNumber: ordinal,
  };
}

function parseStrictDate(raw, allowedFormats, documentId, ordinal) {
  for (const format of allowedFormats) {
    const match = raw.match(DATE_FORMATS[format]);
    if (!match) continue;
    const year = format === "reiwa_ymd_ja"
      ? 2018 + (match[1] === "元" ? 1 : Number(match[1]))
      : Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) break;
    return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  throw new Error(`${documentId}/no.${ordinal}: 日付形式が不正です (${raw || "空"})`);
}

function matchesAllowedDate(raw, allowedFormats) {
  return allowedFormats.some((format) => DATE_FORMATS[format].test(raw));
}

function parseStrictAmount(raw, missingSentinels = [], documentId, ordinal) {
  if (missingSentinels.map(compactCell).includes(compactCell(raw))) return null;
  if (!/^(?:0|[1-9]\d{0,2}(?:,\d{3})*)$/.test(raw)) {
    throw new Error(`${documentId}/no.${ordinal}: 金額欄の掲載値が不正です (${raw || "空"})`);
  }
  const amount = Number(raw.replaceAll(",", ""));
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new Error(`${documentId}/no.${ordinal}: 金額欄が安全な整数ではありません`);
  }
  return amount;
}

function parseCorporateNumbers(cell, schema, documentId, ordinal) {
  const raw = normalizeMultilineCell(cell.text);
  const compact = compactCell(raw);
  if ((schema.corporateNumberMissingSentinels ?? []).map(compactCell).includes(compact)) {
    return { raw, numbers: [], anchors: [] };
  }
  const numbers = compact.match(/\d{13}/g) ?? [];
  if (!numbers.length || numbers.join("") !== compact || new Set(numbers).size !== numbers.length) {
    throw new Error(`${documentId}/no.${ordinal}: 法人番号欄が不正です (${raw || "空"})`);
  }
  const anchors = [];
  for (const line of cell.lines) {
    const lineNumbers = compactCell(line.text).match(/\d{13}/g) ?? [];
    if (lineNumbers.length > 1) {
      throw new Error(`${documentId}/no.${ordinal}: 複数法人番号の行対応を座標から判定できません`);
    }
    if (lineNumbers.length === 1) anchors.push({ number: lineNumbers[0], y: line.y });
  }
  if (anchors.length !== numbers.length || anchors.map((item) => item.number).join("") !== numbers.join("")) {
    throw new Error(`${documentId}/no.${ordinal}: 法人番号の座標対応が不正です`);
  }
  return { raw, numbers, anchors };
}

function partitionOrganizations(cell, corporateAnchors, corporateNumbers, documentId, ordinal) {
  if (corporateNumbers.length <= 1) return [normalizeMultilineCell(cell.text)];
  const anchors = [...corporateAnchors].sort((a, b) => b.y - a.y);
  const groups = anchors.map(() => []);
  for (const line of cell.lines) {
    let nearest = 0;
    let distance = Infinity;
    for (let index = 0; index < anchors.length; index += 1) {
      const candidate = Math.abs(line.y - anchors[index].y);
      if (candidate < distance) { distance = candidate; nearest = index; }
    }
    groups[nearest].push(line);
  }
  const organizations = groups.map((group) => normalizeMultilineCell(
    group.sort((a, b) => b.y - a.y).map((line) => line.text).join("\n"),
  ));
  if (organizations.some((organization) => !organization)) {
    throw new Error(`${documentId}/no.${ordinal}: 複数当事者の名称と法人番号を対応付けられません`);
  }
  return organizations;
}

function assertExpectedRowNumbers(records, expected, documentId, allowRepeats = false) {
  if (!expected || !Number.isSafeInteger(expected.start) || !Number.isSafeInteger(expected.end) || expected.end < expected.start) {
    throw new Error(`${documentId}: 期待掲載番号の定義が不正です`);
  }
  const observedValues = records.map((record) => record.sourceRowNumber);
  const observed = (allowRepeats ? [...new Set(observedValues)] : observedValues).sort((a, b) => a - b);
  const wanted = Array.from({ length: expected.end - expected.start + 1 }, (_, index) => expected.start + index);
  if (observed.length !== wanted.length || observed.some((value, index) => value !== wanted[index])) {
    throw new Error(`${documentId}: 掲載番号が連続した検証済み範囲と一致しません`);
  }
}

function schemaUsesAlignedAmountRows(schema) {
  return schema.recordGranularity === "aligned_amount_rows";
}

function schemaUsesDateAnchorRows(schema) {
  return schema.recordGranularity === "date_anchor_rows" || schema.rowAnchorMode === "date";
}

function assertAlignedAmountRows(records, schema, state, documentId) {
  assertExpectedRowNumbers(records, schema.expectedRowNumbers, documentId, true);
  const expectedFragments = schema.expectedSplitOrdinalFragments
    .map(({ page, ordinal }) => `${page}:${ordinal}`).sort();
  const observedFragments = state.emptyFragments
    .map(({ page, ordinal }) => `${page}:${ordinal}`).sort();
  if (observedFragments.length !== expectedFragments.length
    || observedFragments.some((value, index) => value !== expectedFragments[index])) {
    throw new Error(`${documentId}: 改ページ分割された掲載番号が検証済みreceiptと一致しません`);
  }
  const { start, end } = schema.expectedRowNumbers;
  for (const ordinal of Object.keys(schema.expectedPartyCountsByOrdinal).map(Number)) {
    if (ordinal < start || ordinal > end) {
      throw new Error(`${documentId}: 複数交付先receiptの掲載番号が範囲外です`);
    }
  }
  for (let ordinal = start; ordinal <= end; ordinal += 1) {
    const expected = schema.expectedPartyCountsByOrdinal[String(ordinal)] ?? 1;
    const observed = state.recipientCounts.get(ordinal) ?? 0;
    if (observed !== expected) {
      throw new Error(`${documentId}/no.${ordinal}: 交付先別金額行数が検証済み値と一致しません (${observed}/${expected})`);
    }
  }
  const missingCorporateNumbers = records.filter((record) => record.corporateNumbers.length === 0).length;
  if (missingCorporateNumbers !== schema.expectedMissingCorporateNumberCount) {
    throw new Error(`${documentId}: 法人番号空欄行数が検証済み値と一致しません (${missingCorporateNumbers}/${schema.expectedMissingCorporateNumberCount})`);
  }
}

function normalizeMultilineCell(value) {
  const lines = String(value ?? "").split(/\n+/).map(normalizeCellText).filter(Boolean);
  return lines.reduce((result, line) => {
    if (!result) return line;
    const cjkWrap = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]$/u.test(result)
      && /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]/u.test(line);
    return `${result}${cjkWrap ? "" : " "}${line}`;
  }, "");
}

function compactCell(value) { return String(value ?? "").replace(/[\s　]+/g, ""); }

function normalizeCellText(value) { return String(value ?? "").replace(/[\t\r\n]+/g, " ").replace(/[ 　]+/g, " ").trim(); }

function normalizeMatchText(value) {
  return String(value ?? "").normalize("NFKC").replace(/[\s　・、，,（）()]/g, "").trim();
}

function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
