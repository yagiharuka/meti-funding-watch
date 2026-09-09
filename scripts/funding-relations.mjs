import { createHash } from 'node:crypto';
import { buildFundingLedger, buildProgramGraph } from './funding-ledger.mjs';

export const normalize = (value = '') => String(value).normalize('NFKC').toLocaleLowerCase('ja-JP').replace(/[\s　]+/g, '').trim();
const hash = value => createHash('sha256').update(value).digest('hex').slice(0, 20);
const number = value => Number.isSafeInteger(value) ? value : null;
const corporateNumber = value => /^\d{13}$/.test(String(value ?? '')) && !/^(\d)\1{12}$/.test(String(value)) ? String(value) : '';
const safeUrl = value => typeof value === 'string' && /^https:\/\//.test(value) ? value : null;

// A relation is a sourced observation, not an inferred transaction. Its original
// evidence survives even when names, amounts or dates match another observation.
export function buildFundingRelations({ gbiz = [], payments = [], programs = [], official = [], decisions = [], reviewReceipts = [], excludedRows = [] }) {
  const entities = new Map();
  const observations = [];
  const sourceRecords = [];
  const seen = new Set();
  const programMap = new Map(programs.map(p => [p.id, {
    id: p.id, name: p.name, projectNumber: p.projectNumber,
    sheetYear: p.reviewSheetYear, budgetYear: p.budgetFiscalYear,
    executionYear: p.executionFiscalYear, initialBudget: number(p.initialBudget),
    execution: number(p.execution), organization: p.organization,
    sourceUrl: safeUrl(p.sourceUrl), disclosedFlows: p.disclosedFlows, observationIds: [], candidateIds: [],
  }]));
  if (programMap.size !== programs.length) throw new Error('Duplicate review program IDs');

  function add(row, source) {
    if (!row.id || !row.organization || !safeUrl(row.sourceUrl)) throw new Error(`Invalid ${source} evidence: ${row.id}`);
    const id = `${source}:${row.id}`;
    if (seen.has(id)) throw new Error(`Duplicate evidence ID: ${id}`);
    seen.add(id);
    sourceRecords.push({ id, source, record: row });
    const cn = corporateNumber(row.corporateNumber);
    // Name-only rows are not merged, even if their names are identical.
    const entityId = cn ? `cn:${cn}` : `record:${hash(id)}`;
    const entity = entities.get(entityId) ?? { id: entityId, name: row.organization, corporateNumber: cn, aliases: new Set(), observationIds: [], programIds: new Set(), sources: new Set() };
    entity.aliases.add(row.organization);
    entity.observationIds.push(id);
    entity.sources.add(source);
    entities.set(entityId, entity);
    const programId = source === 'review' ? row.reviewProjectId : null;
    if (programId && !programMap.has(programId)) throw new Error(`Unresolved program: ${programId}`);
    const observation = {
      id, entityId, source, title: row.program || row.theme || '事業・件名の記載なし',
      theme: row.theme || '', organization: row.organization, programId,
      amount: number(row.amount), amountRaw: row.amountRaw || '',
      amountLabel: source === 'review' ? '支出先の合計支出額（掲載値）' : source === 'gbiz' ? (row.stage === 'contracted' ? '落札価格／活動金額' : '補助金の活動金額') : row.amountStage || '公表金額',
      kind: source === 'review' ? 'review' : source === 'gbiz' ? (row.stage === 'contracted' ? 'procurement' : 'subsidy') : row.category === 'grant_decision' ? 'subsidy' : 'procurement',
      date: row.date || null,
      dateYear: source === 'review' ? null : number(row.fiscalYear),
      sheetYear: source === 'review' ? number(row.reviewSheetYear) : null,
      publisher: source === 'official' ? row.sourceName : row.sourceAgency || '',
      routeStatus: source === 'review' ? row.routeStatus || 'not_disclosed' : 'not_disclosed',
      flowDepth: source === 'review' ? number(row.flowDepth) : null,
      upstreamBlocks: source === 'review' ? row.directUpstreamBlocks || [] : [],
      route: source === 'review' && Array.isArray(row.route) ? row.route : null,
      upstreamNames: source === 'review' ? row.directUpstreamNames || [] : [],
      flowLevel: source === 'review' ? row.flowLevel : 'unclassified',
      block: source === 'review' ? row.block || '' : '',
      parentObservationIds: source === 'review' ? (row.parentPaymentIds || []).map(p => `review:${p}`) : [],
      sourceUrl: row.sourceUrl, sourceKey: row.sourceKey || row.id,
      sourceRowNumber: number(row.sourceRowNumber),
      sharedRecipients: source === 'official' && Array.isArray(row.organizations) ? row.organizations : [],
    };
    observations.push(observation);
    if (programId) {
      programMap.get(programId).observationIds.push(id);
      entity.programIds.add(programId);
    }
  }
  gbiz.forEach(r => add(r, 'gbiz'));
  payments.forEach(r => add(r, 'review'));
  official.forEach(r => add(r, 'official'));

  // Exact normalized title only suggests a program association. Never promotes
  // it to programId or a confirmed financial route, even for equal amounts.
  const byName = new Map();
  for (const p of programMap.values()) {
    const key = normalize(p.name);
    if (key.length < 8) continue;
    const group = byName.get(key) ?? [];
    group.push(p); byName.set(key, group);
  }
  for (const o of observations) {
    if (o.programId) continue;
    for (const p of byName.get(normalize(o.title)) ?? []) p.candidateIds.push(o.id);
  }
  const observationMap = new Map(observations.map(o => [o.id, o]));
  for (const o of observations) {
    for (const parent of o.parentObservationIds) {
      const p = observationMap.get(parent);
      if (!p || p.programId !== o.programId) throw new Error(`Invalid disclosed parent: ${parent}`);
    }
  }
  const ledger = buildFundingLedger(observations, decisions);
  for (const o of observations) o.factId = ledger.factByEvidence.get(o.id);
  return {
    ledger: { evidence: ledger.evidence, facts: ledger.facts, cases: ledger.cases, decisions: ledger.decisions },
    sourceRecords,
    entities: [...entities.values()].map(e => ({ ...e, aliases: [...e.aliases], programIds: [...e.programIds], sources: [...e.sources] })),
    programs: [...programMap.values()].map(p => {
      const rows = p.observationIds.map(id => observationMap.get(id));
      return { ...p, graph: buildProgramGraph(p, rows, reviewReceipts), coverage: {
        excludedRows: excludedRows.filter(r => r.reviewSheetYear === p.sheetYear && r.projectNumber === p.projectNumber).length,
        missingBreakdown: 'not_determined',
        rows: rows.length,
        namedEntities: new Set(rows.map(o => o.entityId).filter(id => id.startsWith('cn:'))).size,
        amountKnown: rows.filter(o => o.amount !== null).length,
        routeKnown: rows.filter(o => o.route?.length > 1).length,
        intermediaryRows: rows.filter(o => o.flowLevel === 'disclosed_intermediary').length,
        individualPaymentYearKnown: 0,
        coverageRatio: null,
      } };
    }),
    observations,
  };
}

export function duplicateCandidates(observations) {
  const groups = new Map();
  for (const o of observations) {
    if (o.amount === null || !normalize(o.title)) continue;
    const key = JSON.stringify([o.entityId, normalize(o.title), o.amount, o.amountLabel]);
    const group = groups.get(key) ?? [];
    group.push(o.id); groups.set(key, group);
  }
  return [...groups.values()].filter(group => group.length > 1);
}
