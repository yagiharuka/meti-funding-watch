import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

class FakeClassList {
  #values = new Set();

  setFromString(value) {
    this.#values = new Set(String(value).split(/\s+/).filter(Boolean));
  }

  add(...values) {
    for (const value of values) this.#values.add(value);
  }

  contains(value) {
    return this.#values.has(value);
  }

  toString() {
    return [...this.#values].join(" ");
  }
}

class FakeElement {
  constructor(tagName, registry) {
    this.tagName = String(tagName).toLowerCase();
    this.registry = registry;
    this.children = [];
    this.parentElement = null;
    this.attributes = new Map();
    this.classList = new FakeClassList();
    this.dataset = {};
    this._text = "";
    this._id = "";
  }

  set id(value) {
    if (this._id) this.registry.delete(this._id);
    this._id = String(value);
    if (this._id) this.registry.set(this._id, this);
  }

  get id() {
    return this._id;
  }

  set className(value) {
    this.classList.setFromString(value);
  }

  get className() {
    return this.classList.toString();
  }

  set textContent(value) {
    this._text = String(value ?? "");
    this.children = [];
  }

  get textContent() {
    return this.children.length ? this.children.map((child) => child.textContent).join("") : this._text;
  }

  set innerHTML(value) {
    if (value !== "") throw new Error("fake DOM only supports clearing innerHTML");
    this.children = [];
    this._text = "";
  }

  get innerHTML() {
    return this.textContent;
  }

  setAttribute(name, value) {
    const text = String(value);
    this.attributes.set(name, text);
    if (name === "id") this.id = text;
    if (name === "class") this.className = text;
    if (name.startsWith("data-")) this.dataset[toDatasetKey(name.slice(5))] = text;
  }

  getAttribute(name) {
    if (name === "id") return this.id || null;
    if (name === "class") return this.className || null;
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  append(...children) {
    for (const child of children) {
      child.parentElement = this;
      this.children.push(child);
      if (child.id) this.registry.set(child.id, child);
    }
  }

  prepend(child) {
    child.parentElement = this;
    this.children.unshift(child);
    if (child.id) this.registry.set(child.id, child);
  }

  insertAdjacentElement(position, child) {
    if (position !== "afterend" || !this.parentElement) throw new Error("unsupported insertAdjacentElement");
    const siblings = this.parentElement.children;
    const index = siblings.indexOf(this);
    child.parentElement = this.parentElement;
    siblings.splice(index + 1, 0, child);
    return child;
  }

  remove() {
    if (this.parentElement) {
      this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    }
    if (this.id) this.registry.delete(this.id);
    this.parentElement = null;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector) {
    if (selector.startsWith(":scope > ")) {
      const direct = selector.slice(9).trim();
      return this.children.filter((child) => matchesSimple(child, direct));
    }
    const parts = selector.trim().split(/\s+/);
    let current = descendants(this);
    if (parts.length === 1) return current.filter((element) => matchesSimple(element, parts[0]));

    let matches = current.filter((element) => matchesSimple(element, parts[0]));
    for (const part of parts.slice(1)) {
      matches = matches.flatMap((element) => descendants(element).filter((child) => matchesSimple(child, part)));
    }
    return matches;
  }
}

function toDatasetKey(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function descendants(element) {
  const result = [];
  for (const child of element.children) {
    result.push(child, ...descendants(child));
  }
  return result;
}

function matchesSimple(element, selector) {
  const attributeMatch = selector.match(/\[([^=\]]+)(?:=["']?([^"'\]]+)["']?)?\]/);
  let base = selector.replace(/\[[^\]]+\]/g, "");
  const classNames = [...base.matchAll(/\.([A-Za-z0-9_-]+)/g)].map((match) => match[1]);
  base = base.replace(/\.[A-Za-z0-9_-]+/g, "");
  if (base && element.tagName !== base.toLowerCase()) return false;
  if (classNames.some((name) => !element.classList.contains(name))) return false;
  if (attributeMatch) {
    const [, name, expected] = attributeMatch;
    const actual = element.getAttribute(name);
    if (expected === undefined ? actual === null : actual !== expected) return false;
  }
  return true;
}

function element(registry, tag, { id, className, text, attrs = {} } = {}) {
  const node = new FakeElement(tag, registry);
  if (id) node.id = id;
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  return node;
}

function table(registry, headers, rows, className = "") {
  const node = element(registry, "table", { className });
  const thead = element(registry, "thead");
  const headerRow = element(registry, "tr");
  headerRow.append(...headers.map((value) => element(registry, "th", { text: value })));
  thead.append(headerRow);
  const tbody = element(registry, "tbody");
  for (const cells of rows) {
    const row = element(registry, "tr");
    row.append(...cells);
    tbody.append(row);
  }
  node.append(thead, tbody);
  return node;
}

function amountCell(registry, strongText, smallText) {
  const cell = element(registry, "td");
  cell.append(element(registry, "strong", { text: strongText }), element(registry, "small", { text: smallText }));
  return cell;
}

function stageCell(registry, stage, text) {
  const cell = element(registry, "td");
  cell.append(element(registry, "span", { className: `stage-badge ${stage}`, text }));
  return cell;
}

async function runGuardrail() {
  let source = await readFile(new URL("../pages-site/subsidy-semantics-ui.ts", import.meta.url), "utf8");
  source = source.replace(
    'import fundingSummary from "@/data/funding-summary.json";',
    "const fundingSummary = globalThis.__fundingSummary;",
  );
  const javascript = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;

  const registry = new Map();
  const windowListeners = new Map();
  const frames = new Map();
  let nextFrame = 1;

  const root = element(registry, "html");
  const records = element(registry, "section", { id: "records" });
  const summaryRegion = element(registry, "div", { attrs: { "aria-label": "企業検索結果サマリー" } });
  summaryRegion.append(table(registry,
    ["情報種別", "掲載行", "掲載値合計"],
    [
      [stageCell(registry, "contracted", "調達（委託を含む）"), element(registry, "td", { text: "1行" }), amountCell(registry, "¥100", "金額記載 1行")],
      [stageCell(registry, "subsidy_published", "補助金"), element(registry, "td", { text: "2行" }), amountCell(registry, "¥500", "金額記載 2行")],
    ],
  ));
  summaryRegion.append(table(registry,
    ["直近5年度", "掲載行", "金額記載あり"],
    [[element(registry, "td", { text: "2024年度" }), element(registry, "td", { text: "2行" }), element(registry, "td", { text: "2行" })]],
  ));
  summaryRegion.append(table(registry,
    ["掲載行の多い活動名称・件名", "掲載行", "金額記載あり"],
    [[element(registry, "td", { text: "補助テスト" }), element(registry, "td", { text: "2行" }), element(registry, "td", { text: "2行" })]],
  ));
  const mount = element(registry, "div", { id: "company-search-mount" });
  records.append(summaryRegion, mount);

  const experience = element(registry, "section", { id: "company-search-experience" });
  const panel = element(registry, "div", { className: "company-search-gbiz-panel" });
  const heading = element(registry, "div", { className: "company-search-query-heading", text: "検索結果" });
  panel.append(heading);

  const procurementLine = element(registry, "div", { className: "company-search-funding-line" });
  procurementLine.append(
    element(registry, "span", { className: "company-search-funding-kind", text: "調達・委託" }),
    element(registry, "strong", { className: "company-search-amount", text: "100万円" }),
    element(registry, "small", { text: "※受注額" }),
  );
  const subsidyLine = element(registry, "div", { className: "company-search-funding-line" });
  subsidyLine.append(
    element(registry, "span", { className: "company-search-funding-kind", text: "補助金" }),
    element(registry, "strong", { className: "company-search-amount", text: "500万円" }),
    element(registry, "small", { text: "※GビズINFO補助金掲載額" }),
  );
  const noTotal = element(registry, "p", { className: "company-search-no-total", text: "旧注記" });
  const programButton = element(registry, "button", { text: "金額の大きい事業を見る", attrs: { "data-fold": "p-1" } });
  panel.append(procurementLine, subsidyLine, noTotal, programButton);

  const yearTable = table(registry,
    ["年度", "調達・委託（件数／受注額）", "補助金（件数／GビズINFO掲載額）", "金額の記載なし"],
    [[amountCell(registry, "2024年度", ""), amountCell(registry, "1件", "100万円／受注額"), amountCell(registry, "2件", "500万円／GビズINFO補助金掲載額"), element(registry, "td", { text: "0件" })]],
    "company-search-breakdown-table",
  );
  const programTable = table(registry,
    ["区分", "活動名称・件名", "掲載行", "公表金額", "金額記載あり"],
    [[stageCell(registry, "subsidy_published", "補助金"), element(registry, "td", { text: "補助テスト" }), element(registry, "td", { text: "2件" }), amountCell(registry, "500万円", "※GビズINFO補助金掲載額"), element(registry, "td", { text: "2件" })]],
    "company-search-breakdown-table",
  );
  const detailAmount = amountCell(registry, "¥200", "※GビズINFO補助金掲載額");
  const detailTable = table(registry,
    ["区分", "公表組織", "活動名称・件名", "日付", "公表金額", "出典"],
    [[stageCell(registry, "subsidy_published", "補助金"), element(registry, "td", { text: "経済産業省" }), element(registry, "td", { text: "補助テスト" }), element(registry, "td", { text: "2024-04-01" }), detailAmount, element(registry, "td", { text: "GビズINFO" })]],
    "company-search-breakdown-table company-search-detail-table",
  );
  panel.append(yearTable, programTable, detailTable);
  experience.append(panel);
  mount.append(experience);
  root.append(records);

  const document = {
    documentElement: root,
    createElement(tagName) {
      return new FakeElement(tagName, registry);
    },
    getElementById(id) {
      return registry.get(id) ?? null;
    },
    querySelector(selector) {
      if (selector === '[aria-label="企業検索結果サマリー"]') return summaryRegion;
      return root.querySelector(selector);
    },
  };
  const window = {
    addEventListener(type, listener) {
      windowListeners.set(type, listener);
    },
  };
  const context = {
    __fundingSummary: {
      sources: [{ id: "gbiz", csvEligibleSubsidyCount: 51_375 }],
      coverage: { gbiz: { unclassifiedDateCount: 39_665 } },
    },
    URLSearchParams,
    document,
    window,
    Element: FakeElement,
    HTMLElement: FakeElement,
    HTMLTableElement: FakeElement,
    HTMLButtonElement: FakeElement,
    MutationObserver: class MutationObserver { observe() {} },
    requestAnimationFrame(callback) {
      const id = nextFrame++;
      frames.set(id, callback);
      return id;
    },
    console,
  };

  vm.runInNewContext(javascript, context, { filename: "subsidy-semantics-ui.js" });
  flushFrames(frames);
  return { registry, windowListeners, frames, procurementLine, subsidyLine, noTotal, programButton, yearTable, programTable, detailAmount, mount, summaryRegion };
}

function flushFrames(frames) {
  while (frames.size) {
    const pending = [...frames.values()];
    frames.clear();
    for (const callback of pending) callback();
  }
}

test("Pages UI suppresses cross-row subsidy totals and explains the data semantics", async () => {
  const [source, entrypoint] = await Promise.all([
    readFile(new URL("../pages-site/subsidy-semantics-ui.ts", import.meta.url), "utf8"),
    readFile(new URL("../pages-site/main.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(source, /交付決定・確定等が別行/);
  assert.match(source, /執行団体・事務局等への交付原資/);
  assert.match(source, /掲載法人自身の収益・最終受益額を示すものではありません/);
  assert.match(source, /認定日が空欄/);
  assert.match(entrypoint, /subsidy-semantics-ui\.css/);
  assert.match(entrypoint, /subsidy-semantics-ui/);
});

test("runtime guardrail hides subsidy aggregates but keeps procurement and detail amounts", async () => {
  const runtime = await runGuardrail();

  assert.equal(runtime.procurementLine.querySelector(".company-search-amount").textContent, "100万円");
  assert.equal(runtime.subsidyLine.querySelector(".company-search-amount").textContent, "合計しません");
  assert.equal(runtime.subsidyLine.querySelector("small").textContent, "個別の掲載額は明細で確認");
  assert.match(runtime.noTotal.textContent, /補助金.*行をまたいで合計していません/);
  assert.equal(runtime.programButton.textContent, "事業別を見る");

  const yearSubsidyCell = runtime.yearTable.querySelectorAll("tbody tr")[0].children[2];
  assert.equal(yearSubsidyCell.querySelector("strong").textContent, "2件");
  assert.equal(yearSubsidyCell.querySelector("small").textContent, "認定日基準／金額は合計しません");
  const programAmountCell = runtime.programTable.querySelectorAll("tbody tr")[0].children[3];
  assert.equal(programAmountCell.querySelector("strong").textContent, "合計しません");
  assert.equal(runtime.detailAmount.querySelector("strong").textContent, "¥200");

  const summarySubsidyCell = runtime.summaryRegion.querySelectorAll("table")[0].querySelectorAll("tbody tr")[1].children[2];
  assert.equal(summarySubsidyCell.querySelector("strong").textContent, "合計しません");
  assert.equal(runtime.mount.querySelectorAll(":scope > .subsidy-semantics-note").length, 1);
});

test("year filter warning uses current committed source counts and excludes contract-only searches", async () => {
  const runtime = await runGuardrail();
  const listener = runtime.windowListeners.get("meti-funding-search-result");
  assert.ok(listener);

  listener({ detail: { parameters: new URLSearchParams({ q: "テスト", year: "2024", stage: "all" }).toString() } });
  flushFrames(runtime.frames);
  const warning = runtime.mount.querySelector(":scope > .subsidy-year-warning");
  assert.ok(warning);
  assert.match(warning.textContent, /51,375行/);
  assert.match(warning.textContent, /39,665行/);
  assert.match(warning.textContent, /77\.2%/);
  assert.match(warning.textContent, /年度別件数は資金額・採択件数の推移を示しません/);

  listener({ detail: { parameters: new URLSearchParams({ q: "テスト", year: "2024", stage: "contracted" }).toString() } });
  flushFrames(runtime.frames);
  assert.equal(runtime.mount.querySelector(":scope > .subsidy-year-warning"), null);
});
