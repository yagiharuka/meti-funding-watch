import assert from "node:assert/strict";
import test from "node:test";

import {
  extractOrganizations,
  parseNedoAnnualIndexHtml,
  parseNedoDecisionHtml,
  parseNedoFieldResultsHtml,
  parseNedoMasterSearchHtml,
} from "../scripts/nedo-public-results.mjs";

test("NEDO annual index discovers only field list pages and ignores external links", () => {
  const html = `
    <a href="/koubo/2025_list_01_08.html">自動車・蓄電池</a>
    <a href="/koubo/2025_list_01_05.html">水素</a>
    <a href="/koubo/2025_list.html">年度トップ</a>
    <a href="https://x.com/nedo_info">X</a>
  `;
  assert.deepEqual(parseNedoAnnualIndexHtml(html, "https://www.nedo.go.jp/koubo/2025_list.html"), [
    "https://www.nedo.go.jp/koubo/2025_list_01_05.html",
    "https://www.nedo.go.jp/koubo/2025_list_01_08.html",
  ]);
});

test("NEDO field list uses the decision link and ignores rows without a decision", () => {
  const html = `
    <table><tbody>
      <tr><td>蓄電池事業</td><td><a href="/koubo/CA1_100001.html">2025年4月1日</a></td><td><a href="/koubo/CA3_100002.html">2025年6月1日</a></td><td>決定</td></tr>
      <tr><td>未決定</td><td><a href="/koubo/CA1_100003.html">2025年7月1日</a></td><td>公募</td></tr>
    </tbody></table>
  `;
  assert.deepEqual(parseNedoFieldResultsHtml(html, "https://www.nedo.go.jp/koubo/2025_list_01_08.html"), [
    "https://www.nedo.go.jp/koubo/CA3_100002.html",
  ]);
});

test("NEDO master search decodes amp-escaped pagination and finds decision rows", () => {
  const html = `
    <a href="?f=koubo.html&amp;o=-date%2Cpagetitle&amp;p=341">341</a>
    <table><tbody>
      <tr><td>2020年 2月 3日</td><td><a href="/koubo/CD3_100200.html">調査に係る実施体制の決定について</a></td><td>決定</td></tr>
      <tr><td>2020年 2月 2日</td><td><a href="/koubo/CD2_100199.html">調査の公募について</a></td><td>公募</td></tr>
    </tbody></table>
  `;
  const parsed = parseNedoMasterSearchHtml(html);
  assert.equal(parsed.maxPage, 341);
  assert.deepEqual(parsed.decisions, [{
    url: "https://www.nedo.go.jp/koubo/CD3_100200.html",
    publishedDate: "2020-02-03",
    fiscalYear: 2019,
  }]);
});

test("NEDO decision parser identifies participant attachments without confusing review committees", () => {
  const html = `
    <h1>決定 2025年度「革新型蓄電池開発」に係る実施体制の決定について</h1>
    <p>2025年6月17日</p>
    <h3>3. 実施予定先</h3><p>別紙1のとおり。</p>
    <a href="/content/participants.pdf">別紙1：実施予定先一覧</a>
    <a href="/content/committee.pdf">別紙2：採択審査委員一覧</a>
  `;
  const result = parseNedoDecisionHtml(html, "https://www.nedo.go.jp/koubo/CA3_100002.html", 2025);
  assert.equal(result.fiscalYear, 2025);
  assert.equal(result.date, "2025-06-17");
  assert.match(result.program, /革新型蓄電池開発/u);
  assert.deepEqual(result.attachments, [{
    url: "https://www.nedo.go.jp/content/participants.pdf",
    label: "別紙1:実施予定先一覧",
  }]);
});

test("NEDO decision parser accepts varied public participant labels and normalizes whitespace", () => {
  const tryHtml = `
    <h1>決定 2021年度「TRY」公募に係る実施体制の決定について</h1>
    <p>2021年6月30日</p>
    <p>4件の実施予定先を決定しました。</p>
    <a href="/content/numbers.pdf">助成金交付予定先の提案書受理番号一覧</a>
    <a href="/content/final.pdf">交付決定事業者</a>
    <a href="/content/committee.pdf">採択審査委員一覧</a>
  `;
  assert.deepEqual(
    parseNedoDecisionHtml(tryHtml, "https://www.nedo.go.jp/koubo/CA3_100292.html", 2021).attachments,
    [
      { url: "https://www.nedo.go.jp/content/numbers.pdf", label: "助成金交付予定先の提案書受理番号一覧" },
      { url: "https://www.nedo.go.jp/content/final.pdf", label: "交付決定事業者" },
    ],
  );

  const themeHtml = `
    <h1>決定 2022年度「省エネルギー技術開発」に係る実施体制の決定について</h1>
    <p>2022年5月23日</p>
    <p>17件の実施予定先を決定しました。</p>
    <a href="/content/themes.pdf">別紙1 採択テーマ 一覧</a>
    <a href="/content/committee.pdf">別紙2 採択審査委員一覧</a>
  `;
  assert.deepEqual(
    parseNedoDecisionHtml(themeHtml, "https://www.nedo.go.jp/koubo/DA3_100289.html", 2022).attachments,
    [{ url: "https://www.nedo.go.jp/content/themes.pdf", label: "別紙1 採択テーマ 一覧" }],
  );
});

test("NEDO decision parser reads a directly listed audit firm from the participant section", () => {
  const html = `
    <h1>決定「令和4事業年度決算業務の支援」に係る実施体制の決定について</h1>
    <p>2023年1月26日</p>
    <h3>3. 実施予定先</h3>
    <p>PwCあらた有限責任監査法人</p>
    <h3>4. 事業期間</h3>
    <p>2023年3月1日から</p>
  `;
  const result = parseNedoDecisionHtml(html, "https://www.nedo.go.jp/koubo/AC3_100006.html", 2022);
  assert.deepEqual(result.directOrganizations, ["PwCあらた有限責任監査法人"]);
  assert.equal(result.selectedCount, null);
});

test("participant extraction keeps Toyota and other legal organizations but not NEDO or headings", () => {
  const values = [
    "トヨタ自動車株式会社",
    "株式会社豊田中央研究所",
    "国立大学法人東京大学",
    "PwCあらた有限責任監査法人",
    "実施予定先一覧",
    "国立研究開発法人新エネルギー・産業技術総合開発機構",
  ];
  assert.deepEqual(extractOrganizations(values), [
    "PwCあらた有限責任監査法人",
    "トヨタ自動車株式会社",
    "株式会社豊田中央研究所",
    "国立大学法人東京大学",
  ]);
});
