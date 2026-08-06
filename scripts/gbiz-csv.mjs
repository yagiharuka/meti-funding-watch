import { createHash } from "node:crypto";

import {
  cleanCell,
  fiscalYear,
  hasValidCorporateNumber,
  parseAmount,
  parseJapaneseDate,
} from "./gbiz-values.mjs";

const MAX_AUTOMATIC_COUNT_GROWTH_RATE = 0.05;
const MAX_AUTOMATIC_COUNT_GROWTH_FLOOR = 1_000;
const MAX_AUTOMATIC_BYTE_GROWTH_RATE = 0.10;

const approvedAgencyAliases = new Map([
  ["経済産業省", "経済産業省"],
  ["資源エネルギー庁", "資源エネルギー庁"],
  ["中小企業庁", "中小企業庁"],
  ["特許庁", "特許庁"],
  ["情報処理推進機構", "IPA"],
  ["独立行政法人情報処理推進機構", "IPA"],
  ["IPA", "IPA"],
  ["国立研究開発法人新エネルギー・産業技術総合開発機構", "NEDO"],
  ["新エネルギー・産業技術総合開発機構", "NEDO"],
  ["国立研究開発法人NEDO", "NEDO"],
  ["NEDO", "NEDO"],
  ...["北海道", "東北", "関東", "中部", "近畿", "中国", "四国", "九州"].flatMap((region) => [
    [`${region}経済産業局`, `${region}経済産業局`],
    [`経済産業省${region}経済産業局`, `${region}経済産業局`],
  ]),
]);

const metiAgencyMarkers = [
  "経済産業省",
  "経済産業局",
  "資源エネルギー庁",
  "中小企業庁",
  "特許庁",
  "情報処理推進機構",
  "新エネルギー・産業技術総合開発機構",
  "NEDO",
  "IPA",
];

export const GBIZ_AGENCY_RULES_SHA256 = createHash("sha256")
  .update(JSON.stringify([...approvedAgencyAliases.entries()].sort(([a], [b]) => a.localeCompare(b, "ja"))))
  .digest("hex");

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
  const [total, subsidies, procurements, other] = numbers;
  if (total !== subsidies + procurements + other) {
    throw new Error(
      `GビズINFO dashboard: ${label}行の合計と内訳が一致しません `
      + `(${total}/${subsidies + procurements + other})`,
    );
  }
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
  const publisherCounts = new Map();
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
    publisherCounts.set(agency, (publisherCounts.get(agency) || 0) + 1);
    if (!date) missingDateRows += 1;
    if (!program) missingProgramRows += 1;
    if (amount === null) missingAmountRows += 1;
    if (!sourceKey) missingSourceKeyRows += 1;

    const stage = kind === "procurement" ? "contracted" : "subsidy_published";
    const record = {
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
    };
    record.sourceRecordHash = gbizRecordSemanticHash(record);
    records.push(record);
  }
  const unmatchedAgencyEntries = [...unmatchedAgencies.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "ja"));
  const suspiciousUnmatchedAgencies = unmatchedAgencyEntries.filter(([name]) =>
    metiAgencyMarkers.some((marker) => name.includes(marker)));
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
      headerCount: headers.length,
      schemaSha256: createHash("sha256").update(headers.join("\u001f")).digest("hex"),
      agencyRulesSha256: GBIZ_AGENCY_RULES_SHA256,
      publisherCounts: Object.fromEntries(
        [...publisherCounts.entries()].sort(([a], [b]) => a.localeCompare(b, "ja")),
      ),
      unmatchedAgencyRows: unmatchedAgencyEntries.reduce((sum, [, count]) => sum + count, 0),
      unmatchedAgencyNames: unmatchedAgencyEntries.length,
      unmatchedAgencyDistributionSha256: createHash("sha256")
        .update(JSON.stringify(unmatchedAgencyEntries))
        .digest("hex"),
      unmatchedAgencies: [...unmatchedAgencyEntries]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20),
      suspiciousUnmatchedAgencyRows: suspiciousUnmatchedAgencies
        .reduce((sum, [, count]) => sum + count, 0),
      suspiciousUnmatchedAgencies,
    },
  };
}

export function assertGbizSnapshotContinuity(previousSource, snapshot, dashboardStats = null) {
  if (snapshot.missingSourceKeyRows !== 0) {
    throw new Error(
      `GビズINFO 全件CSV: キー情報がない対象行があります (${snapshot.missingSourceKeyRows}行)`,
    );
  }

  if (snapshot.suspiciousUnmatchedAgencyRows !== 0) {
    throw new Error(
      "GビズINFO 全件CSV: 経産省関係の可能性がある未承認の公表組織名があります "
      + `(${snapshot.suspiciousUnmatchedAgencyRows}行: `
      + `${snapshot.suspiciousUnmatchedAgencies.slice(0, 3).map(([name]) => name).join(", ")})`,
    );
  }

  const requiredBaselineFields = [
    "recordCount",
    "csvTotalSubsidyRows",
    "csvTotalProcurementRows",
    "csvEligibleSubsidyCount",
    "csvEligibleProcurementCount",
    "csvSubsidyFileBytes",
    "csvProcurementFileBytes",
    "dashboardSubsidyCount",
    "dashboardProcurementCount",
    "dashboardMinusCsvEligibleSubsidyCount",
    "dashboardMinusCsvEligibleProcurementCount",
  ];
  if (
    typeof previousSource?.lastSuccessfulImportAt !== "string"
    || requiredBaselineFields.some((field) => !Number.isSafeInteger(previousSource?.[field]))
  ) {
    throw new Error("GビズINFO 全件CSV: 承認済みの前回成功スナップショットがありません");
  }
  if (
    !dashboardStats
    || !Number.isSafeInteger(dashboardStats.dashboardSubsidyCount)
    || !Number.isSafeInteger(dashboardStats.dashboardProcurementCount)
  ) {
    throw new Error("GビズINFO 全件CSV: 公式画面の区分別件数を確認できないため更新を停止します");
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
    const previous = previousSource[field];
    const current = snapshot[field];
    if (!Number.isSafeInteger(current)) {
      throw new Error(`GビズINFO 全件CSV: ${label}を検証できません`);
    }
    if (current < previous) {
      throw new Error(
        `GビズINFO 全件CSV: ${label}が前回成功時から減少しました (${current}/${previous})`,
      );
    }
    const isBytes = field.endsWith("FileBytes");
    const allowedGrowth = isBytes
      ? Math.max(1_000_000, Math.ceil(previous * MAX_AUTOMATIC_BYTE_GROWTH_RATE))
      : Math.max(MAX_AUTOMATIC_COUNT_GROWTH_FLOOR, Math.ceil(previous * MAX_AUTOMATIC_COUNT_GROWTH_RATE));
    if (current - previous > allowedGrowth) {
      throw new Error(
        `GビズINFO 全件CSV: ${label}の増加が自動公開の上限を超えました `
        + `(+${current - previous}/+${allowedGrowth})`,
      );
    }
  }

  const kinds = [
    ["補助金", "dashboardSubsidyCount", "csvEligibleSubsidyCount", "dashboardMinusCsvEligibleSubsidyCount"],
    ["調達", "dashboardProcurementCount", "csvEligibleProcurementCount", "dashboardMinusCsvEligibleProcurementCount"],
  ];
  for (const [label, dashboardField, csvField, gapField] of kinds) {
    const dashboardCount = dashboardStats[dashboardField];
    const csvCount = snapshot[csvField];
    const gap = dashboardCount - csvCount;
    const previousGap = previousSource[gapField];
    if (gap < 0) {
      throw new Error(
        `GビズINFO 全件CSV: ${label}CSV対象行が公式画面の件数を超えました `
        + `(${csvCount}/${dashboardCount})`,
      );
    }
    if (gap > previousGap) {
      throw new Error(
        `GビズINFO 全件CSV: ${label}の公式画面との差が前回成功時より拡大しました `
        + `(${gap}/${previousGap})`,
      );
    }
  }
}

export function assertGbizRecordContinuity(previousRecords, candidateRecords) {
  if (!previousRecords.length) {
    throw new Error("GビズINFO 全件CSV: 承認済みの前回成功データがありません");
  }
  const previousRows = uniqueRecordMap(previousRecords, "前回成功データ");
  const candidateRows = uniqueRecordMap(candidateRecords, "今回取得データ");
  const missingKeys = [...previousRows.keys()].filter((key) => !candidateRows.has(key));
  if (missingKeys.length) {
    throw new Error(
      `GビズINFO 全件CSV: 前回成功データのキーが${missingKeys.length}件欠落しています `
      + `(${missingKeys.slice(0, 3).join(", ")})`,
    );
  }
  const changedKeys = [...previousRows.entries()]
    .filter(([key, record]) => gbizRecordSemanticHash(record) !== gbizRecordSemanticHash(candidateRows.get(key)))
    .map(([key]) => key);
  if (changedKeys.length) {
    throw new Error(
      `GビズINFO 全件CSV: 既存キーの内容が${changedKeys.length}件変更されています `
      + `(${changedKeys.slice(0, 3).join(", ")})`,
    );
  }
  return {
    continuityBaselineRecordCount: previousRows.size,
    continuityRetainedRecordCount: previousRows.size,
    continuityRemovedRecordCount: 0,
    continuityChangedRecordCount: 0,
    continuityAddedRecordCount: candidateRows.size - previousRows.size,
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
  return approvedAgencyAliases.get(value) || null;
}

export function gbizRecordSemanticHash(record) {
  const values = [
    record.stage,
    record.sourceKey,
    record.organization,
    record.corporateNumber,
    record.sourceAgency,
    record.publisherCanonical,
    record.program,
    record.date,
    record.dateRaw,
    record.fiscalYear,
    record.amount,
    record.amountRaw,
    record.notes,
    record.dataQuality,
    record.sourceSystem,
  ];
  return createHash("sha256").update(JSON.stringify(values)).digest("hex");
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

function uniqueRecordMap(records, label) {
  const rows = new Map();
  for (const record of records) {
    if (!record?.stage || !record?.sourceKey) {
      throw new Error(`GビズINFO 全件CSV: ${label}にキー情報がない行があります`);
    }
    const key = `${record.stage}\u001f${record.sourceKey}`;
    if (rows.has(key)) {
      throw new Error(`GビズINFO 全件CSV: ${label}のキー情報が重複しています (${key})`);
    }
    rows.set(key, record);
  }
  return rows;
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
