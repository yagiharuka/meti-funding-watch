import { setTimeout as delay } from "node:timers/promises";
import { verifyLivePages } from "./live-pages-verifier.mjs";

const baseUrl = process.env.PAGES_URL;
const expectedRunId = process.env.EXPECTED_RUN_ID;
const expectedRunAttempt = process.env.EXPECTED_RUN_ATTEMPT;
const expectedOutcome = process.env.EXPECTED_OUTCOME;
const expectedCommit = process.env.EXPECTED_COMMIT;
if (!baseUrl || !expectedRunId || !expectedRunAttempt || !expectedOutcome || !expectedCommit) {
  throw new Error("公開後検証に必要な環境変数がありません");
}

let lastError;
for (let attempt = 1; attempt <= 12; attempt += 1) {
  try {
    const result = await verifyLivePages({
      baseUrl,
      expectedRunId,
      expectedRunAttempt,
      expectedOutcome,
      expectedCommit,
      cacheBust: `${expectedRunId}-${attempt}`,
    });
    console.log(`Verified live Pages release ${result.release.commitSha} (${result.recordCount} rows)`);
    process.exit(0);
  } catch (error) {
    lastError = error;
    console.warn(`Live verification attempt ${attempt}/12 failed: ${error instanceof Error ? error.message : String(error)}`);
    if (attempt < 12) await delay(10_000);
  }
}
throw lastError;
