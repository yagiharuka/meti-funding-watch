import type { Metadata } from "next";

import ViewTabs from "@/app/ViewTabs";
import reconciliationData from "@/data/official-reconciliation.json";
import sourceRegistry from "@/data/official-source-registry.json";

export const metadata: Metadata = {
  title: "機関公表資料との照合の記録",
  description: "機関公表資料の掲載行とGビズINFO掲載値について、実際に照合を試みた範囲と各件の判定を示します。",
};

type ReconciliationStatus = "matched" | "amount_mismatch" | "one_sided" | "unresolvable";

type ReconciliationItem = {
  sequence: number;
  status: ReconciliationStatus;
  officialRecordId: string;
  officialSourceKey: string;
  recipient: string;
  officialAmount: number | null;
  gbizRecordId: string | null;
  gbizAmount: number | null;
  note?: string;
};

type ReconciliationComparison = Omit<(typeof reconciliationData.comparisons)[number], "items"> & {
  items: ReconciliationItem[];
};
const comparisons = reconciliationData.comparisons as ReconciliationComparison[];
const reviewPlanYears = reconciliationData.reviewPlan.fiscalYears;

const statusLabels: Record<ReconciliationStatus, string> = {
  matched: "一致",
  amount_mismatch: "額が不一致",
  one_sided: "片側のみ",
  unresolvable: "照合不能",
};

function formatAmount(value: number | null) {
  return value === null
    ? "該当行なし"
    : new Intl.NumberFormat("ja-JP", {
      style: "currency",
      currency: "JPY",
      maximumFractionDigits: 0,
    }).format(value);
}

export default function OfficialReconciliationPage() {
  for (const comparison of comparisons) {
    const statusCount = Object.values(comparison.counts).reduce((sum, value) => sum + value, 0);
    if (statusCount !== comparison.attemptedCount || comparison.items.length !== comparison.attemptedCount) {
      throw new Error(`${comparison.id}: 照合件数と内訳が一致しません`);
    }
  }
  const firstComparison = comparisons[0];

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="../" aria-label="経産省関係の調達（委託を含む）・補助金情報 トップ">
          <span className="brand-mark" aria-hidden="true">¥</span>
          <span>経産省関係の調達（委託を含む）・補助金情報</span>
        </a>
      </header>

      <ViewTabs active="official" />

      <section className="official-hero" id="top" aria-labelledby="official-title">
        <p className="eyebrow">RECONCILIATION LOG</p>
        <h1 id="official-title">機関公表資料との照合の記録</h1>
        <p className="official-lead">
          機関公表資料は自動更新する主系列ではなく、GビズINFO掲載値を確認するための照合資料として扱います。
          ここに示す分母は、機関公表資料のうち実際に照合を試みた件数です。
        </p>
        <p className="official-warning">
          照合結果は対象資料の全掲載行や、他の機関・年度を代表しません。金額は資料ごとの掲載値を比較し、合算しません。
        </p>
        <div className="hero-actions">
          <a className="primary-action" href="#reconciliation-records">照合結果を見る</a>
          <a className="secondary-action" href="#unreviewed">未照合の範囲を見る</a>
        </div>
      </section>

      <section className="official-section reconciliation-section" id="reconciliation-records" aria-labelledby="reconciliation-title">
        <div className="section-heading compact">
          <div>
            <p className="eyebrow">CHECKED SAMPLE</p>
            <h2 id="reconciliation-title">{firstComparison.executorName}／{firstComparison.periodLabel}</h2>
          </div>
          <p>確認日：{reconciliationData.asOf}</p>
        </div>

        {comparisons.map((comparison) => (
          <article className="reconciliation-sample" id={comparison.id} key={comparison.id}>
            <div className="reconciliation-card">
              <p className="reconciliation-attempted">
                <strong>照合 {comparison.attemptedCount}件</strong>
                <span>（{comparison.sampleDefinition}）</span>
              </p>
              <dl className="reconciliation-counts" aria-label={`${comparison.sampleDefinition}の照合結果内訳`}>
                <div><dt>一致</dt><dd>{comparison.counts.matched}件</dd></div>
                <div><dt>額が不一致</dt><dd>{comparison.counts.amountMismatch}件</dd></div>
                <div><dt>片側のみ</dt><dd>{comparison.counts.oneSided}件</dd></div>
                <div><dt>照合不能</dt><dd>{comparison.counts.unresolvable}件</dd></div>
              </dl>
              <p className="reconciliation-denominator">
                分母：{comparison.sampleDefinition}について、GビズINFOとの照合を試みた{comparison.attemptedCount}件。
              </p>
            </div>

            <div className="reconciliation-table" role="region" aria-label={`${comparison.executorName} ${comparison.sampleDefinition}の照合結果`} tabIndex={0}>
              <table>
                <caption>{comparison.sampleDefinition}：各行の原典とGビズINFO掲載行</caption>
                <thead>
                  <tr>
                    <th scope="col">掲載順</th>
                    <th scope="col">相手方</th>
                    <th scope="col">判定</th>
                    <th scope="col">機関公表資料</th>
                    <th scope="col">GビズINFO</th>
                  </tr>
                </thead>
                <tbody>
                  {comparison.items.map((item) => (
                    <tr key={item.officialRecordId}>
                      <th scope="row">{item.sequence}</th>
                      <td>
                        {item.recipient}
                        {item.note && <small className="reconciliation-note">確認メモ：{item.note}</small>}
                      </td>
                      <td><span className={`reconciliation-status ${item.status}`}>{statusLabels[item.status]}</span></td>
                      <td>
                        <strong>{formatAmount(item.officialAmount)}</strong>
                        <a href={comparison.sourceDocumentUrl} target="_blank" rel="noreferrer">
                          原典PDF ↗
                        </a>
                        <small>{item.officialSourceKey}</small>
                      </td>
                      <td>
                        {item.gbizRecordId ? (
                          <>
                            <strong>{formatAmount(item.gbizAmount)}</strong>
                            <a href={`../?q=${item.gbizRecordId}&year=${comparison.fiscalYear}#${item.gbizRecordId}`}>
                              GビズINFO掲載行
                            </a>
                            <small>{item.gbizRecordId}</small>
                          </>
                        ) : (
                          <>
                            <strong>該当行なし</strong>
                            <span>GビズINFO側の該当行を確認できず</span>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        ))}
      </section>

      <section className="official-section" id="unreviewed" aria-labelledby="unreviewed-title">
        <div className="section-heading compact">
          <div>
            <p className="eyebrow">NOT CHECKED</p>
            <h2 id="unreviewed-title">照合していない範囲</h2>
          </div>
          <p>空欄ではなく、実施状況を明記します。</p>
        </div>
        <p className="reconciliation-plan-note">
          下表は照合状況を明示するための表示範囲です。機関公表資料の母集団や収録対象範囲を示すものではありません。
        </p>
        <div className="unreviewed-matrix" role="region" aria-label="機関と年度ごとの照合状況" tabIndex={0}>
          <table>
            <caption>機関×年度の照合状況</caption>
            <thead>
              <tr>
                <th scope="col">機関</th>
                {reviewPlanYears.map((year) => <th scope="col" key={year}>{year}年度</th>)}
              </tr>
            </thead>
            <tbody>
              {sourceRegistry.executors.map((executor) => (
                <tr key={executor.id}>
                  <th scope="row">{executor.name}</th>
                  {reviewPlanYears.map((year) => {
                    const isReviewedSample = comparisons.some(
                      (comparison) => executor.id === comparison.executorId && year === comparison.fiscalYear,
                    );
                    return (
                      <td key={year} data-label={`${year}年度`}>
                        {isReviewedSample ? (
                          <a className="reviewed-sample" href="#reconciliation-records">
                            一部照合
                            <small>令和4年度上期・掲載順先頭50行と末尾50行のみ／中間65行は未照合</small>
                          </a>
                        ) : (
                          <span className="not-reviewed">未照合</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="official-warning">
          沖縄総合事務局は収録・照合の対象外です。過去に取得したデータは履歴として保持しています。
        </p>
      </section>

      <footer className="site-footer">
        <span>機関公表資料のparserと既存取得データは、手動照合と履歴確認のため保持しています。</span>
        <a href={firstComparison.sourceDocumentUrl} target="_blank" rel="noreferrer">今回の原典PDF ↗</a>
      </footer>
    </main>
  );
}
