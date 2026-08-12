import assert from "node:assert/strict";
import test from "node:test";

import { documents, parseSmeaOfficialHtml } from "../scripts/official-smea-history.mjs";

test("registers FY2020-FY2024 as four contract series plus grants", () => {
  assert.equal(documents.length, 25);
  assert.deepEqual([...new Set(documents.map((item) => item.fiscalYear))], [2020, 2021, 2022, 2023, 2024]);
  for (const year of [2020, 2021, 2022, 2023, 2024]) {
    const annual = documents.filter((item) => item.fiscalYear === year);
    assert.equal(annual.filter((item) => item.category === "contract_result").length, 4);
    assert.equal(annual.filter((item) => item.category === "grant_decision").length, 1);
    assert.ok(annual.every((item) => item.url.startsWith("https://www.chusho.meti.go.jp/")));
  }
  assert.match(documents.find((item) => item.id === "smea-2020-competitive-commission").url, /koukyounyuusatuitaku2020\.html$/);
  assert.match(documents.find((item) => item.id === "smea-2020-discretionary-commission").url, /zuikei_itaku_2020\.htm$/);
  assert.match(documents.find((item) => item.id === "smea-2021-discretionary-commission").url, /zuikei_itaku_2021\.html$/);
});

test("parses a two-row contract header and preserves raw evidence", () => {
  const document = documents.find((item) => item.id === "smea-2020-competitive-goods");
  const rows = parseSmeaOfficialHtml(html(`
    <h1>令和2年度競争入札一覧表(庁費の類)</h1>
    <h2 id="t202004">2020年4月の競争入札</h2>
    <div><table>
      <tr><th rowspan="2">物品役務等の名称及び数量</th><th rowspan="2">契約担当官等の氏名並びにその所属する部局の名称及び所在地</th><th rowspan="2">契約を締結した日</th><th rowspan="2">契約の相手方の商号又は名称</th><th rowspan="2">契約の相手の法人番号</th><th rowspan="2">契約の相手方の住所</th><th rowspan="2">一般競争入札・指名競争入札の別(総合評価の実施)</th><th rowspan="2">予定価格<br>(円)</th><th rowspan="2">契約金額<br>(円)</th><th rowspan="2">落札率<br>(％)</th><th rowspan="2">備考</th><th colspan="3">公益法人の場合</th></tr>
      <tr><th>公益法人の区分</th><th>国所管、都道府県所管の区分</th><th>応札・応募者数</th></tr>
      <tr><td>ガイドブックの梱包発送</td><td>中小企業庁 契約担当官</td><td>2020年4月9日</td><td>株式会社ペア</td><td>法人番号<br>1012301009957</td><td>東京都町田市</td><td>一般競争入札</td><td>非公表</td><td>2,350,000</td><td>非公表</td><td>原文備考</td><td>非該当</td><td></td><td>3</td></tr>
    </table></div>
  `), document);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].date, "2020-04-09");
  assert.equal(rows[0].amount, 2_350_000);
  assert.equal(rows[0].amountRaw, "2,350,000");
  assert.equal(rows[0].corporateNumber, "1012301009957");
  assert.equal(rows[0].corporateNumberRaw, "法人番号 1012301009957");
  assert.equal(rows[0].notes, "原文備考");
  assert.equal(rows[0].sourceFieldsRaw.notes, "原文備考");
  assert.equal(rows[0].sourceFieldsRaw.plannedPriceRaw, "非公表");
  assert.equal(rows[0].bidderCountRaw, "3");
});

test("keeps unit-price amounts as raw strings instead of inventing a total", () => {
  const document = documents.find((item) => item.id === "smea-2023-discretionary-goods");
  const rows = parseSmeaOfficialHtml(discretionaryFixture({
    heading: "2023年4月の随意契約", date: "2023年4月3日", amount: "＠84円ほか",
  }), document);
  assert.equal(rows[0].amount, null);
  assert.equal(rows[0].amountRaw, "＠84円ほか");
  assert.equal(rows[0].methodRaw, "会計法第29条の3第4項");
});

test("accepts a strict YYYY/M/D official date while retaining fiscal-year validation", () => {
  const document = documents.find((item) => item.id === "smea-2023-discretionary-goods");
  const rows = parseSmeaOfficialHtml(discretionaryFixture({
    heading: "2023年10月の随意契約", date: "2023/10/5", amount: "1,000",
  }), document);
  assert.equal(rows[0].date, "2023-10-05");
  assert.equal(rows[0].dateRaw, "2023/10/5");
  assert.throws(() => parseSmeaOfficialHtml(discretionaryFixture({
    heading: "2023年10月の随意契約", date: "2022/10/5", amount: "1,000",
  }), document), /資料年度外/);
  assert.throws(() => parseSmeaOfficialHtml(discretionaryFixture({
    heading: "2023年10月の随意契約", date: "2023-10-5", amount: "1,000",
  }), document), /日付を解釈できません/);
});

test("accepts only the exact known FY2021 row missing the final optional bidder-count cell", () => {
  const document = documents.find((item) => item.id === "smea-2021-discretionary-commission");
  const rows = parseSmeaOfficialHtml(shortFy2021CommissionFixture(KNOWN_FY2021_SHORT_ROW_CELLS), document);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, "事業復活支援金事務事業");
  assert.equal(rows[0].date, "2021-12-21");
  assert.equal(rows[0].amount, 50_079_288_070);
  assert.equal(rows[0].bidderCountRaw, "");
  assert.equal(rows[0].sourceFieldsRaw.bidderCountRaw, "");

  const changedTitle = [...KNOWN_FY2021_SHORT_ROW_CELLS];
  changedTitle[0] = "別の事業";
  assert.throws(
    () => parseSmeaOfficialHtml(shortFy2021CommissionFixture(changedTitle), document),
    /列数が不足しています/,
    "the exception must not accept a different row that happens to lack its final cell",
  );

  const changedNonAnchorCell = [...KNOWN_FY2021_SHORT_ROW_CELLS];
  changedNonAnchorCell[11] = "書き換えられた備考";
  assert.throws(
    () => parseSmeaOfficialHtml(shortFy2021CommissionFixture(changedNonAnchorCell), document),
    /列数が不足しています/,
    "title and date alone must not authorize a different 14-cell row",
  );

  const completeRow = [...KNOWN_FY2021_SHORT_ROW_CELLS, ""];
  const missingRequiredAmount = completeRow.filter((_, index) => index !== 8);
  assert.equal(missingRequiredAmount.length, 14);
  assert.throws(
    () => parseSmeaOfficialHtml(shortFy2021CommissionFixture(missingRequiredAmount), document),
    /列数が不足しています/,
    "a missing required internal cell must never be treated as the optional trailing-cell defect",
  );
});

test("parses grant rows, Reiwa dates, two half-year tables, and the official stray closing div", () => {
  const document = documents.find((item) => item.id === "smea-2023-grant-decisions");
  const rows = parseSmeaOfficialHtml(html(`
    <h1>令和5年度補助金等の情報公開</h1>
    <h2>令和5年4月～令和5年9月</h2>${grantTable("1", "令和5年4月3日", "78,712,000 円")}
    <h2>令和5年10月～令和6年3月</h2>${grantTable("1", "令和6年3月4日", "3,572,574 円")}</div>
  `), document);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.date), ["2023-04-03", "2024-03-04"]);
  assert.deepEqual(rows.map((row) => row.sourceRowNumber), [1, 1]);
  assert.deepEqual(rows.map((row) => row.amount), [78_712_000, 3_572_574]);
  assert.equal(rows[0].accountRaw, "一般会計");
  assert.equal(rows[0].budgetItemRaw, "中小企業政策推進事業費補助金");
});

test("strictly decodes archived Shift_JIS HTML before validating the official table", () => {
  const document = documents.find((item) => item.id === "smea-2024-grant-decisions");
  const encoded = Buffer.from(
    "PCFkb2N0eXBlIGh0bWw+PGh0bWwgbGFuZz0iamEiPjxoZWFkPjxtZXRhIGNoYXJzZXQ9IlNoaWZ0X0pJUyI+PC9oZWFkPjxib2R5PjxtYWluPjxoMT6X35hhNpROk3iV4o+Vi+CTmYLMj+6V8Yz2iko8L2gxPjxoMj6X35hhNpRONIyOgWCX35hhNpROOYyOPC9oMj48dGFibGU+PHRyPjx0aD6U1I2GPC90aD48dGg+jpaLxpa8PC90aD48dGg+leKPlYvgjPCVdJDmlrw8L3RoPjx0aD6WQJBslNSNhjwvdGg+PHRoPozwlXSMiJLoino8L3RoPjx0aD6OeI9vjLOJ74x2i+aVqjwvdGg+PHRoPo54j2+Ms4FpltqBapa8PC90aD48dGg+jPCVdIyIkuiT+jwvdGg+PC90cj48dHI+PHRkPjE8L3RkPjx0ZD6V4o+VjpaLxjwvdGQ+PHRkPoqUjq6J747QjPCVdJDmPC90ZD48dGQ+ODAxMDAwMTEyMDM5MTwvdGQ+PHRkPjEsMDAwPC90ZD48dGQ+iOqUyonvjHY8L3RkPjx0ZD6V4o+Vi+A8L3RkPjx0ZD6X35hhNpRONIyOMZP6PC90ZD48L3RyPjwvdGFibGU+PC9tYWluPjwvYm9keT48L2h0bWw+",
    "base64",
  );
  const rows = parseSmeaOfficialHtml(encoded, document);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, "補助事業");
  assert.equal(rows[0].organization, "株式会社交付先");
  assert.equal(rows[0].date, "2024-04-01");
  assert.equal(rows[0].amount, 1_000);
});

test("fails closed on a missing, unsupported, or invalid declared HTML encoding", () => {
  const document = documents.find((item) => item.id === "smea-2024-grant-decisions");
  assert.throws(
    () => parseSmeaOfficialHtml(Buffer.from("<!doctype html><html><head><title>fixture</title></head><body>".padEnd(120)), document),
    /文字コードが未宣言/,
  );
  assert.throws(
    () => parseSmeaOfficialHtml(Buffer.from("<!doctype html><meta charset='UTF-16'><main>".padEnd(120)), document),
    /文字コードが未宣言または未対応/,
  );
  const invalidShiftJis = Buffer.concat([
    Buffer.from("<!doctype html><meta charset='Shift_JIS'><main>"),
    Buffer.from([0x82]),
    Buffer.alloc(100, 0x20),
  ]);
  assert.throws(() => parseSmeaOfficialHtml(invalidShiftJis, document), /厳密に復号できません/);
});

test("records an explicit zero month and preserves a mismatched official statement", () => {
  const document = documents.find((item) => item.id === "smea-2020-discretionary-commission");
  const rows = parseSmeaOfficialHtml(html(`
    <h1>令和2年度 随意契約一覧表(委託費の類)</h1>
    <h2>2020年11月の随意契約</h2><p>9月の随意契約はございません。</p>
  `), document);
  assert.equal(rows.length, 0);
  assert.deepEqual(rows.emptyPeriods, [{
    period: "2020-11", statementRaw: "9月の随意契約はございません。", periodMismatch: true,
  }]);
});

test("fails closed on malformed spans, unexpected headers, rows, and dates", () => {
  const contract = documents.find((item) => item.id === "smea-2023-discretionary-goods");
  assert.throws(() => parseSmeaOfficialHtml(
    discretionaryFixture({ heading: "2023年4月の随意契約", date: "2023年5月1日", amount: "1,000" }), contract,
  ), /月見出しと契約日/);
  assert.throws(() => parseSmeaOfficialHtml(html(`
    <h1>令和5年度 随意契約一覧表(庁費の類)</h1><h2>2023年4月の随意契約</h2><p>作業中です</p>
  `), contract), /想定外の非空行/);
  const grant = documents.find((item) => item.id === "smea-2023-grant-decisions");
  assert.throws(() => parseSmeaOfficialHtml(html(`
    <h1>令和5年度補助金等の情報公開</h1><h2>令和5年4月～令和5年9月</h2>
    <table><tr><th colspan="0">番号</th></tr><tr><td>1</td></tr></table>
  `), grant), /colspanが不正/);
  assert.throws(() => parseSmeaOfficialHtml(html(`
    <h1>令和5年度補助金等の情報公開</h1><h2>令和5年4月～令和5年9月</h2>
    <table><tr><th>番号</th><th>未知列</th></tr><tr><td>1</td><td>値</td></tr></table>
  `), grant), /想定外の表見出し/);
});

function grantTable(number, date, amount) {
  return `<table>
    <tr><th>番号</th><th>事業名</th><th>補助金交付先名</th><th>法人番号</th><th>交付決定額</th><th>支出元会計区分</th><th>支出元（目）名</th><th>交付決定日</th></tr>
    <tr><td>${number}</td><td>補助事業</td><td>株式会社交付先</td><td>8010001120391</td><td>${amount}</td><td>一般会計</td><td>中小企業政策推進事業費補助金</td><td>${date}</td></tr>
  </table>`;
}

function discretionaryFixture({ heading, date, amount }) {
  return html(`
    <h1>令和5年度 随意契約一覧表(庁費の類)</h1><h2>${heading}</h2>
    <table>
      <tr><th rowspan="2">物品役務等の名称及び数量</th><th rowspan="2">契約担当官等の氏名並びにその所属する部局の名称及び所在地</th><th rowspan="2">契約を締結した日</th><th rowspan="2">契約の相手方の商号又は名称</th><th rowspan="2">契約の相手方の法人番号</th><th rowspan="2">契約の相手方の住所</th><th rowspan="2">随意契約によることとした会計法令の根拠条文及び理由(企画競争又は公募)</th><th rowspan="2">予定価格<br>(円)</th><th rowspan="2">契約金額<br>(円)</th><th rowspan="2">落札率<br>(％)</th><th rowspan="2">再就職<br>の役員<br>の数<br>(人)</th><th rowspan="2">備考</th><th colspan="3">公益法人の場合</th></tr>
      <tr><th>公益法人の区分</th><th>国所管、都道府県所管の区分</th><th>応札・応募者数</th></tr>
      <tr><td>新聞の定期購読</td><td>中小企業庁</td><td>${date}</td><td>丸の内新聞株式会社</td><td>1010005001594</td><td>東京都中央区</td><td>会計法第29条の3第4項</td><td>非公表</td><td>${amount}</td><td>非公表</td><td></td><td>原文備考</td><td>非該当</td><td></td><td></td></tr>
    </table>
  `);
}

const KNOWN_FY2021_SHORT_ROW_CELLS = Object.freeze([
  "事業復活支援金事務事業",
  "中小企業庁 東京都千代田区霞が関１－３－１ 支出負担行為担当官 中小企業庁長官官房総務課長 小林 浩史",
  "2021年12月21日",
  "デロイトトーマツファイナンシャルアドバイザリー合同会社",
  "3010001076738",
  "東京都千代田区丸の内３－２－３ 丸の内二重橋ビルディング",
  "本事業の実施にあたっては、特殊な技術又は設備等が必要であり、事業者が一しかないと考えられたことから、公募（入札可能性調査）を実施したところ、示した要件を満たす者が一しかいないことが明らかとなったため、会計法第２９条３の第４項の随意契約を行うこととする。",
  "非公表",
  "50,079,288,070",
  "非公表",
  "",
  "新型コロナウイルス感染症対策中小企業等持続化給付金の支払の臨時特例に関する政令で経済産業大臣が指定する機関は、デロイトトーマツファイナンシャルアドバイザリー合同会社とする。",
  "非該当",
  "",
]);

function shortFy2021CommissionFixture(cells) {
  return html(`
    <h1>令和3年度 随意契約一覧表(委託費の類)</h1><h2>2021年12月の随意契約</h2>
    <table>
      <tr><th rowspan="2">物品役務等の名称及び数量</th><th rowspan="2">契約担当官等の氏名並びにその所属する部局の名称及び所在地</th><th rowspan="2">契約を締結した日</th><th rowspan="2">契約の相手方の商号又は名称</th><th rowspan="2">契約の相手方の法人番号</th><th rowspan="2">契約の相手方の住所</th><th rowspan="2">随意契約によることとした会計法令の根拠条文及び理由(企画競争又は公募)</th><th rowspan="2">予定価格<br>(円)</th><th rowspan="2">契約金額<br>(円)</th><th rowspan="2">落札率<br>(％)</th><th rowspan="2">再就職<br>の役員<br>の数<br>(人)</th><th rowspan="2">備考</th><th colspan="3">公益法人の場合</th></tr>
      <tr><th>公益法人の区分</th><th>国所管、都道府県所管の区分</th><th>応札・応募者数</th></tr>
      <tr>${cells.map((value) => `<td>${value}</td>`).join("")}</tr>
    </table>
  `);
}

function html(body) {
  return Buffer.from(`<!doctype html><html lang="ja"><head><meta charset="UTF-8"><title>fixture</title></head><body><main>${body}</main></body></html>`);
}
