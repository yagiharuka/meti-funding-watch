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

function runGuarded(label: string, operation: () => void) {
  try {
    operation();
  } catch (error) {
    console.error(`[subsidy-semantics] ${label} failed`, error);
  }
}

function scheduleApply() {
  if (scheduledFrame) return;
  scheduledFrame = requestAnimationFrame(() => {
    scheduledFrame = 0;
    runGuarded("summary", patchReactSummary);
    runGuarded("note", renderSemanticsNote);
    runGuarded("year-warning", renderYearWarning);
  });
}

function replaceCell(cell: Element | undefined, strongText: string, smallText: string) {
  if (!cell) throw new Error("Expected subsidy summary cell is missing");
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

function patchReactSummary() {
  const region = document.querySelector<HTMLElement>('[aria-label="企業検索結果サマリー"]');
  if (!region) return;

  let foundStageTable = false;
  for (const table of region.querySelectorAll("table")) {
    const headers = [...table.querySelectorAll("thead th")];
    const labels = headers.map((header) => header.textContent?.trim() ?? "");

    if (labels[0] === "情報種別") {
      foundStageTable = true;
      if (labels[2] !== "掲載値合計" && labels[2] !== "掲載値") {
        throw new Error(`Unexpected stage summary amount header: ${labels[2] ?? "missing"}`);
      }
      setText(headers[2], "掲載値");
      for (const row of table.querySelectorAll("tbody tr")) {
        if (!row.querySelector(".stage-badge.subsidy_published")) continue;
        if (row.children.length !== 3) throw new Error(`Unexpected stage summary column count: ${row.children.length}`);
        replaceCell([...row.children][2], "合計しません", "個別の掲載額は明細で確認");
      }
    }

    if (labels[0] === "直近5年度") setText(headers[0], "認定日・受注日の直近5年度");
    if (labels[0] === "掲載行の多い活動名称・件名") setText(headers[0], "活動名称・件名（参考）");
  }

  if (!foundStageTable) throw new Error("Stage summary table contract was not found");
  region.classList.add("subsidy-semantics-ready");
}

function renderSemanticsNote() {
  const mount = document.getElementById("company-search-mount");
  if (!mount || mount.querySelector(":scope > .subsidy-semantics-note")) return;
  const note = document.createElement("p");
  note.className = "filter-note subsidy-semantics-note";
  note.textContent = SUBSIDY_NOTE;
  mount.prepend(note);
}

function renderYearWarning() {
  const mount = document.getElementById("company-search-mount");
  if (!mount) return;
  const existing = mount.querySelector<HTMLElement>(":scope > .subsidy-year-warning");
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

  let text = "年度指定について：認定日が空欄の補助金掲載行は年度で振り分けられず検索対象外になります。年度別件数は資金額・採択件数の推移を示しません。";
  if (
    typeof subsidyRows === "number" && Number.isSafeInteger(subsidyRows) && subsidyRows > 0
    && typeof undatedSubsidyRows === "number" && Number.isSafeInteger(undatedSubsidyRows) && undatedSubsidyRows > 0
  ) {
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
  mount.prepend(warning);
}

window.addEventListener("meti-funding-search-result", ((event: SearchEvent) => {
  latestParameters = event.detail?.parameters ?? "";
  scheduleApply();
}) as EventListener);

const observer = new MutationObserver(scheduleApply);
observer.observe(document.documentElement, { childList: true, subtree: true });
scheduleApply();
