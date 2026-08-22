type CompanySearchResult = {
  organizationSummaries?: unknown[];
};

type SearchEvent = CustomEvent<{
  message: { result?: CompanySearchResult };
  parameters: string | null;
}>;

const zeroResultWarning = "これは、この事業者が資金を受けていないことを意味するものではありません。";
const legacyZeroPrefix = "GビズINFOでは一致する法人を確認できませんでした。";

const readingGuideHtml = `
  <details id="company-search-reading-guide" class="filter-note company-search-reading-guide">
    <summary>このデータの読み方</summary>
    <div>
      <p>GビズINFOの補助金は、同一補助金の交付決定・確定等が別行で掲載される場合があるため、掲載額を行をまたいで合計していません。</p>
      <p>掲載法人が執行団体・事務局等である場合があり、掲載法人自身の収益や最終受益額を示すとは限りません。</p>
      <p>公式資料の金額は交付決定額・契約額など公表時点が異なるため、GビズINFOや行政事業レビューの金額と合算しません。</p>
      <p>経産省から所管法人・基金・事務局等を経由する資金では、途中の主体が掲載される場合があります。各系列は公表対象・収録範囲・更新時点も異なります。</p>
    </div>
  </details>`;

function replaceExplanatoryNotes(panel: HTMLElement) {
  panel.querySelector<HTMLElement>(".subsidy-semantics-note")?.remove();
  panel.querySelectorAll<HTMLElement>(".company-search-no-total").forEach((node) => {
    node.innerHTML = '<a class="source-link company-search-reading-link" href="#company-search-reading-guide">↓ 読み方</a>';
  });
}

function removeLegacyZeroMessage(panel: HTMLElement) {
  const legacy = Array.from(panel.querySelectorAll<HTMLElement>("p.filter-note"))
    .find((node) => node.textContent?.trim().startsWith(legacyZeroPrefix));
  legacy?.remove();
}

function applyReadingGuide(isZeroResult: boolean) {
  const panel = document.querySelector<HTMLElement>("#company-search-experience .company-search-gbiz-panel");
  if (!panel) return;

  replaceExplanatoryNotes(panel);
  removeLegacyZeroMessage(panel);
  panel.querySelector<HTMLElement>(".company-search-zero-warning")?.remove();
  panel.querySelector<HTMLElement>("#company-search-reading-guide")?.remove();

  const heading = panel.querySelector<HTMLElement>(".company-search-query-heading");
  if (isZeroResult && heading) {
    heading.insertAdjacentHTML(
      "afterend",
      `<p class="filter-note company-search-zero-warning">${zeroResultWarning}</p>`,
    );
  }

  panel.insertAdjacentHTML("beforeend", readingGuideHtml);
}

window.addEventListener("meti-funding-search-result", ((event: SearchEvent) => {
  const result = event.detail?.message?.result;
  if (!result) return;
  const isZeroResult = (result.organizationSummaries?.length ?? 0) === 0;

  // company-search-ui registers first and renders in requestAnimationFrame.
  // Scheduling after it keeps the long explanatory text out of the painted UI
  // while preserving the existing renderer as a fail-closed base layer.
  requestAnimationFrame(() => applyReadingGuide(isZeroResult));
}) as EventListener);
