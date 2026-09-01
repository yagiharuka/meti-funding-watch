import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

class FakeClassList {
  #values = new Set();

  add(...values) {
    for (const value of values) this.#values.add(value);
  }

  remove(...values) {
    for (const value of values) this.#values.delete(value);
  }

  toggle(value, force) {
    if (force === true) {
      this.#values.add(value);
      return true;
    }
    if (force === false) {
      this.#values.delete(value);
      return false;
    }
    if (this.#values.has(value)) {
      this.#values.delete(value);
      return false;
    }
    this.#values.add(value);
    return true;
  }

  contains(value) {
    return this.#values.has(value);
  }
}

class FakeElement {
  constructor(tagName, registry) {
    this.tagName = tagName;
    this.registry = registry;
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    this.classList = new FakeClassList();
    this.innerHTML = "";
    this.tabIndex = 0;
    this._id = "";
  }

  set id(value) {
    this._id = value;
    if (value) this.registry.set(value, this);
  }

  get id() {
    return this._id;
  }

  append(child) {
    child.parentElement = this;
    this.children.push(child);
    if (child.id) this.registry.set(child.id, child);
  }

  querySelector() {
    return null;
  }

  querySelectorAll() {
    return [];
  }

  remove() {
    if (this.id) this.registry.delete(this.id);
    if (this.parentElement) {
      this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    }
    this.parentElement = null;
  }
}

async function renderCompanySearch(result, query) {
  const source = await readFile(new URL("../pages-site/company-search-ui.ts", import.meta.url), "utf8");
  const javascript = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
    },
  }).outputText;

  const registry = new Map();
  const windowListeners = new Map();
  const documentListeners = new Map();
  const frames = new Map();
  let nextFrame = 1;

  const records = new FakeElement("section", registry);
  records.id = "records";
  const mount = new FakeElement("div", registry);
  mount.id = "company-search-mount";

  const document = {
    addEventListener(type, listener) {
      documentListeners.set(type, listener);
    },
    createElement(tagName) {
      return new FakeElement(tagName, registry);
    },
    getElementById(id) {
      return registry.get(id) ?? null;
    },
    querySelector(selector) {
      if (selector === "#records") return records;
      return null;
    },
  };

  const window = {
    addEventListener(type, listener) {
      windowListeners.set(type, listener);
    },
  };

  const context = {
    URLSearchParams,
    console,
    document,
    window,
    Element: FakeElement,
    Event: class Event {},
    HTMLInputElement: class HTMLInputElement {},
    MutationObserver: class MutationObserver {
      observe() {}
    },
    requestAnimationFrame(callback) {
      const id = nextFrame++;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) {
      frames.delete(id);
    },
  };

  vm.runInNewContext(javascript, context, { filename: "company-search-ui.js" });
  const listener = windowListeners.get("meti-funding-search-result");
  assert.ok(listener, "company search result listener must be registered");
  listener({
    detail: {
      message: { result },
      parameters: new URLSearchParams({ q: query }).toString(),
    },
  });

  while (frames.size) {
    const pending = [...frames.entries()];
    frames.clear();
    for (const [, callback] of pending) callback();
  }

  return registry.get("company-search-experience") ?? null;
}

function visibleLabels(html) {
  return [...html.matchAll(/<(th|caption|dt|button|span class="company-search-funding-kind"\b[^>]*)>([\s\S]*?)<\/(?:th|caption|dt|button|span)>/g)]
    .map((match) => match[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

test("zero Gbiz rows show the harm-critical negative-inference warning and keep other series reachable", async () => {
  const ui = await renderCompanySearch({ organizationSummaries: [] }, "レビューだけにある法人");
  assert.ok(ui, "company search experience must mount even when Gbiz has zero rows");
  assert.match(ui.innerHTML, />GビズINFO<\/button>/);
  assert.match(ui.innerHTML, />行政事業レビュー<\/button>/);
  assert.match(ui.innerHTML, /主系列2つ＋照合記録/);
  assert.match(ui.innerHTML, />照合記録<\/button>/);
  assert.match(ui.innerHTML, /class="company-search-zero-warning"/);
  assert.match(ui.innerHTML, /検索0件は、この法人が経産省関係の資金を受けていないことを意味しません/);
  assert.match(ui.innerHTML, /行政事業レビュー・照合記録のタブも確認してください/);
  assert.match(ui.innerHTML, /href="#data-reading-guide">↓ 読み方/);
});

test("real company renderer shows same-corporation subsidy totals without a zero-result warning and keeps individual detail", async () => {
  const ui = await renderCompanySearch({
    alternativeOrganizations: [{
      name: "テスト研究所株式会社",
      corporateNumber: "2222222222222",
      records: 4,
    }],
    alternativeOrganizationCount: 1,
    organizationSummaries: [{
      name: "テスト株式会社",
      corporateNumber: "1111111111111",
      records: 3,
      amountUnknownCount: 0,
      duplicateExcludedCount: 1,
      byStage: [
        { stage: "contracted", records: 1, amount: 100, amountKnownCount: 1, amountIncludedCount: 1, duplicateExcludedCount: 0 },
        { stage: "subsidy_published", records: 2, amount: 987654321, amountKnownCount: 2, amountIncludedCount: 1, duplicateExcludedCount: 1 },
      ],
      byYear: [{
        fiscalYear: 2026,
        contracted: { records: 1, amount: 100, amountKnownCount: 1, amountIncludedCount: 1, duplicateExcludedCount: 0 },
        subsidy_published: { records: 2, amount: 987654321, amountKnownCount: 2, amountIncludedCount: 1, duplicateExcludedCount: 1 },
        amountUnknownCount: 0,
      }],
      topPrograms: [
        { stage: "contracted", program: "委託テスト", records: 1, amount: 100, amountKnownCount: 1, amountIncludedCount: 1, duplicateExcludedCount: 0 },
        { stage: "subsidy_published", program: "補助テスト", records: 2, amount: 987654321, amountKnownCount: 2, amountIncludedCount: 1, duplicateExcludedCount: 1 },
      ],
      detailRows: [
        { stage: "contracted", sourceAgency: "経済産業省", program: "委託テスト", date: "2026-04-01", amount: 100, sourceUrl: null, sourceSystem: "GビズINFO" },
        { stage: "subsidy_published", sourceAgency: "経済産業省", program: "補助テスト", date: "2026-04-02", amount: 200, sourceUrl: null, sourceSystem: "GビズINFO" },
        { stage: "subsidy_published", sourceAgency: "経済産業省", program: "補助テスト", date: "2026-04-03", amount: 200, sourceUrl: null, sourceSystem: "GビズINFO" },
      ],
      detailTruncated: false,
    }],
  }, "テスト株式会社");

  assert.ok(ui);
  assert.doesNotMatch(ui.innerHTML, /company-search-zero-warning|資金を受けていないことを意味しません/);
  assert.doesNotMatch(ui.innerHTML, /掲載法人自身の収益・最終受益額を示すものではありません/);
  assert.doesNotMatch(ui.innerHTML, /company-search-no-total/);
  assert.match(ui.innerHTML, /href="#data-reading-guide">↓ 読み方/);
  assert.doesNotMatch(ui.innerHTML, /合計しません|個別の掲載額は明細で確認/);
  assert.match(ui.innerHTML, /<strong class="company-search-amount" title="￥987,654,321">9\.9億円<\/strong><small>※GビズINFO掲載額（重複候補除外後）／重複掲載とみなして除外 1件<\/small>/);
  assert.match(ui.innerHTML, /重複掲載とみなして除外 1件（同一・近似事業名かつ掲載額差±0\.1%）/);
  assert.match(ui.innerHTML, /名称に「テスト株式会社」を含む別法人/);
  assert.match(ui.innerHTML, /テスト研究所株式会社/);
  assert.match(ui.innerHTML, /data-corp="2222222222222"/);
  assert.match(ui.innerHTML, /<th>認定日・受注日の年度<\/th>/);
  assert.match(ui.innerHTML, /<th>補助金（掲載行／重複候補除外後）<\/th>/);
  assert.match(ui.innerHTML, /9\.9億円／掲載額／重複掲載とみなして除外 1件/);
  assert.match(ui.innerHTML, />事業別を見る<\/button>/);
  assert.doesNotMatch(ui.innerHTML, /金額の大きい事業を見る/);
  assert.match(ui.innerHTML, /<strong>[^<]*200[^<]*<\/strong><small>※GビズINFO掲載額（重複候補除外後）<\/small>/);

  const labels = visibleLabels(ui.innerHTML);
  for (const label of labels) {
    assert.doesNotMatch(label, /総額|計$/, `misleading total label: ${label}`);
  }
});
