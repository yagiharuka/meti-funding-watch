import type { Metadata } from "next";

import ViewTabs from "@/app/ViewTabs";
import ReviewSearch from "@/app/review/ReviewSearch";

export const metadata: Metadata = {
  title: "行政事業レビュー（参考系列・非公式）",
  description: "行政事業レビュー公式CSVの事業・予算執行・支出先・支出経路を、契約結果・交付決定とは混ぜずに検索します。",
};

export default function ReviewPage() {
  return (
    <main>
      <header className="topbar">
        <a className="brand" href="../" aria-label="経産省関係の調達（委託を含む）・補助金情報（非公式） トップ">
          <span className="brand-mark" aria-hidden="true">¥</span>
          <span>経産省関係の調達（委託を含む）・補助金情報（非公式）</span>
        </a>
      </header>
      <ViewTabs active="review" />
      <section className="official-hero" id="top" aria-labelledby="review-title">
        <p className="eyebrow">ADMINISTRATIVE BUSINESS REVIEW</p>
        <h1 id="review-title">行政事業レビュー</h1>
        <p className="official-lead">
          行政事業レビューの公式CSVから、経済産業省の事業、予算・執行、支出先、CSVに根拠がある場合の支出経路を検索します。
          これは契約結果・補助金交付決定・GビズINFOとは<strong>別の参考系列</strong>です。
        </p>
        <p className="official-warning">
          レビューシートの「支出先の合計支出額」は、契約額・交付決定額・実支払額と同じ意味ではありません。
          同じ資金経路の上流・中間・下流が複数行に現れる場合があるため、他系列ともレビュー内の異なる階層同士とも合算しません。
        </p>
      </section>
      <ReviewSearch />
      <section className="official-section review-limitations" aria-labelledby="review-limit-title">
        <div className="section-heading compact">
          <div><p className="eyebrow">LIMITS</p><h2 id="review-limit-title">この系列で分かること・分からないこと</h2></div>
        </div>
        <div className="official-limitations">
          <article><strong>分かる：レビュー上の事業と支出先</strong><p>公式CSVに掲載された事業、予算・執行、支出先名、法人番号、支出先ブロックを確認できます。経路はCSVで根拠を確認できる範囲だけを表示します。</p></article>
          <article><strong>分からない：全ての最終受益者</strong><p>レビューシート自体が全ての再委託先・最終受益者を網羅するとは限りません。掲載がないことを「受給なし」と解釈できません。</p></article>
          <article><strong>混ぜない：契約・交付決定</strong><p>レビュー上の支出額を契約額、交付決定額、GビズINFO掲載値へ足しません。同一案件の自動重複排除もしません。</p></article>
        </div>
      </section>
    </main>
  );
}
