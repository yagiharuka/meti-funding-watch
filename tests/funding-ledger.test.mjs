import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFundingLedger, evidenceFingerprint, buildProgramGraph, aggregateFacts } from '../scripts/funding-ledger.mjs';
const row = { id: 'gbiz:a', entityId: 'cn:1234567890123', source: 'gbiz', programId: null, block: '', amount: 100, amountLabel: '補助金の活動金額', kind: 'subsidy', date: '2024-06-01', dateYear: 2024, sheetYear: null, flowLevel: 'unclassified', sharedRecipients: [] };
function decision(type, rows, id = 'decision-1') { return { id, type, evidence: rows.map(o => ({ id: o.id, fingerprint: evidenceFingerprint(o) })), reason: 'The cited record explicitly identifies the same award.', reviewedBy: 'fixture-reviewer', reviewedAt: '2026-09-07T00:00:00Z', references: [{ url: 'https://example.com/award', locator: 'award 001, amendment 2' }] }; }

test('same amount/title is never an automatic transaction match; no payment year or payer invented', () => {
  const m = buildFundingLedger([row, { ...row, id: 'gbiz:b' }]);
  assert.equal(m.facts.length, 2); assert.equal(m.cases.length, 0);
  assert.ok(m.facts.every(f => f.dates.paymentFiscalYear === null && f.payerEntityId === null));
  assert.equal(aggregateFacts(m.facts, { entityId: row.entityId, amountStage: m.facts[0].amountStage, paymentFiscalYear: 2024 }).amount, null);
});
test('reviewed re-publication conserves two evidence rows as one fact; changed evidence blocks stale decisions', () => {
  const rows = [row, { ...row, id: 'gbiz:b' }], d = decision('same_fact', rows);
  const m = buildFundingLedger(rows, [d]);
  assert.equal(m.evidence.length, 2); assert.equal(m.facts.length, 1); assert.equal(m.facts[0].evidenceIds.length, 2);
  assert.throws(() => buildFundingLedger([row, { ...rows[1], amount: 200 }], [d]), /Stale/);
  assert.throws(() => buildFundingLedger(rows, [{ ...d, references: [] }]), /Invalid/);
});
test('different monetary stages and funding legs cannot merge; decisions never hide conflicting evidence', () => {
  for (const changed of [{ amount: 200 }, { kind: 'procurement' }, { block: 'A' }, { dateYear: 2025 }, { entityId: 'cn:9999999999999' }]) {
    const rows = [row, { ...row, id: 'gbiz:b', ...changed }];
    assert.throws(() => buildFundingLedger(rows, [decision('same_fact', rows)]), /Incompatible/);
  }
  const rows = [row, { ...row, id: 'gbiz:b' }];
  assert.throws(() => buildFundingLedger(rows, [decision('same_fact', rows), decision('different_case', rows, 'other')]), /Contradictory/);
});
test('amendments preserve chronology and current value without adding versions; cycles are rejected', () => {
  const rows = [row, { ...row, id: 'gbiz:b', amount: 120 }, { ...row, id: 'gbiz:c', amount: 110 }];
  const decisions = [decision('revision', rows.slice(0, 2)), decision('revision', rows.slice(1), 'second')];
  const m = buildFundingLedger(rows, decisions);
  assert.equal(m.facts.length, 3); assert.equal(m.cases.length, 1);
  assert.equal(m.cases[0].currentFactIds.length, 1);
  assert.equal(m.facts.find(f => f.id === m.cases[0].currentFactIds[0]).amount, 110);
  assert.throws(() => buildFundingLedger(rows, [...decisions, decision('revision', [rows[2], row], 'cycle')]), /Cyclic/);
});
test('block graph retains many-to-many paths without claiming a payer or a flow amount', () => {
  const observations = ['A', 'A', 'B', 'C'].map((block, i) => ({ ...row, id: `review:${i}`, block, upstreamBlocks: block === 'C' ? ['A', 'B'] : [], routeStatus: 'multiple_or_unresolved_disclosed_paths' }));
  const graph = buildProgramGraph({ id: 'p', sheetYear: 2025 }, observations);
  assert.equal(graph.edges.length, 2);
  assert.ok(graph.edges.every(e => e.level === 'block' && e.amount === null));
  assert.equal(graph.nodes.find(n => n.id === 'A').observationIds.length, 2);
  assert.equal(graph.nodes.find(n => n.id === 'C').tracking, 'end_of_disclosed_route');
  assert.equal(graph.total, null);
});
test('future raw flow rows retain nodes without named recipients and exact source row locators', () => {
  const graph = buildProgramGraph({ id: 'p', sheetYear: 2025, disclosedFlows: [{ government: true, from: '', target: 'A', sourceRowNumber: 7 }, { from: 'A', target: 'Z', sourceRowNumber: 8 }] }, []);
  assert.equal(graph.edges.length, 2); assert.equal(graph.nodes.length, 3);
  assert.deepEqual(graph.edges[1].sourceRowNumbers, [8]);
  assert.equal(graph.nodes.find(n => n.id === 'Z').observationIds.length, 0);
});
test('legacy or publisher-only records cannot produce confirmed block routes', () => {
  const graph = buildProgramGraph({ id: 'p' }, [{ ...row, block: 'A', flowDepth: 1, routeStatus: 'legacy_single_route_unverified', route: ['経済産業省', 'A'], upstreamBlocks: ['B'] }]);
  assert.equal(graph.edges.length, 0);
});
