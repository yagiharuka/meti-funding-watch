type Stage = "contracted" | "subsidy_published";
type Series = "gbiz" | "review" | "official";
type SearchEvent = CustomEvent<{ message: { result?: any }; parameters: string | null }>;

const yen = new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 });
const short = new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 1 });
let series: Series = "gbiz";
let pending: { q: string; result: any } | null = null;
let scheduledFrame = 0;

const esc = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
const amount = (n: number) => n >= 1e8 ? `${short.format(n / 1e8)}億円` : n >= 1e4 ? `${short.format(n / 1e4)}万円` : yen.format(n);
const label = (s: Stage) => s === "contracted" ? "調達・委託" : "補助金";
const note = (s: Stage) => s === "contracted" ? "受注額" : "GビズINFO補助金掲載額";
const stage = (o: any, s: Stage) => o.byStage.find((x: any) => x.stage === s) ?? { records: 0, amount: 0, amountKnownCount: 0 };
const date = (v: string | null) => v || "日付の記載なし";

function moneyCell(x: any, s: Stage) {
  return x.amountKnownCount ? `<strong title="${esc(yen.format(x.amount))}">${esc(amount(x.amount))}</strong><small>※${note(s)}</small>` : `<strong>—</strong><small>※${note(s)}</small>`;
}

function yearTable(o: any) {
  return `<div class="company-search-table-scroll"><table class="company-search-breakdown-table"><thead><tr><th>年度</th><th>調達・委託（件数／受注額）</th><th>補助金（件数／GビズINFO掲載額）</th><th>金額の記載なし</th></tr></thead><tbody>${o.byYear.map((y: any) => `<tr><td>${y.fiscalYear === null ? "年度不明" : `${y.fiscalYear}年度`}</td><td><strong>${y.contracted.records}件</strong><small>${y.contracted.amountKnownCount ? esc(amount(y.contracted.amount)) : "—"}／受注額</small></td><td><strong>${y.subsidy_published.records}件</strong><small>${y.subsidy_published.amountKnownCount ? esc(amount(y.subsidy_published.amount)) : "—"}／GビズINFO補助金掲載額</small></td><td>${y.amountUnknownCount}件</td></tr>`).join("")}</tbody></table></div>`;
}

function programTable(o: any) {
  return `<div class="company-search-table-scroll"><table class="company-search-breakdown-table"><thead><tr><th>区分</th><th>活動名称・件名</th><th>掲載行</th><th>公表金額</th><th>金額記載あり</th></tr></thead><tbody>${o.topPrograms.map((p: any) => `<tr><td><span class="stage-badge ${p.stage}">${label(p.stage)}</span></td><td><span class="program-name">${esc(p.program)}</span></td><td>${p.records}件</td><td>${moneyCell(p, p.stage)}</td><td>${p.amountKnownCount}件</td></tr>`).join("")}</tbody></table></div>`;
}

function detailTable(o: any) {
  const rows = o.detailRows.map((r: any) => `<tr><td><span class="stage-badge ${r.stage}">${label(r.stage)}</span></td><td>${esc(r.sourceAgency)}</td><td><span class="program-name">${esc(r.program)}</span></td><td>${esc(date(r.date))}</td><td><strong>${r.amount !== null ? esc(yen.format(r.amount)) : "金額の記載なし"}</strong><small>※${note(r.stage)}</small></td><td>${r.sourceUrl ? `<a class="source-link" href="${esc(r.sourceUrl)}" target="_blank" rel="noreferrer">GビズINFO ↗</a>` : esc(r.sourceSystem)}</td></tr>`).join("");
  const more = o.detailTruncated ? `<p class="company-search-fold-note">先頭100件を表示しています。<button type="button" class="company-search-corp-only" data-corp="${esc(o.corporateNumber)}">法人番号で全明細を検索</button></p>` : "";
  return `<div class="company-search-table-scroll"><table class="company-search-breakdown-table company-search-detail-table"><thead><tr><th>区分</th><th>公表組織</th><th>活動名称・件名</th><th>日付</th><th>公表金額</th><th>出典</th></tr></thead><tbody>${rows}</tbody></table></div>${more}`;
}

function fundingLine(o: any, s: Stage) {
  const x = stage(o, s);
  return `<div class="company-search-funding-line"><span class="company-search-funding-kind">${label(s)}</span><strong class="company-search-count">${x.records}件</strong><strong class="company-search-amount${x.amountKnownCount ? "" : " empty"}" title="${x.amountKnownCount ? esc(yen.format(x.amount)) : ""}">${x.amountKnownCount ? esc(amount(x.amount)) : "—"}</strong><small>※${note(s)}${x.records > x.amountKnownCount ? `／金額記載 ${x.amountKnownCount}件` : ""}</small></div>`;
}

function card(o: any, i: number) {
  const id = `${o.corporateNumber}-${i}`;
  return `<article class="company-search-organization-card"><header class="company-search-organization-header"><div><h4>${esc(o.name)}</h4><p>法人番号 <strong>${esc(o.corporateNumber)}</strong></p></div><span class="company-search-record-count">掲載 ${o.records}件</span></header><div class="company-search-funding-summary">${fundingLine(o, "contracted")}${fundingLine(o, "subsidy_published")}<div class="company-search-funding-line company-search-unknown-line"><span class="company-search-funding-kind">金額の記載なし</span><strong class="company-search-count">${o.amountUnknownCount}件</strong><span class="company-search-amount empty">—</span><small>金額欄が空欄の掲載行</small></div></div><p class="company-search-no-total">※ 調達・委託の受注額と補助金情報の掲載額は意味が異なるため、金額は合計していません。</p><div class="company-search-disclosure-controls"><button type="button" class="company-search-disclosure-button" data-fold="y-${id}" data-open="年度別を閉じる">年度別を見る</button><button type="button" class="company-search-disclosure-button" data-fold="p-${id}" data-open="事業別を閉じる">金額の大きい事業を見る</button><button type="button" class="company-search-disclosure-button" data-fold="d-${id}" data-open="明細を閉じる">明細を見る</button></div><div class="company-search-fold" id="y-${id}" hidden>${yearTable(o)}</div><div class="company-search-fold" id="p-${id}" hidden>${programTable(o)}</div><div class="company-search-fold" id="d-${id}" hidden>${detailTable(o)}</div></article>`;
}

function tabs() {
  return `<div class="company-search-series-tabs" role="tablist" aria-label="検索結果の出典系列"><button type="button" role="tab" data-series="gbiz">GビズINFO</button><button type="button" role="tab" data-series="review">行政事業レビュー</button><button type="button" role="tab" data-series="official">公式資料</button></div>`;
}

function markCombined() {
  const records = document.querySelector<HTMLElement>("#records");
  const combined = records?.querySelector<HTMLElement>(':scope > section[aria-labelledby="combined-company-review-title"]');
  if (!records || !combined) return;
  let official = false;
  for (const child of Array.from(combined.children)) {
    if (child.querySelector<HTMLElement>(".eyebrow")?.textContent?.trim() === "OFFICIAL SUPPLEMENT") official = true;
    child.classList.toggle("combined-series-official-node", official);
    child.classList.toggle("combined-series-review-node", !official);
  }
  const review = combined.querySelector<HTMLElement>("[aria-label='行政事業レビュー企業検索サマリー']");
  if (!review) return;
  const n = Number((review.querySelector("tbody td:first-child strong")?.textContent ?? "").replace(/\D/g, ""));
  review.classList.toggle("review-multi-corp-summary", n > 1);
  let warn = combined.querySelector<HTMLElement>(".review-multi-corp-note");
  if (n > 1 && !warn) {
    warn = document.createElement("p");
    warn.className = "filter-note review-multi-corp-note combined-series-review-node";
    warn.textContent = `${n}法人が一致したため、法人をまたぐ金額合計は表示していません。明細の法人番号で区別してください。`;
    review.insertAdjacentElement("afterend", warn);
  }
  if (n <= 1) warn?.remove();
}

function syncSeries() {
  const records = document.querySelector<HTMLElement>("#records");
  const ui = document.getElementById("company-search-experience");
  if (!records || !ui) return;
  records.dataset.companySeries = series;
  ui.querySelectorAll<HTMLButtonElement>("[data-series]").forEach((b) => {
    const active = b.dataset.series === series;
    b.setAttribute("aria-selected", active ? "true" : "false");
    b.tabIndex = active ? 0 : -1;
  });
  markCombined();
}

function render() {
  scheduledFrame = 0;
  if (!pending) return;
  const records = document.querySelector<HTMLElement>("#records");
  const mount = document.getElementById("company-search-mount");
  if (!records || !mount) {
    console.error("Company search mount point was not found.");
    pending = null;
    return;
  }
  const { q, result } = pending;
  const orgs = result.organizationSummaries ?? [];
  let ui = document.getElementById("company-search-experience");
  if (!ui) {
    ui = document.createElement("section");
    ui.id = "company-search-experience";
    mount.append(ui);
  } else if (ui.parentElement !== mount) {
    mount.append(ui);
  }
  const gbizBody = orgs.length
    ? `<div class="company-search-organization-list">${orgs.map(card).join("")}</div>`
    : '<p class="filter-note">GビズINFOでは一致する法人を確認できませんでした。行政事業レビュー・公式資料のタブも確認できます。</p>';
  ui.innerHTML = `${tabs()}<div class="company-search-gbiz-panel"><div class="company-search-query-heading"><p class="eyebrow">COMPANY SEARCH / GビズINFO</p><h3>「${esc(q)}」の検索結果</h3><p>該当法人 <strong>${orgs.length}件</strong>（法人番号で区別しています）</p>${result.organizationSummariesTruncated ? '<p class="company-search-warning">一致法人が多いため先頭50法人まで表示しています。</p>' : ""}</div>${gbizBody}</div>`;
  records.classList.add("enhanced-company-search-active");
  series = "gbiz";
  pending = null;
  syncSeries();
}

function scheduleRender() {
  if (scheduledFrame) cancelAnimationFrame(scheduledFrame);
  scheduledFrame = requestAnimationFrame(render);
}

function clear() {
  pending = null;
  if (scheduledFrame) cancelAnimationFrame(scheduledFrame);
  scheduledFrame = 0;
  document.getElementById("company-search-experience")?.remove();
  const r = document.querySelector<HTMLElement>("#records");
  r?.classList.remove("enhanced-company-search-active");
  if (r) delete r.dataset.companySeries;
  document.querySelector(".review-multi-corp-note")?.remove();
}

window.addEventListener("meti-funding-search-result", ((e: SearchEvent) => {
  const result = e.detail?.message?.result;
  const q = e.detail?.parameters ? (new URLSearchParams(e.detail.parameters).get("q") ?? "").trim() : "";
  if (!q || !result) return clear();
  pending = { q, result };
  scheduleRender();
}) as EventListener);

document.addEventListener("click", (e) => {
  const t = e.target instanceof Element ? e.target : null;
  if (!t?.closest("#company-search-experience")) return;
  const tab = t.closest<HTMLButtonElement>("button[data-series]");
  if (tab) { series = tab.dataset.series as Series; return syncSeries(); }
  const b = t.closest<HTMLButtonElement>("button[data-fold]");
  if (b?.dataset.fold) {
    const panel = document.getElementById(b.dataset.fold);
    if (!panel) return;
    const open = panel.hasAttribute("hidden");
    panel.toggleAttribute("hidden", !open);
    b.setAttribute("aria-expanded", open ? "true" : "false");
    if (!b.dataset.closed) b.dataset.closed = b.textContent ?? "見る";
    b.textContent = open ? (b.dataset.open ?? "閉じる") : b.dataset.closed;
    return;
  }
  const corp = t.closest<HTMLButtonElement>("button[data-corp]")?.dataset.corp;
  if (corp) {
    const input = document.querySelector<HTMLInputElement>("#records .search-field input[type=search]");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (input && setter) { setter.call(input, corp); input.dispatchEvent(new Event("input", { bubbles: true })); input.focus(); }
  }
});

document.addEventListener("input", (e) => { if (e.target instanceof Element && e.target.closest("#records .filters")) clear(); });
document.addEventListener("change", (e) => { if (e.target instanceof Element && e.target.closest("#records .filters")) clear(); });

const root = document.getElementById("root");
if (root) new MutationObserver(() => { if (document.querySelector("#records.enhanced-company-search-active")) requestAnimationFrame(markCombined); }).observe(root, { childList: true, subtree: true });