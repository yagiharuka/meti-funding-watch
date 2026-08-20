type Stage = "contracted" | "subsidy_published";

type StageSummary = {
  stage: Stage;
  records: number;
  amount: number;
  amountKnownCount: number;
};

type YearStageSummary = {
  records: number;
  amount: number;
  amountKnownCount: number;
};

type FundingRecord = {
  id: string;
  fiscalYear: number | null;
  date: string | null;
  organization: string;
  corporateNumber: string;
  sourceAgency: string;
  program: string;
  amount: number | null;
  amountRaw?: string;
  stage: Stage;
  sourceSystem: string;
  sourceUrl?: string;
};

type OrganizationFundingSummary = {
  name: string;
  corporateNumber: string;
  records: number;
  amountUnknownCount: number;
  byStage: StageSummary[];
  byYear: Array<{
    fiscalYear: number | null;
    contracted: YearStageSummary;
    subsidy_published: YearStageSummary;
    amountUnknownCount: number;
  }>;
  topPrograms: Array<{
    stage: Stage;
    program: string;
    records: number;
    amount: number;
    amountKnownCount: number;
  }>;
  detailRows: FundingRecord[];
  detailTruncated: boolean;
};

type EnhancedSearchResult = {
  totalRecords: number;
  organizationSummaries?: OrganizationFundingSummary[];
  organizationSummariesTruncated?: boolean;
};

type SearchEventDetail = {
  message: {
    type?: string;
    requestId?: number;
    result?: EnhancedSearchResult;
  };
  parameters: string | null;
};

type PendingRender = {
  query: string;
  result: EnhancedSearchResult;
};

type SeriesMode = "gbiz" | "review" | "official";

const yen = new Intl.NumberFormat("ja-JP", {
  style: "currency",
  currency: "JPY",
  maximumFractionDigits: 0,
});
const decimal = new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 1 });
let pendingRender: PendingRender | null = null;
let renderScheduled = false;
let seriesScheduled = false;
let currentSeriesMode: SeriesMode = "gbiz";

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatAmount(amount: number) {
  if (amount >= 100_000_000) return `${decimal.format(amount / 100_000_000)}億円`;
  if (amount >= 10_000) return `${decimal.format(amount / 10_000)}万円`;
  return yen.format(amount);
}

function formatDate(value: string | null) {
  if (!value) return "日付の記載なし";
  const [year, month, day] = value.split("-");
  return `${year}/${String(Number(month)).padStart(2, "0")}/${String(Number(day)).padStart(2, "0")}`;
}

function stageLabel(stage: Stage) {
  return stage === "contracted" ? "調達・委託" : "補助金";
}

function stageAmountNote(stage: Stage) {
  return stage === "contracted" ? "受注額" : "交付決定額";
}

function stageSummary(summary: OrganizationFundingSummary, stage: Stage): StageSummary {
  return summary.byStage.find((item) => item.stage === stage)
    ?? { stage, records: 0, amount: 0, amountKnownCount: 0 };
}

function renderFundingLine(summary: OrganizationFundingSummary, stage: Stage) {
  const item = stageSummary(summary, stage);
  const amount = item.amountKnownCount > 0
    ? `<strong class="company-search-amount" title="${escapeHtml(yen.format(item.amount))}">${escapeHtml(formatAmount(item.amount))}</strong>`
    : `<strong class="company-search-amount empty">—</strong>`;
  const knownNote = item.records > item.amountKnownCount
    ? `／金額記載 ${item.amountKnownCount.toLocaleString("ja-JP")}件`
    : "";
  return `
    <div class="company-search-funding-line">
      <span class="company-search-funding-kind">${escapeHtml(stageLabel(stage))}</span>
      <strong class="company-search-count">${item.records.toLocaleString("ja-JP")}件</strong>
      ${amount}
      <small>※${escapeHtml(stageAmountNote(stage))}${escapeHtml(knownNote)}</small>
    </div>`;
}

function renderYearTable(summary: OrganizationFundingSummary) {
  const rows = summary.byYear.map((item) => {
    const contract = item.contracted;
    const subsidy = item.subsidy_published;
    const contractAmount = contract.amountKnownCount ? formatAmount(contract.amount) : "—";
    const subsidyAmount = subsidy.amountKnownCount ? formatAmount(subsidy.amount) : "—";
    return `<tr>
      <td>${item.fiscalYear === null ? "年度不明" : `${item.fiscalYear}年度`}</td>
      <td><strong>${contract.records.toLocaleString("ja-JP")}件</strong><small>${escapeHtml(contractAmount)}／受注額</small></td>
      <td><strong>${subsidy.records.toLocaleString("ja-JP")}件</strong><small>${escapeHtml(subsidyAmount)}／交付決定額</small></td>
      <td>${item.amountUnknownCount.toLocaleString("ja-JP")}件</td>
    </tr>`;
  }).join("");
  return `<div class="company-search-table-scroll"><table class="company-search-breakdown-table">
    <thead><tr><th>年度</th><th>調達・委託（件数／受注額）</th><th>補助金（件数／交付決定額）</th><th>金額の記載なし</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="4">該当なし</td></tr>'}</tbody>
  </table></div>`;
}

function renderProgramTable(summary: OrganizationFundingSummary) {
  const rows = summary.topPrograms.map((item) => `<tr>
    <td><span class="stage-badge ${escapeHtml(item.stage)}">${escapeHtml(stageLabel(item.stage))}</span></td>
    <td><span class="program-name">${escapeHtml(item.program)}</span></td>
    <td>${item.records.toLocaleString("ja-JP")}件</td>
    <td><strong>${item.amountKnownCount ? escapeHtml(formatAmount(item.amount)) : "—"}</strong><small>※${escapeHtml(stageAmountNote(item.stage))}</small></td>
    <td>${item.amountKnownCount.toLocaleString("ja-JP")}件</td>
  </tr>`).join("");
  return `<div class="company-search-table-scroll"><table class="company-search-breakdown-table company-search-program-table">
    <thead><tr><th>区分</th><th>活動名称・件名</th><th>掲載行</th><th>公表金額</th><th>金額記載あり</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="5">該当なし</td></tr>'}</tbody>
  </table></div>`;
}

function renderDetailTable(summary: OrganizationFundingSummary) {
  const rows = summary.detailRows.map((row) => {
    const amount = row.amount !== null
      ? yen.format(row.amount)
      : (row.amountRaw?.trim() ? `原文：${row.amountRaw}` : "金額の記載なし");
    const source = row.sourceUrl
      ? `<a class="source-link" href="${escapeHtml(row.sourceUrl)}" target="_blank" rel="noreferrer">GビズINFO ↗</a>`
      : escapeHtml(row.sourceSystem);
    return `<tr>
      <td><span class="stage-badge ${escapeHtml(row.stage)}">${escapeHtml(stageLabel(row.stage))}</span></td>
      <td>${escapeHtml(row.sourceAgency)}</td>
      <td><span class="program-name">${escapeHtml(row.program)}</span></td>
      <td>${escapeHtml(formatDate(row.date))}</td>
      <td><strong>${escapeHtml(amount)}</strong><small>※${escapeHtml(stageAmountNote(row.stage))}</small></td>
      <td>${source}</td>
    </tr>`;
  }).join("");
  const truncated = summary.detailTruncated
    ? `<p class="company-search-fold-note">この法人は100件を超えるため、ここでは先頭100件を表示しています。<button type="button" class="company-search-corp-only" data-corporate-number="${escapeHtml(summary.corporateNumber)}">法人番号で全明細を検索</button></p>`
    : "";
  return `<div class="company-search-table-scroll company-search-detail-scroll"><table class="company-search-breakdown-table company-search-detail-table">
    <thead><tr><th>区分</th><th>公表組織</th><th>活動名称・件名</th><th>日付</th><th>公表金額</th><th>出典</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="6">明細なし</td></tr>'}</tbody>
  </table></div>${truncated}`;
}

function renderOrganizationCard(summary: OrganizationFundingSummary, index: number) {
  const key = `${summary.corporateNumber}-${index}`;
  return `<article class="company-search-organization-card">
    <header class="company-search-organization-header">
      <div>
        <h4>${escapeHtml(summary.name)}</h4>
        <p>法人番号 <strong>${escapeHtml(summary.corporateNumber)}</strong></p>
      </div>
      <span class="company-search-record-count">掲載 ${summary.records.toLocaleString("ja-JP")}件</span>
    </header>
    <div class="company-search-funding-summary">
      ${renderFundingLine(summary, "contracted")}
      ${renderFundingLine(summary, "subsidy_published")}
      <div class="company-search-funding-line company-search-unknown-line">
        <span class="company-search-funding-kind">金額の記載なし</span>
        <strong class="company-search-count">${summary.amountUnknownCount.toLocaleString("ja-JP")}件</strong>
        <span class="company-search-amount empty">—</span>
        <small>金額欄が空欄の掲載行</small>
      </div>
    </div>
    <p class="company-search-no-total">※ 調達・委託は受注額、補助金は交付決定額で意味が異なるため、金額は合計していません。</p>
    <div class="company-search-disclosure-controls" aria-label="${escapeHtml(summary.name)}の内訳表示">
      <button type="button" class="company-search-disclosure-button" aria-expanded="false" aria-controls="company-year-${key}" data-fold-target="company-year-${key}" data-closed-label="年度別を見る" data-open-label="年度別を閉じる">年度別を見る</button>
      <button type="button" class="company-search-disclosure-button" aria-expanded="false" aria-controls="company-program-${key}" data-fold-target="company-program-${key}" data-closed-label="金額の大きい事業を見る" data-open-label="事業別を閉じる">金額の大きい事業を見る</button>
      <button type="button" class="company-search-disclosure-button" aria-expanded="false" aria-controls="company-detail-${key}" data-fold-target="company-detail-${key}" data-closed-label="明細を見る" data-open-label="明細を閉じる">明細を見る</button>
    </div>
    <div class="company-search-fold" id="company-year-${key}" hidden>${renderYearTable(summary)}</div>
    <div class="company-search-fold" id="company-program-${key}" hidden>${renderProgramTable(summary)}</div>
    <div class="company-search-fold" id="company-detail-${key}" hidden>${renderDetailTable(summary)}</div>
  </article>`;
}

function renderSeriesTabs() {
  return `<div class="company-search-series-tabs" role="tablist" aria-label="検索結果の出典系列">
    <button type="button" role="tab" data-series="gbiz">GビズINFO</button>
    <button type="button" role="tab" data-series="review">行政事業レビュー</button>
    <button type="button" role="tab" data-series="official">公式資料</button>
  </div>`;
}

function syncSeriesMode() {
  const records = document.querySelector<HTMLElement>("#records");
  const experience = document.getElementById("company-search-experience");
  if (!records || !experience) return;
  records.dataset.companySeries = currentSeriesMode;
  for (const button of experience.querySelectorAll<HTMLButtonElement>("[role=tab][data-series]")) {
    const active = button.dataset.series === currentSeriesMode;
    button.setAttribute("aria-selected", active ? "true" : "false");
    button.tabIndex = active ? 0 : -1;
  }
  markCombinedSeries();
}

function renderPendingExperience() {
  renderScheduled = false;
  if (!pendingRender) return;
  const records = document.querySelector<HTMLElement>("#records");
  if (!records) return;
  const originalSummary = records.querySelector<HTMLElement>(
    ':scope > .records-table[aria-label="企業検索結果サマリー"]',
  );
  if (!originalSummary) {
    scheduleRender();
    return;
  }

  const { query, result } = pendingRender;
  const organizations = result.organizationSummaries ?? [];
  if (!query || !result.totalRecords || !organizations.length) {
    clearEnhancedExperience();
    return;
  }

  let experience = document.getElementById("company-search-experience");
  if (!experience) {
    experience = document.createElement("section");
    experience.id = "company-search-experience";
    originalSummary.insertAdjacentElement("beforebegin", experience);
  }
  experience.innerHTML = `${renderSeriesTabs()}
    <div class="company-search-gbiz-panel" role="tabpanel">
      <div class="company-search-query-heading">
        <p class="eyebrow">COMPANY SEARCH / GビズINFO</p>
        <h3>「${escapeHtml(query)}」の検索結果</h3>
        <p>該当法人 <strong>${organizations.length.toLocaleString("ja-JP")}件</strong>（法人番号で区別しています）</p>
        ${result.organizationSummariesTruncated ? '<p class="company-search-warning">一致法人が多いため、先頭50法人まで表示しています。検索語を絞ってください。</p>' : ""}
      </div>
      <div class="company-search-organization-list">
        ${organizations.map(renderOrganizationCard).join("")}
      </div>
    </div>`;

  records.classList.add("enhanced-company-search-active");
  currentSeriesMode = "gbiz";
  syncSeriesMode();
}

function scheduleRender() {
  if (renderScheduled) return;
  renderScheduled = true;
  window.requestAnimationFrame(renderPendingExperience);
}

function clearEnhancedExperience() {
  document.getElementById("company-search-experience")?.remove();
  const records = document.querySelector<HTMLElement>("#records");
  if (records) {
    records.classList.remove("enhanced-company-search-active");
    delete records.dataset.companySeries;
  }
  pendingRender = null;
  currentSeriesMode = "gbiz";
  clearReviewMultiCorporationWarning();
}

function handleSearchResult(event: Event) {
  const custom = event as CustomEvent<SearchEventDetail>;
  const result = custom.detail?.message?.result;
  const parameters = custom.detail?.parameters;
  const query = parameters ? (new URLSearchParams(parameters).get("q") ?? "").trim() : "";
  if (!result || !query || !result.totalRecords) {
    pendingRender = null;
    clearEnhancedExperience();
    return;
  }
  pendingRender = { query, result };
  scheduleRender();
}

function setReactSearchValue(value: string) {
  const input = document.querySelector<HTMLInputElement>("#records .search-field input[type=search]");
  if (!input) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.focus();
}

function handleExperienceClick(event: MouseEvent) {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const experience = target.closest<HTMLElement>("#company-search-experience");
  if (!experience) return;

  const seriesButton = target.closest<HTMLButtonElement>("button[data-series]");
  if (seriesButton?.dataset.series) {
    const next = seriesButton.dataset.series as SeriesMode;
    if (next === "gbiz" || next === "review" || next === "official") {
      currentSeriesMode = next;
      syncSeriesMode();
    }
    return;
  }

  const foldButton = target.closest<HTMLButtonElement>("button[data-fold-target]");
  if (foldButton?.dataset.foldTarget) {
    const panel = document.getElementById(foldButton.dataset.foldTarget);
    if (!panel) return;
    const willOpen = panel.hasAttribute("hidden");
    if (willOpen) panel.removeAttribute("hidden");
    else panel.setAttribute("hidden", "");
    foldButton.setAttribute("aria-expanded", willOpen ? "true" : "false");
    foldButton.textContent = willOpen
      ? (foldButton.dataset.openLabel ?? "閉じる")
      : (foldButton.dataset.closedLabel ?? "見る");
    return;
  }

  const corpOnly = target.closest<HTMLButtonElement>("button.company-search-corp-only[data-corporate-number]");
  if (corpOnly?.dataset.corporateNumber) setReactSearchValue(corpOnly.dataset.corporateNumber);
}

function handleFilterInteraction(event: Event) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
  if (!target.closest("#records .filters")) return;
  clearEnhancedExperience();
}

function parseLeadingInteger(value: string) {
  const match = value.replace(/,/g, "").match(/\d+/);
  return match ? Number(match[0]) : null;
}

function clearReviewMultiCorporationWarning() {
  document.querySelector(".review-multi-corp-note")?.remove();
  document.querySelector("[aria-label='行政事業レビュー企業検索サマリー']")?.classList.remove("review-multi-corp-summary");
}

function markCombinedSeries() {
  seriesScheduled = false;
  const records = document.querySelector<HTMLElement>("#records");
  const combined = records?.querySelector<HTMLElement>(
    ':scope > section[aria-labelledby="combined-company-review-title"]',
  );
  if (!records || !combined || !records.classList.contains("enhanced-company-search-active")) return;

  let officialStarted = false;
  for (const child of Array.from(combined.children)) {
    const eyebrow = child.querySelector<HTMLElement>(".eyebrow")?.textContent?.trim();
    if (eyebrow === "OFFICIAL SUPPLEMENT") officialStarted = true;
    child.classList.toggle("combined-series-official-node", officialStarted);
    child.classList.toggle("combined-series-review-node", !officialStarted);
  }
  combined.dataset.seriesView = currentSeriesMode;

  const reviewSummary = combined.querySelector<HTMLElement>("[aria-label='行政事業レビュー企業検索サマリー']");
  if (reviewSummary) {
    const countText = reviewSummary.querySelector("tbody td:first-child strong")?.textContent ?? "";
    const count = parseLeadingInteger(countText);
    if (count !== null && count > 1) {
      reviewSummary.classList.add("review-multi-corp-summary");
      if (!combined.querySelector(".review-multi-corp-note")) {
        const note = document.createElement("p");
        note.className = "filter-note review-multi-corp-note combined-series-review-node";
        note.textContent = `${count.toLocaleString("ja-JP")}法人が一致したため、法人をまたぐ金額合計は表示していません。明細の法人番号で区別してください。`;
        reviewSummary.insertAdjacentElement("afterend", note);
      }
    } else {
      clearReviewMultiCorporationWarning();
    }
  }
}

function scheduleCombinedSeries() {
  if (seriesScheduled) return;
  seriesScheduled = true;
  window.requestAnimationFrame(markCombinedSeries);
}

window.addEventListener("meti-funding-search-result", handleSearchResult as EventListener);
document.addEventListener("click", handleExperienceClick);
document.addEventListener("input", handleFilterInteraction);
document.addEventListener("change", handleFilterInteraction);

const root = document.getElementById("root");
if (root) {
  new MutationObserver(() => {
    if (pendingRender) scheduleRender();
    scheduleCombinedSeries();
  }).observe(root, { childList: true, subtree: true });
}
