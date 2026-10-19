import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import {
  discoverPublishedReviewSheetYears,
  moduleScriptUrls,
  publishedYearsFromHtml,
  publishedYearsFromModule,
  REVIEW_CSV_INDEX_URL,
} from "../scripts/review-csv-discovery.mjs";

const execFileAsync = promisify(execFile);
const projectRoot = new URL("../", import.meta.url);

const csvCatalog = (years) => `const arbitraryBuildName=[${years.map((year) =>
  `{year:"${year}",criteriaDate:"2026年1月19日",data:renamedData,budgetAndExecutionCaption:translate("ps-download-csv-${year}-page-caption-budget-and-execution")}`).join(",")}];`;
const catalogPage = '<html><script type="module" crossorigin src="/assets/main-build123.js"></script></html>';
const sourceResponse = (body, contentType) => new Response(body, { headers: { "content-type": contentType } });

test("discovers published CSV years rather than unrelated searchable or announcement years", () => {
  const source = `const searchYears=[2021,2022,2023,2024,2025,2026];const note="2026年度のCSVは順次公開予定";${csvCatalog([2024, 2025])}`;
  assert.deepEqual(publishedYearsFromModule(source), [2024, 2025]);
  assert.deepEqual(publishedYearsFromModule(source.replaceAll("arbitraryBuildName", "newHashName").replaceAll("renamedData", "anotherName")), [2024, 2025]);
  assert.deepEqual(publishedYearsFromModule(csvCatalog([2024, 2025, 2026])), [2024, 2025, 2026]);
  assert.deepEqual(publishedYearsFromModule('const years=[2024,2025,2026];'), []);
  assert.deepEqual(publishedYearsFromHtml('<a href="/download-csv/2025">2025</a><a href="https://rssystem.go.jp/download-csv/2024">2024</a><a href="/project/2026">2026</a>'), [2024, 2025]);
});

test("rejects incomplete, conflicting, duplicate, or mismatched CSV catalogs", () => {
  assert.throws(() => publishedYearsFromModule(csvCatalog([2024, 2025]).replace('year:"2025"', 'year:"2026"')), /一致しません/);
  assert.throws(() => publishedYearsFromModule(csvCatalog([2024, 2025]).replace('data:renamedData,budgetAndExecutionCaption:translate("ps-download-csv-2025-page-caption-budget-and-execution")', 'data:renamedData')), /一致しません/);
  assert.throws(() => publishedYearsFromModule(csvCatalog([2024, 2024])), /重複/);
  assert.throws(() => publishedYearsFromModule(`${csvCatalog([2024])}${csvCatalog([2024, 2025])}`), /一致しません/);
});

test("only discovers bounded same-origin hashed module URLs and safe year links", () => {
  const malicious = [
    "https://evil.example/assets/main-abc.js",
    "//evil.example/assets/main-abc.js",
    "https://rssystem.go.jp.evil.example/assets/main-abc.js",
    "https://user:password@rssystem.go.jp/assets/main-abc.js",
    "/assets/../assets/main-abc.js",
    "/assets/%2e%2e/assets/main-abc.js",
    "/assets/main-abc.js?redirect=https://evil.example",
    "/assets/main-abc.js#fragment",
    "javascript:alert(1)",
    "/assets/main.js",
  ];
  assert.deepEqual(moduleScriptUrls(`${catalogPage}${malicious.map((url) => `<script type="module" src="${url}"></script>`).join("")}`), ["https://rssystem.go.jp/assets/main-build123.js"]);
  assert.deepEqual(publishedYearsFromHtml([
    "https://evil.example/download-csv/2026", "/x/../download-csv/2026", "/%64ownload-csv/2026", "/download-csv/2026?x=1", "javascript:alert(2026)",
  ].map((url) => `<a href="${url}">2026</a>`).join("")), []);
  assert.throws(() => moduleScriptUrls(Array.from({ length: 5 }, (_, index) => `<script type="module" src="/assets/main-build${index}.js"></script>`).join("")), /取得上限/);
});

test("retries transient HTML instead of JavaScript and validates the official catalog", async () => {
  const calls = [];
  const sleeps = [];
  let scriptAttempts = 0;
  const years = await discoverPublishedReviewSheetYears({
    previousYears: [2024, 2025],
    sleep: async (milliseconds) => { sleeps.push(milliseconds); },
    fetchResponse: async (url, options) => {
      calls.push(url);
      assert.equal(options.redirect, "error");
      assert.equal(options.headers["cache-control"], "no-cache");
      if (url === REVIEW_CSV_INDEX_URL) return sourceResponse(catalogPage, "text/html");
      scriptAttempts += 1;
      return scriptAttempts === 1
        ? sourceResponse("<html>temporary upstream fallback</html>", "text/html")
        : sourceResponse(csvCatalog([2024, 2025]), "application/javascript; charset=utf-8");
    },
  });
  assert.deepEqual(years, [2024, 2025]);
  assert.equal(calls.length, 4);
  assert.deepEqual(sleeps, [1500]);
});

test("fails closed after bounded retries on unknown catalogs, missing years, and HTTP failures", async () => {
  for (const scenario of [
    { response: () => sourceResponse("<html>unrecognized source</html>", "text/html"), previousYears: [], pattern: /配布カタログがありません/ },
    { response: () => sourceResponse('<a href="/download-csv/2024">2024</a>', "text/html"), previousYears: [2024, 2025], pattern: /前回収録年度が欠落/ },
    { response: () => new Response("unavailable", { status: 503 }), previousYears: [], pattern: /503/ },
  ]) {
    let attempts = 0;
    await assert.rejects(discoverPublishedReviewSheetYears({
      previousYears: scenario.previousYears,
      sleep: async () => {},
      fetchResponse: async () => { attempts += 1; return scenario.response(); },
    }), scenario.pattern);
    assert.equal(attempts, 3);
  }
});

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

test("strict live discovery and advertised ZIP failures leave every prior cache file unchanged", async (t) => {
  const temporary = await mkdtemp(join(fileURLToPath(projectRoot), ".tmp-review-discovery-"));
  const output = join(temporary, "review-cache");
  try {
    await execFileAsync(process.execPath, [
      "scripts/update-review-data.mjs", "--fixture-dir", "tests/fixtures/review",
      "--output-dir", output, "--now", "2026-08-16T01:34:06.322Z", "--require-fresh",
    ], { cwd: projectRoot, timeout: 30_000 });
    const originalFiles = await snapshotFiles(output);
    for (const scenario of [
      { name: "unrecognized HTML catalog", html: "<html>upstream fallback</html>", pattern: /年度一覧を取得できません/ },
      { name: "previously published year disappears", html: '<a href="/download-csv/2024">2024</a>', pattern: /前回収録年度が欠落/ },
      { name: "advertised year has no valid ZIP", html: '<a href="/download-csv/2025">2025</a>', pattern: /前回値は公開用データへ置き換えません/ },
    ]) {
      await t.test(scenario.name, async () => {
        const preload = join(temporary, "mock-fetch.mjs");
        await writeFile(preload, `globalThis.fetch = async (url) => new Response(url === ${JSON.stringify(REVIEW_CSV_INDEX_URL)} ? ${JSON.stringify(scenario.html)} : "<html>not a ZIP</html>", { headers: { "content-type": "text/html" } });\n`);
        await assert.rejects(execFileAsync(process.execPath, [
          "--import", preload, "scripts/update-review-data.mjs", "--output-dir", output,
          "--now", "2026-10-19T14:00:00.000Z", "--require-fresh",
        ], { cwd: projectRoot, timeout: 30_000 }), (error) => {
          assert.match(error.stderr, scenario.pattern);
          return true;
        });
        assert.deepEqual(await snapshotFiles(output), originalFiles);
      });
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

async function snapshotFiles(directory) {
  return Object.fromEntries(await Promise.all((await readdir(directory)).sort().map(async (filename) =>
    [filename, await readFile(join(directory, filename), "utf8")])));
}

async function readOutput(output) {
  const manifest = JSON.parse(await readFile(join(output, "manifest.json"), "utf8"));
  const payments = (await Promise.all(manifest.paymentFiles.map(async (filename) =>
    JSON.parse(await readFile(join(output, filename), "utf8"))))).flat();
  const excludedRows = JSON.parse(await readFile(join(output, manifest.excludedRowsFile), "utf8"));
  return { manifest, payments, excludedRows };
}
