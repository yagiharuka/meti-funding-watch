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

function setText(element: Element | null | undefined, value: string) {
  if (element && element.textContent !== value) element.textContent = value;
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
  box.setAttribute("aria-label", `名称に「${query}」を含む企業名の部分一致候補`);

  const heading = document.createElement("div");
  heading.className = "company-name-suggestions-heading";
  const headingLabel = document.createElement("span");
  headingLabel.textContent = "企業名の部分一致候補";
  const headingQuery = document.createElement("small");
  headingQuery.textContent = `名称に「${query}」を含む法人`;
  heading.append(headingLabel, headingQuery);
  box.append(heading);

  const note = document.createElement("p");
  note.className = "company-name-suggestions-note";
  note.textContent = "名称の部分一致だけで表示しています。資本関係・取引関係などの「関連会社」を示すものではありません。";
  box.append(note);

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
    meta.textContent = `法人番号 ${candidate.corporateNumber} ／ GビズINFO掲載行 ${candidate.records.toLocaleString("ja-JP")}行`;
    button.append(name, meta);
    list.append(button);
  }
  box.append(list);
  filters.insertAdjacentElement("afterend", box);
}

function balanceSiteCopy() {
  document.querySelector(".hero-scope-warning")?.remove();
  document.querySelector(".hero-note")?.remove();

  setText(document.querySelector<HTMLAnchorElement>('.topbar nav a[href="#records"]'), "検索");
  setText(document.querySelector<HTMLAnchorElement>(".hero-actions .secondary-action"), "企業・事業を検索");

  const sourceSection = document.querySelector<HTMLElement>("#sources");
  setText(
    sourceSection?.querySelector<HTMLElement>(".section-heading.light > p"),
    "GビズINFOと行政事業レビューは週次、実装済みの公式補足は月次で、それぞれ独立して更新します。",
  );

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

  const yearFilterNote = [...document.querySelectorAll<HTMLElement>("#records .filter-note")]
    .find((element) => element.textContent?.includes("年度を指定すると"));
  const undatedCount = yearFilterNote?.textContent?.match(/(\d[\d,]*)行/)?.[1];
  if (yearFilterNote && undatedCount) {
    setText(
      yearFilterNote,
      `年度を指定すると、認定日・受注日の記載がない${undatedCount}行は検索対象から外れます。日付の記載がない行の大半は中小企業庁の補助金です。そのため、年度指定時の結果では中小企業庁の補助金が大きく欠けます。`,
    );
  }

  setText(
    document.querySelector<HTMLElement>("footer > p"),
    "GビズINFO、行政事業レビュー、機関公表資料などの公開情報を抽出・整形して作成した非公式サイトです。原資料と本サイトの抽出・取込について、正確性・完全性・最新性を保証するものではありません。",
  );
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
  requestAnimationFrame(balanceSiteCopy);
  window.addEventListener("load", balanceSiteCopy, { once: true });
  new MutationObserver(() => requestAnimationFrame(balanceSiteCopy)).observe(root, { childList: true, subtree: true });
}
