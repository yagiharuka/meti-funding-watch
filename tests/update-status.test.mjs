import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { verifyLivePages } from "../scripts/live-pages-verifier.mjs";
import {
  PAGE_UPDATE_STALE_AFTER_MS,
  buildPublicUpdateStatus,
  evaluatePublicUpdateHealth,
  validatePublicUpdateStatus,
} from "../scripts/pages-update-status.mjs";

const now = Date.parse("2026-08-10T01:00:00.000Z");
const releaseIdentity = {
  commitSha: "a".repeat(40),
  generatedAt: "2026-08-10T00:00:00.000Z",
};

function status(outcome = "succeeded", successAt = "2026-08-10T00:00:00.000Z") {
  return buildPublicUpdateStatus({
    outcome,
    runId: "123",
    runAttempt: 1,
    attemptedAt: "2026-08-10T00:30:00.000Z",
    runUrl: "https://github.com/yagiharuka/meti-funding-watch/actions/runs/123",
    release: releaseIdentity,
    lastSuccessfulImportAt: successAt,
  });
}

test("separates failed, stale, healthy, and mismatched update states", () => {
  assert.equal(evaluatePublicUpdateHealth(status(), releaseIdentity, now), "healthy");
  assert.equal(evaluatePublicUpdateHealth(status("failed"), releaseIdentity, now), "failed");
  const oldSuccess = new Date(now - PAGE_UPDATE_STALE_AFTER_MS - 1).toISOString();
  assert.equal(evaluatePublicUpdateHealth(status("succeeded", oldSuccess), releaseIdentity, now), "stale");
  assert.equal(evaluatePublicUpdateHealth(status(), { ...releaseIdentity, commitSha: "b".repeat(40) }, now), "unknown");
  assert.equal(evaluatePublicUpdateHealth(null, releaseIdentity, now), "unknown");
});

test("rejects untrusted update status links and invalid release bindings", () => {
  const value = status();
  assert.equal(validatePublicUpdateStatus(value), value);
  assert.throws(
    () => validatePublicUpdateStatus({ ...value, attempt: { ...value.attempt, runUrl: "https://example.com/123" } }),
    /形式が不正/,
  );
});

test("live verifier binds status, release, manifest, chunks, and ID set", async () => {
  const rowsText = `${JSON.stringify([{ id: "row-1" }])}\n`;
  const manifestText = `${JSON.stringify({
    generatedAt: releaseIdentity.generatedAt,
    commitments: { 2026: "commitments-2026.json" },
  }, null, 2)}\n`;
  const officialRowsText = `${JSON.stringify([{ id: "official-1" }])}\n`;
  const officialManifestText = `${JSON.stringify({
    schemaVersion: 1,
    generatedAt: releaseIdentity.generatedAt,
    recordCount: 1,
    files: { 2025: "records-2025.json" },
  }, null, 2)}\n`;
  const release = {
    schemaVersion: 1,
    ...releaseIdentity,
    recordCount: 1,
    manifestSha256: sha256(manifestText),
    idSetSha256: sha256("row-1\n"),
    appShell: {
      "index.html": {
        sha256: sha256("<main>verified</main>\n"),
        bytes: Buffer.byteLength("<main>verified</main>\n"),
      },
    },
    files: {
      "commitments-2026.json": {
        sha256: sha256(rowsText),
        bytes: Buffer.byteLength(rowsText),
        rows: 1,
      },
    },
    official: {
      generatedAt: releaseIdentity.generatedAt,
      recordCount: 1,
      manifestSha256: sha256(officialManifestText),
      idSetSha256: sha256("official-1\n"),
      files: {
        "records-2025.json": {
          sha256: sha256(officialRowsText),
          bytes: Buffer.byteLength(officialRowsText),
          rows: 1,
        },
      },
    },
  };
  const bodies = new Map([
    ["release.json", `${JSON.stringify(release)}\n`],
    ["update-status.json", `${JSON.stringify(status())}\n`],
    ["data/manifest.json", manifestText],
    ["data/official/manifest.json", officialManifestText],
    ["data/official/records-2025.json", officialRowsText],
    ["data/commitments-2026.json", rowsText],
    ["index.html", "<main>verified</main>\n"],
  ]);
  const fetchImpl = async (url) => {
    const key = new URL(url).pathname.replace("/meti-funding-watch/", "");
    return bodies.has(key)
      ? new Response(bodies.get(key), { status: 200 })
      : new Response("not found", { status: 404 });
  };
  const verified = await verifyLivePages({
    baseUrl: "https://example.test/meti-funding-watch/",
    expectedRunId: "123",
    expectedRunAttempt: "1",
    expectedOutcome: "succeeded",
    expectedCommit: releaseIdentity.commitSha,
    fetchImpl,
  });
  assert.equal(verified.recordCount, 1);
  assert.equal(verified.officialRecordCount, 1);
  await assert.rejects(
    verifyLivePages({
      baseUrl: "https://example.test/meti-funding-watch/",
      expectedRunId: "999",
      expectedRunAttempt: "1",
      expectedOutcome: "succeeded",
      expectedCommit: releaseIdentity.commitSha,
      fetchImpl,
    }),
    /run ID/,
  );
  await assert.rejects(
    verifyLivePages({
      baseUrl: "https://example.test/meti-funding-watch/",
      expectedRunId: "123",
      expectedRunAttempt: "2",
      expectedOutcome: "succeeded",
      expectedCommit: releaseIdentity.commitSha,
      fetchImpl,
    }),
    /run attempt/,
  );
  bodies.set("index.html", "<main>stale UI</main>\n");
  await assert.rejects(
    verifyLivePages({
      baseUrl: "https://example.test/meti-funding-watch/",
      expectedRunId: "123",
      expectedRunAttempt: "1",
      expectedOutcome: "succeeded",
      expectedCommit: releaseIdentity.commitSha,
      fetchImpl,
    }),
    /index\.htmlの公開内容/,
  );
});

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
