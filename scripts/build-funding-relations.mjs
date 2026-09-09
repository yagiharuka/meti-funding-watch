import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { buildFundingRelations, duplicateCandidates } from './funding-relations.mjs';

const read = async path => JSON.parse(await readFile(path, 'utf8'));
export async function buildFundingRelationArtifacts({ outputDirectory }) {
  const gm = await read('data/pages/manifest.json');
  const rm = await read('data/review-cache/manifest.json');
  const official = await read('public/data/official-company-index.json');
  if (rm.schemaVersion !== 4) throw new Error('Relations require verified review schema v4');
  const [gbizGroups, paymentGroups, programs] = await Promise.all([
    Promise.all(Object.values(gm.commitments).map(f => read(`data/pages/${f}`))),
    Promise.all(rm.paymentFiles.map(f => read(`data/review-cache/${f}`))),
    read(`data/review-cache/${rm.programsFile}`),
  ]);
  const gbiz = gbizGroups.flat(); const payments = paymentGroups.flat();
  if (payments.length !== rm.paymentCount || programs.length !== rm.programCount || official.records.length !== official.recordCount) throw new Error('Relation input accounting mismatch');
  const decisions = await read('data/funding/match-decisions.json');
  if (decisions.schemaVersion !== 1 || !Array.isArray(decisions.decisions)) throw new Error('Invalid funding match decisions');
  const excludedRows = await read(`data/review-cache/${rm.excludedRowsFile}`);
  const model = buildFundingRelations({ gbiz, payments, programs, official: official.records, decisions: decisions.decisions, reviewReceipts: rm.sourceReceipts, excludedRows });
  await mkdir(outputDirectory, { recursive: true });
  const files = {};
  async function save(name, data) {
    const text = JSON.stringify(data);
    const digest = createHash('sha256').update(text).digest('hex');
    const filename = `${name}-${digest.slice(0, 16)}.json`;
    await writeFile(new URL(filename, outputDirectory), `${text}\n`);
    files[filename] = { sha256: createHash('sha256').update(`${text}\n`).digest('hex'), bytes: Buffer.byteLength(`${text}\n`) };
    return filename;
  }
  const bucket = id => createHash('sha256').update(id).digest()[0] % 64;
  const buckets = Array.from({ length: 64 }, () => []);
  for (const o of model.observations) buckets[bucket(o.entityId)].push(o);
  const rawById = new Map(model.sourceRecords.map(r => [r.id, r]));
  const factsById = new Map(model.ledger.facts.map(f => [f.id, f]));
  const bucketFiles = [];
  for (let i = 0; i < buckets.length; i++) bucketFiles.push(await save(`evidence-${i}`, { schemaVersion: 2, observations: buckets[i], facts: [...new Set(buckets[i].map(o => o.factId))].map(id => factsById.get(id)), sourceRecords: buckets[i].map(o => rawById.get(o.id)) }));
  const byObservation = new Map(model.observations.map(o => [o.id, o]));
  const programIndex = [];
  for (const p of model.programs) {
    const observations = p.observationIds.map(id => byObservation.get(id));
    const candidates = p.candidateIds.map(id => byObservation.get(id));
    const filename = await save(`program-${p.id}`, { schemaVersion: 2, program: p, observations, candidates, graph: p.graph, facts: [...new Set(observations.map(o => o.factId))].map(id => factsById.get(id)) });
    const { observationIds, candidateIds, graph, disclosedFlows, ...summary } = p;
    summary.flowEdges = graph.edges.length;
    programIndex.push({ ...summary, candidateCount: candidateIds.length, file: filename });
  }
  const entityIndex = model.entities.map(e => ({
    id: e.id, name: e.name, corporateNumber: e.corporateNumber,
    aliases: e.aliases.filter(n => n !== e.name), sources: e.sources,
    count: e.observationIds.length, programIds: e.programIds,
    file: bucketFiles[bucket(e.id)],
  }));
  const entitiesFile = await save('entities', entityIndex);
  const programsFile = await save('programs', programIndex);
  const candidateGroups = duplicateCandidates(model.observations);
  const ledgerFile = await save('ledger', model.ledger);
  const receiptsFile = await save('source-receipts', { review: rm.sourceReceipts, rowAccounting: rm.rowAccounting, gbiz: gm });
  const manifest = {
    schemaVersion: 2, ledgerFile, receiptsFile, entitiesFile, programsFile,
    counts: { entities: entityIndex.length, programs: programIndex.length, observations: model.observations.length,
      gbiz: gbiz.length, review: payments.length, official: official.records.length, facts: model.ledger.facts.length, reviewedCases: model.ledger.cases.length, blockEdges: model.programs.reduce((n, p) => n + p.graph.edges.length, 0), duplicateCandidateGroups: candidateGroups.length },
    sources: { gbiz: gm.generatedAt, review: rm.lastSuccessfulSourceRefreshAt || rm.generatedAt, official: official.generatedAt },
    rules: { identity: 'corporate_number_only', programRelation: 'review_project_id', otherProgramMatches: 'name_candidate_only', aggregation: 'no_cross_observation_sum', missingIndividualReviewYear: true },
    files,
  };
  await writeFile(new URL('manifest.json', outputDirectory), `${JSON.stringify(manifest)}\n`);
  console.log(`Funding relations: ${entityIndex.length} identities, ${programIndex.length} program sheets, ${model.observations.length} evidence rows`);
  return manifest;
}
