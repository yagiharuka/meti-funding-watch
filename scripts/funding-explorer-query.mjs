import { normalizeCompanyIdentity } from './company-search.mjs';
export const normalizeText = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase('ja-JP').replace(/[\s　]+/g, '');

export function createEntitySearch(entities) {
  const exact = new Map();
  const postings = new Map();
  const indexed = entities.map((entity, position) => {
    const names = [entity.name, ...entity.aliases].map(normalizeCompanyIdentity);
    for (const name of [...names, entity.corporateNumber].filter(Boolean)) {
      const list = exact.get(name) ?? new Set(); list.add(entity); exact.set(name, list);
    }
    const text = [...names, entity.corporateNumber].join(' ');
    const keys = new Set();
    for (let i = 0; i < text.length; i++) { keys.add(text.slice(i, i + 1)); if (i + 1 < text.length) keys.add(text.slice(i, i + 2)); }
    for (const key of keys) { const list = postings.get(key) ?? new Set(); list.add(position); postings.set(key, list); }
    return { entity, text };
  });
  return { exact, indexed, postings };
}
export function entityCandidatePositions(index, terms) {
  const keys = terms.flatMap(t => t.length < 2 ? [t] : Array.from({ length: t.length - 1 }, (_, i) => t.slice(i, i + 2)));
  const lists = [...new Set(keys)].map(k => index.postings.get(k) ?? new Set()).sort((a, b) => a.size - b.size);
  return lists.length ? [...lists[0]].filter(id => lists.every(list => list.has(id))) : [];
}
export function searchEntities(index, query) {
  const q = normalizeCompanyIdentity(query);
  if (!q) return [];
  if (/^\d{13}$/.test(q)) return [...(index.exact.get(q) ?? [])];
  const terms = query.trim().split(/[\s　]+/).map(normalizeCompanyIdentity).filter(Boolean);
  const exact = index.exact.get(q) ?? new Set();
  return entityCandidatePositions(index, terms).map(position => index.indexed[position]).filter(x => terms.every(term => x.text.includes(term)))
    .sort((a, b) => Number(exact.has(b.entity)) - Number(exact.has(a.entity)) || b.entity.count - a.entity.count)
    .map(x => x.entity);
}
export function filterEvidence(observations, { source = 'all', yearBasis = 'all', year = 'all' }) {
  return observations.filter(o => (source === 'all' || source === o.source) &&
    (yearBasis === 'all' || (yearBasis === 'sheet'
      ? o.sheetYear !== null && (year === 'all' || String(o.sheetYear) === year)
      : o.source !== 'review' && (yearBasis !== 'event' || o.source === 'gbiz') && (yearBasis !== 'published' || o.source === 'official') && (year === 'all' || (year === 'unknown' ? o.dateYear === null : String(o.dateYear) === year)))));
}
export function groupEvidence(observations) {
  const groups = new Map();
  for (const o of observations) {
    const key = o.amount === null ? o.id : JSON.stringify([o.entityId, normalizeText(o.title), o.amount, o.amountLabel]);
    const group = groups.get(key) ?? []; group.push(o); groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => (b[0].sheetYear ?? b[0].dateYear ?? 0) - (a[0].sheetYear ?? a[0].dateYear ?? 0));
}
export function shouldUseSourceView(search, hash) {
  const params = new URLSearchParams(search);
  return params.get('view') === 'source' || (params.get('view') !== 'explore' &&
    (['q', 'target', 'agency', 'year', 'stage'].some(key => params.has(key)) || ['#records', '#sources'].includes(hash)));
}
