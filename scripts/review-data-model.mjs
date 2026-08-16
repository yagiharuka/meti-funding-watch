import { createHash } from "node:crypto";

export const REVIEW_SCHEMA_VERSION = 4;
export const FLOW_LEVELS = [
  "disclosed_intermediary",
  "terminal_in_disclosed_graph",
  "unclassified",
];
export const AMOUNT_STATUSES = ["positive", "zero", "negative", "blank", "invalid"];

export function createReviewPayments({ reviewSheetYear, rows, programById, graphByProject }) {
  const payments = [];
  const excludedRows = [];
  const amountStatusCounts = Object.fromEntries(AMOUNT_STATUSES.map((status) => [status, 0]));
  let sourcePaymentRowCount = 0;

  for (const { row, rowNumber } of rows) {
    if (!isMetiReviewRow(row)) continue;
    sourcePaymentRowCount += 1;
    const projectNumber = cleanCell(row["予算事業ID"]);
    const project = programById.get(projectNumber);
    const organization = cleanCell(row["支出先名"]);
    const block = cleanCell(row["支出先ブロック番号"]);
    const amountRaw = cleanCell(row["支出先の合計支出額"]);
    const { amount, amountStatus } = parseReviewAmount(amountRaw);
    amountStatusCounts[amountStatus] += 1;
    const reasons = [];
    if (!project) reasons.push("project_not_found");
    if (!organization) reasons.push("organization_blank");
    if (!block) reasons.push("block_blank");
    if (reasons.length) {
      excludedRows.push({
        id: `rs-excluded-${stableId([reviewSheetYear, rowNumber])}`,
        reviewSheetYear,
        sourceRowNumber: rowNumber,
        projectNumber,
        organization,
        block,
        amountRaw,
        amountStatus,
        reasons,
      });
      continue;
    }

    const corporateNumberCandidate = cleanCell(row["法人番号"]).replace(/\D/g, "");
    const corporateNumber = /^\d{13}$/.test(corporateNumberCandidate) ? corporateNumberCandidate : "";
    const graph = graphByProject.get(projectNumber);
    const position = disclosedPosition(graph, block);
    const sourceRowIdentity = cleanCell(row["支出先番号"] || row["支出先ID"] || rowNumber);
    const id = `rs-payment-${stableId([
      reviewSheetYear,
      projectNumber,
      block,
      corporateNumber || organization,
      sourceRowIdentity,
      rowNumber,
    ])}`;
    payments.push({
      id,
      reviewSheetYear,
      reviewProjectId: project.id,
      organization,
      corporateNumber,
      organizationType: cleanCell(row["法人種別"]),
      sourceAgency: position.sourceAgency,
      program: project.name,
      amount,
      amountRaw,
      amountStatus,
      flowLevel: position.flowLevel,
      flowDepth: position.flowDepth,
      block,
      route: position.route,
      routeStatus: position.routeStatus,
      directUpstreamBlocks: position.directUpstreamBlocks,
      directUpstreamNames: position.directUpstreamNames,
      parentPaymentIds: [],
      hasDisclosedDownstream: position.hasDisclosedDownstream,
      sourceRowNumber: rowNumber,
      sourceName: `行政事業レビュー ${reviewSheetYear}年度シート（支出先）`,
      sourceUrl: "https://rssystem.go.jp/download-csv",
      quality: "primary",
    });
  }

  const idsByProjectAndBlock = new Map();
  for (const payment of payments) {
    const key = `${payment.reviewProjectId}\u001f${payment.block}`;
    const ids = idsByProjectAndBlock.get(key) ?? [];
    ids.push(payment.id);
    idsByProjectAndBlock.set(key, ids);
  }
  for (const payment of payments) {
    payment.parentPaymentIds = payment.directUpstreamBlocks.flatMap((block) =>
      idsByProjectAndBlock.get(`${payment.reviewProjectId}\u001f${block}`) ?? []);
  }

  return {
    payments,
    excludedRows,
    accounting: {
      status: "complete",
      sourcePaymentRowCount,
      publishedPaymentRowCount: payments.length,
      excludedPaymentRowCount: excludedRows.length,
      excludedByReason: countReasons(excludedRows),
      amountStatusCounts,
    },
  };
}

export function migrateLegacyPayment(row, legacyIndex) {
  const hasDisclosedRoute = Number.isInteger(row.flowDepth) && row.flowDepth > 0
    && Array.isArray(row.route) && row.route.length >= 2;
  const terminal = row.flowLevel === "recipient" && hasDisclosedRoute;
  return {
    id: row.id,
    reviewSheetYear: row.reviewSheetYear,
    reviewProjectId: row.reviewProjectId,
    organization: row.organization,
    corporateNumber: row.corporateNumber ?? "",
    organizationType: row.organizationType ?? "",
    sourceAgency: hasDisclosedRoute ? row.sourceAgency ?? null : null,
    program: row.program,
    amount: row.amount,
    amountRaw: String(row.amount),
    amountStatus: row.amount > 0 ? "positive" : row.amount === 0 ? "zero" : "negative",
    flowLevel: terminal ? "terminal_in_disclosed_graph" : "unclassified",
    flowDepth: hasDisclosedRoute ? row.flowDepth : null,
    block: row.block,
    route: hasDisclosedRoute ? row.route : null,
    routeStatus: hasDisclosedRoute ? "legacy_single_route_unverified" : "not_disclosed",
    directUpstreamBlocks: [],
    directUpstreamNames: hasDisclosedRoute && row.sourceAgency ? [row.sourceAgency] : [],
    parentPaymentIds: [],
    hasDisclosedDownstream: null,
    sourceRowNumber: null,
    legacyRowIndex: legacyIndex,
    sourceName: row.sourceName,
    sourceUrl: row.sourceUrl,
    quality: row.quality ?? "primary",
  };
}

export function buildReviewGraphs(rows) {
  const graphByProject = new Map();
  for (const { row } of rows) {
    if (!isMetiReviewRow(row)) continue;
    const projectNumber = cleanCell(row["予算事業ID"]);
    const target = cleanCell(row["支出先の支出先ブロック"]);
    if (!projectNumber || !target) continue;
    const graph = graphByProject.get(projectNumber) ?? {
      edges: [], depth: new Map(), parents: new Map(), names: new Map(), outgoing: new Set(),
    };
    const from = cleanCell(row["支出元の支出先ブロック"]);
    const fromName = cleanCell(row["支出元の支出先ブロック名"]);
    const targetName = cleanCell(row["支出先の支出先ブロック名"]);
    const government = cleanCell(row["担当組織からの支出"]).toUpperCase() === "TRUE";
    graph.edges.push({ from, target, government });
    const parents = graph.parents.get(target) ?? [];
    parents.push(government ? null : from || null);
    graph.parents.set(target, [...new Set(parents)]);
    if (from) {
      graph.outgoing.add(from);
      if (fromName) graph.names.set(from, fromName);
    }
    if (targetName) graph.names.set(target, targetName);
    graphByProject.set(projectNumber, graph);
  }
  for (const graph of graphByProject.values()) {
    for (const edge of graph.edges) if (edge.government) graph.depth.set(edge.target, 1);
    for (let pass = 0; pass < graph.edges.length; pass += 1) {
      let changed = false;
      for (const edge of graph.edges) {
        if (edge.government || !edge.from || !graph.depth.has(edge.from)) continue;
        const depth = graph.depth.get(edge.from) + 1;
        if (!graph.depth.has(edge.target) || depth < graph.depth.get(edge.target)) {
          graph.depth.set(edge.target, depth);
          changed = true;
        }
      }
      if (!changed) break;
    }
  }
  return graphByProject;
}

export function disclosedPosition(graph, block) {
  const flowDepth = graph?.depth.get(block) ?? null;
  if (!graph || flowDepth === null) {
    return {
      flowLevel: "unclassified",
      flowDepth: null,
      sourceAgency: null,
      route: null,
      routeStatus: "not_disclosed",
      directUpstreamBlocks: [],
      directUpstreamNames: [],
      hasDisclosedDownstream: null,
    };
  }
  const directParents = graph.parents.get(block) ?? [];
  const directUpstreamBlocks = directParents.filter(Boolean);
  const directUpstreamNames = directParents.map((parent) =>
    parent === null ? "経済産業省" : graph.names.get(parent) || parent);
  const route = singleDisclosedRoute(graph, block);
  return {
    flowLevel: graph.outgoing.has(block)
      ? "disclosed_intermediary"
      : "terminal_in_disclosed_graph",
    flowDepth,
    sourceAgency: directUpstreamNames.length === 1 ? directUpstreamNames[0] : null,
    route,
    routeStatus: route ? "single_disclosed_path" : "multiple_or_unresolved_disclosed_paths",
    directUpstreamBlocks,
    directUpstreamNames,
    hasDisclosedDownstream: graph.outgoing.has(block),
  };
}

function singleDisclosedRoute(graph, block) {
  const route = [];
  const visited = new Set();
  let current = block;
  while (current && !visited.has(current)) {
    visited.add(current);
    route.unshift(graph.names.get(current) || current);
    const parents = graph.parents.get(current) ?? [];
    if (parents.length !== 1) return null;
    if (parents[0] === null) {
      route.unshift("経済産業省");
      return route;
    }
    current = parents[0];
  }
  return null;
}

export function* csvObjectRows(csvText) {
  const iterator = parseCsvRows(csvText);
  const first = iterator.next();
  if (first.done) return;
  const headers = first.value.map(cleanCell);
  let rowNumber = 1;
  for (const values of iterator) {
    rowNumber += 1;
    yield {
      row: Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])),
      rowNumber,
    };
  }
}

export function* parseCsvRows(text) {
  let row = [], field = "", quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index];
    if (quoted) {
      if (ch === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); yield row; row = []; field = ""; }
    else if (ch !== "\r") field += ch;
  }
  if (field || row.length) { row.push(field); yield row; }
}

export function isMetiReviewRow(row) {
  return cleanCell(row["所管府省庁"] || row["府省庁"]) === "経済産業省";
}

export function parseNullableInteger(value) {
  if (value === null || value === undefined || cleanCell(String(value)) === "") return null;
  const n = Number(cleanCell(String(value)).replaceAll(",", "").replace(/[円￥]/g, ""));
  return Number.isSafeInteger(n) ? n : null;
}

export function parseNullableNumber(value) {
  if (value === null || value === undefined || cleanCell(String(value)) === "") return null;
  const n = Number(cleanCell(String(value)).replaceAll(",", ""));
  return Number.isFinite(n) ? n : null;
}

export function cleanCell(value = "") {
  return String(value).replace(/^\uFEFF/, "").replace(/[\u3000\s]+/g, " ").trim();
}

export function stableId(parts) {
  return createHash("sha256").update(parts.join("\u001f")).digest("hex").slice(0, 16);
}

function parseReviewAmount(amountRaw) {
  if (!amountRaw) return { amount: null, amountStatus: "blank" };
  const amount = parseNullableInteger(amountRaw);
  if (amount === null) return { amount: null, amountStatus: "invalid" };
  return { amount, amountStatus: amount > 0 ? "positive" : amount === 0 ? "zero" : "negative" };
}

function countReasons(rows) {
  const counts = {};
  for (const row of rows) for (const reason of row.reasons) counts[reason] = (counts[reason] ?? 0) + 1;
  return counts;
}
