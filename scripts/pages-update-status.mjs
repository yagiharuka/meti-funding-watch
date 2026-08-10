export const PAGE_UPDATE_STALE_AFTER_MS = 30 * 60 * 60 * 1000;
const allowedOutcomes = new Set(["succeeded", "failed", "unknown"]);

export function buildPublicUpdateStatus({
  outcome,
  runId = null,
  runAttempt = null,
  attemptedAt,
  runUrl = null,
  release,
  lastSuccessfulImportAt = null,
}) {
  const value = {
    schemaVersion: 1,
    attempt: {
      runId: runId === null ? null : String(runId),
      runAttempt: runAttempt === null ? null : Number(runAttempt),
      attemptedAt,
      outcome,
      runUrl,
    },
    publishedRelease: {
      commitSha: release.commitSha,
      generatedAt: release.generatedAt,
      lastSuccessfulImportAt,
    },
  };
  return validatePublicUpdateStatus(value);
}

export function validatePublicUpdateStatus(value) {
  if (!value || typeof value !== "object") throw new Error("更新状態の形式が不正です");
  const attempt = value.attempt;
  const published = value.publishedRelease;
  if (
    value.schemaVersion !== 1
    || !attempt || typeof attempt !== "object"
    || !allowedOutcomes.has(attempt.outcome)
    || (attempt.runId !== null && (typeof attempt.runId !== "string" || !/^\d+$/.test(attempt.runId)))
    || (attempt.runAttempt !== null && (!Number.isSafeInteger(attempt.runAttempt) || attempt.runAttempt < 1))
    || !isIsoTimestamp(attempt.attemptedAt)
    || (attempt.runUrl !== null && !isAllowedRunUrl(attempt.runUrl, attempt.runId))
    || !published || typeof published !== "object"
    || typeof published.commitSha !== "string" || !/^[0-9a-f]{40}$/i.test(published.commitSha)
    || !isIsoTimestamp(published.generatedAt)
    || (published.lastSuccessfulImportAt !== null && !isIsoTimestamp(published.lastSuccessfulImportAt))
  ) {
    throw new Error("更新状態の形式が不正です");
  }
  return value;
}

export function evaluatePublicUpdateHealth(value, release, now = Date.now()) {
  let status;
  try {
    status = validatePublicUpdateStatus(value);
  } catch {
    return "unknown";
  }
  if (
    !release
    || status.publishedRelease.commitSha !== release.commitSha
    || status.publishedRelease.generatedAt !== release.generatedAt
  ) return "unknown";
  if (status.attempt.outcome === "failed") return "failed";
  if (status.attempt.outcome !== "succeeded") return "unknown";
  const successAt = Date.parse(status.publishedRelease.lastSuccessfulImportAt ?? "");
  if (!Number.isFinite(successAt) || successAt > now + 5 * 60 * 1000) return "unknown";
  return now - successAt > PAGE_UPDATE_STALE_AFTER_MS ? "stale" : "healthy";
}

function isIsoTimestamp(value) {
  return typeof value === "string"
    && !Number.isNaN(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function isAllowedRunUrl(value, runId) {
  if (typeof value !== "string" || runId === null) return false;
  return value === `https://github.com/yagiharuka/meti-funding-watch/actions/runs/${runId}`;
}
