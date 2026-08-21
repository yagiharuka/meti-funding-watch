import fundingSummary from "@/data/funding-summary.json";

type SearchEvent = CustomEvent<{
  parameters?: string | null;
}>;

type FundingSummary = {
  sources?: Array<{ id?: string; csvEligibleSubsidyCount?: number }>;
  coverage?: { gbiz?: { unclassifiedDateCount?: number } };
};

const summary = fundingSummary as FundingSummary;
const gbiz = summary.sources?.find((source) => source.id === "gbiz");
const subsidyRows = gbiz?.csvEligibleSubsidyCount ?? null;
const undatedSubsidyRows = summary.coverage?.gbiz?.unclassifiedDateCount ?? null;

const SUBSIDY_NOTE = "GビズINFOの補助金は、同一補助金の交付決定・確定等が別行で掲載される場合があるため、掲載額を行をまたいで合計していません。また、執行団体・事務局等への交付原資を含む場合があり、掲載法人自身の収益・最終受益額を示すものではありません。";

let latestParameters = "";
let scheduledFrame = 0;

function scheduleApply() {
  if (scheduledFrame) return;
  scheduledFrame = requestAnimationFrame(() => {
    scheduledFrame = 0;
    patchReactSummary();
    patchCompanyExperience();
    renderYearWarning();
  });
}

function replaceCell(cell: Element | undefined, strongText: string, smallText: string) {
  if (!cell) return;
  if (
    cell.getAttribute("data-subsidy-semantics") === "patched"
    && cell.querySelector("strong")?.textContent === strongText
    && cell.querySelector("small")?.textContent === smallText
  ) return;
  cell.innerHTML = "";
  const strong = document.createElement("strong");
  strong.textContent = strongText;
  const small = document.createElement("small");
  small.textContent = smallText;
  cell.append(strong, small);
  cell.setAttribute("data-subsidy-semantics", "patched");
}

function setText(element: Element | undefined | null, value: string) {
  if (element && element.textContent !== value) element.textContent = value;
}

function ensureSemanticsNote(container: Element, after: Element | null = null) {
  if (container.querySelector(":scope > .subsidy-semantics-note")) return;
  const note = document.createElement("p");
  note.className = "filter-note subsidy-semantics-note";
  note.textContent = SUBSIDY_NOTE;
  if (after) after.insertAdjacentElement("afterend", note);
  else container.prepend(note);
}

function patchReactSummary() {
  const region = document.querySelector<HTMLElement>('[aria-label="企業検索結果サマリー"]');
  if (!region) return;

  for (const table of region.querySelectorAll("table")) {
    const headers = [...table.querySelectorAll("thead th")];
    const labels = headers.map((header) => header.textContent?.trim() ?? "");

    if (labels[0] === "情報種別") {
      setText(headers[2], "掲載値");
      for (const row of table.querySelectorAll("tbody tr")) {
        if (!row.querySelector(".stage-badge.subsidy_published")) continue;
        replaceCell([...row.children][2], "合計しません", "個別の掲載額は明細で確認");
      }
    }

    if (labels[0] === "直近5年度") setText(headers[0], "認定日・受注日の直近5年度");
    if (labels[0] === "掲載行の多い活動名称・件名") setText(headers[0], "活動名称・件名（参考）");
  }

  ensureSemanticsNote(region);
}

function patchCompanyExperience() {
  const ui = document.getElementById("company-search-experience");
  if (!ui) return;

  const heading = ui.querySelector(".company-search-query-heading");
  const panel = ui.querySelector(".company-search-gbiz-panel");
  if (panel) ensureSemanticsNote(panel, heading);

  for (const line of ui.querySelectorAll<HTMLElement>(".company-search-funding-line")) {
    if (line.querySelector(".company-search-funding-kind")?.textContent?.trim() !== "補助金") continue;
    const amount = line.querySelector<HTMLElement>(".company-search-amount");
    if (amount && amount.getAttribute("data-subsidy-semantics") !== "patched") {
      amount.textContent = "合計しません";
      amount.removeAttribute("title");
      amount.classList.add("empty");
      amount.setAttribute("data-subsidy-semantics", "patched");
    }
    setText(line.querySelector("small"), "個別の掲載額は明細で確認");
  }

  for (const note of ui.querySelectorAll<HTMLElement>(".company-search-no-total")) {
    setText(note, "※ 調達・委託は受注額を合計しています。補助金は交付決定・確定等の別行掲載があるため、掲載額を行をまたいで合計していません。");
  }

  for (const button of ui.querySelectorAll<HTMLButtonElement>("button[data-fold]")) {
    if (button.textContent?.includes("金額の大きい事業")) setText(button, "事業別を見る");
  }

  for (const table of ui.querySelectorAll<HTMLTableElement>(".company-search-breakdown-table")) {
    const headers = [...table.querySelectorAll("thead th")];
    const labels = headers.map((header) => header.textContent?.trim() ?? "");

    if (labels[0] === "年度") {
      setText(headers[0], "認定日・受注日の年度");
      setText(headers[2], "補助金（掲載件数）");
      for (const row of table.querySelectorAll("tbody tr")) {
        const cells = [...row.children];
        const subsidyCell = cells[2];
        const count = subsidyCell?.querySelector("strong")?.textContent?.trim() ?? "0件";
        replaceCell(subsidyCell, count, "認定日基準／金額は合計しません");
      }
      continue;
    }

    if (labels[0] === "区分" && labels.includes("公表金額")) {
      for (const row of table.querySelectorAll("tbody tr")) {
        if (!row.querySelector(".stage-badge.subsidy_published")) continue;
        replaceCell([...row.children][3], "合計しません", "個別の掲載額は明細で確認");
      }
    }
  }
}

function renderYearWarning() {
  const existing = document.querySelector<HTMLElement>(".subsidy-year-warning");
  if (!latestParameters) {
    existing?.remove();
    return;
  }

  const parameters = new URLSearchParams(latestParameters);
  const year = parameters.get("year") ?? "all";
  const stage = parameters.get("stage") ?? "all";
  const shouldShow = /^\d{4}$/.test(year) && stage !== "contracted";
  if (!shouldShow) {
    existing?.remove();
    return;
  }

  const mount = document.getElementById("company-search-mount");
  if (!mount) return;

  let text = "年度指定について：認定日が空欄の補助金掲載行は年度で振り分けられず検索対象外になります。年度別件数は資金額・採択件数の推移を示しません。";
  if (Number.isSafeInteger(subsidyRows) && Number.isSafeInteger(undatedSubsidyRows) && subsidyRows && undatedSubsidyRows) {
    const ratio = (100 * undatedSubsidyRows / subsidyRows).toFixed(1);
    text = `年度指定について：補助金${subsidyRows.toLocaleString("ja-JP")}行のうち${undatedSubsidyRows.toLocaleString("ja-JP")}行（${ratio}%）はGビズINFOの認定日が空欄のため、年度を指定すると年度で振り分けられず検索対象外になります。年度別件数は資金額・採択件数の推移を示しません。`;
  }

  if (existing) {
    setText(existing, text);
    return;
  }
  const warning = document.createElement("p");
  warning.className = "filter-note subsidy-year-warning";
  warning.textContent = text;
  mount.insertAdjacentElement("beforebegin", warning);
}

window.addEventListener("meti-funding-search-result", ((event: SearchEvent) => {
  latestParameters = event.detail?.parameters ?? "";
  scheduleApply();
}) as EventListener);

const observer = new MutationObserver(scheduleApply);
observer.observe(document.documentElement, { childList: true, subtree: true });
scheduleApply();
