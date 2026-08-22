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

test("zero Gbiz rows show the one loss-preventing warning and still expose the other series", async () => {
  const ui = await renderCompanySearch({ organizationSummaries: [] }, "レビューだけにある法人");
  assert.ok(ui, "company search experience must mount even when Gbiz has zero rows");
  assert.match(ui.innerHTML, />GビズINFO<\/button>/);
  assert.match(ui.innerHTML, />行政事業レビュー<\/button>/);
  assert.match(ui.innerHTML, />公式資料<\/button>/);
  assert.match(ui.innerHTML, /これは、この事業者が資金を受けていないことを意味するものではありません。/);
  assert.doesNotMatch(ui.innerHTML, /GビズINFOでは一致する法人を確認できませんでした。/);
  assert.match(ui.innerHTML, /<summary>このデータの読み方<\/summary>/);
});

test("real company renderer keeps local non-additivity labels but moves explanations below the results", async () => {
  const ui = await renderCompanySearch({
    organizationSummaries: [{
      name: "テスト株式会社",
      corporateNumber: "1111111111111",
      records: 2,
      amountUnknownCount: 0,
      byStage: [
        { stage: "contracted", records: 1, amount: 100, amountKnownCount: 1 },
        { stage: "subsidy_published", records: 1, amount: 987654321, amountKnownCount: 1 },
      ],
      byYear: [{
        fiscalYear: 2026,
        contracted: { records: 1, amount: 100, amountKnownCount: 1 },
        subsidy_published: { records: 1, amount: 987654321, amountKnownCount: 1 },
        amountUnknownCount: 0,
      }],
      topPrograms: [
        { stage: "contracted", program: "委託テスト", records: 1, amount: 100, amountKnownCount: 1 },
        { stage: "subsidy_published", program: "補助テスト", records: 1, amount: 987654321, amountKnownCount: 1 },
      ],
      detailRows: [
        { stage: "contracted", sourceAgency: "経済産業省", program: "委託テスト", date: "2026-04-01", amount: 100, sourceUrl: null, sourceSystem: "GビズINFO" },
        { stage: "subsidy_published", sourceAgency: "経済産業省", program: "補助テスト", date: "2026-04-02", amount: 200, sourceUrl: null, sourceSystem: "GビズINFO" },
      ],
      detailTruncated: false,
    }],
  }, "テスト株式会社");

  assert.ok(ui);
  assert.doesNotMatch(ui.innerHTML, /これは、この事業者が資金を受けていないことを意味するものではありません。/);
  assert.match(ui.innerHTML, /<strong class="company-search-amount empty">合計しません<\/strong>/);
  assert.match(ui.innerHTML, /<th>認定日・受注日の年度<\/th>/);
  assert.match(ui.innerHTML, /<th>補助金（掲載件数）<\/th>/);
  assert.match(ui.innerHTML, /認定日基準／金額は合計しません/);
  assert.match(ui.innerHTML, />事業別を見る<\/button>/);
  assert.match(ui.innerHTML, />↓ 読み方<\/a>/);
  assert.doesNotMatch(ui.innerHTML, /金額の大きい事業を見る/);
  assert.doesNotMatch(ui.innerHTML, /987,654,321|9\.9億円|98765\.4万円/);
  assert.match(ui.innerHTML, /<strong>[^<]*200[^<]*<\/strong><small>※GビズINFO補助金掲載額<\/small>/);

  const guideStart = ui.innerHTML.indexOf('<details id="company-search-reading-guide"');
  assert.ok(guideStart >= 0, "reading guide must exist below the result cards");
  const beforeGuide = ui.innerHTML.slice(0, guideStart);
  const guide = ui.innerHTML.slice(guideStart);
  assert.doesNotMatch(beforeGuide, /同一補助金の交付決定・確定等が別行で掲載される場合/);
  assert.doesNotMatch(beforeGuide, /掲載法人自身の収益や最終受益額/);
  assert.match(guide, /GビズINFOの補助金は、同一補助金の交付決定・確定等が別行で掲載される場合/);
  assert.match(guide, /掲載法人自身の収益や最終受益額を示すとは限りません/);
  assert.match(guide, /GビズINFOや行政事業レビューの金額と合算しません/);

  const labels = visibleLabels(ui.innerHTML);
  for (const label of labels) {
    assert.doesNotMatch(label, /総額|計$/, `misleading total label: ${label}`);
  }
});
