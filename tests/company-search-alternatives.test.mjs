import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  INTERNAL_PARTIAL_SEARCH_PREFIX,
  filterCompanyRecords,
  matchCompanyEntities,
} from "../scripts/company-search.mjs";

const rows = [
  { organization: "ＮＴＴ株式会社", corporateNumber: "7010001065142", sourceAgency: "経済産業省", stage: "contracted", fiscalYear: 2026 },
  { organization: "株式会社ＮＴＴデータ", corporateNumber: "6010601062093", sourceAgency: "経済産業省", stage: "contracted", fiscalYear: 2026 },
  { organization: "株式会社ＮＴＴデータ経営研究所", corporateNumber: "1010001143390", sourceAgency: "経済産業省", stage: "contracted", fiscalYear: 2026 },
  { organization: "別会社株式会社", corporateNumber: "1111111111111", sourceAgency: "経済産業省", stage: "contracted", fiscalYear: 2026 },
];

test("normal search keeps exact-first behavior while the internal contains search can retrieve alternatives", () => {
  const exact = filterCompanyRecords(rows, { query: "NTT" });
  assert.deepEqual([...new Set(exact.map((row) => row.corporateNumber))], ["7010001065142"]);

  const contains = filterCompanyRecords(rows, { query: `${INTERNAL_PARTIAL_SEARCH_PREFIX}NTT` });
  assert.deepEqual(
    [...new Set(contains.map((row) => row.corporateNumber))].sort(),
    ["1010001143390", "6010601062093", "7010001065142"],
  );
});

test("one match pass returns the exact corporation and every separate contains candidate", () => {
  const matches = matchCompanyEntities(rows, "NTT");
  assert.deepEqual(matches.primary.map((row) => row.corporateNumber), ["7010001065142"]);
  assert.deepEqual(
    matches.contains.map((row) => row.corporateNumber).sort(),
    ["1010001143390", "6010601062093", "7010001065142"],
  );
});

test("internal contains search still respects agency, type, and year filters", () => {
  const mixed = [
    ...rows,
    { organization: "ＮＴＴ関連株式会社", corporateNumber: "2222222222222", sourceAgency: "特許庁", stage: "contracted", fiscalYear: 2026 },
    { organization: "ＮＴＴ補助株式会社", corporateNumber: "3333333333333", sourceAgency: "経済産業省", stage: "subsidy_published", fiscalYear: 2025 },
  ];
  const result = filterCompanyRecords(mixed, {
    query: `${INTERNAL_PARTIAL_SEARCH_PREFIX}NTT`,
    agency: "経済産業省",
    stage: "contracted",
    year: "2026",
  });
  assert.deepEqual(
    [...new Set(result.map((row) => row.corporateNumber))].sort(),
    ["1010001143390", "6010601062093", "7010001065142"],
  );
});

test("Pages UI receives and immediately shows separate contains corporations", async () => {
  const [worker, page, source, styles, entrypoint] = await Promise.all([
    readFile(new URL("../app/funding-search.worker.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../pages-site/company-search-ui.ts", import.meta.url), "utf8"),
    readFile(new URL("../pages-site/company-search-alternatives.css", import.meta.url), "utf8"),
    readFile(new URL("../pages-site/main.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(worker, /matchCompanyEntities\(companyEntities, query\)/);
  assert.match(worker, /alternativeOrganizations, alternativeOrganizationCount/);
  assert.match(page, /名称に「\{debouncedQuery\.trim\(\)\}」を含む別法人/);
  assert.match(source, /名称に「\$\{esc\(query\)\}」を含む別法人/);
  assert.match(source, /data-corp="\$\{esc\(organization\.corporateNumber\)\}"/);
  assert.match(styles, /\.company-search-alternative-item/);
  assert.doesNotMatch(entrypoint, /company-search-alternatives"/);
});
