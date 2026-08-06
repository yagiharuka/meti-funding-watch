import { createHash } from "node:crypto";

import {
  cleanCell,
  fiscalYear,
  hasValidCorporateNumber,
  parseAmount,
  parseJapaneseDate,
} from "./gbiz-values.mjs";

export function parseDashboardRow(html, label) {
  const rowStart = html.indexOf(label);
  if (rowStart < 0) throw new Error(`GビズINFO dashboard: ${label}行が見つかりません`);
  const rowEnd = html.indexOf("</tr>", rowStart);
  const rowText = stripHtml(html.slice(rowStart, rowEnd < 0 ? rowStart + 2_000 : rowEnd + 5));
  const numbers = [...rowText.matchAll(/\b[\d,]+\b/g)]
    .slice(0, 4)
    .map((match) => Number(match[0].replaceAll(",", "")));
  if (numbers.length < 4 || numbers.some((value) => !Number.isSafeInteger(value))) {
    throw new Error(`GビズINFO dashboard: ${label}行の件数を解析できません`);
  }
  const [, subsidies, procurements] = numbers;
  return { subsidies, procurements };
}

export function toGbizBulkRecords(csvText, kind) {
  const iterator = parseCsvRows(csvText);
  const first = iterator.next();
  if (first.done) throw new Error(`GビズINFO ${kind}: CSVが空です`);
  const headers = first.value.map(cleanCell);
  if (new Set(headers).size !== headers.length) {
    throw new Error(`GビズINFO ${kind}: CSVヘッダーが重複しています`);
  }
  const column = Object.fromEntries(headers.map((header, index) => [header, index]));
  const fields = kind === "procurement"
    ? { date: "受注日", program: "件名", amount: "落札価格", agency: "組織名" }
    : { date: "証明日", program: "名称", amount: "金額", agency: "発行元" };
  for (const header of ["法人番号", "商号または名称", "キー情報", ...Object.values(fields)]) {
    if (!(header in column)) throw new Error(`GビズINFO ${kind}: ${header}列がありません`);
  }

  const records = [];
  const unmatchedAgencies = new Map();
  let totalRows = 0;
  let recipientRows = 0;
  let eligibleRows = 0;
  let missingDateRows = 0;
  let missingProgramRows = 0;
  let missingAmountRows = 0;
  let missingSourceKeyRows = 0;
  let sourceRowNumber = 1;
  for (const row of iterator) {
    sourceRowNumber += 1;
    if (row.length !== headers.length) {
      throw new Error(
        `GビズINFO ${kind}: ${sourceRowNumber}行目の列数が不正です `
        + `(${row.length}/${headers.length})`,
      );
    }
    totalRows += 1;
    const corporateNumber = cleanCell(row[column["法人番号"]]).replace(/\D/g, "");
    const organization = cleanCell(row[column["商号または名称"]]);
    const dateRaw = row[column[fields.date]] ?? "";
    const date = parseJapaneseDate(dateRaw);
    const program = cleanCell(row[column[fields.program]]);
    const amountRaw = row[column[fields.amount]] ?? "";
    const amount = parseAmount(amountRaw);
    const rawAgency = cleanCell(row[column[fields.agency]]);
    const agency = normalizeGbizAgency(rawAgency);
    const sourceKey = "キー情報" in column ? cleanCell(row[column["キー情報"]]) : "";
    const isRecipient = hasValidCorporateNumber(corporateNumber) && Boolean(organization);
    if (isRecipient) recipientRows += 1;
    if (isRecipient && !agency) {
      unmatchedAgencies.set(
        rawAgency || "（発行元なし）",
        (unmatchedAgencies.get(rawAgency || "（発行元なし）") || 0) + 1,
      );
    }
    if (!isRecipient || !agency) continue;

    eligibleRows += 1;
    if (!date) missingDateRows += 1;
    if (!program) missingProgramRows += 1;
    if (amount === null) missingAmountRows += 1;
    if (!sourceKey) missingSourceKeyRows += 1;

    const stage = kind === "procurement" ? "contracted" : "subsidy_published";
    records.push({
      id: `gbiz-${stableId(sourceKey
        ? [kind, "key", sourceKey]
        : [kind, "row", sourceRowNumber, dateRaw, corporateNumber, amountRaw, program, rawAgency])}`,
      fiscalYear: date ? fiscalYear(date) : null,
      date,
      dateRaw,
      organization,
      corporateNumber,
      sourceAgency: rawAgency,
      publisherCanonical: agency,
      program,
      amount,
      amountRaw,
      stage,
      sourceKey,
      sourceRowNumber,
      dataQuality: valueFor(row, column, "データ品質"),
      sourceSystem: valueFor(row, column, "出典元"),
      sourceRetrievedAt: valueFor(row, column, "最終取得日"),
      sourceUpdatedAt: valueFor(row, column, "最終更新日"),
      notes: kind === "procurement" ? valueFor(row, column, "備考") : valueFor(row, column, "対象"),
      sourceName: `GビズINFO 全件CSV（${kind === "procurement" ? "調達" : "補助金"}）`,
      sourceUrl: `https://info.gbiz.go.jp/hojin/ichiran?hojinBango=${corporateNumber}`,
      quality: "aggregated",
      ingestSource: "gbiz-bulk-csv",
    });
  }
  return {
    records,
    stats: {
      totalRows,
      recipientRows,
      eligibleRows,
      importedRows: records.length,
      missingDateRows,
      missingProgramRows,
      missingAmountRows,
      missingSourceKeyRows,
      unmatchedAgencies: [...unmatchedAgencies.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20),
    },
  };
}

export function assertGbizSnapshotContinuity(previousSource, snapshot, dashboardStats = null) {
  if (snapshot.missingSourceKeyRows !== 0) {
    throw new Error(
      `GビズINFO 全件CSV: キー情報がない対象行があります (${snapshot.missingSourceKeyRows}行)`,
    );
  }

  const comparisons = [
    ["補助金CSV総行数", "csvTotalSubsidyRows"],
    ["調達CSV総行数", "csvTotalProcurementRows"],
    ["補助金CSV対象行", "csvEligibleSubsidyCount"],
    ["調達CSV対象行", "csvEligibleProcurementCount"],
    ["補助金CSVバイト数", "csvSubsidyFileBytes"],
    ["調達CSVバイト数", "csvProcurementFileBytes"],
  ];
  for (const [label, field] of comparisons) {
    const previous = previousSource?.[field];
    const current = snapshot[field];
    if (Number.isSafeInteger(previous) && Number.isSafeInteger(current) && current < previous) {
      throw new Error(
        `GビズINFO 全件CSV: ${label}が前回成功時から減少しました (${current}/${previous})`,
      );
    }
  }

  const dashboardRecordCount = dashboardStats?.dashboardRecordCount;
  if (Number.isSafeInteger(dashboardRecordCount)) {
    const dashboardGap = dashboardRecordCount - snapshot.csvEligibleRecordCount;
    const hasPreviousGap = Number.isSafeInteger(previousSource?.dashboardMinusCsvEligibleCount);
    const allowedGap = hasPreviousGap
      ? Math.max(0, previousSource.dashboardMinusCsvEligibleCount)
      : Math.max(100, Math.ceil(dashboardRecordCount * 0.005));
    if (dashboardGap > allowedGap) {
      throw new Error(
        "GビズINFO 全件CSV: 公式画面との件数差が安全確認の上限を超えました "
        + `(${dashboardGap}/${allowedGap})`,
      );
    }
  }
}

export function assertGbizRecordContinuity(previousRecords, candidateRecords) {
  const previousKeys = uniqueRecordKeys(previousRecords, "前回成功データ");
  const candidateKeys = uniqueRecordKeys(candidateRecords, "今回取得データ");
  const missingKeys = [...previousKeys].filter((key) => !candidateKeys.has(key));
  if (missingKeys.length) {
    throw new Error(
      `GビズINFO 全件CSV: 前回成功データのキーが${missingKeys.length}件欠落しています `
      + `(${missingKeys.slice(0, 3).join(", ")})`,
    );
  }
  return {
    continuityBaselineRecordCount: previousKeys.size,
    continuityRetainedRecordCount: previousKeys.size,
    continuityRemovedRecordCount: 0,
    continuityAddedRecordCount: candidateKeys.size - previousKeys.size,
  };
}

export function auditGbizImport(subsidyResult, procurementResult, dashboardStats = null) {
  const csvEligibleSubsidyCount = subsidyResult.stats.eligibleRows;
  const csvEligibleProcurementCount = procurementResult.stats.eligibleRows;
  const csvImportedSubsidyCount = subsidyResult.records.length;
  const csvImportedProcurementCount = procurementResult.records.length;
  const csvEligibleRecordCount = csvEligibleSubsidyCount + csvEligibleProcurementCount;
  const csvImportedRecordCount = csvImportedSubsidyCount + csvImportedProcurementCount;
  const csvImportGap = csvEligibleRecordCount - csvImportedRecordCount;

  if (!csvEligibleRecordCount) {
    throw new Error("GビズINFO 全件CSV: 対象行が0件です");
  }
  if (
    csvImportedSubsidyCount !== csvEligibleSubsidyCount
    || csvImportedProcurementCount !== csvEligibleProcurementCount
    || csvImportGap !== 0
  ) {
    throw new Error(
      "GビズINFO 全件CSV: CSV対象行との件数照合に失敗 "
      + `(補助金 ${csvImportedSubsidyCount}/${csvEligibleSubsidyCount}、`
      + `調達 ${csvImportedProcurementCount}/${csvEligibleProcurementCount})`,
    );
  }
  if (subsidyResult.records.some((record) => record.stage !== "subsidy_published")) {
    throw new Error("GビズINFO 全件CSV: 補助金CSVに異なる区分があります");
  }
  if (procurementResult.records.some((record) => record.stage !== "contracted")) {
    throw new Error("GビズINFO 全件CSV: 調達CSVに異なる区分があります");
  }

  const dashboardRecordCount = dashboardStats?.dashboardRecordCount ?? null;
  const dashboardSubsidyCount = dashboardStats?.dashboardSubsidyCount ?? null;
  const dashboardProcurementCount = dashboardStats?.dashboardProcurementCount ?? null;
  const dashboardMinusCsvEligibleCount = Number.isSafeInteger(dashboardRecordCount)
    ? dashboardRecordCount - csvEligibleRecordCount
    : null;
  const dashboardMinusCsvEligibleSubsidyCount = Number.isSafeInteger(dashboardSubsidyCount)
    ? dashboardSubsidyCount - csvEligibleSubsidyCount
    : null;
  const dashboardMinusCsvEligibleProcurementCount = Number.isSafeInteger(dashboardProcurementCount)
    ? dashboardProcurementCount - csvEligibleProcurementCount
    : null;

  return {
    csvEligibleRecordCount,
    csvImportedRecordCount,
    csvImportGap,
    csvEligibleSubsidyCount,
    csvImportedSubsidyCount,
    csvEligibleProcurementCount,
    csvImportedProcurementCount,
    dashboardRecordCount,
    dashboardSubsidyCount,
    dashboardProcurementCount,
    dashboardMinusCsvEligibleCount,
    dashboardMinusCsvEligibleSubsidyCount,
    dashboardMinusCsvEligibleProcurementCount,
    dashboardComparisonStatus: dashboardRecordCount === null
      ? "unavailable"
      : dashboardMinusCsvEligibleCount === 0 ? "matched" : "different",
  };
}

export function normalizeGbizAgency(value) {
  if (["NEDO", "IPA", "経済産業省", "資源エネルギー庁", "中小企業庁", "特許庁"].includes(value)) {
    return value;
  }
  const agencies = [
    ["新エネルギー・産業技術総合開発機構", "NEDO"],
    ["情報処理推進機構", "IPA"],
    ["北海道経済産業局", "北海道経済産業局"],
    ["東北経済産業局", "東北経済産業局"],
    ["関東経済産業局", "関東経済産業局"],
    ["中部経済産業局", "中部経済産業局"],
    ["近畿経済産業局", "近畿経済産業局"],
    ["中国経済産業局", "中国経済産業局"],
    ["四国経済産業局", "四国経済産業局"],
    ["九州経済産業局", "九州経済産業局"],
    ["資源エネルギー庁", "資源エネルギー庁"],
    ["中小企業庁", "中小企業庁"],
    ["特許庁", "特許庁"],
    ["経済産業省", "経済産業省"],
  ];
  return agencies.find(([needle]) => value.includes(needle))?.[1] || null;
}

export function stripHtml(value) {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function valueFor(row, column, header) {
  return header in column ? cleanCell(row[column[header]]) : "";
}

function stableId(parts) {
  return createHash("sha256").update(parts.join("\u001f")).digest("hex").slice(0, 16);
}

function uniqueRecordKeys(records, label) {
  const keys = new Set();
  for (const record of records) {
    if (!record?.stage || !record?.sourceKey) {
      throw new Error(`GビズINFO 全件CSV: ${label}にキー情報がない行があります`);
    }
    const key = `${record.stage}\u001f${record.sourceKey}`;
    if (keys.has(key)) {
      throw new Error(`GビズINFO 全件CSV: ${label}のキー情報が重複しています (${key})`);
    }
    keys.add(key);
  }
  return keys;
}

function* parseCsvRows(text) {
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field);
      yield row;
      row = [];
      field = "";
    } else if (character !== "\r") {
      field += character;
    }
  }
  if (quoted) throw new Error("GビズINFO CSV: 引用符が閉じられていません");
  if (field || row.length) {
    row.push(field);
    yield row;
  }
}
