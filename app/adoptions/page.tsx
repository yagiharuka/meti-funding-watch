import type { Metadata } from "next";

import ViewTabs from "@/app/ViewTabs";

export const metadata: Metadata = {
  title: "中小企業庁の補助金採択者情報",
  description: "中小企業庁の公式検索で、公開に同意した補助金採択者情報を確認するための案内ページです。金額情報ではありません。",
};

export default function AdoptionsPage() {
  return (
    <main>
      <header className="topbar">
        <a className="brand" href="../" aria-label="経産省関係の調達・委託・補助金情報 トップ">
          <span className="brand-mark" aria-hidden="true">¥</span>
          <span>経産省関係の調達・委託・補助金情報</span>
        </a>
      </header>

      <ViewTabs active="adoptions" />

      <section className="adoption-page" id="top" aria-labelledby="adoptions-title">
        <div className="adoption-card">
          <div className="adoption-copy">
            <p className="eyebrow">ADOPTION RECORDS</p>
            <h1 id="adoptions-title">中小企業庁の補助金採択者情報</h1>
            <p className="adoption-lead">
              Go-Tech、IT導入、ものづくり、事業再構築、持続化などの採択者を、
              中小企業庁の公式検索で確認できます。
            </p>
            <p className="adoption-warning">
              採択は補助金交付の候補者として選定された段階です。この採択者情報は、交付決定額・確定額・実支払額を示しません。
              検索先に金額は掲載されていないため、GビズINFOの掲載情報とは合算しません。
              公開に同意した採択者のみが対象です。
            </p>
            <p className="adoption-detail">
              Go-Techでは、掲載事業者と国から直接補助金を受ける事業管理機関が異なる場合があり、
              掲載事業者名だけでは直接・間接の受領主体や受領額を判定できません。
            </p>
          </div>
          <div className="adoption-actions" aria-label="中小企業庁の公式採択者検索">
            <a
              className="primary-action"
              href="https://mirasapo-connect.go.jp/chusho-subsidies"
              target="_blank"
              rel="noreferrer"
            >
              補助金採択者検索を開く ↗
            </a>
            <a
              className="secondary-action"
              href="https://mirasapo-connect.go.jp/chusho-subsidies?subsidyCodes=GO_TECH"
              target="_blank"
              rel="noreferrer"
            >
              Go-Tech採択者を見る ↗
            </a>
            <span>外部サイト：中小企業庁 成長加速マッチングサービス</span>
          </div>
        </div>
      </section>

      <footer>
        <div className="brand"><span className="brand-mark" aria-hidden="true">¥</span><span>補助金採択者情報</span></div>
        <p>採択情報は、交付決定額・確定額・実支払額を示すものではありません。</p>
        <a href="../">GビズINFOの検索へ</a>
      </footer>
    </main>
  );
}
