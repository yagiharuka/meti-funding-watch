import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const projectRoot = new URL("../", import.meta.url);

test("runs the review ZIP/CSV pipeline offline from a fixed fixture", async () => {
  const temporary = await mkdtemp(join(fileURLToPath(projectRoot), ".tmp-review-fixture-"));
  const output = join(temporary, "review-cache");
  const args = [
    "scripts/update-review-data.mjs",
    "--fixture-dir", "tests/fixtures/review",
    "--output-dir", output,
    "--now", "2026-08-16T01:34:06.322Z",
    "--require-fresh",
  ];
  try {
    await execFileAsync(process.execPath, args, { cwd: projectRoot, timeout: 30_000 });
    const first = await readOutput(output);
    await execFileAsync(process.execPath, args, { cwd: projectRoot, timeout: 30_000 });
    const second = await readOutput(output);

    assert.equal(first.manifest.generatedAt, "2026-08-16T01:34:06.322Z");
    assert.equal(first.manifest.lastSuccessfulSourceRefreshAt, "2026-08-16T01:34:06.322Z");
    assert.equal(first.manifest.lastSuccessfulSourceRefreshDate, "2026-08-16");
    assert.equal(first.manifest.refreshStatus, "fresh");
    assert.deepEqual(first.manifest.reviewSheetYears, [2025]);
    assert.equal(first.manifest.programCount, 1);
    assert.equal(first.manifest.paymentCount, 4);
    assert.equal(first.manifest.excludedRowCount, 1);
    assert.deepEqual(first.manifest.rowAccounting.totals.amountStatusCounts, {
      positive: 2, zero: 1, negative: 1, blank: 1, invalid: 0,
    });
    assert.equal(first.manifest.rowAccounting.totals.sourcePaymentRowCount, 5);
    assert.equal(first.manifest.rowAccounting.totals.publishedPaymentRowCount, 4);
    assert.equal(first.manifest.rowAccounting.totals.excludedPaymentRowCount, 1);
    assert.equal(first.manifest.sourceReceipts.length, 4);
    assert.ok(first.manifest.sourceReceipts.every((receipt) => receipt.fixtureOnly === true));
    assert.deepEqual(first.excludedRows[0].reasons, ["organization_blank"]);

    const byBlock = new Map(first.payments.map((row) => [row.block, row]));
    assert.equal(byBlock.get("A").amountStatus, "positive");
    assert.equal(byBlock.get("B").amountStatus, "zero");
    assert.equal(byBlock.get("C").amountStatus, "negative");
    assert.equal(byBlock.get("D").amountStatus, "blank");
    assert.equal(byBlock.get("A").flowLevel, "disclosed_intermediary");
    assert.deepEqual(byBlock.get("B").parentPaymentIds, [byBlock.get("A").id]);
    assert.equal(byBlock.get("D").corporateNumber, "");

    assert.deepEqual(second.manifest.sourceReceipts, first.manifest.sourceReceipts);
    assert.deepEqual(second.payments.map((row) => row.id), first.payments.map((row) => row.id));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("strict review refresh rejects carry-forward and preserves the prior cache", async () => {
  const temporary = await mkdtemp(join(fileURLToPath(projectRoot), ".tmp-review-strict-"));
  const output = join(temporary, "review-cache");
  const unavailableFixture = join(temporary, "unavailable-fixture");
  try {
    await execFileAsync(process.execPath, [
      "scripts/update-review-data.mjs",
      "--fixture-dir", "tests/fixtures/review",
      "--output-dir", output,
      "--now", "2026-08-16T01:34:06.322Z",
      "--require-fresh",
    ], { cwd: projectRoot, timeout: 30_000 });
    await mkdir(unavailableFixture, { recursive: true });
    await writeFile(join(unavailableFixture, "years.json"), "[2025]\n");
    await assert.rejects(
      execFileAsync(process.execPath, [
        "scripts/update-review-data.mjs",
        "--fixture-dir", unavailableFixture,
        "--output-dir", output,
        "--now", "2026-08-18T01:00:00.000Z",
        "--require-fresh",
      ], { cwd: projectRoot, timeout: 30_000 }),
      (error) => {
        assert.match(error.stderr, /前回値は公開用データへ置き換えません/);
        return true;
      },
    );
    const retained = await readOutput(output);
    assert.equal(retained.manifest.refreshStatus, "fresh");
    assert.equal(retained.manifest.generatedAt, "2026-08-16T01:34:06.322Z");
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

async function readOutput(output) {
  const manifest = JSON.parse(await readFile(join(output, "manifest.json"), "utf8"));
  const payments = (await Promise.all(manifest.paymentFiles.map(async (filename) =>
    JSON.parse(await readFile(join(output, filename), "utf8"))))).flat();
  const excludedRows = JSON.parse(await readFile(join(output, manifest.excludedRowsFile), "utf8"));
  return { manifest, payments, excludedRows };
}
