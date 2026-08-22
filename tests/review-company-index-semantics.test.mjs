import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function text(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

async function json(path) {
  return JSON.parse(await text(path));
}

test("review company index does not publish recipient amount totals", async () => {
  const index = await json("../dist-pages/data/review-company-index.json");
  assert.equal(index.schemaVersion, 1);
  assert.ok(Array.isArray(index.recipients) && index.recipients.length > 0);
  assert.match(index.semantics.aggregationWarning, /別レビューシート年度に再掲/);
  assert.match(index.semantics.aggregationWarning, /行・年度をまたいで合計しない/);
  assert.ok(index.recipients.every((recipient) => !("amountKnownTotal" in recipient)));
});

test("NDF keeps both review rows but never promotes 47bn plus 47bn to a recipient total", async () => {
  const index = await json("../dist-pages/data/review-company-index.json");
  const recipient = index.recipients.find((item) => item.organization === "原子力損害賠償・廃炉等支援機構");
  assert.ok(recipient, "known review recipient must remain searchable");

  const repeated = recipient.entries.filter((entry) =>
    entry.amount === 47_000_000_000
    && entry.block === "A"
    && /-3844$/.test(entry.reviewProjectId));
  assert.ok(repeated.length >= 2, "known 47bn entries across review-sheet years must remain as row-level evidence");
  const years = new Set(repeated.map((entry) => entry.reviewSheetYear));
  assert.ok(years.has(2024));
  assert.ok(years.has(2025));
  assert.equal("amountKnownTotal" in recipient, false);
});

test("combined company UI can show review row amounts but cannot render a review aggregate", async () => {
  const source = await text("../app/CombinedCompanyResults.tsx");
  assert.match(source, /行政事業レビュー内でも掲載行をまたぐ金額合計は表示しません/);
  assert.match(source, /<strong>合計しません<\/strong><small>個別の掲載額は下の明細で確認<\/small>/);
  assert.match(source, /displayReviewAmount\(entry\)/);
  assert.doesNotMatch(source, /reviewAmountKnownTotal|amountKnownTotal|金額記載行の単純合計/);

  const officialBlock = source.slice(source.indexOf("OFFICIAL SUPPLEMENT"));
  assert.match(officialBlock, /yen\.format\(row\.amount\)/);
  assert.doesNotMatch(officialBlock, /reduce\([^\n]*amount|officialAmountTotal|amountKnownTotal/);
});

test("Pages build checks committed metadata before regenerating the review company index", async () => {
  const packageJson = await json("../package.json");
  assert.match(
    packageJson.scripts["build:pages"],
    /^node scripts\/sync-source-metadata\.mjs --check && node scripts\/build-review-company-index\.mjs &&/,
  );
});
