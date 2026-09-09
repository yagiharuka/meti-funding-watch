import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { buildFundingRelations, duplicateCandidates } from '../scripts/funding-relations.mjs';
import { createEntitySearch, searchEntities, entityCandidatePositions, filterEvidence, groupEvidence, useSourceView } from '../scripts/funding-explorer-query.mjs';
const cn = '1234567890123';
const program = { id: 'rs-2025-1', name: 'GX分野のディープテック・スタートアップ支援事業', projectNumber: '1', reviewSheetYear: 2025, budgetFiscalYear: 2025, executionFiscalYear: 2024, initialBudget: 1000, execution: 900, sourceUrl: 'https://example.com/review' };
const base = { id: '1', organization: '株式会社テスト', corporateNumber: cn, program: program.name, amount: 100, sourceUrl: 'https://example.com/evidence', fiscalYear: 2024, stage: 'subsidy_published' };
const payment = { ...base, reviewProjectId: program.id, reviewSheetYear: 2025, flowLevel: 'terminal_in_disclosed_graph', route: ['経済産業省', '株式会社テスト'], sourceRowNumber: 5 };

test('corporate identity joins sources but missing numbers and homonyms stay separate', () => {
  const m = buildFundingRelations({ gbiz: [base, { ...base, id: '2', corporateNumber: '9876543210123' }], payments: [payment], programs: [program], official: [{ ...base, id: '3', corporateNumber: '' }, { ...base, id: '4', corporateNumber: '' }] });
  assert.equal(m.entities.length, 4); assert.equal(m.observations.length, 5);
  assert.equal(m.entities.find(e => e.id === `cn:${cn}`).observationIds.length, 2);
  const search = createEntitySearch(m.entities.map(e => ({ ...e, count: e.observationIds.length })));
  assert.equal(searchEntities(search, cn).length, 1);
  assert.equal(searchEntities(search, '(株)テスト').length, 4);
});
test('program ID is authoritative; matching names only yield candidates', () => {
  const m = buildFundingRelations({ gbiz: [base], payments: [payment], programs: [program] });
  assert.deepEqual(m.programs[0].observationIds, ['review:1']);
  assert.deepEqual(m.programs[0].candidateIds, ['gbiz:1']);
  assert.equal(m.observations[0].programId, null);
  assert.equal(m.observations[0].route, null);
  assert.equal(m.programs[0].coverage.coverageRatio, null);
});
test('equal title/amount rows survive as separate evidence across years; no total or dedupe', () => {
  const m = buildFundingRelations({ gbiz: [base, { ...base, id: '2', fiscalYear: 2019 }, { ...base, id: '3', amount: null }, { ...base, id: '4', amount: 0 }, { ...base, id: '5', amount: -10 }] });
  assert.equal(m.observations.length, 5);
  assert.deepEqual(duplicateCandidates(m.observations), [['gbiz:1', 'gbiz:2']]);
  assert.equal(groupEvidence(m.observations).flat().length, 5);
  assert.deepEqual(m.observations.map(o => o.amount), [100, 100, null, 0, -10]);
  assert.equal('total' in m.entities[0], false);
});
test('sheet year is never converted to an individual payment year', () => {
  const m = buildFundingRelations({ gbiz: [base, { ...base, id: 'unknown', fiscalYear: null }], payments: [payment], programs: [program] });
  assert.equal(m.observations.find(o => o.source === 'review').dateYear, null);
  assert.deepEqual(filterEvidence(m.observations, { yearBasis: 'sheet', year: '2025' }).map(o => o.id), ['review:1']);
  assert.deepEqual(filterEvidence(m.observations, { yearBasis: 'record', year: '2024' }).map(o => o.id), ['gbiz:1']);
  assert.deepEqual(filterEvidence(m.observations, { yearBasis: 'record', year: 'unknown' }).map(o => o.id), ['gbiz:unknown']);
});
test('unresolved references, duplicate evidence and cross-program parents stop publication', () => {
  assert.throws(() => buildFundingRelations({ payments: [payment] }), /Unresolved program/);
  assert.throws(() => buildFundingRelations({ gbiz: [base, base] }), /Duplicate evidence/);
  assert.throws(() => buildFundingRelations({ payments: [{ ...payment, parentPaymentIds: ['absent'] }], programs: [program] }), /Invalid disclosed parent/);
});
test('existing source bookmarks retain their intended view', () => {
  assert.equal(useSourceView('', ''), false);
  assert.equal(useSourceView('?q=日本電気', ''), true);
  assert.equal(useSourceView('?view=explore&company=cn:1234567890123', '#records'), false);
  assert.equal(useSourceView('?view=source', ''), true);
});

test('real data: NEC is isolated, GX recipients are linked, cashless candidates conserve evidence', async () => {
  const read = async path => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'));
  const gm = await read('data/pages/manifest.json'), rm = await read('data/review-cache/manifest.json');
  const gbiz = (await Promise.all(Object.values(gm.commitments).map(f => read(`data/pages/${f}`)))).flat();
  const payments = (await Promise.all(rm.paymentFiles.map(f => read(`data/review-cache/${f}`)))).flat();
  const programs = await read('data/review-cache/programs.json');
  const official = (await read('public/data/official-company-index.json')).records;
  const m = buildFundingRelations({ gbiz, payments, programs, official });
  assert.equal(m.observations.length, gbiz.length + payments.length + official.length);
  const nec = m.entities.find(e => e.name === '日本電気株式会社'); assert.ok(nec);
  const index = createEntitySearch(m.entities.map(e => ({ ...e, count: e.observationIds.length })));
  assert.equal(searchEntities(index, '日本電気')[0].id, nec.id);
  const necRows = m.observations.filter(o => o.entityId === nec.id);
  assert.ok(necRows.length > 0); assert.ok(nec.programIds.length > 0);
  assert.deepEqual(new Set(necRows.map(o => o.id)), new Set(nec.observationIds));
  const gx = m.programs.find(p => p.id === 'rs-2025-7096'); assert.ok(gx);
  const gxRows = m.observations.filter(o => o.programId === gx.id);
  assert.equal(gxRows.length, payments.filter(p => p.reviewProjectId === gx.id).length);
  assert.ok(gxRows.some(o => o.route?.length > 2));
  assert.ok(gxRows.every(o => m.entities.some(e => e.id === o.entityId)));
  const cashless = m.entities.find(e => e.name.includes('キャッシュレス推進協議会')); assert.ok(cashless);
  const cashlessRows = m.observations.filter(o => o.entityId === cashless.id);
  assert.ok(duplicateCandidates(cashlessRows).length > 0);
  assert.equal(groupEvidence(cashlessRows).flat().length, cashlessRows.length);
});


test('placeholder corporate numbers never join unrelated recipients', () => {
  const m = buildFundingRelations({ gbiz: [{ ...base, corporateNumber: '9999999999999' }, { ...base, id: 'other', organization: '別の事業者', corporateNumber: '9999999999999' }] });
  assert.equal(m.entities.length, 2);
  assert.ok(m.entities.every(e => e.id.startsWith('record:') && !e.corporateNumber));
});

test('company lookup visits indexed candidates rather than scanning every company', () => {
  const entities = Array.from({ length: 5000 }, (_, i) => ({ id: String(i), name: `検証企業${i}`, aliases: [], corporateNumber: '', count: 1 }));
  entities.push({ id: 'target', name: '特異的検索対象', aliases: [], corporateNumber: '', count: 1 });
  const index = createEntitySearch(entities);
  assert.equal(entityCandidatePositions(index, ['特異的']).length, 1);
  assert.deepEqual(searchEntities(index, '特異的').map(e => e.id), ['target']);
  assert.equal(searchEntities(index, '存在しない').length, 0);
});
