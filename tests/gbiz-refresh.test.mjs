import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assertGbizRecordContinuity,
  gbizRecordSemanticHash,
  parseDashboardRow,
} from "../scripts/gbiz-csv.mjs";

const currentDashboardFixture = `
<table id="corporateActivityNumbersTable" class="dashboard-table table-responsive">
  <thead class="dashboard-thead">
    <tr>
      <th></th><th>省庁</th><th>財務情報</th><th>特許情報</th>
      <th>届出・認定・行政処分情報</th><th>補助金情報</th><th>調達情報</th>
      <th>表彰情報</th><th>職場情報</th>
    </tr>
  </thead>
  <tbody>
    <tr class="summary-row">
      <td><button>+</button></td><td>経済産業省 (小計)</td><td></td><td></td>
      <td>46,490</td><td>51,358</td><td>16,927</td><td>1,224</td><td></td>
    </tr>
    <tr>
      <td></td><td>特許庁</td><td></td><td>4,600,382</td><td></td>
      <td>22</td><td>1,202</td><td>58</td><td></td>
    </tr>
  </tbody>
</table>`;

test("reads current dashboard counts by named columns, not by the first numbers in a row", () => {
  assert.deepEqual(parseDashboardRow(currentDashboardFixture, "経済産業省 (小計)"), {
    subsidies: 51_358,
    procurements: 16_927,
  });
  assert.deepEqual(parseDashboardRow(currentDashboardFixture, "特許庁"), {
    subsidies: 22,
    procurements: 1_202,
  });
});

test("fails closed when dashboard values, headers, or column order change", () => {
  assert.throws(
    () => parseDashboardRow(
      currentDashboardFixture.replace("<td>51,358</td>", "<td></td>"),
      "経済産業省 (小計)",
    ),
    /補助金情報を解析できません.*空欄/,
  );
  assert.throws(
    () => parseDashboardRow(
      currentDashboardFixture.replace("<th>補助金情報</th><th>調達情報</th>", "<th>調達情報</th><th>補助金情報</th>"),
      "経済産業省 (小計)",
    ),
    /列見出しまたは列順が変更されました/,
  );
  assert.throws(
    () => parseDashboardRow(
      currentDashboardFixture.replace("<th>補助金情報</th>", "<th>補助金</th>"),
      "経済産業省 (小計)",
    ),
    /列見出しまたは列順が変更されました/,
  );
  assert.throws(
    () => parseDashboardRow(
      currentDashboardFixture.replace('id="corporateActivityNumbersTable"', 'id="renamedTable"'),
      "経済産業省 (小計)",
    ),
    /法人活動情報テーブルが見つかりません/,
  );
});

function record(overrides = {}) {
  const value = {
    id: "gbiz-test",
    stage: "contracted",
    sourceKey: "official-key-1",
    organization: "株式会社テスト",
    corporateNumber: "6010001030403",
    sourceAgency: "経済産業省",
    publisherCanonical: "経済産業省",
    program: "調査委託",
    date: "2026-04-01",
    dateRaw: "2026-04-01",
    fiscalYear: 2026,
    amount: 100,
    amountRaw: "100",
    notes: "",
    dataQuality: "",
    sourceSystem: "",
    ...overrides,
  };
  value.sourceRecordHash = gbizRecordSemanticHash(value);
  return value;
}

test("allows a bounded official correction and records an auditable change receipt", () => {
  const previous = record();
  const corrected = record({ amount: 120, amountRaw: "120", program: "調査委託（訂正）" });
  const result = assertGbizRecordContinuity([previous], [corrected], {
    allowOfficialCorrections: true,
  });
  assert.equal(result.continuityChangedRecordCount, 1);
  assert.equal(result.continuityRemovedRecordCount, 0);
  assert.deepEqual(result.continuityChangedRecords, [{
    key: "contracted\u001fofficial-key-1",
    oldHash: gbizRecordSemanticHash(previous),
    newHash: gbizRecordSemanticHash(corrected),
    changedFields: ["program", "amount", "amountRaw"],
  }]);
});

test("rejects identity changes and corrections above the automatic limit", () => {
  const previous = record();
  for (const [field, value] of [
    ["stage", "subsidy_published"],
    ["sourceKey", "different-key"],
    ["corporateNumber", "5250005003274"],
    ["publisherCanonical", "特許庁"],
  ]) {
    assert.throws(
      () => assertGbizRecordContinuity(
        [previous],
        [record({ [field]: value })],
        { allowOfficialCorrections: true },
      ),
      /識別情報|キーが1件欠落/,
      `${field} must never be treated as a correction`,
    );
  }

  const previousRows = Array.from({ length: 1_000 }, (_, index) => record({
    id: `gbiz-${index}`,
    sourceKey: `official-key-${index}`,
  }));
  const candidateRows = previousRows.map((row, index) => index < 3
    ? record({
      ...row,
      amount: row.amount + 1,
      amountRaw: String(row.amount + 1),
    })
    : row);
  assert.throws(
    () => assertGbizRecordContinuity(previousRows, candidateRows, {
      allowOfficialCorrections: true,
    }),
    /自動取込上限を超えました \(3\/2\)/,
  );
});

test("workflow publishes only verified prior data with an explicit failure status", async () => {
  const workflow = await readFile(new URL("../.github/workflows/update-data.yml", import.meta.url), "utf8");
  assert.match(workflow, /- name: Refresh official detail data[\s\S]*?id: official_refresh[\s\S]*?run: npm run update:official/);
  assert.match(workflow, /Preserve last verified official detail data after a source failure[\s\S]*?git restore --source=HEAD -- data\/official/);
  assert.match(workflow, /- name: Refresh Gbiz public data[\s\S]*?id: refresh[\s\S]*?run: npm run update:data/);
  assert.ok(
    workflow.indexOf("Refresh official detail data") < workflow.indexOf("Refresh Gbiz public data"),
    "an official-source failure must not prevent the independent Gbiz refresh attempt",
  );
  assert.match(workflow, /continue-on-error: true/);
  assert.match(workflow, /Confirm failed refresh did not alter verified data/);
  assert.match(workflow, /git restore --source=HEAD -- data\/funding-data\.json data\/funding-summary\.json data\/pages data\/official/);
  assert.match(workflow, /PAGES_UPDATE_OUTCOME:/);
  assert.match(workflow, /PAGES_OFFICIAL_UPDATE_OUTCOME:/);
  assert.match(workflow, /EXPECTED_OFFICIAL_OUTCOME:/);
  assert.match(workflow, /PAGES_OFFICIAL_UPDATE_OUTCOME:.*steps\.official_refresh\.outcome == 'success'.*steps\.refresh\.outcome == 'success'/);
  assert.match(workflow, /UPDATE_PHASE: gbiz-data-refresh/);
  assert.match(workflow, /Verify the published release from the live site/);
  assert.match(workflow, /node scripts\/verify-live-pages\.mjs/);
  assert.match(workflow, /Fail the workflow unless a fresh release was verified/);
  assert.match(workflow, /Preserve source snapshot and correction evidence/);
  assert.match(workflow, /Attest the verified public release/);
  assert.doesNotMatch(workflow, /uses: actions\/[a-z-]+@v\d/);
});

test("production automatically publishes bounded non-identity corrections", async () => {
  const updater = await readFile(new URL("../scripts/update-data.mjs", import.meta.url), "utf8");
  assert.match(updater, /allowOfficialCorrections: true/);
  assert.doesNotMatch(updater, /assertApprovedGbizCorrections/);
  assert.doesNotMatch(updater, /approved-gbiz-corrections\.json/);
  assert.ok(
    updater.indexOf("writeGbizAuditEvidence") < updater.indexOf("next.records = newRecords"),
    "source evidence must be written before corrected records are published",
  );
});
