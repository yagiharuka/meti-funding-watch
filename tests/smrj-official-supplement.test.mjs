import assert from "node:assert/strict";
import test from "node:test";

import {
  SMRJ_HQ_CONTRACT_URL,
  parseSmrjContractFragments,
  parseSmrjListingHtml,
} from "../scripts/smrj-official-supplement.mjs";

const DOCUMENT = {
  url: "https://www.smrj.go.jp/procurement/bid/contract/test-202604.pdf",
  title: "令和8年4月競争入札契約",
  year: 2026,
  month: 4,
  fiscalYear: 2026,
};

function row(ordinal, {
  program = `令和8年度テスト業務${ordinal}`,
  date = `8.4.${ordinal}`,
  organization = `株式会社テスト${ordinal}`,
  corporateNumber = `100000000000${ordinal}`.slice(-13),
  method = "最低価格",
  planned = "省略",
  amount = "1,234,567",
} = {}) {
  return [
    String(ordinal),
    program,
    "分任契約担当役",
    "本部長代理",
    date,
    organization,
    `法人番号：${corporateNumber}`,
    "一般競争入札",
    `（${method}）`,
    planned,
    amount,
    "非公表",
  ];
}

test("SMRJ listing parser keeps only current-fiscal-year HQ competitive contract PDFs", () => {
  const html = `
    <html><body>
      <a href="/procurement/bid/contract/old.pdf">令和7年4月競争入札契約（PDF）</a>
      <a href="/procurement/bid/contract/april.pdf?download=1#x">令和8年4月競争入札契約（PDF）</a>
      <a href="/procurement/bid/contract/may.pdf">令和8年5月競争入札契約（PDF）</a>
      <a href="/procurement/bid/contract/other.pdf">令和8年5月随意契約（PDF）</a>
    </body></html>`;
  const docs = parseSmrjListingHtml(html, SMRJ_HQ_CONTRACT_URL);
  assert.deepEqual(docs.map(({ url, month, fiscalYear }) => ({ url, month, fiscalYear })), [
    { url: "https://www.smrj.go.jp/procurement/bid/contract/april.pdf", month: 4, fiscalYear: 2026 },
    { url: "https://www.smrj.go.jp/procurement/bid/contract/may.pdf", month: 5, fiscalYear: 2026 },
  ]);
});

test("SMRJ parser accounts for every printed row and publishes only rows with a contract amount", () => {
  const fragments = [
    ...row(1, {
      program: "令和8年度中小企業大学校三条校電気設備等改修工事",
      date: "8.4.1",
      organization: "本間電機工業(株)",
      corporateNumber: "2110001014671",
      planned: "29,260,000",
      amount: "28,490,000",
    }),
    ...row(2, {
      program: "コンタクトセンター運営管理業務",
      date: "8.4.9",
      organization: "アクセンチュア株式会社",
      corporateNumber: "7010401001556",
      method: "総合評価",
      planned: "省略",
      amount: "76,978,000",
    }),
    ...row(3, {
      program: "単価契約テスト",
      date: "8.4.27",
      organization: "伊藤忠エネクス(株)",
      corporateNumber: "9010401078551",
      planned: "省略",
      amount: "－",
    }),
  ];

  const parsed = parseSmrjContractFragments(fragments, DOCUMENT);
  assert.equal(parsed.totalRows, 3);
  assert.deepEqual(parsed.noAmountOrdinals, [3]);
  assert.equal(parsed.records.length, 2);
  assert.deepEqual(parsed.records[0], {
    id: "smrj-hq-2026-04-competitive-1",
    organization: "本間電機工業株式会社",
    corporateNumber: "2110001014671",
    fiscalYear: 2026,
    date: "2026-04-01",
    program: "令和8年度中小企業大学校三条校電気設備等改修工事",
    theme: "",
    phase: "",
    supportYears: "",
    category: "contract_result",
    amountStage: "契約金額",
    amount: 28_490_000,
    sourceUrl: DOCUMENT.url,
    sourcePageUrl: SMRJ_HQ_CONTRACT_URL,
    sourceKey: "smrj-hq-2026-04-competitive-1",
  });
  assert.equal(parsed.records[1].amount, 76_978_000);
  assert.equal(parsed.records[1].date, "2026-04-09");
});

test("SMRJ parser fails closed on missing or non-sequential printed rows", () => {
  assert.throws(
    () => parseSmrjContractFragments([...row(1), ...row(3)], DOCUMENT),
    /掲載行番号が連続していません/,
  );
});

test("SMRJ parser does not convert an unparseable contract amount column into a zero or omission", () => {
  const broken = row(1);
  broken[10] = "金額未確認";
  assert.throws(
    () => parseSmrjContractFragments(broken, DOCUMENT),
    /予定価格・契約金額列を解析できません/,
  );
});
