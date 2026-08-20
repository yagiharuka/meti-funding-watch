import {
  INTERNAL_PARTIAL_SEARCH_PREFIX,
  normalizeCompanyIdentity,
} from "../scripts/company-search.mjs";

type OrganizationSummary = {
  name: string;
  corporateNumber: string;
  records: number;
};

type SearchResult = {
  organizationSummaries?: OrganizationSummary[];
  summary?: { organizationCount?: number };
};

type WorkerResult = {
  type?: string;
  requestId?: number | string;
  result?: SearchResult;
};

type SearchMessage = {
  type?: string;
  requestId?: number;
  parameters?: string;
};

type OriginalSearch = {
  parameters: string;
  generation: number;
};

type AlternativeSearch = {
  query: string;
  primaryCorporateNumbers: Set<string>;
  generation: number;
};

const INTERNAL_REQUEST_PREFIX = "__company-name-alternatives__:";
const BaseWorker = window.Worker as any;
let generation = 0;

function removeAlternativeDisclosure() {
  document.querySelector(".company-search-alternatives")?.remove();
}

function createAlternativeDisclosure(
  query: string,
  organizations: OrganizationSummary[],
  totalAlternativeCount: number,
  truncated: boolean,
  expectedGeneration: number,
) {
  const install = (attempt: number) => {
    if (expectedGeneration !== generation) return;
    const experience = document.getElementById("company-search-experience");
    const heading = experience?.querySelector<HTMLElement>(".company-search-query-heading");
    if (!experience || !heading) {
      if (attempt < 8) window.setTimeout(() => install(attempt + 1), 35);
      return;
    }

    removeAlternativeDisclosure();
    if (!organizations.length || totalAlternativeCount < 1) return;

    const details = document.createElement("details");
    details.className = "company-search-alternatives";

    const summary = document.createElement("summary");
    const summaryLabel = document.createElement("span");
    summaryLabel.textContent = "名称を含む他の法人も見る";
    const summaryCount = document.createElement("strong");
    summaryCount.textContent = `${totalAlternativeCount.toLocaleString("ja-JP")}法人`;
    summary.append(summaryLabel, summaryCount);
    details.append(summary);

    const body = document.createElement("div");
    body.className = "company-search-alternatives-body";

    const note = document.createElement("p");
    note.textContent = `「${query}」を名称に含む別法人です。完全一致の法人とは金額を合算しません。法人を選ぶと、その法人番号だけで再検索します。`;
    body.append(note);

    const list = document.createElement("div");
    list.className = "company-search-alternatives-list";
    for (const organization of organizations) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "company-search-alternative-item";
      button.dataset.corp = organization.corporateNumber;

      const name = document.createElement("span");
      name.className = "company-search-alternative-name";
      name.textContent = organization.name;

      const meta = document.createElement("small");
      meta.textContent = `法人番号 ${organization.corporateNumber} ／ 掲載 ${organization.records.toLocaleString("ja-JP")}件`;
      button.append(name, meta);
      list.append(button);
    }
    body.append(list);

    if (truncated) {
      const more = document.createElement("p");
      more.className = "company-search-alternatives-truncated";
      more.textContent = `候補は${totalAlternativeCount.toLocaleString("ja-JP")}法人あります。掲載件数の多い法人から最大50法人を表示しています。`;
      body.append(more);
    }

    details.append(body);
    heading.insertAdjacentElement("afterend", details);
  };

  requestAnimationFrame(() => install(0));
}

class CompanyAlternativeWorker extends BaseWorker {
  private originalSearches = new Map<number, OriginalSearch>();
  private alternativeSearches = new Map<string, AlternativeSearch>();

  constructor(scriptURL: string | URL, options?: WorkerOptions) {
    super(scriptURL, options);
    if (!(this as any).enhanced) return;
    this.addEventListener("message", (event: MessageEvent<WorkerResult>) => {
      this.handleResult(event.data);
    });
  }

  postMessage(message: unknown, transferOrOptions?: Transferable[] | StructuredSerializeOptions) {
    if ((this as any).enhanced && message && typeof message === "object") {
      const candidate = message as SearchMessage;
      if (
        candidate.type === "search"
        && Number.isSafeInteger(candidate.requestId)
        && typeof candidate.parameters === "string"
      ) {
        generation += 1;
        removeAlternativeDisclosure();
        this.originalSearches.set(candidate.requestId as number, {
          parameters: candidate.parameters,
          generation,
        });
      }
    }
    return super.postMessage(message, transferOrOptions);
  }

  terminate() {
    this.originalSearches.clear();
    this.alternativeSearches.clear();
    return super.terminate();
  }

  private handleResult(message: WorkerResult) {
    if (message.type !== "result" || !message.result) return;

    if (typeof message.requestId === "string" && message.requestId.startsWith(INTERNAL_REQUEST_PREFIX)) {
      const context = this.alternativeSearches.get(message.requestId);
      this.alternativeSearches.delete(message.requestId);
      if (!context || context.generation !== generation) return;

      const allOrganizations = message.result.organizationSummaries ?? [];
      const alternatives = allOrganizations.filter(
        (organization) => !context.primaryCorporateNumbers.has(organization.corporateNumber),
      );
      const totalOrganizations = Number(message.result.summary?.organizationCount ?? allOrganizations.length);
      const totalAlternativeCount = Math.max(0, totalOrganizations - context.primaryCorporateNumbers.size);
      const truncated = totalAlternativeCount > alternatives.length;
      createAlternativeDisclosure(
        context.query,
        alternatives,
        totalAlternativeCount,
        truncated,
        context.generation,
      );
      return;
    }

    if (!Number.isSafeInteger(message.requestId)) return;
    const original = this.originalSearches.get(message.requestId as number);
    this.originalSearches.delete(message.requestId as number);
    if (!original || original.generation !== generation) return;

    const parameters = new URLSearchParams(original.parameters);
    const query = (parameters.get("q") ?? "").trim();
    if (!query || /^\d{13}$/.test(query) || query.length > 80) return;

    const organizations = message.result.organizationSummaries ?? [];
    if (!organizations.length) return;
    const identity = normalizeCompanyIdentity(query);
    if (!identity) return;
    const hasExactMatch = organizations.some(
      (organization) => normalizeCompanyIdentity(organization.name) === identity,
    );
    if (!hasExactMatch) return;

    const primaryCorporateNumbers = new Set(organizations.map((organization) => organization.corporateNumber));
    const alternativeParameters = new URLSearchParams(original.parameters);
    alternativeParameters.set("q", `${INTERNAL_PARTIAL_SEARCH_PREFIX}${query}`);
    alternativeParameters.set("page", "1");

    const internalRequestId = `${INTERNAL_REQUEST_PREFIX}${message.requestId}:${original.generation}`;
    this.alternativeSearches.set(internalRequestId, {
      query,
      primaryCorporateNumbers,
      generation: original.generation,
    });

    (this as any).native.postMessage({
      type: "search",
      requestId: internalRequestId,
      parameters: alternativeParameters.toString(),
    });
  }
}

Object.defineProperty(window, "Worker", {
  configurable: true,
  writable: true,
  value: CompanyAlternativeWorker,
});
