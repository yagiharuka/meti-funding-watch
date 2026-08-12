import assert from "node:assert/strict";
import test from "node:test";

import { OFFICIAL_DOCUMENTS } from "../scripts/update-official-data.mjs";
import {
  VERIFIED_WARP_CAPTURES,
  VERIFIED_WARP_CAPTURE_METADATA,
  applyVerifiedWarpCaptures,
  assertVerifiedWarpReplacement,
} from "../scripts/official-warp-captures.mjs";
import { documents as smeaDocuments, parseSmeaOfficialHtml } from "../scripts/official-smea-history.mjs";

const captureIds = new Set(VERIFIED_WARP_CAPTURES.map((item) => item.id));
const liveFy2025Ids = [
  "jpo-2025-competitive-commission",
  "jpo-2025-competitive-public-works",
  "jpo-2025-discretionary-commission",
];
const liveRevisedSmea2020Ids = [
  "smea-2020-competitive-goods",
  "smea-2020-competitive-commission",
  "smea-2020-discretionary-goods",
];
const expectedCaptureIds = new Set([
  ...["goods", "commission", "public-works"].map((kind) => `jpo-2020-competitive-${kind}`),
  ...["goods", "commission", "public-works"].map((kind) => `jpo-2020-discretionary-${kind}`),
  ...["goods", "commission", "public-works"].map((kind) => `jpo-2021-competitive-${kind}`),
  ...["goods", "commission", "public-works"].map((kind) => `jpo-2021-discretionary-${kind}`),
  "jpo-2021-grant-decisions-h1", "jpo-2021-grant-decisions-h2",
  ...["goods", "commission", "public-works"].map((kind) => `jpo-2022-competitive-${kind}`),
  "jpo-2022-grant-decisions-h1", "jpo-2022-grant-decisions-h2",
  "jpo-2023-grant-decisions-h1", "jpo-2023-grant-decisions-h2",
  ...["goods", "commission", "public-works"].map((kind) => `jpo-2024-competitive-${kind}`),
  "jpo-2024-discretionary-goods", "jpo-2024-discretionary-commission",
  "jpo-2024-grant-decisions-h1", "jpo-2024-grant-decisions-h2",
  "smea-2020-discretionary-commission", "smea-2020-grant-decisions",
  ...[2021, 2022, 2023, 2024].flatMap((year) => [
    `smea-${year}-competitive-goods`, `smea-${year}-competitive-commission`,
    `smea-${year}-discretionary-goods`, `smea-${year}-discretionary-commission`,
    `smea-${year}-grant-decisions`,
  ]),
]);

test("applies all 50 full-GET-verified WARP captures and preserves the original official URLs", () => {
  assert.equal(VERIFIED_WARP_CAPTURES.length, 50);
  assert.equal(captureIds.size, 50);
  assert.deepEqual([...captureIds].sort(), [...expectedCaptureIds].sort());
  assert.equal(VERIFIED_WARP_CAPTURE_METADATA.verifiedAt, "2026-08-12");
  assert.match(VERIFIED_WARP_CAPTURE_METADATA.verification, /Full GET/);
  assert.match(VERIFIED_WARP_CAPTURE_METADATA.verification, /50\/50 passed/);
  assert.match(VERIFIED_WARP_CAPTURE_METADATA.warning, /Range GET/);

  const archived = OFFICIAL_DOCUMENTS.filter((document) => captureIds.has(document.id));
  assert.equal(archived.length, 50);
  assert.deepEqual(countBy(archived, (document) => document.executorId), { jpo: 28, smea: 22 });
  for (const document of archived) {
    const capture = VERIFIED_WARP_CAPTURES.find((item) => item.id === document.id);
    assert.equal(document.url, capture.url, document.id);
    assert.equal(document.originalUrl, capture.originalUrl, document.id);
    assert.equal(document.sourcePageUrl, capture.sourcePageUrl, document.id);
    assert.equal(document.discoveryStatus, "archived_official_file", document.id);
    assert.equal(document.archiveProvider, "国立国会図書館インターネット資料収集保存事業（WARP）", document.id);
    assert.equal(document.archiveVerifiedAt, "2026-08-12", document.id);
    assert.match(document.archiveVerification, /Full GET/, document.id);
    assert.match(document.url, /^https:\/\/warp\.ndl\.go\.jp\/\d{8}\/\d{14}\/https:\/\//, document.id);
    assert.match(document.originalUrl, /^https:\/\/(?:www\.jpo\.go\.jp|www\.chusho\.meti\.go\.jp)\//, document.id);
    assert.equal(document.archiveExpectedBytes, capture.expectedBytes, document.id);
    assert.equal(document.archiveExpectedSha256, capture.expectedSha256, document.id);
    assert.equal(document.archiveExpectedRecordCount, capture.expectedRecordCount, document.id);
  }
});

test("pins exact full-response integrity and strict parser receipts for every capture", () => {
  for (const capture of VERIFIED_WARP_CAPTURES) {
    assert.match(capture.expectedSha256, /^[0-9a-f]{64}$/, capture.id);
    assert.ok(Number.isSafeInteger(capture.expectedBytes) && capture.expectedBytes >= 500, capture.id);
    assert.ok(Number.isSafeInteger(capture.expectedRecordCount) && capture.expectedRecordCount >= 0, capture.id);
  }
});

test("requires receipts for all 59 archived documents while keeping the 9 existing archives outside map50", () => {
  const archived = OFFICIAL_DOCUMENTS.filter((document) => document.archiveProvider);
  const existingArchives = archived.filter((document) => !captureIds.has(document.id));
  assert.equal(archived.length, 59);
  assert.equal(existingArchives.length, 9);
  assert.deepEqual(
    existingArchives.map((document) => document.id).sort(),
    [
      ...["goods", "commission", "public-works"].map((kind) => `jpo-2022-discretionary-${kind}`),
      ...["competitive", "discretionary"].flatMap((contractClass) =>
        ["goods", "commission", "public-works"].map((kind) => `jpo-2023-${contractClass}-${kind}`)),
    ].sort(),
  );
  for (const document of archived) {
    assert.ok(Number.isSafeInteger(document.archiveExpectedBytes) && document.archiveExpectedBytes >= 500, document.id);
    assert.match(document.archiveExpectedSha256, /^[0-9a-f]{64}$/, document.id);
    assert.ok(Number.isSafeInteger(document.archiveExpectedRecordCount) && document.archiveExpectedRecordCount >= 0, document.id);
  }
});

test("keeps the three FY2025 historical JPO candidates on their live official URLs", () => {
  for (const id of liveFy2025Ids) {
    assert.equal(captureIds.has(id), false, id);
    const document = OFFICIAL_DOCUMENTS.find((item) => item.id === id);
    assert.ok(document, id);
    assert.equal(document.fiscalYear, 2025, id);
    assert.match(document.url, /^https:\/\/www\.jpo\.go\.jp\//, id);
    assert.equal(document.originalUrl, undefined, id);
    assert.equal(document.archiveProvider, undefined, id);
  }
});

test("keeps the three already-published revised SMEA 2020 sources live", () => {
  for (const id of liveRevisedSmea2020Ids) {
    assert.equal(captureIds.has(id), false, id);
    const document = OFFICIAL_DOCUMENTS.find((item) => item.id === id);
    assert.ok(document, id);
    assert.equal(document.fiscalYear, 2020, id);
    assert.match(document.url, /^https:\/\/www\.chusho\.meti\.go\.jp\//, id);
    assert.equal(document.originalUrl, undefined, id);
    assert.equal(document.archiveProvider, undefined, id);
  }
});

test("fails closed if a verified capture is missing or no longer matches its parser definition", () => {
  const originals = OFFICIAL_DOCUMENTS.map((document) => {
    if (!captureIds.has(document.id)) return document;
    const original = { ...document, url: document.originalUrl };
    for (const field of [
      "archiveProvider", "archiveVerifiedAt", "archiveVerification",
      "archiveExpectedBytes", "archiveExpectedSha256", "archiveExpectedRecordCount",
      "discoveryStatus", "originalUrl",
    ]) delete original[field];
    return original;
  });
  assert.equal(applyVerifiedWarpCaptures(originals).filter((item) => item.archiveVerifiedAt).length, 50);
  assert.throws(
    () => applyVerifiedWarpCaptures(originals.filter((item) => item.id !== VERIFIED_WARP_CAPTURES[0].id)),
    /対応する定義がありません/,
  );
  assert.throws(
    () => applyVerifiedWarpCaptures(originals.map((item) => item.id === VERIFIED_WARP_CAPTURES[0].id
      ? { ...item, fiscalYear: item.fiscalYear + 1 }
      : item)),
    /WARP mapと資料定義が一致しません/,
  );
  assert.throws(
    () => applyVerifiedWarpCaptures(originals.map((item) => item.id === VERIFIED_WARP_CAPTURES[0].id
      ? { ...item, sourcePageUrl: "https://www.jpo.go.jp/news/chotatsu/rakusatu/hojokin/index.html" }
      : item)),
    /sourcePageUrl/,
  );
});

test("the SMEA HTML parser accepts only the exact allowlisted archived definition", () => {
  const original = smeaDocuments.find((item) => item.id === "smea-2024-grant-decisions");
  const archived = OFFICIAL_DOCUMENTS.find((item) => item.id === original.id);
  assert.doesNotThrow(() => assertVerifiedWarpReplacement(archived, original));
  const originalRows = parseSmeaOfficialHtml(smeaGrantFixture(), original);
  const archivedRows = parseSmeaOfficialHtml(smeaGrantFixture(), archived);
  assert.deepEqual(
    archivedRows.map((row) => row.sourceKey),
    originalRows.map((row) => row.sourceKey),
    "switching only the transport URL to WARP must not churn published source identities",
  );

  for (const changed of [
    { ...archived, url: archived.url.replace(/\/\d{14}\//, "/20990101000000/") },
    { ...archived, originalUrl: archived.originalUrl.replace("zuikei_hojo_", "other_") },
    { ...archived, sourcePageUrl: "https://www.chusho.meti.go.jp/koukai/nyusatsu/other.html" },
    { ...archived, fiscalYear: 2023 },
  ]) {
    assert.throws(() => assertVerifiedWarpReplacement(Object.freeze(changed), original), /WARP/);
    assert.throws(() => parseSmeaOfficialHtml(smeaGrantFixture(), Object.freeze(changed)), /許可されていない/);
  }
});

function smeaGrantFixture() {
  return Buffer.from(`<!doctype html><html lang="ja"><head><meta charset="UTF-8"></head><body><main>
    <h1>令和6年度補助金等の情報公開</h1>
    <h2>令和6年4月～令和6年9月</h2>
    <table><tr><th>番号</th><th>事業名</th><th>補助金交付先名</th><th>法人番号</th><th>交付決定額</th><th>支出元会計区分</th><th>支出元（目）名</th><th>交付決定日</th></tr>
    <tr><td>1</td><td>補助事業</td><td>株式会社交付先</td><td>8010001120391</td><td>1,000</td><td>一般会計</td><td>補助金</td><td>令和6年4月1日</td></tr></table>
  </main></body></html>`);
}

function countBy(items, key) {
  return items.reduce((result, item) => {
    const value = key(item);
    result[value] = (result[value] ?? 0) + 1;
    return result;
  }, {});
}
