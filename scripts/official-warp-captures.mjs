import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";

const CAPTURE_MAP_URL = new URL("../data/official-warp-capture-map.json", import.meta.url);
const ARCHIVE_PROVIDER = "国立国会図書館インターネット資料収集保存事業（WARP）";
const EXPECTED_CAPTURE_IDS = Object.freeze([
  "jpo-2020-discretionary-goods",
  "jpo-2020-discretionary-commission",
  "jpo-2020-discretionary-public-works",
  "jpo-2021-competitive-goods",
  "jpo-2021-competitive-commission",
  "jpo-2021-competitive-public-works",
  "jpo-2021-discretionary-goods",
  "jpo-2021-discretionary-commission",
  "jpo-2021-discretionary-public-works",
  "jpo-2021-grant-decisions-h1",
  "jpo-2021-grant-decisions-h2",
  "jpo-2022-competitive-goods",
  "jpo-2022-competitive-commission",
  "jpo-2022-competitive-public-works",
  "jpo-2022-grant-decisions-h1",
  "jpo-2022-grant-decisions-h2",
  "jpo-2023-grant-decisions-h1",
  "jpo-2023-grant-decisions-h2",
  "jpo-2024-competitive-goods",
  "jpo-2024-competitive-commission",
  "jpo-2024-competitive-public-works",
  "jpo-2024-discretionary-goods",
  "jpo-2024-discretionary-commission",
  "jpo-2024-grant-decisions-h1",
  "jpo-2024-grant-decisions-h2",
  "jpo-2020-competitive-goods",
  "jpo-2020-competitive-commission",
  "jpo-2020-competitive-public-works",
  "smea-2020-discretionary-commission",
  "smea-2020-grant-decisions",
  "smea-2021-competitive-goods",
  "smea-2021-competitive-commission",
  "smea-2021-discretionary-goods",
  "smea-2021-discretionary-commission",
  "smea-2021-grant-decisions",
  "smea-2022-competitive-goods",
  "smea-2022-competitive-commission",
  "smea-2022-discretionary-goods",
  "smea-2022-discretionary-commission",
  "smea-2022-grant-decisions",
  "smea-2023-competitive-goods",
  "smea-2023-competitive-commission",
  "smea-2023-discretionary-goods",
  "smea-2023-discretionary-commission",
  "smea-2023-grant-decisions",
  "smea-2024-competitive-goods",
  "smea-2024-competitive-commission",
  "smea-2024-discretionary-goods",
  "smea-2024-discretionary-commission",
  "smea-2024-grant-decisions",
]);
const EXPECTED_CAPTURE_ID_SET = new Set(EXPECTED_CAPTURE_IDS);
const EXPECTED_LIVE_FY2025_IDS = Object.freeze([
  "jpo-2025-competitive-commission",
  "jpo-2025-competitive-public-works",
  "jpo-2025-discretionary-commission",
]);

const rawCaptureMap = JSON.parse(readFileSync(CAPTURE_MAP_URL, "utf8"));
validateCaptureMap(rawCaptureMap);

export const VERIFIED_WARP_CAPTURE_METADATA = Object.freeze({
  schemaVersion: rawCaptureMap.schemaVersion,
  verifiedAt: rawCaptureMap.verifiedAt,
  verification: rawCaptureMap.verification,
  warning: rawCaptureMap.warning,
});

export const VERIFIED_WARP_CAPTURES = Object.freeze(rawCaptureMap.records.map((record) =>
  Object.freeze({ ...record })));

const CAPTURE_BY_ID = new Map(VERIFIED_WARP_CAPTURES.map((record) => [record.id, record]));

/**
 * Replaces only the 50 explicitly verified historical URLs with their WARP
 * raw replays.  Parser instructions stay on the original document definition;
 * a map/document mismatch is fatal at module load rather than silently widening
 * the published population.
 */
export function applyVerifiedWarpCaptures(documents) {
  if (!Array.isArray(documents)) throw new Error("WARP置換対象の資料定義が配列ではありません");
  const definitions = new Map();
  for (const document of documents) {
    if (!document?.id || definitions.has(document.id)) {
      throw new Error(`WARP置換対象の資料IDが不正または重複しています: ${document?.id ?? "(なし)"}`);
    }
    definitions.set(document.id, document);
  }

  const appliedIds = new Set();
  const replaced = documents.map((document) => {
    const capture = CAPTURE_BY_ID.get(document.id);
    if (!capture) return document;
    assertCaptureMatchesDocument(capture, document);
    appliedIds.add(document.id);
    return archivedDefinition(document, capture);
  });

  const unapplied = VERIFIED_WARP_CAPTURES.filter((capture) => !appliedIds.has(capture.id));
  if (unapplied.length) {
    throw new Error(`検証済みWARP資料に対応する定義がありません: ${unapplied.map((item) => item.id).join(", ")}`);
  }

  for (const id of EXPECTED_LIVE_FY2025_IDS) {
    const document = replaced.find((item) => item.id === id);
    if (!document) throw new Error(`ライブ取得を維持するFY2025資料の定義がありません: ${id}`);
    if (!document.url.startsWith("https://www.jpo.go.jp/") || document.originalUrl || document.archiveProvider) {
      throw new Error(`FY2025資料をWARPに置換してはいけません: ${id}`);
    }
  }

  return Object.freeze(replaced);
}

/**
 * Allows a parser with its own closed document registry to accept only the
 * exact archived definition produced from the committed WARP allowlist.  An
 * arbitrary WARP URL, a different capture of the same original URL, or any
 * changed parser instruction is rejected.
 */
export function assertVerifiedWarpReplacement(document, originalDocument) {
  if (!document?.id || !originalDocument?.id || document.id !== originalDocument.id) {
    throw new Error("WARP置換資料と原本定義のIDが一致しません");
  }
  const capture = CAPTURE_BY_ID.get(originalDocument.id);
  if (!capture) throw new Error(`${originalDocument.id}: 許可されたWARP captureがありません`);
  assertCaptureMatchesDocument(capture, originalDocument);
  const expected = archivedDefinition(originalDocument, capture);
  if (!isDeepStrictEqual(document, expected)) {
    throw new Error(`${originalDocument.id}: 許可されたWARP置換定義と一致しません`);
  }
}

function validateCaptureMap(value) {
  assertPlainObject(value, "WARP capture map");
  assertExactKeys(value, ["schemaVersion", "verifiedAt", "verification", "warning", "records"], "WARP capture map");
  if (value.schemaVersion !== 2) throw new Error("WARP capture mapのschemaVersionが不正です");
  if (typeof value.verifiedAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.verifiedAt)) {
    throw new Error("WARP capture mapのverifiedAtが不正です");
  }
  if (typeof value.verification !== "string" || !value.verification.includes("Full GET") || !value.verification.includes("50/50 passed")) {
    throw new Error("WARP capture mapの検証方法が不正です");
  }
  if (typeof value.warning !== "string" || !value.warning.includes("Range GET")) {
    throw new Error("WARP capture mapの取得上の注意が不正です");
  }
  if (!Array.isArray(value.records) || value.records.length !== EXPECTED_CAPTURE_IDS.length) {
    throw new Error(`WARP capture mapの件数が不正です: ${value.records?.length ?? "(なし)"}/${EXPECTED_CAPTURE_IDS.length}`);
  }

  const ids = new Set();
  const urls = new Set();
  for (const [index, record] of value.records.entries()) {
    const label = `WARP capture map ${index + 1}件目`;
    assertPlainObject(record, label);
    assertExactKeys(record, [
      "id", "capture", "url", "originalUrl", "sourcePageUrl",
      "executorId", "fiscalYear", "category", "format",
      "expectedBytes", "expectedSha256", "expectedRecordCount",
    ], label);
    if (typeof record.id !== "string" || !EXPECTED_CAPTURE_ID_SET.has(record.id) || ids.has(record.id)) {
      throw new Error(`${label}のIDが不正または重複しています`);
    }
    ids.add(record.id);
    if (typeof record.capture !== "string" || !/^\d{8}\/\d{14}$/.test(record.capture)) {
      throw new Error(`${record.id}: WARP capture識別子が不正です`);
    }
    if (record.url !== `https://warp.ndl.go.jp/${record.capture}/${record.originalUrl}` || urls.has(record.url)) {
      throw new Error(`${record.id}: WARP URLが不正または重複しています`);
    }
    urls.add(record.url);
    if (!isOfficialOriginUrl(record.originalUrl, record.executorId, record.format)
      || !isOfficialPageUrl(record.sourcePageUrl, record.executorId)) {
      throw new Error(`${record.id}: 原本URLまたは出典ページURLが許可対象外です`);
    }
    if (record.executorId !== record.id.split("-")[0]
      || !Number.isSafeInteger(record.fiscalYear)
      || record.fiscalYear !== Number(record.id.split("-")[1])) {
      throw new Error(`${record.id}: 執行機関または年度がIDと一致しません`);
    }
    if (!new Set(["contract_result", "grant_decision"]).has(record.category)) {
      throw new Error(`${record.id}: 資料区分が不正です`);
    }
    if ((record.executorId === "jpo" && record.format !== "xlsx")
      || (record.executorId === "smea" && record.format !== "html")) {
      throw new Error(`${record.id}: 資料形式が不正です`);
    }
    if (!Number.isSafeInteger(record.expectedBytes) || record.expectedBytes < 500 || record.expectedBytes > 10_000_000) {
      throw new Error(`${record.id}: 検証済みバイト数が不正です`);
    }
    if (typeof record.expectedSha256 !== "string" || !/^[0-9a-f]{64}$/.test(record.expectedSha256)) {
      throw new Error(`${record.id}: 検証済みSHA-256が不正です`);
    }
    if (!Number.isSafeInteger(record.expectedRecordCount) || record.expectedRecordCount < 0) {
      throw new Error(`${record.id}: 検証済み明細数が不正です`);
    }
  }
  const missingIds = EXPECTED_CAPTURE_IDS.filter((id) => !ids.has(id));
  const unexpectedIds = [...ids].filter((id) => !EXPECTED_CAPTURE_ID_SET.has(id));
  if (missingIds.length || unexpectedIds.length) {
    throw new Error(`WARP capture mapのID集合が不正です (不足: ${missingIds.join(", ") || "なし"}; 想定外: ${unexpectedIds.join(", ") || "なし"})`);
  }
  for (const id of EXPECTED_LIVE_FY2025_IDS) {
    if (ids.has(id)) throw new Error(`FY2025のライブ取得資料がWARP mapに混入しています: ${id}`);
  }
}

function assertCaptureMatchesDocument(capture, document) {
  const mismatches = [];
  for (const field of ["executorId", "fiscalYear", "category", "format"]) {
    const documentValue = field === "format" ? (document.format ?? "xlsx") : document[field];
    if (capture[field] !== documentValue) mismatches.push(field);
  }
  if (capture.originalUrl !== document.url) mismatches.push("originalUrl");
  if (capture.sourcePageUrl !== document.sourcePageUrl) mismatches.push("sourcePageUrl");
  if (mismatches.length) {
    throw new Error(`${capture.id}: WARP mapと資料定義が一致しません (${mismatches.join(", ")})`);
  }
}

function archivedDefinition(document, capture) {
  return Object.freeze({
    ...document,
    url: capture.url,
    originalUrl: capture.originalUrl,
    sourcePageUrl: capture.sourcePageUrl,
    discoveryStatus: "archived_official_file",
    archiveProvider: ARCHIVE_PROVIDER,
    archiveVerifiedAt: VERIFIED_WARP_CAPTURE_METADATA.verifiedAt,
    archiveVerification: VERIFIED_WARP_CAPTURE_METADATA.verification,
    archiveExpectedBytes: capture.expectedBytes,
    archiveExpectedSha256: capture.expectedSha256,
    archiveExpectedRecordCount: capture.expectedRecordCount,
  });
}

function isOfficialOriginUrl(url, executorId, format) {
  if (typeof url !== "string") return false;
  if (executorId === "jpo" && format === "xlsx") {
    return /^https:\/\/www\.jpo\.go\.jp\/news\/chotatsu\/rakusatu\/(?:kyosonyusatu|zuikeyaku|hojokin)\/document\/202[0-4]\/[A-Za-z0-9_-]+\.xlsx$/.test(url);
  }
  if (executorId === "smea" && format === "html") {
    return /^https:\/\/www\.chusho\.meti\.go\.jp\/koukai\/nyusatsu\/zuikei\/[A-Za-z0-9_-]+\.html?$/.test(url);
  }
  return false;
}

function isOfficialPageUrl(url, executorId) {
  if (typeof url !== "string") return false;
  if (executorId === "jpo") return url.startsWith("https://www.jpo.go.jp/news/chotatsu/rakusatu/");
  if (executorId === "smea") return url.startsWith("https://www.chusho.meti.go.jp/koukai/nyusatsu/");
  return false;
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error(`${label}がオブジェクトではありません`);
  }
}

function assertExactKeys(value, keys, label) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}の項目が不正です`);
  }
}
