import { readFileSync } from "node:fs";

const FALLBACK_MAP_URL = new URL("../data/official-live-fallback-map.json", import.meta.url);
const EXPECTED_IDS = Object.freeze([
  "smea-2025-competitive-goods",
  "smea-2025-competitive-commission",
  "smea-2025-discretionary-goods",
  "smea-2025-discretionary-commission",
]);
const EXPECTED_ID_SET = new Set(EXPECTED_IDS);

const rawMap = JSON.parse(readFileSync(FALLBACK_MAP_URL, "utf8"));
validateMap(rawMap);

export const VERIFIED_LIVE_FALLBACK_METADATA = Object.freeze({
  schemaVersion: rawMap.schemaVersion,
  verifiedAt: rawMap.verifiedAt,
  verification: rawMap.verification,
});

export const VERIFIED_LIVE_FALLBACKS = Object.freeze(rawMap.records.map((record) => Object.freeze({ ...record })));
const FALLBACK_BY_ID = new Map(VERIFIED_LIVE_FALLBACKS.map((record) => [record.id, record]));

export function applyVerifiedLiveFallbacks(documents) {
  if (!Array.isArray(documents)) throw new Error("ライブ資料定義が配列ではありません");
  const applied = new Set();
  const configured = documents.map((document) => {
    const fallback = FALLBACK_BY_ID.get(document.id);
    if (!fallback) return document;
    if (document.url !== fallback.originalUrl
      || document.executorId !== "smea"
      || document.fiscalYear !== 2025
      || document.category !== "contract_result"
      || (document.format ?? "xlsx") !== "xlsx"
      || document.archiveProvider
      || document.verifiedFallback) {
      throw new Error(`${document.id}: 検証済みライブfallbackと資料定義が一致しません`);
    }
    applied.add(document.id);
    return Object.freeze({ ...document, verifiedFallback: fallback });
  });
  const missing = EXPECTED_IDS.filter((id) => !applied.has(id));
  if (missing.length) throw new Error(`検証済みライブfallbackに対応する資料定義がありません: ${missing.join(", ")}`);
  return Object.freeze(configured);
}

function validateMap(value) {
  assertPlainObject(value, "ライブfallback map");
  assertExactKeys(value, ["schemaVersion", "verifiedAt", "verification", "records"], "ライブfallback map");
  if (value.schemaVersion !== 1) throw new Error("ライブfallback mapのschemaVersionが不正です");
  if (typeof value.verifiedAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.verifiedAt)) {
    throw new Error("ライブfallback mapのverifiedAtが不正です");
  }
  if (typeof value.verification !== "string"
    || !value.verification.includes("sourceKey")
    || !value.verification.includes("4/4 passed")) {
    throw new Error("ライブfallback mapの検証方法が不正です");
  }
  if (!Array.isArray(value.records) || value.records.length !== EXPECTED_IDS.length) {
    throw new Error("ライブfallback mapの件数が不正です");
  }
  const ids = new Set();
  for (const [index, record] of value.records.entries()) {
    const label = `ライブfallback map ${index + 1}件目`;
    assertPlainObject(record, label);
    assertExactKeys(record, [
      "id", "capture", "url", "originalUrl",
      "expectedBytes", "expectedSha256", "expectedRecordCount",
    ], label);
    if (!EXPECTED_ID_SET.has(record.id) || ids.has(record.id)) throw new Error(`${label}のIDが不正または重複しています`);
    ids.add(record.id);
    if (typeof record.capture !== "string" || !/^\d{8}\/\d{14}$/.test(record.capture)
      || record.url !== `https://warp.ndl.go.jp/${record.capture}/${record.originalUrl}`) {
      throw new Error(`${record.id}: fallback WARP URLが不正です`);
    }
    if (!/^https:\/\/www\.chusho\.meti\.go\.jp\/koukai\/nyusatsu\/choutatsu\/[a-z_]+_2025\.xlsx$/.test(record.originalUrl)) {
      throw new Error(`${record.id}: fallback原本URLが不正です`);
    }
    if (!Number.isSafeInteger(record.expectedBytes) || record.expectedBytes < 500 || record.expectedBytes > 10_000_000
      || typeof record.expectedSha256 !== "string" || !/^[0-9a-f]{64}$/.test(record.expectedSha256)
      || !Number.isSafeInteger(record.expectedRecordCount) || record.expectedRecordCount < 1) {
      throw new Error(`${record.id}: fallback receiptが不正です`);
    }
  }
  const missing = EXPECTED_IDS.filter((id) => !ids.has(id));
  if (missing.length) throw new Error(`ライブfallback mapのIDが不足しています: ${missing.join(", ")}`);
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error(`${label}がオブジェクトではありません`);
  }
}

function assertExactKeys(value, keys, label) {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    throw new Error(`${label}の項目が不正です`);
  }
}
