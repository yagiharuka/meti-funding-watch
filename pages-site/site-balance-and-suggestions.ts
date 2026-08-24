type OrganizationCandidate = {
  name: string;
  corporateNumber: string;
  records: number;
};

type SearchResult = {
  organizationSummaries?: OrganizationCandidate[];
  alternativeOrganizations?: OrganizationCandidate[];
};

type SearchEvent = CustomEvent<{
  message?: { result?: SearchResult };
  parameters?: string | null;
}>;

const SUGGESTIONS_ID = "company-name-suggestions";
const MAX_SUGGESTIONS = 12;

function normalize(value: string) {
  return value.normalize("NFKC").replace(/[\s　]+/g, "").toLocaleLowerCase("ja-JP");
}

function searchInput() {
  return document.querySelector<HTMLInputElement>("#records .search-field input[type=search]");
}

function clearSuggestions() {
  document.getElementById(SUGGESTIONS_ID)?.remove();
}

function setNativeInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (!setter) return;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.focus();
}

function renderSuggestions(query: string, result: SearchResult) {
  clearSuggestions();
  const input = searchInput();
  const filters = input?.closest<HTMLElement>(".filters");
  const normalizedQuery = normalize(query);
  if (!input || !filters || !normalizedQuery || /^\d{13}$/.test(normalizedQuery)) return;

  const deduped = new Map<string, OrganizationCandidate>();
  for (const item of [...(result.organizationSummaries ?? []), ...(result.alternativeOrganizations ?? [])]) {
    if (!item?.name || !/^\d{13}$/.test(item.corporateNumber)) continue;
    if (!normalize(item.name).includes(normalizedQuery)) continue;
    if (!deduped.has(item.corporateNumber)) deduped.set(item.corporateNumber, item);
  }
  const candidates = [...deduped.values()].slice(0, MAX_SUGGESTIONS);
  if (!candidates.length) return;

  const box = document.createElement("div");
  box.id = SUGGESTIONS_ID;
  box.className = "company-name-suggestions";
  box.setAttribute("role", "listbox");
  box.setAttribute("aria-label", `「${query}」を含む企業名候補`);

  const heading = document.createElement("div");
  heading.className = "company-name-suggestions-heading";
  heading.innerHTML = `<span>企業名の候補</span><small>「${query.replace(/[&<>"']/g, "")}」を含む法人</small>`;
  box.append(heading);

  const list = document.createElement("div");
  list.className = "company-name-suggestions-list";
  for (const candidate of candidates) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "company-name-suggestion";
    button.dataset.corporateNumber = candidate.corporateNumber;
    button.setAttribute("role", "option");
    const name = document.createElement("strong");
    name.textContent = candidate.name;
    const meta = document.createElement("small");
    meta.textContent = `法人番号 ${candidate.corporateNumber} ／ 掲載 ${candidate.records.toLocaleString("ja-JP")}件`;
    button.append(name, meta);
    list.append(button);
  }
  box.append(list);
  filters.insertAdjacentElement("afterend", box);
}

function balanceSiteCopy() {
  document.querySelector(".hero-scope-warning")?.remove();
  document.querySelector(".hero-note")?.remove();

  const recordsNav = document.querySelector<HTMLAnchorElement>('.topbar nav a[href="#records"]');
  if (recordsNav) recordsNav.textContent = "検索";

  const secondaryAction = document.querySelector<HTMLAnchorElement>(".hero-actions .secondary-action");
  if (secondaryAction) secondaryAction.textContent = "企業・事業を検索";

  const sourceSection = document.querySelector<HTMLElement>("#sources");
  const sourceIntro = sourceSection?.querySelector<HTMLElement>(".section-heading.light > p");
  if (sourceIntro) {
    sourceIntro.textContent = "GビズINFOと行政事業レビューは週次、実装済みの公式補足は月次で、それぞれ独立して更新します。";
  }

  if (sourceSection && !document.getElementById("series-update-overview")) {
    const detailGrid = sourceSection.querySelector(".source-grid");
    const overview = document.createElement("div");
    overview.id = "series-update-overview";
    overview.className = "source-grid series-update-overview";
    overview.innerHTML = [
      ["GビズINFO", "週次", "法人等別の調達・補助金掲載情報"],
      ["行政事業レビュー", "週次", "事業・予算執行・支出先情報"],
      ["公式補足", "月次", "取得処理を実装済みの機関公表資料"],
    ].map(([name, cadence, note]) => `<article><div>${name}</div><strong>${cadence}更新</strong><p>${note}</p></article>`).join("");
    detailGrid?.insertAdjacentElement("beforebegin", overview);
  }

  const footerText = document.querySelector<HTMLElement>("footer > p");
  if (footerText) {
    footerText.textContent = "GビズINFO、行政事業レビュー、機関公表資料などの公開情報を抽出・整形して作成した非公式サイトです。原資料と本サイトの抽出・取込について、正確性・完全性・最新性を保証するものではありません。";
  }
}

window.addEventListener("meti-funding-search-result", ((event: SearchEvent) => {
  const result = event.detail?.message?.result;
  const query = event.detail?.parameters
    ? (new URLSearchParams(event.detail.parameters).get("q") ?? "").trim()
    : "";
  if (!result || !query) return clearSuggestions();
  renderSuggestions(query, result);
}) as EventListener);

document.addEventListener("input", (event) => {
  if (event.target === searchInput()) clearSuggestions();
});

document.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const button = target?.closest<HTMLButtonElement>(".company-name-suggestion[data-corporate-number]");
  if (button?.dataset.corporateNumber) {
    const input = searchInput();
    if (input) setNativeInputValue(input, button.dataset.corporateNumber);
    clearSuggestions();
    return;
  }
  if (!target?.closest("#company-name-suggestions") && !target?.closest("#records .search-field")) clearSuggestions();
});

const root = document.getElementById("root");
if (root) {
  balanceSiteCopy();
  new MutationObserver(() => requestAnimationFrame(balanceSiteCopy)).observe(root, { childList: true, subtree: true });
}
