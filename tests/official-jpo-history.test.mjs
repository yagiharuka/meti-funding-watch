import assert from "node:assert/strict";
import test from "node:test";

import { JPO_HISTORICAL_DOCUMENTS } from "../scripts/official-jpo-history.mjs";

const ids = new Set(JPO_HISTORICAL_DOCUMENTS.map((document) => document.id));

test("registers only the existence-checked JPO historical XLSX set", () => {
  assert.equal(JPO_HISTORICAL_DOCUMENTS.length, 40);
  assert.equal(ids.size, JPO_HISTORICAL_DOCUMENTS.length);
  assert.equal(new Set(JPO_HISTORICAL_DOCUMENTS.map((document) => document.url)).size, JPO_HISTORICAL_DOCUMENTS.length);
  assert.ok(Object.isFrozen(JPO_HISTORICAL_DOCUMENTS));

  for (const year of [2020, 2021]) {
    for (const contractClass of ["competitive", "discretionary"]) {
      for (const subject of ["goods", "commission", "public-works"]) {
        assert.ok(ids.has(`jpo-${year}-${contractClass}-${subject}`));
      }
    }
  }

  for (const year of [2022, 2023]) {
    for (const contractClass of ["competitive", "discretionary"]) {
      for (const subject of ["goods", "commission", "public-works"]) {
        assert.ok(ids.has(`jpo-${year}-${contractClass}-${subject}`));
      }
    }
  }
  for (const subject of ["goods", "commission", "public-works"]) {
    assert.ok(ids.has(`jpo-2024-competitive-${subject}`));
  }
  for (const subject of ["goods", "commission"]) {
    assert.ok(ids.has(`jpo-2024-discretionary-${subject}`));
  }
  for (const year of [2021, 2022, 2023, 2024]) {
    assert.ok(ids.has(`jpo-${year}-grant-decisions-h1`));
    assert.ok(ids.has(`jpo-${year}-grant-decisions-h2`));
  }
  assert.ok(ids.has("jpo-2025-competitive-commission"));
  assert.ok(ids.has("jpo-2025-competitive-public-works"));
  assert.ok(ids.has("jpo-2025-discretionary-commission"));
});

test("uses WARP captures rather than dead original JPO paths", () => {
  for (const year of [2022, 2023]) {
    for (const contractClass of ["competitive", "discretionary"]) {
      for (const subject of ["goods", "commission", "public-works"]) {
        if (year === 2022 && contractClass === "competitive") continue;
        const document = JPO_HISTORICAL_DOCUMENTS.find((item) =>
          item.id === `jpo-${year}-${contractClass}-${subject}`);
        assert.equal(document.discoveryStatus, "archived_official_file");
        assert.match(document.url, /^https:\/\/warp\.ndl\.go\.jp\//);
        assert.match(document.sourcePageUrl, /^https:\/\/warp\.ndl\.go\.jp\//);
        assert.match(document.originalUrl, /^https:\/\/www\.jpo\.go\.jp\/.+\.xlsx$/);
        assert.notEqual(document.url, document.originalUrl);
      }
    }
  }
  assert.equal(ids.has("jpo-2024-discretionary-public-works"), false);
  assert.equal(ids.has("jpo-2025-discretionary-public-works"), false);
  assert.equal(ids.has("jpo-2020-grant-decisions-h1"), false);
  assert.equal(ids.has("jpo-2020-grant-decisions-h2"), false);
});

test("keeps every definition official, typed, and parser-addressable", () => {
  for (const document of JPO_HISTORICAL_DOCUMENTS) {
    assert.ok(Object.isFrozen(document), document.id);
    assert.equal(document.executorId, "jpo");
    assert.equal(document.executorName, "特許庁");
    assert.equal(document.format, "xlsx");
    assert.equal(document.verifiedAt, "2026-08-12");
    assert.match(document.url, /^https:\/\/(?:www\.jpo\.go\.jp\/news\/chotatsu\/rakusatu\/(?:kyosonyusatu|zuikeyaku|hojokin)\/document\/20(?:2[0-5])\/.+|warp\.ndl\.go\.jp\/.+\/www\.jpo\.go\.jp\/news\/chotatsu\/rakusatu\/(?:kyosonyusatu|zuikeyaku)\/document\/20(?:2[23])\/.+)\.xlsx$/);
    assert.match(document.sourcePageUrl, /^https:\/\/(?:www\.jpo\.go\.jp\/news\/chotatsu\/rakusatu\/(?:kyosonyusatu|zuikeyaku|hojokin)\/(?:index|20(?:2[0-5]))\.html|warp\.ndl\.go\.jp\/.+\/www\.jpo\.go\.jp\/news\/chotatsu\/rakusatu\/(?:kyosonyusatu|zuikeyaku)\/20(?:2[23])\.html)$/);
    assert.ok(["linked_from_live_year_page", "orphaned_official_file", "archived_official_file"].includes(document.discoveryStatus));
    assert.ok(Number.isSafeInteger(document.expectedSheetCount) && document.expectedSheetCount > 0, document.id);
    assert.equal(document.multiplePartyPolicy, "one_official_row");
    assert.doesNotMatch(document.coverageClaim, /全支出|実支払|全契約|全月を収録/);

    if (document.discoveryStatus === "linked_from_live_year_page") {
      assert.ok(document.sourcePageUrl.endsWith(`/${document.fiscalYear}.html`), document.id);
    } else if (document.discoveryStatus === "orphaned_official_file") {
      assert.ok(document.sourcePageUrl.endsWith("/index.html"), document.id);
    } else {
      assert.match(document.url, /^https:\/\/warp\.ndl\.go\.jp\//);
      assert.match(document.originalUrl, /^https:\/\/www\.jpo\.go\.jp\//);
      assert.equal(document.archiveProvider, "国立国会図書館インターネット資料収集保存事業（WARP）");
    }

    if (document.category === "contract_result") {
      assert.ok(["competitive", "discretionary"].includes(document.contractClass));
      assert.ok(["goods", "commission", "public-works"].includes(document.subjectClass));
      assert.ok(document.contractSubjectHeaders.length > 0);
      assert.ok(document.headerAliases["契約を締結した日"].includes("契約を締結した日"));
      assert.ok(document.headerAliases["契約の相手方の商号又は名称"].includes("契約の相手方の商号又は名称"));
      assert.ok(document.headerAliases["契約の相手方の法人番号"].includes("法人番号"));
      assert.ok(document.headerAliases["契約金額円"].includes("契約金額（円）"));
      assert.equal(document.emptySentinel, null);
      assert.match(document.amountStage, /契約金額欄/);
    } else {
      assert.equal(document.category, "grant_decision");
      assert.deepEqual(document.contractSubjectHeaders, []);
      assert.deepEqual(document.headerAliases["事業名"], ["事業名"]);
      assert.deepEqual(document.headerAliases["交付先名"], ["交付先名"]);
      assert.deepEqual(document.headerAliases["法人番号"], ["法人番号"]);
      assert.deepEqual(document.headerAliases["交付決定額"], ["交付決定額"]);
      assert.deepEqual(document.headerAliases["交付決定日"], ["交付決定日"]);
      assert.equal(document.emptySentinel, "交付決定なし");
      assert.match(document.amountStage, /交付決定額欄/);
    }
  }
});

test("captures the public-works subject-header schema separately", () => {
  const publicWorks = JPO_HISTORICAL_DOCUMENTS.filter((document) => document.subjectClass === "public-works");
  assert.ok(publicWorks.length > 0);
  assert.ok(publicWorks.every((document) => document.contractSubjectHeaders.some((header) =>
    ["公共工事の名称、場所、期間及び種別", "物品役務等の名称及び数量"].includes(header))));

  for (const year of [2022, 2023]) {
    const archivedWorks = JPO_HISTORICAL_DOCUMENTS.filter((document) =>
      document.fiscalYear === year && document.subjectClass === "public-works" &&
      document.discoveryStatus === "archived_official_file");
    assert.ok(archivedWorks.every((document) =>
      document.contractSubjectHeaders.includes("物品役務等の名称及び数量")));
  }

  const otherContracts = JPO_HISTORICAL_DOCUMENTS.filter((document) =>
    document.category === "contract_result" && document.subjectClass !== "public-works");
  assert.ok(otherContracts.every((document) =>
    document.contractSubjectHeaders.includes("物品役務等の名称及び数量")));
});
