import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  INTERNAL_PARTIAL_SEARCH_PREFIX,
  filterCompanyRecords,
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

test("Pages UI shows the exact match and keeps alternative corporations visibly discoverable", async () => {
  const [source, styles, entrypoint] = await Promise.all([
    readFile(new URL("../pages-site/company-search-alternatives.ts", import.meta.url), "utf8"),
    readFile(new URL("../pages-site/company-search-alternatives.css", import.meta.url), "utf8"),
    readFile(new URL("../pages-site/main.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(source, /完全一致：\$\{primaryOrganizations\[0\]\.name\}/);
  assert.match(source, /ほかに「\$\{query\}」を含む法人があります/);
  assert.match(source, /→ \$\{totalAlternativeCount\.toLocaleString\("ja-JP"\)\}法人を見る/);
  assert.match(source, /primaryOrganizations: organizations/);
  assert.match(source, /button\.dataset\.corp = organization\.corporateNumber/);
  assert.match(source, /INTERNAL_PARTIAL_SEARCH_PREFIX/);
  assert.match(styles, /\.company-search-exact-match/);
  assert.match(entrypoint, /company-search-alternatives/);
});
