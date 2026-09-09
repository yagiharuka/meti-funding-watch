import { createHash } from 'node:crypto';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const evidenceFingerprint = observation => digest(observation);
const year = value => Number.isInteger(value) && value >= 1900 && value <= 2200 ? value : null;

export function amountStage(o) {
  if (o.source === 'review') return 'review_recipient_reported';
  if (o.source === 'gbiz') return o.kind === 'procurement' ? 'gbiz_procurement_reported' : 'gbiz_subsidy_reported';
  if (['契約金額欄の掲載値', '契約金額', '契約額', '契約金額（税込額）'].includes(o.amountLabel)) return 'contract_reported';
  if (['交付決定額欄の掲載値', '交付決定額'].includes(o.amountLabel)) return 'grant_decision_reported';
  return 'unclassified_reported';
}

// Evidence is immutable. Facts and case relationships are a separate, reviewed
// interpretation. Never identify transactions by name/amount similarity.
export function buildFundingLedger(observations, decisions = []) {
  const byId = new Map(observations.map(o => [o.id, o]));
  const evidence = observations.map(o => ({ id: o.id, fingerprint: evidenceFingerprint(o) }));
  const fingerprints = new Map(evidence.map(e => [e.id, e.fingerprint]));
  const parent = new Map(observations.map(o => [o.id, o.id]));
  const root = id => { let p = id; while (parent.get(p) !== p) p = parent.get(p); return p; };
  const decisionIds = new Set();
  for (const d of decisions) {
    if (!d.id || decisionIds.has(d.id) || !['same_fact', 'revision', 'different_case'].includes(d.type)
      || !d.reason?.trim() || !d.reviewedBy?.trim() || !Number.isFinite(Date.parse(d.reviewedAt))
      || !Array.isArray(d.references) || !d.references.length || d.references.some(r => !/^https:\/\//.test(r.url) || !r.locator?.trim())
      || !Array.isArray(d.evidence) || d.evidence.length < 2 || new Set(d.evidence.map(e => e.id)).size !== d.evidence.length) throw new Error(`Invalid funding decision: ${d.id}`);
    decisionIds.add(d.id);
    for (const e of d.evidence) if (!byId.has(e.id) || fingerprints.get(e.id) !== e.fingerprint) throw new Error(`Stale funding decision: ${d.id} ${e.id}`);
    if (d.type === 'same_fact') {
      const rows = d.evidence.map(e => byId.get(e.id));
      // A review decision may merge compatible re-publications; it cannot merge
      // upstream/downstream legs, different monetary stages, or revisions.
      const keys = rows.map(o => JSON.stringify([o.entityId, o.programId, o.block, o.amount, amountStage(o), o.dateYear, o.sheetYear]));
      if (new Set(keys).size !== 1) throw new Error(`Incompatible same-fact decision: ${d.id}`);
      const first = root(rows[0].id);
      for (const row of rows.slice(1)) parent.set(root(row.id), first);
    }
  }
  const groups = new Map();
  for (const o of observations) { const key = root(o.id); const group = groups.get(key) ?? []; group.push(o); groups.set(key, group); }
  const factByEvidence = new Map();
  const facts = [...groups.values()].map(rows => {
    const o = rows[0], evidenceIds = rows.map(r => r.id).sort();
    const id = `fact-${digest(evidenceIds).slice(0, 20)}`;
    for (const eid of evidenceIds) factByEvidence.set(eid, id);
    return { id, evidenceIds, entityId: o.entityId, programId: o.programId, amount: o.amount,
      amountStage: amountStage(o), currency: 'JPY', amountScope: o.sharedRecipients?.length > 1 ? 'joint_recipients' : 'reported_recipient',
      payerEntityId: null, block: o.block || null, role: o.flowLevel,
      dates: { sourceSheetYear: year(o.sheetYear), sourceRecordYear: o.source === 'official' ? year(o.dateYear) : null,
        eventDate: o.source === 'review' ? null : o.date, eventFiscalYear: o.source === 'gbiz' && o.date ? year(o.dateYear) : null,
        paymentFiscalYear: null },
      status: rows.length > 1 ? 'reviewed_same_fact' : 'source_assertion',
      aggregation: 'not_established', caseId: null, supersededBy: null };
  });
  const byFact = new Map(facts.map(f => [f.id, f]));
  const caseParent = new Map(facts.map(f => [f.id, f.id]));
  const caseRoot = id => { let p = id; while (caseParent.get(p) !== p) p = caseParent.get(p); return p; };
  for (const d of decisions) {
    const ids = d.evidence.map(e => factByEvidence.get(e.id));
    if (d.type === 'different_case' && new Set(ids.map(caseRoot)).size !== ids.length) throw new Error(`Contradictory decision: ${d.id}`);
    if (d.type !== 'revision') continue;
    if (ids.length !== 2 || ids[0] === ids[1]) throw new Error(`Invalid revision: ${d.id}`);
    const [before, after] = ids.map(id => byFact.get(id));
    if (before.entityId !== after.entityId || before.amountStage !== after.amountStage || before.programId !== after.programId || before.block !== after.block || before.supersededBy) throw new Error(`Incompatible revision: ${d.id}`);
    before.supersededBy = after.id;
    caseParent.set(caseRoot(after.id), caseRoot(before.id));
  }
  for (const f of facts) {
    const visited = new Set(); let cursor = f;
    while (cursor?.supersededBy) { if (visited.has(cursor.id)) throw new Error('Cyclic revision history'); visited.add(cursor.id); cursor = byFact.get(cursor.supersededBy); }
  }
  for (const d of decisions.filter(d => d.type === 'different_case')) {
    const roots = d.evidence.map(e => caseRoot(factByEvidence.get(e.id)));
    if (new Set(roots).size !== roots.length) throw new Error(`Contradictory decision: ${d.id}`);
  }
  const caseGroups = new Map();
  for (const f of facts) if (f.supersededBy) { const key = caseRoot(f.id); const list = caseGroups.get(key) ?? new Set(); list.add(f.id); list.add(f.supersededBy); caseGroups.set(key, list); }
  const cases = [...caseGroups.values()].map(ids => {
    const factIds = [...ids].sort(), id = `case-${digest(factIds).slice(0, 20)}`;
    for (const fid of factIds) byFact.get(fid).caseId = id;
    return { id, factIds, currentFactIds: factIds.filter(fid => !byFact.get(fid).supersededBy) };
  });
  return { evidence, facts, cases, decisions, factByEvidence };
}

// An explicit guard for future totals. Unknown scope/period/transaction identity
// must not silently become a number. Budget totals remain separate source values.
export function aggregateFacts(facts, scope) {
  if (!scope?.entityId || !scope?.amountStage || !Number.isInteger(scope?.paymentFiscalYear)) return { amount: null, reason: 'scope_required' };
  const rows = facts.filter(f => f.entityId === scope.entityId && f.amountStage === scope.amountStage && !f.supersededBy);
  if (!rows.length) return { amount: null, reason: 'no_confirmed_facts' };
  if (rows.some(f => f.aggregation !== 'eligible' || f.dates.paymentFiscalYear === null || f.amount === null || f.amountScope !== 'reported_recipient')) return { amount: null, reason: 'identity_period_or_scope_unresolved' };
  const selected = rows.filter(f => f.dates.paymentFiscalYear === scope.paymentFiscalYear);
  if (!selected.length) return { amount: null, reason: 'no_confirmed_facts' };
  const amount = selected.reduce((sum, f) => sum + BigInt(f.amount), 0n);
  return amount <= BigInt(Number.MAX_SAFE_INTEGER) && amount >= BigInt(Number.MIN_SAFE_INTEGER) ? { amount: Number(amount), reason: null } : { amount: null, reason: 'unsafe_integer' };
}

export function buildProgramGraph(program, observations, receipts = []) {
  const nodes = new Map(), edges = new Map();
  const node = block => { if (!nodes.has(block)) nodes.set(block, { id: block, label: block === 'government' ? '経済産業省（担当組織）' : `支出ブロック ${block}`, observationIds: [], entityIds: [], role: 'unclassified' }); return nodes.get(block); };
  for (const o of observations) {
    if (!o.block) continue;
    const n = node(o.block); n.observationIds.push(o.id); n.entityIds.push(o.entityId);
    if (o.flowLevel === 'disclosed_intermediary') n.role = 'disclosed_intermediary';
    else if (n.role === 'unclassified') n.role = o.flowLevel;
  }
  function edge(from, to, evidenceId, sourceRowNumber = null) {
    node(from); node(to);
    const key = JSON.stringify([from, to]);
    const e = edges.get(key) ?? { id: `edge-${digest([program.id, from, to]).slice(0, 20)}`, from, to, level: 'block', amount: null, evidenceIds: [], sourceRowNumbers: [] };
    if (evidenceId) e.evidenceIds.push(evidenceId);
    if (sourceRowNumber !== null) e.sourceRowNumbers.push(sourceRowNumber);
    edges.set(key, e);
  }
  if (Array.isArray(program.disclosedFlows)) {
    for (const f of program.disclosedFlows) if (f.target && (f.government || f.from)) edge(f.government ? 'government' : f.from, f.target, null, f.sourceRowNumber);
  } else {
    for (const o of observations) {
      if (!o.block || o.routeStatus?.startsWith('legacy')) continue;
      for (const from of o.upstreamBlocks || []) edge(from, o.block, o.id);
      // Only the explicit single-path root can be recovered safely from the
      // older cache. Never turn a publisher name into a paying entity.
      if (o.flowDepth === 1 && o.routeStatus === 'single_disclosed_path' && o.route?.length === 2) edge('government', o.block, o.id);
    }
  }
  const incoming = new Set([...edges.values()].map(e => e.to));
  const outgoing = new Set([...edges.values()].map(e => e.from));
  return { level: 'block', reconstruction: Array.isArray(program.disclosedFlows) ? 'source_flow_rows' : 'verified_payment_cache',
    nodes: [...nodes.values()].map(n => ({ ...n, entityIds: [...new Set(n.entityIds)],
      tracking: n.id === 'government' ? 'origin' : !incoming.has(n.id) ? 'route_unconfirmed' : outgoing.has(n.id) ? 'downstream_disclosed' : 'end_of_disclosed_route' })),
    edges: [...edges.values()].map(e => ({ ...e, evidenceIds: [...new Set(e.evidenceIds)], sourceRowNumbers: [...new Set(e.sourceRowNumbers)] })),
    receipts: receipts.filter(r => r.reviewSheetYear === program.sheetYear && r.kind === 'flows'),
    total: null, missingBreakdown: 'not_determined' };
}
