import type { Metadata } from "next";

const REQUEST_URL = "https://github.com/yagiharuka/meti-funding-watch/issues/new?template=correction.yml";
const LOG_URL = "https://github.com/yagiharuka/meti-funding-watch/blob/main/CORRECTIONS.md";

export const metadata: Metadata = {
  title: "訂正・確認の方針｜非公式サイト",
  description: "掲載内容の訂正・確認依頼と対応記録について説明します。",
};

export default function CorrectionsPage() {
  return (
    <main className="governance-page">
      <a className="governance-back" href="../">← 検索画面へ戻る</a>
      <p className="eyebrow">CORRECTIONS &amp; GOVERNANCE</p>
      <h1>訂正・確認の方針</h1>
      <p className="governance-lead">
        このサイトは、公開原資料を再構成した非公式サイトです。掲載内容の誤りが疑われる場合は、公開情報だけを使って確認依頼を送れます。
      </p>

      <section>
        <h2>受け付ける内容</h2>
        <ul>
          <li>原資料と当サイトの転記内容が一致しない</li>
          <li>法人名と法人番号、金額、日付、年度、区分の対応が違う</li>
          <li>重複、欠落、誤解を招く説明や表示がある</li>
        </ul>
        <a className="governance-action" href={REQUEST_URL}>GitHubの訂正・確認フォームを開く</a>
        <p className="governance-caution">依頼内容は公開されます。個人情報、未公表情報、担当者の連絡先は記載しないでください。</p>
      </section>

      <section>
        <h2>対応の原則</h2>
        <ol>
          <li>公開原資料と当サイトのレコードを照合します。</li>
          <li>当サイトの転記・解析誤りは、テストを追加して修正し、対応記録を残します。</li>
          <li>原資料自体の内容は当サイトで書き換えません。必要に応じて「原資料掲載値」であることを明示します。</li>
          <li>確認できない申し出は推測で反映せず、未確認として扱います。</li>
        </ol>
        <a className="governance-link" href={LOG_URL}>訂正対応記録を見る</a>
      </section>

      <section>
        <h2>利用上の注意</h2>
        <p>このサイトだけを、契約関係、資金受領、法的・会計的判断の確定根拠にしないでください。必ず各レコードから公表元の原資料を確認してください。</p>
      </section>
    </main>
  );
}
