import assert from "node:assert/strict";
import test from "node:test";

import ExcelJS from "exceljs";

import {
  fetchOfficialDocuments,
  OFFICIAL_PARSER_REVISION,
  officialDocumentDefinitionSha256,
} from "../scripts/update-official-data.mjs";

test("retries a transient empty live response twice and then parses the third response", async () => {
  const document = grantDocument({
    id: "live-retry-fixture",
    sourcePageUrl: "https://www.jpo.go.jp/example/index.html",
    url: "https://www.jpo.go.jp/example/live.xlsx",
  });
  const validBytes = await grantWorkbookBytes();
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response(calls < 3 ? new Uint8Array() : validBytes, { status: 200 });
  };

  const result = await fetchOfficialDocuments([document], [], fetchImpl);
  assert.equal(calls, 3);
  assert.equal(result.sourceFailures.length, 0);
  assert.equal(result.fetched.length, 1);
  assert.equal(result.fetched[0].records.length, 1);
});

test("rejects an unreceipted archive definition and never retries a live parse failure", async () => {
  const archived = grantDocument({
    id: "archive-no-retry-fixture",
    sourcePageUrl: "https://www.jpo.go.jp/example/index.html",
    url: "https://warp.ndl.go.jp/20260101/20260101000000/https://www.jpo.go.jp/example/archive.xlsx",
    archiveProvider: "国立国会図書館インターネット資料収集保存事業（WARP）",
  });
  let archiveCalls = 0;
  await assert.rejects(
    fetchOfficialDocuments([archived], [], async () => {
      archiveCalls += 1;
      return new Response(new Uint8Array(), { status: 200 });
    }),
    /WARP資料の検証済みreceipt定義がありません/,
  );
  assert.equal(archiveCalls, 0, "an archive without a receipt must fail before network access");

  const malformed = grantDocument({
    id: "live-parse-no-retry-fixture",
    sourcePageUrl: "https://www.jpo.go.jp/example/index.html",
    url: "https://www.jpo.go.jp/example/malformed.xlsx",
  });
  const malformedBytes = Buffer.concat([Buffer.from("PK\u0003\u0004"), Buffer.alloc(600)]);
  let parseCalls = 0;
  const parseResult = await fetchOfficialDocuments([malformed], [], async () => {
    parseCalls += 1;
    return new Response(malformedBytes, { status: 200 });
  });
  assert.equal(parseCalls, 1);
  assert.equal(parseResult.sourceFailures[0].reasonCode, "parse_failed");
});

test("requires a committed verified WARP capture and enforces its byte, hash, and record receipts", async () => {
  const validBytes = await grantWorkbookBytes();
  const expectedSha256 = await sha256(validBytes);
  const archived = grantDocument({
    id: "archive-required-fixture",
    sourcePageUrl: "https://www.jpo.go.jp/example/index.html",
    url: "https://warp.ndl.go.jp/20260101/20260101000000/https://www.jpo.go.jp/example/archive.xlsx",
    archiveProvider: "国立国会図書館インターネット資料収集保存事業（WARP）",
    archiveExpectedBytes: validBytes.length,
    archiveExpectedSha256: expectedSha256,
    archiveExpectedRecordCount: 1,
  });

  let emptyCalls = 0;
  await assert.rejects(
    fetchOfficialDocuments([archived], [], async () => {
      emptyCalls += 1;
      return new Response(new Uint8Array(), { status: 200 });
    }),
    /検証済みWARP資料を再検証できません/,
  );
  assert.equal(emptyCalls, 1, "verified WARP captures are fetched exactly once");

  await assert.rejects(
    fetchOfficialDocuments([{ ...archived, archiveExpectedBytes: validBytes.length + 1 }], [], async () =>
      new Response(validBytes, { status: 200 })),
    /バイト数が検証済み値と一致しません/,
  );
  await assert.rejects(
    fetchOfficialDocuments([{ ...archived, archiveExpectedSha256: "0".repeat(64) }], [], async () =>
      new Response(validBytes, { status: 200 })),
    /SHA-256が検証済み値と一致しません/,
  );
  await assert.rejects(
    fetchOfficialDocuments([{ ...archived, archiveExpectedRecordCount: 2 }], [], async () =>
      new Response(validBytes, { status: 200 })),
    /明細数が検証済み値と一致しません/,
  );

  const valid = await fetchOfficialDocuments([archived], [], async () => new Response(validBytes, { status: 200 }));
  assert.equal(valid.fetched.length, 1);
  assert.equal(valid.sourceFailures.length, 0);
});

test("carries a pinned published WARP source for HTTP 403 or a transient transport failure", async () => {
  const validBytes = await grantWorkbookBytes();
  const expectedSha256 = await sha256(validBytes);
  const originalUrl = "https://www.jpo.go.jp/example/archive.xlsx";
  const archived = grantDocument({
    id: "archive-403-carry-fixture",
    sourcePageUrl: "https://www.jpo.go.jp/example/index.html",
    originalUrl,
    url: `https://warp.ndl.go.jp/20260101/20260101000000/${originalUrl}`,
    archiveProvider: "国立国会図書館インターネット資料収集保存事業（WARP）",
    archiveVerifiedAt: "2026-08-12",
    archiveVerification: "exact archive fixture",
    archiveExpectedBytes: validBytes.length,
    archiveExpectedSha256: expectedSha256,
    archiveExpectedRecordCount: 1,
    discoveryStatus: "archived_official_file",
    coverageClaim: "fixture one-row archive",
  });
  const first = await fetchOfficialDocuments([archived], [], async () => new Response(validBytes));
  const baseline = first.fetched[0].records;
  const previousReceipt = archiveReceipt(archived, validBytes, baseline.length);

  let calls = 0;
  const carried = await fetchOfficialDocuments(
    [archived], baseline, async () => {
      calls += 1;
      return new Response("forbidden".padEnd(600), { status: 403 });
    }, [archived.id], [previousReceipt],
  );
  assert.equal(calls, 1, "a pinned WARP capture is attempted once");
  assert.equal(carried.sourceFailures.length, 0);
  assert.deepEqual(carried.fetched[0].records, baseline);
  assert.deepEqual(carried.fetched[0].carryForward, {
    primaryFailureReasonCode: "archive_http_403",
    lastSuccessfulRetrievedAt: previousReceipt.retrievedAt,
    emptySentinelFound: false,
  });
  assert.equal(carried.fetched[0].sha256, archived.archiveExpectedSha256);
  assert.equal(carried.fetched[0].bytes, archived.archiveExpectedBytes);

  const repeatedReceipt = {
    ...previousReceipt,
    carryForwardUsed: true,
    primaryFailureReasonCode: "archive_http_403",
    lastSuccessfulRetrievedAt: previousReceipt.retrievedAt,
    attemptedAt: "2026-08-12T01:00:00.000Z",
  };
  const repeated = await fetchOfficialDocuments(
    [archived], baseline, async () => new Response("forbidden".padEnd(600), { status: 403 }),
    [archived.id], [repeatedReceipt],
  );
  assert.equal(repeated.fetched[0].carryForward.lastSuccessfulRetrievedAt, previousReceipt.retrievedAt);

  const transient = await fetchOfficialDocuments(
    [archived], baseline, async () => { throw new TypeError("network timeout"); },
    [archived.id], [previousReceipt],
  );
  assert.equal(transient.fetched[0].carryForward.primaryFailureReasonCode, "fetch_failed");

  await assert.rejects(
    fetchOfficialDocuments([archived], [], async () => new Response("forbidden".padEnd(600), { status: 403 })),
    /検証済みWARP資料を再検証できません/,
    "a first-seen archive must never be carried without prior evidence",
  );
});

test("never carries a WARP archive after permanent fetch or post-fetch verification failures", async () => {
  const validBytes = await grantWorkbookBytes();
  const expectedSha256 = await sha256(validBytes);
  const originalUrl = "https://www.jpo.go.jp/example/archive.xlsx";
  const archived = grantDocument({
    id: "archive-carry-refusal-fixture",
    sourcePageUrl: "https://www.jpo.go.jp/example/index.html",
    originalUrl,
    url: `https://warp.ndl.go.jp/20260101/20260101000000/${originalUrl}`,
    archiveProvider: "国立国会図書館インターネット資料収集保存事業（WARP）",
    archiveVerifiedAt: "2026-08-12",
    archiveVerification: "exact archive fixture",
    archiveExpectedBytes: validBytes.length,
    archiveExpectedSha256: expectedSha256,
    archiveExpectedRecordCount: 1,
    discoveryStatus: "archived_official_file",
    coverageClaim: "fixture one-row archive",
  });
  const baseline = (await fetchOfficialDocuments([archived], [], async () => new Response(validBytes))).fetched[0].records;
  const receipt = archiveReceipt(archived, validBytes, baseline.length);
  const attempt = (document, response, priorReceipt = receipt) => fetchOfficialDocuments(
    [document], baseline, async () => response(), [archived.id], [priorReceipt],
  );

  for (const response of [
    () => new Response("missing".padEnd(600), { status: 404 }),
    () => new Response(null, { status: 302, headers: { location: archived.url } }),
    () => new Response(new Uint8Array(validBytes.length).fill(1), { status: 200 }),
    () => new Response(Buffer.concat([Buffer.from("PK\u0003\u0004"), Buffer.alloc(600)]), { status: 200 }),
  ]) {
    await assert.rejects(attempt(archived, response));
  }

  for (const mutation of [
    { sourcePageUrl: "https://www.jpo.go.jp/example/changed-index.html" },
    { coverageClaim: "changed coverage" },
    { kind: "changed kind" },
    { fiscalYear: 2024 },
    { headerAliases: { "事業名": ["changed header"] } },
    { archiveExpectedSha256: "0".repeat(64) },
  ]) {
    const changed = { ...archived, ...mutation };
    await assert.rejects(
      fetchOfficialDocuments(
        [changed], baseline, async () => new Response("forbidden".padEnd(600), { status: 403 }),
        [changed.id], [receipt],
      ),
    );
  }
});

test("retries a transient live response-body failure and succeeds on the third body", async () => {
  const document = grantDocument({
    id: "live-body-retry-fixture",
    sourcePageUrl: "https://www.jpo.go.jp/example/index.html",
    url: "https://www.jpo.go.jp/example/live.xlsx",
  });
  const validBytes = await grantWorkbookBytes();
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls < 3) {
      return {
        status: 200,
        ok: true,
        headers: new Headers(),
        async arrayBuffer() {
          throw new TypeError("response body terminated");
        },
      };
    }
    return new Response(validBytes, { status: 200 });
  };

  const result = await fetchOfficialDocuments([document], [], fetchImpl);
  assert.equal(calls, 3);
  assert.equal(result.sourceFailures.length, 0);
  assert.equal(result.fetched[0].records.length, 1);
});

test("stops after three failed live response bodies", async () => {
  const document = grantDocument({
    id: "live-body-exhausted-fixture",
    sourcePageUrl: "https://www.jpo.go.jp/example/index.html",
    url: "https://www.jpo.go.jp/example/live.xlsx",
  });
  let calls = 0;
  const result = await fetchOfficialDocuments([document], [], async () => {
    calls += 1;
    return {
      status: 200,
      ok: true,
      headers: new Headers(),
      async arrayBuffer() {
        throw new TypeError("response body terminated");
      },
    };
  });

  assert.equal(calls, 3);
  assert.equal(result.fetched.length, 0);
  assert.equal(result.sourceFailures[0].reasonCode, "fetch_failed");
});

test("treats HTTP 202 WAF-like responses as transient and carries forward a published source", async () => {
  const validBytes = await grantWorkbookBytes();
  const document = grantDocument({
    id: "waf-202-carry-forward-fixture",
    sourcePageUrl: "https://www.jpo.go.jp/example/index.html",
    url: "https://www.jpo.go.jp/example/live.xlsx",
  });
  const baseline = (await fetchOfficialDocuments([document], [], async () => new Response(validBytes))).fetched[0].records;
  const previousReceipt = {
    id: document.id,
    url: document.url,
    originalUrl: document.url,
    sourcePageUrl: document.sourcePageUrl,
    format: "xlsx",
    discoveryStatus: "linked_from_official_index",
    coverageClaim: "公式資料に掲載された行",
    parserRevision: OFFICIAL_PARSER_REVISION,
    definitionSha256: officialDocumentDefinitionSha256(document),
    executorId: document.executorId,
    category: document.category,
    kind: document.kind,
    fiscalYear: document.fiscalYear,
    sha256: await sha256(validBytes),
    bytes: validBytes.length,
    records: baseline.length,
    retrievedAt: "2026-08-11T00:00:00.000Z",
  };
  let calls = 0;
  const result = await fetchOfficialDocuments(
    [document], baseline, async () => {
      calls += 1;
      return new Response("AWS WAF challenge".padEnd(600), { status: 202 });
    }, [document.id], [previousReceipt],
  );
  assert.equal(calls, 3);
  assert.equal(result.sourceFailures.length, 0);
  assert.equal(result.fetched[0].carryForward.primaryFailureReasonCode, "transient_http");

  const firstRun = await fetchOfficialDocuments([document], [], async () =>
    new Response("AWS WAF challenge".padEnd(600), { status: 202 }));
  assert.equal(firstRun.fetched.length, 0);
  assert.equal(firstRun.sourceFailures[0].reasonCode, "fetch_failed");
});

test("uses an exact verified WARP fallback only after transient live exhaustion and exact baseline equality", async () => {
  const validBytes = await grantWorkbookBytes();
  const sha = await sha256(validBytes);
  const primary = grantDocument({
    id: "fallback-fixture",
    sourcePageUrl: "https://www.jpo.go.jp/example/index.html",
    url: "https://www.jpo.go.jp/example/live.xlsx",
  });
  const archiveUrl = `https://warp.ndl.go.jp/20260101/20260101000000/${primary.url}`;
  const configured = {
    ...primary,
    verifiedFallback: {
      id: primary.id,
      capture: "20260101/20260101000000",
      url: archiveUrl,
      originalUrl: primary.url,
      expectedBytes: validBytes.length,
      expectedSha256: sha,
      expectedRecordCount: 1,
    },
  };
  const firstPass = await fetchOfficialDocuments([primary], [], async () => new Response(validBytes, { status: 200 }));
  const baseline = firstPass.fetched[0].records;
  let primaryCalls = 0;
  let fallbackCalls = 0;
  const result = await fetchOfficialDocuments([configured], baseline, async (url) => {
    if (url === archiveUrl) {
      fallbackCalls += 1;
      return new Response(validBytes, { status: 200 });
    }
    primaryCalls += 1;
    return new Response(new Uint8Array(), { status: 200 });
  });
  assert.equal(primaryCalls, 3);
  assert.equal(fallbackCalls, 1);
  assert.equal(result.fetched[0].fallback.primaryFailureReasonCode, "empty_response");
  assert.equal(result.fetched[0].records.length, 1);

  await assert.rejects(
    fetchOfficialDocuments([configured], [], async (url) =>
      new Response(url === archiveUrl ? validBytes : new Uint8Array(), { status: 200 })),
    /前回公開済み明細がない/,
  );
  await assert.rejects(
    fetchOfficialDocuments([configured], [{ ...baseline[0], amount: 999 }], async (url) =>
      new Response(url === archiveUrl ? validBytes : new Uint8Array(), { status: 200 })),
    /前回公開済み明細と一致しません/,
  );
});

test("never falls back on HTTP 404, redirects, or a successful response that fails parsing", async () => {
  const validBytes = await grantWorkbookBytes();
  const primary = grantDocument({
    id: "fallback-refusal-fixture",
    sourcePageUrl: "https://www.jpo.go.jp/example/index.html",
    url: "https://www.jpo.go.jp/example/live.xlsx",
  });
  const archiveUrl = `https://warp.ndl.go.jp/20260101/20260101000000/${primary.url}`;
  const configured = {
    ...primary,
    verifiedFallback: {
      id: primary.id, capture: "20260101/20260101000000", url: archiveUrl, originalUrl: primary.url,
      expectedBytes: validBytes.length, expectedSha256: await sha256(validBytes), expectedRecordCount: 1,
    },
  };
  const baseline = (await fetchOfficialDocuments([primary], [], async () => new Response(validBytes))).fetched[0].records;
  for (const response of [
    () => new Response("missing".padEnd(600), { status: 404 }),
    () => new Response(null, { status: 302, headers: { location: archiveUrl } }),
    () => new Response(Buffer.concat([Buffer.from("PK\u0003\u0004"), Buffer.alloc(600)]), { status: 200 }),
  ]) {
    let fallbackCalls = 0;
    await assert.rejects(fetchOfficialDocuments([configured], baseline, async (url) => {
      if (url === archiveUrl) fallbackCalls += 1;
      return response();
    }));
    assert.equal(fallbackCalls, 0);
  }
});

test("carries forward exact prior rows and receipt only after transient live exhaustion", async () => {
  const validBytes = await grantWorkbookBytes();
  const document = grantDocument({
    id: "carry-forward-fixture",
    sourcePageUrl: "https://www.jpo.go.jp/example/index.html",
    url: "https://www.jpo.go.jp/example/live.xlsx",
  });
  const baseline = (await fetchOfficialDocuments([document], [], async () => new Response(validBytes))).fetched[0].records;
  const previousReceipt = {
    id: document.id,
    url: document.url,
    originalUrl: document.url,
    sourcePageUrl: document.sourcePageUrl,
    format: "xlsx",
    discoveryStatus: "linked_from_official_index",
    coverageClaim: "公式資料に掲載された行",
    parserRevision: OFFICIAL_PARSER_REVISION,
    definitionSha256: officialDocumentDefinitionSha256(document),
    executorId: document.executorId,
    category: document.category,
    kind: document.kind,
    fiscalYear: document.fiscalYear,
    sha256: await sha256(validBytes),
    bytes: validBytes.length,
    records: baseline.length,
    retrievedAt: "2026-08-11T00:00:00.000Z",
  };
  let calls = 0;
  const result = await fetchOfficialDocuments(
    [document], baseline, async () => { calls += 1; return new Response(new Uint8Array(), { status: 200 }); },
    [document.id], [previousReceipt],
  );
  assert.equal(calls, 3);
  assert.deepEqual(result.fetched[0].records, baseline);
  assert.deepEqual(result.fetched[0].carryForward, {
    primaryFailureReasonCode: "empty_response",
    lastSuccessfulRetrievedAt: previousReceipt.retrievedAt,
    emptySentinelFound: false,
  });
  const repeatedReceipt = {
    ...previousReceipt,
    primaryUrl: document.url,
    transportUrl: document.url,
    carryForwardUsed: true,
    primaryFailureReasonCode: "empty_response",
    lastSuccessfulRetrievedAt: previousReceipt.retrievedAt,
    attemptedAt: "2026-08-12T00:00:00.000Z",
  };
  const repeated = await fetchOfficialDocuments(
    [document], baseline, async () => new Response(new Uint8Array()), [document.id], [repeatedReceipt],
  );
  assert.deepEqual(repeated.fetched[0].records, baseline);
  assert.equal(repeated.fetched[0].carryForward.lastSuccessfulRetrievedAt, previousReceipt.retrievedAt);
  assert.equal(repeated.fetched[0].sha256, previousReceipt.sha256);
  assert.equal(repeated.fetched[0].bytes, previousReceipt.bytes);

  const zeroDocument = { ...document, id: "carry-forward-zero-fixture", emptySentinel: "交付決定なし" };
  const zeroReceipt = {
    ...previousReceipt,
    id: zeroDocument.id,
    records: 0,
    emptySentinelFound: true,
    carryForwardUsed: true,
    definitionSha256: officialDocumentDefinitionSha256(zeroDocument),
    lastSuccessfulRetrievedAt: previousReceipt.retrievedAt,
    attemptedAt: "2026-08-12T00:00:00.000Z",
  };
  const repeatedZero = await fetchOfficialDocuments(
    [zeroDocument], [], async () => new Response(new Uint8Array()), [zeroDocument.id], [zeroReceipt],
  );
  assert.equal(repeatedZero.fetched[0].records.length, 0);
  assert.equal(repeatedZero.fetched[0].carryForward.emptySentinelFound, true);
  for (const invalidZeroReceipt of [
    { ...zeroReceipt, emptySentinelFound: false },
    Object.fromEntries(Object.entries(zeroReceipt).filter(([key]) => key !== "emptySentinelFound")),
  ]) {
    await assert.rejects(fetchOfficialDocuments(
      [zeroDocument], [], async () => new Response(new Uint8Array()), [zeroDocument.id], [invalidZeroReceipt],
    ), /0件表記receiptが明細数と一致しません/);
  }
  await assert.rejects(fetchOfficialDocuments(
    [document], baseline, async () => new Response(new Uint8Array()), [document.id],
    [{ ...previousReceipt, emptySentinelFound: true }],
  ), /0件表記receiptが明細数と一致しません/);

  for (const response of [
    new Response("missing".padEnd(600), { status: 404 }),
    new Response(null, { status: 302, headers: { location: "https://example.test/redirect" } }),
    new Response(Buffer.concat([Buffer.from("PK\u0003\u0004"), Buffer.alloc(600)]), { status: 200 }),
  ]) {
    await assert.rejects(fetchOfficialDocuments(
      [document], baseline, async () => response.clone(), [document.id], [previousReceipt],
    ));
  }
  await assert.rejects(fetchOfficialDocuments(
    [document], baseline, async () => new Response(new Uint8Array()), [document.id],
    [{ ...previousReceipt, originalUrl: "https://example.test/wrong.xlsx" }],
  ), /receiptまたは明細が資料定義と一致しません/);
  for (const mutation of [
    { url: "https://example.test/wrong.xlsx" },
    { sourcePageUrl: "https://example.test/wrong-page" },
    { kind: "別の種類" },
    { archiveProvider: "WARP" },
    { records: baseline.length + 1 },
  ]) {
    await assert.rejects(fetchOfficialDocuments(
      [document], baseline, async () => new Response(new Uint8Array()), [document.id],
      [{ ...previousReceipt, ...mutation }],
    ), /receiptまたは明細が資料定義と一致しません/);
  }
});

function grantDocument(overrides) {
  return {
    executorId: "jpo",
    executorName: "特許庁",
    fiscalYear: 2025,
    category: "grant_decision",
    kind: "補助金等の交付決定",
    amountStage: "交付決定額",
    format: "xlsx",
    ...overrides,
  };
}

function archiveReceipt(document, bytes, records) {
  return {
    id: document.id,
    url: document.url,
    primaryUrl: document.url,
    transportUrl: document.url,
    fallbackUsed: false,
    carryForwardUsed: false,
    originalUrl: document.originalUrl,
    sourcePageUrl: document.sourcePageUrl,
    format: document.format,
    discoveryStatus: document.discoveryStatus,
    archiveProvider: document.archiveProvider,
    archiveVerifiedAt: document.archiveVerifiedAt,
    archiveVerification: document.archiveVerification,
    archiveExpectedBytes: document.archiveExpectedBytes,
    archiveExpectedSha256: document.archiveExpectedSha256,
    archiveExpectedRecordCount: document.archiveExpectedRecordCount,
    evidenceExpectedMagic: null,
    evidenceExpectedBytes: null,
    evidenceExpectedSha256: null,
    evidenceExpectedRecordCount: null,
    evidenceVerified: false,
    parserRevision: OFFICIAL_PARSER_REVISION,
    definitionSha256: officialDocumentDefinitionSha256(document),
    coverageClaim: document.coverageClaim,
    executorId: document.executorId,
    category: document.category,
    kind: document.kind,
    fiscalYear: document.fiscalYear,
    sha256: document.archiveExpectedSha256,
    bytes: bytes.length,
    records,
    emptySentinelFound: false,
    retrievedAt: "2026-08-11T00:00:00.000Z",
  };
}

async function grantWorkbookBytes() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("fixture");
  sheet.addRow(["事業名", "交付先名", "法人番号", "交付決定額", "交付決定日"]);
  sheet.addRow(["補助事業", "法人A", "6010001030403", "1,000", "2025年4月1日"]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function sha256(value) {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(value).digest("hex");
}
