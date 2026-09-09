import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
const directory = new URL('../dist-pages/data/explorer/', import.meta.url);

test('published relationships have verifiable files and conserve all evidence', async () => {
  const manifestText = await readFile(new URL('manifest.json', directory), 'utf8');
  const m = JSON.parse(manifestText);
  const read = async filename => JSON.parse(await readFile(new URL(filename, directory), 'utf8'));
  const entities = await read(m.entitiesFile), programs = await read(m.programsFile);
  assert.equal(m.schemaVersion, 2);
  assert.equal(entities.length, m.counts.entities); assert.equal(programs.length, m.counts.programs);
  for (const [file, metadata] of Object.entries(m.files)) {
    const bytes = await readFile(new URL(file, directory));
    assert.equal(bytes.length, metadata.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), metadata.sha256);
  }
  const ledger = await read(m.ledgerFile);
  assert.equal(ledger.evidence.length, m.counts.observations);
  assert.equal(ledger.facts.length, m.counts.facts);
  const factIds = new Set(ledger.facts.map(f => f.id));
  const ids = new Set(); const entityIds = new Set(entities.map(e => e.id));
  for (const filename of new Set(entities.map(e => e.file))) {
    const detail = await read(filename);
    assert.equal(detail.sourceRecords.length, detail.observations.length);
    assert.deepEqual(detail.sourceRecords.map(r => r.id), detail.observations.map(o => o.id));
    assert.ok(detail.observations.every(o => factIds.has(o.factId)));
    for (const o of detail.observations) { assert.equal(ids.has(o.id), false); ids.add(o.id); assert.ok(entityIds.has(o.entityId)); }
  }
  assert.equal(ids.size, m.counts.observations);
  assert.equal(ids.size, m.counts.gbiz + m.counts.review + m.counts.official);
  for (const p of programs) {
    const detail = await read(p.file);
    assert.equal(detail.program.id, p.id);
    assert.equal(detail.graph.edges.length, p.flowEdges);
    assert.ok(detail.graph.edges.every(e => e.level === "block" && e.amount === null));
    assert.equal(detail.observations.length, p.coverage.rows);
    assert.ok(detail.observations.every(o => o.programId === p.id && ids.has(o.id)));
    assert.ok(detail.candidates.every(o => o.programId === null && ids.has(o.id)));
  }
  const release = JSON.parse(await readFile(new URL('../dist-pages/release.json', import.meta.url), 'utf8'));
  assert.equal(release.explorer.manifestSha256, createHash('sha256').update(manifestText).digest('hex'));
});
