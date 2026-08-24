import assert from "node:assert/strict";
import test from "node:test";

import {
  extractOrganizations,
  parseNedoAnnualIndexHtml,
  parseNedoDecisionHtml,
  parseNedoFieldResultsHtml,
} from "../scripts/nedo-public-results.mjs";

test("NEDO annual index discovers only field list pages", () => {
  const html = `
    <a href="/koubo/2025_list_01_08.html">自動車・蓄電池</a>
    <a href="/koubo/2025_list_01_05.html">水素</a>
    <a href="/koubo/2025_list.html">年度トップ</a>
  `;
  assert.deepEqual(parseNedoAnnualIndexHtml(html, "https://www.nedo.go.jp/koubo/2025_list.html"), [
    "https://www.nedo.go.jp/koubo/2025_list_01_05.html",
    "https://www.nedo.go.jp/koubo/2025_list_01_08.html",
  ]);
});

test("NEDO field list uses the result link and ignores rows without results", () => {
  const html = `
    <table><tbody>
      <tr><td>蓄電池事業</td><td><a href="/koubo/CA1_100001.html">2025年4月1日</a></td><td><a href="/koubo/CA3_100002.html">2025年6月1日</a></td></tr>
      <tr><td>未決定</td><td><a href="/koubo/CA1_100003.html">2025年7月1日</a></td><td></td></tr>
    </tbody></table>
  `;
  assert.deepEqual(parseNedoFieldResultsHtml(html, "https://www.nedo.go.jp/koubo/2025_list_01_08.html"), [
    "https://www.nedo.go.jp/koubo/CA3_100002.html",
  ]);
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

test("participant extraction keeps Toyota and other legal organizations but not NEDO or headings", () => {
  const values = [
    "トヨタ自動車株式会社",
    "株式会社豊田中央研究所",
    "国立大学法人東京大学",
    "実施予定先一覧",
    "国立研究開発法人新エネルギー・産業技術総合開発機構",
  ];
  assert.deepEqual(extractOrganizations(values), [
    "トヨタ自動車株式会社",
    "株式会社豊田中央研究所",
    "国立大学法人東京大学",
  ]);
});
