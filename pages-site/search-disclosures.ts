const READY_CLASS = "search-folds-ready";
const YEAR_CLASS = "show-search-year";
const PROGRAM_CLASS = "show-search-programs";
const DETAILS_CLASS = "show-search-details";

let scheduled = false;

function setAttributeIfChanged(element: Element, name: string, value: string) {
  if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}

function setTextIfChanged(element: HTMLElement, value: string) {
  if (element.textContent !== value) element.textContent = value;
}

function scheduleEnhancement() {
  if (scheduled) return;
  scheduled = true;
  window.requestAnimationFrame(() => {
    scheduled = false;
    enhanceSearchResultDisclosures();
  });
}

function closeDisclosures(section: HTMLElement) {
  section.classList.remove(YEAR_CLASS, PROGRAM_CLASS, DETAILS_CLASS);
  syncButtons(section);
}

function makeButton(
  section: HTMLElement,
  modeClass: string,
  controlId: string,
  closedLabel: string,
  openLabel: string,
) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "search-disclosure-button";
  button.dataset.modeClass = modeClass;
  button.dataset.closedLabel = closedLabel;
  button.dataset.openLabel = openLabel;
  setAttributeIfChanged(button, "aria-controls", controlId);
  setAttributeIfChanged(button, "aria-expanded", "false");
  setTextIfChanged(button, closedLabel);
  button.addEventListener("click", () => {
    section.classList.toggle(modeClass);
    syncButtons(section);
  });
  return button;
}

function syncButtons(section: HTMLElement) {
  for (const button of section.querySelectorAll<HTMLButtonElement>(":scope > .search-disclosure-controls button[data-mode-class]")) {
    const modeClass = button.dataset.modeClass;
    if (!modeClass) continue;
    const open = section.classList.contains(modeClass);
    setAttributeIfChanged(button, "aria-expanded", open ? "true" : "false");
    setTextIfChanged(
      button,
      open ? (button.dataset.openLabel ?? "閉じる") : (button.dataset.closedLabel ?? "見る"),
    );
  }
}

function enhanceSearchResultDisclosures() {
  const section = document.querySelector<HTMLElement>("#records");
  if (!section) return;

  const summary = section.querySelector<HTMLElement>(
    ':scope > .records-table[aria-label="企業検索結果サマリー"]',
  );

  if (!summary) {
    section.classList.remove(READY_CLASS, YEAR_CLASS, PROGRAM_CLASS, DETAILS_CLASS);
    section.querySelector(":scope > .search-disclosure-controls")?.remove();
    return;
  }

  const tables = Array.from(summary.querySelectorAll<HTMLTableElement>(":scope > table"));
  if (tables.length < 4) return;

  const yearTable = tables[2];
  const programTable = tables[3];
  const detailsTable = section.querySelector<HTMLElement>(
    ':scope > .records-table[aria-label="GビズINFO調達（委託を含む）・補助金掲載情報一覧"]',
  );
  if (!detailsTable) return;

  yearTable.classList.add("search-fold-year");
  programTable.classList.add("search-fold-programs");
  setAttributeIfChanged(yearTable, "id", "search-year-breakdown");
  setAttributeIfChanged(programTable, "id", "search-program-breakdown");
  setAttributeIfChanged(detailsTable, "id", "search-gbiz-details");
  section.classList.add(READY_CLASS);

  let controls = section.querySelector<HTMLElement>(":scope > .search-disclosure-controls");
  if (!controls) {
    controls = document.createElement("div");
    controls.className = "search-disclosure-controls";
    controls.setAttribute("aria-label", "検索結果の内訳表示");
    controls.append(
      makeButton(section, YEAR_CLASS, "search-year-breakdown", "年度別を見る", "年度別を閉じる"),
      makeButton(section, PROGRAM_CLASS, "search-program-breakdown", "金額の大きい事業を見る", "事業別を閉じる"),
      makeButton(section, DETAILS_CLASS, "search-gbiz-details", "明細を見る", "明細を閉じる"),
    );
    summary.insertAdjacentElement("afterend", controls);
  }

  syncButtons(section);
}

function handleFilterChange(event: Event) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
  if (!target.closest("#records .filters")) return;
  const section = document.querySelector<HTMLElement>("#records");
  if (section) closeDisclosures(section);
}

const root = document.getElementById("root");
if (root) {
  new MutationObserver(scheduleEnhancement).observe(root, { childList: true, subtree: true });
  document.addEventListener("input", handleFilterChange);
  document.addEventListener("change", handleFilterChange);
  scheduleEnhancement();
}
