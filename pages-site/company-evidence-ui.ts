import { normalizeCompanyIdentity } from "../scripts/company-search.mjs";

type OrganizationSummary = {
  name: string;
  corporateNumber: string;
  records: number;
};

type FundingSearchResult = {
  organizationSummaries?: OrganizationSummary[];
  organizationSummariesTruncated?: boolean;
  summary?: { organizationCount?: number };
};

type SearchEvent = CustomEvent<{
  message: { result?: FundingSearchResult };
  parameters: string | null;
}>;

type ReviewEntry = {
  id: string;
  reviewSheetYear: number;
  program: string;
  route: string[] | null;
  flowLevel: string;
};

type ReviewRecipient = {
  organization: string;
  corporateNumber: string;
  entries: ReviewEntry[];
};

type ReviewIndex = {
  schemaVersion: 1;
  reviewSheetYears: number[];
  recipients: ReviewRecipient[];
};

type OfficialSource = {
  id: string;
  name: string;
  fiscalYears: number[];
  recordCount: number;
  coverageNote: string;
};

type OfficialRecord = {
  id: string;
  sourceId: string;
  sourceName: string;
  organization: string;
  corporateNumber: string;
  fiscalYear: number;
  date: string | null;
  program: string;
  theme: string;
  phase: string;
  supportYears: string;
  category: "grant_decision" | "contract_result";
  amountStage: string;
  amount: number;
  sourceUrl: string;
};

type OfficialCompanyIndex = {
  schemaVersion: 1;
  generatedAt: string;
  recordCount: number;
  sourceCount: number;
  scopeNote: string;
  sources: OfficialSource[];
  records: OfficialRecord[];
};

const yen = new Intl.NumberFormat("ja-JP", {
  style: "currency",
  currency: "JPY",
  maximumFractionDigits: 0,
});
let generation = 0;
let reviewPromise: Promise<ReviewIndex> | null = null;
let officialPromise: Promise<OfficialCompanyIndex> | null = null;

function publicBaseUrl() {
  if (window.location.hostname.endsWith(".chatgpt.site")) {
    return new URL("https://yagiharuka.github.io/meti-funding-watch/");
  }
  return new URL("./", window.location.href);
}

async function fetchJson<T>(filename: string): Promise<T> {
  const url = new URL(filename, publicBaseUrl());
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${filename}: HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

function getReviewIndex() {
  reviewPromise ??= fetchJson<ReviewIndex>("data/review-company-index.json").then((value) => {
    if (value.schemaVersion !== 1 || !Array.isArray(value.recipients)) {
      throw new Error("行政事業レビュー企業索引の形式が不正です");
    }
    return value;
  });
  return reviewPromise;
}

function getOfficialIndex() {
  officialPromise ??= fetchJson<OfficialCompanyIndex>("data/official-company-index.json").then((value) => {
    if (
      value.schemaVersion !== 1
      || !Array.isArray(value.sources)
      || !Array.isArray(value.records)
      || value.recordCount !== value.records.length
    ) {
      throw new Error("公式資料企業索引の形式が不正です");
    }
    return value;
  });
  return officialPromise;
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDate(value: string | null) {
  if (!value) return "日付記載なし";
  const [year, month, day] = value.split("-");
  return `${year}年${Number(month)}月${Number(day)}日`;
}

function removeEvidence() {
  document.querySelector(".company-selection-panel")?.remove();
  document.querySelector(".company-route-evidence")?.remove();
  document.querySelector(".company-expanded-official")?.remove();
  const records = document.getElementById("records");
  records?.classList.remove("company-selection-required", "expanded-official-active");
}

function findCompanyHeading() {
  return document.querySelector<HTMLElement>("#company-search-experience .company-search-query-heading");
}

function renderSelection(
  query: string,
  organizations: OrganizationSummary[],
  totalCount: number,
  truncated: boolean,
  expectedGeneration: number,
) {
  const install = (attempt: number) => {
    if (expectedGeneration !== generation) return;
    const heading = findCompanyHeading();
    const records = document.getElementById("records");
    if (!heading || !records) {
      if (attempt < 10) window.setTimeout(() => install(attempt + 1), 35);
      return;
    }

    document.querySelector(".company-selection-panel")?.remove();
    records.classList.add("company-selection-required");
    records.classList.remove("expanded-official-active");

    const panel = document.createElement("section");
    panel.className = "company-selection-panel";
    panel.setAttribute("aria-label", "法人の選択");

    const title = document.createElement("h4");
    title.textContent = "法人を選んでください";
    const note = document.createElement("p");
    note.textContent = `「${query}」に完全一致する法人がないため、名称を含む法人を分けて表示しています。法人を選ぶと、その法人番号だけで3系列を確認します。`;
    panel.append(title, note);

    const list = document.createElement("div");
    list.className = "company-selection-list";
    for (const organization of organizations) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "company-selection-item";
      button.dataset.corp = organization.corporateNumber;
      button.innerHTML = `<strong>${escapeHtml(organization.name)}</strong><small>法人番号 ${escapeHtml(organization.corporateNumber)} ／ GビズINFO掲載 ${organization.records.toLocaleString("ja-JP")}件</small>`;
      list.append(button);
    }
    panel.append(list);

    if (truncated || totalCount > organizations.length) {
      const more = document.createElement("p");
      more.className = "company-selection-more";
      more.textContent = `一致候補は${totalCount.toLocaleString("ja-JP")}法人あります。掲載件数の多い法人から最大50法人を表示しています。`;
      panel.append(more);
    }

    heading.insertAdjacentElement("afterend", panel);
  };
  requestAnimationFrame(() => install(0));
}

function routeGroups(recipient: ReviewRecipient | undefined) {
  if (!recipient) return [] as Array<{ route: string[]; count: number; years: number[]; programs: string[] }>;
  const groups = new Map<string, { route: string[]; count: number; years: Set<number>; programs: Set<string> }>();
  for (const entry of recipient.entries) {
    if (!Array.isArray(entry.route) || entry.route.length < 2) continue;
    const route = entry.route.map((part) => String(part).trim()).filter(Boolean);
    if (route.length < 2) continue;
    const key = route.join("\u0000");
    const current = groups.get(key) ?? { route, count: 0, years: new Set<number>(), programs: new Set<string>() };
    current.count += 1;
    current.years.add(entry.reviewSheetYear);
    if (entry.program) current.programs.add(entry.program);
    groups.set(key, current);
  }
  return [...groups.values()]
    .map((item) => ({
      route: item.route,
      count: item.count,
      years: [...item.years].sort((a, b) => b - a),
      programs: [...item.programs].slice(0, 3),
    }))
    .sort((a, b) => b.route.length - a.route.length || b.count - a.count || a.route.join("→").localeCompare(b.route.join("→"), "ja"))
    .slice(0, 12);
}

function renderRoutes(
  company: OrganizationSummary,
  review: ReviewIndex,
  expectedGeneration: number,
) {
  if (expectedGeneration !== generation) return;
  const combined = document.querySelector<HTMLElement>('#records > section[aria-labelledby="combined-company-review-title"]');
  if (!combined) return;
  document.querySelector(".company-route-evidence")?.remove();

  const recipient = review.recipients.find((row) => row.corporateNumber === company.corporateNumber);
  const groups = routeGroups(recipient);
  const section = document.createElement("section");
  section.className = "company-route-evidence";
  section.setAttribute("aria-label", `${company.name}の行政事業レビュー記載資金経路`);

  const heading = document.createElement("div");
  heading.className = "company-evidence-heading";
  heading.innerHTML = `<p class="eyebrow">DISCLOSED FUNDING ROUTES</p><h3>${escapeHtml(company.name)}への資金経路</h3><p>法人番号 ${escapeHtml(company.corporateNumber)} で行政事業レビューを照合。レビューシートの支出経路に明示された経路だけを表示し、経路ごとの金額は合算しません。</p>`;
  section.append(heading);

  if (!groups.length) {
    const empty = document.createElement("p");
    empty.className = "company-evidence-empty";
    empty.textContent = "現在収録している行政事業レビューでは、この法人までの複数段階の資金経路を明示的に確認できませんでした。経路が存在しないという意味ではありません。";
    section.append(empty);
  } else {
    const list = document.createElement("div");
    list.className = "company-route-list";
    for (const group of groups) {
      const article = document.createElement("article");
      article.className = "company-route-card";
      const chain = group.route.map((part, index) => `<span>${escapeHtml(part)}</span>${index < group.route.length - 1 ? '<i aria-hidden="true">→</i>' : ""}`).join("");
      const programs = group.programs.length
        ? `<small>${group.programs.map(escapeHtml).join(" ／ ")}</small>`
        : "";
      article.innerHTML = `<div class="company-route-chain">${chain}</div><p>レビュー明細 ${group.count.toLocaleString("ja-JP")}件 ／ ${group.years.map((year) => `${year}年度`).join("・")}</p>${programs}`;
      list.append(article);
    }
    section.append(list);
  }

  combined.insertAdjacentElement("afterend", section);
}

function officialMatches(index: OfficialCompanyIndex, company: OrganizationSummary) {
  const identity = normalizeCompanyIdentity(company.name);
  return index.records.filter((row) =>
    row.corporateNumber === company.corporateNumber
    || (!row.corporateNumber && normalizeCompanyIdentity(row.organization) === identity));
}

function renderOfficial(
  company: OrganizationSummary,
  index: OfficialCompanyIndex,
  expectedGeneration: number,
) {
  if (expectedGeneration !== generation) return;
  const records = document.getElementById("records");
  const route = document.querySelector<HTMLElement>(".company-route-evidence");
  const combined = document.querySelector<HTMLElement>('#records > section[aria-labelledby="combined-company-review-title"]');
  if (!records || !combined) return;

  document.querySelector(".company-expanded-official")?.remove();
  records.classList.add("expanded-official-active");
  const matches = officialMatches(index, company);

  const section = document.createElement("section");
  section.className = "company-expanded-official";
  section.setAttribute("aria-label", `${company.name}の公式資料検索結果`);

  const heading = document.createElement("div");
  heading.className = "company-evidence-heading";
  heading.innerHTML = `<p class="eyebrow">OFFICIAL MATERIALS / VERIFIED SCOPE</p><h3>公式資料（確認できた範囲）</h3><p>${escapeHtml(company.name)}を法人番号 ${escapeHtml(company.corporateNumber)} で照合。公表資料に法人番号がない行だけ、法人名の完全一致で補います。</p>`;
  section.append(heading);

  const scope = document.createElement("p");
  scope.className = "company-official-scope-note";
  scope.textContent = index.scopeNote;
  section.append(scope);

  const details = document.createElement("details");
  details.className = "company-official-sources";
  const summary = document.createElement("summary");
  summary.textContent = `現在の収録機関を見る（${index.sourceCount.toLocaleString("ja-JP")}機関）`;
  details.append(summary);
  const sourceList = document.createElement("div");
  sourceList.className = "company-official-source-list";
  for (const source of index.sources) {
    const item = document.createElement("p");
    item.innerHTML = `<strong>${escapeHtml(source.name)}</strong><span>${source.recordCount.toLocaleString("ja-JP")}行</span><small>${escapeHtml(source.coverageNote)}</small>`;
    sourceList.append(item);
  }
  details.append(sourceList);
  section.append(details);

  if (!matches.length) {
    const empty = document.createElement("p");
    empty.className = "company-evidence-empty";
    empty.textContent = "現在収録している公式資料では、この法人に一致する行を確認できませんでした。公的資金の受領や契約がないことを意味しません。";
    section.append(empty);
  } else {
    const intro = document.createElement("p");
    intro.className = "company-official-result-note";
    intro.textContent = `${matches.length.toLocaleString("ja-JP")}行を確認。金額は交付決定額・契約額など公表時点が異なるため、GビズINFOや行政事業レビューと合算しません。`;
    section.append(intro);

    const scroll = document.createElement("div");
    scroll.className = "company-search-table-scroll";
    const table = document.createElement("table");
    table.className = "company-search-breakdown-table company-expanded-official-table";
    table.innerHTML = `<thead><tr><th>公表機関</th><th>区分</th><th>事業・件名</th><th>公表金額</th><th>時点</th><th>原典</th></tr></thead><tbody>${matches.slice(0, 100).map((row) => `<tr><td><strong>${escapeHtml(row.sourceName)}</strong></td><td>${row.category === "grant_decision" ? "交付決定" : "契約結果"}</td><td><span class="program-name">${escapeHtml(row.theme || row.program || "事業・件名の記載なし")}</span>${row.theme && row.program ? `<small>${escapeHtml(row.program)}</small>` : ""}</td><td><strong>${escapeHtml(yen.format(row.amount))}</strong><small>${escapeHtml(row.amountStage)}</small></td><td>${escapeHtml(formatDate(row.date))}<small>${row.fiscalYear}年度</small></td><td><a class="source-link" href="${escapeHtml(row.sourceUrl)}" target="_blank" rel="noreferrer">公式資料 ↗</a></td></tr>`).join("")}</tbody>`;
    scroll.append(table);
    section.append(scroll);
    if (matches.length > 100) {
      const more = document.createElement("p");
      more.className = "company-selection-more";
      more.textContent = `一致は${matches.length.toLocaleString("ja-JP")}行あります。画面では先頭100行を表示しています。`;
      section.append(more);
    }
  }

  (route ?? combined).insertAdjacentElement("afterend", section);
}

async function renderCrossSeries(company: OrganizationSummary, expectedGeneration: number) {
  try {
    const [review, official] = await Promise.all([getReviewIndex(), getOfficialIndex()]);
    if (expectedGeneration !== generation) return;
    const install = (attempt: number) => {
      if (expectedGeneration !== generation) return;
      const combined = document.querySelector<HTMLElement>('#records > section[aria-labelledby="combined-company-review-title"]');
      if (!combined) {
        if (attempt < 12) window.setTimeout(() => install(attempt + 1), 50);
        return;
      }
      renderRoutes(company, review, expectedGeneration);
      renderOfficial(company, official, expectedGeneration);
    };
    install(0);
  } catch (error) {
    if (expectedGeneration !== generation) return;
    console.error("Cross-series company evidence could not be loaded", error);
  }
}

window.addEventListener("meti-funding-search-result", ((event: SearchEvent) => {
  generation += 1;
  const expectedGeneration = generation;
  removeEvidence();

  const result = event.detail?.message?.result;
  const parameters = event.detail?.parameters ? new URLSearchParams(event.detail.parameters) : null;
  const query = (parameters?.get("q") ?? "").trim();
  if (!result || !query) return;

  const organizations = result.organizationSummaries ?? [];
  if (!organizations.length) return;

  const identity = normalizeCompanyIdentity(query);
  const exact = identity
    ? organizations.find((organization) => normalizeCompanyIdentity(organization.name) === identity)
    : undefined;
  const totalCount = Number(result.summary?.organizationCount ?? organizations.length);

  if (!exact && organizations.length > 1) {
    renderSelection(
      query,
      organizations,
      totalCount,
      Boolean(result.organizationSummariesTruncated || totalCount > organizations.length),
      expectedGeneration,
    );
    return;
  }

  const company = exact ?? organizations[0];
  renderCrossSeries(company, expectedGeneration);
}) as EventListener);

document.addEventListener("input", (event) => {
  if (event.target instanceof Element && event.target.closest("#records .filters")) {
    generation += 1;
    removeEvidence();
  }
});
