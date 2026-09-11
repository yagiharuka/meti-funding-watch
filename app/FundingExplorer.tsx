"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { createEntitySearch, searchEntities, filterEvidence, groupEvidence } from '../scripts/funding-explorer-query.mjs';

type Source = 'gbiz' | 'review' | 'official';
type Entity = { id: string; name: string; corporateNumber: string; aliases: string[]; sources: Source[]; count: number; programIds: string[]; file: string };
type Coverage = { rows: number; namedEntities: number; amountKnown: number; routeKnown: number; intermediaryRows: number; excludedRows: number };
type Program = { id: string; name: string; projectNumber: string; sheetYear: number; budgetYear: number | null; executionYear: number | null; initialBudget: number | null; execution: number | null; organization: string; sourceUrl: string; coverage: Coverage; candidateCount?: number; flowEdges: number; file: string };
type Observation = { id: string; factId: string; routeStatus: string; entityId: string; source: Source; title: string; theme: string; organization: string; programId: string | null; amount: number | null; amountRaw: string; amountLabel: string; kind: string; date: string | null; dateYear: number | null; sheetYear: number | null; publisher: string; route: string[] | null; upstreamNames: string[]; flowLevel: string; block: string; parentObservationIds: string[]; sourceUrl: string; sourceKey: string; sourceRowNumber: number | null; sharedRecipients: string[] };
type Manifest = { schemaVersion: number; entitiesFile: string; programsFile: string; counts: { entities: number; programs: number; observations: number; gbiz: number; review: number; official: number }; sources: Record<Source, string>; files: Record<string, { sha256: string; bytes: number }> };
type Fact = { id: string; evidenceIds: string[]; amountStage: string; status: string; caseId: string | null; supersededBy: string | null };
type GraphNode = { id: string; label: string; observationIds: string[]; entityIds: string[]; tracking: string };
type Graph = { nodes: GraphNode[]; edges: { id: string; from: string; to: string; amount: null }[]; receipts: { url: string; filename: string }[] };
type Detail = { observations: Observation[]; candidates?: Observation[]; facts: Fact[]; graph?: Graph };
const stageLabels: Record<string, string> = { review_recipient_reported: 'レビュー支出先の掲載額', gbiz_procurement_reported: 'GビズINFO 調達掲載額', gbiz_subsidy_reported: 'GビズINFO 補助金掲載額', contract_reported: '契約金額', grant_decision_reported: '交付決定額', unclassified_reported: 'その他の掲載額' };
const sourceLabels: Record<Source, string> = { gbiz: 'GビズINFO', review: '行政事業レビュー', official: '機関公表資料' };
const normalize = (s: string) => s.normalize('NFKC').toLocaleLowerCase('ja-JP').replace(/[\s　]+/g, '');
const yen = (n: number | null) => n === null ? '金額の記載なし' : `${n.toLocaleString('ja-JP')}円`;
const count = (n: number) => n.toLocaleString('ja-JP');
const stateEvent = 'funding-explorer-navigation';
function subscribe(callback: () => void) { window.addEventListener('popstate', callback); window.addEventListener(stateEvent, callback); return () => { window.removeEventListener('popstate', callback); window.removeEventListener(stateEvent, callback); }; }
function snapshot() { return window.location.search; }
function href(values: Record<string, string>) { const params = new URLSearchParams({ view: 'explore', ...values }); return `?${params}`; }
function navigate(values: Record<string, string>) { window.history.pushState(null, '', href(values)); window.dispatchEvent(new Event(stateEvent)); }
const fileCache = new Map<string, Promise<unknown>>();
const emptyObservations: Observation[] = [];
async function verifiedJson<T>(filename: string, manifest: Manifest): Promise<T> {
  const receipt = manifest.files[filename];
  if (!receipt || !/^[a-zA-Z0-9-]+\.json$/.test(filename)) throw new Error('参照先を確認できません');
  const url = `data/explorer/${filename}`;
  if (!fileCache.has(url)) fileCache.set(url, (async () => {
    const response = await fetch(url, { cache: 'force-cache' });
    if (!response.ok) throw new Error('データを読み込めませんでした');
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength !== receipt.bytes) throw new Error('データの長さが一致しません');
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
    if (digest !== receipt.sha256) throw new Error('データの更新状態が一致しません。再読み込みしてください');
    return JSON.parse(new TextDecoder().decode(bytes));
  })().catch(error => { fileCache.delete(url); throw error; }));
  return fileCache.get(url) as Promise<T>;
}

export default function FundingExplorer() {
  const search = useSyncExternalStore(subscribe, snapshot, () => '');
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const entityId = params.get('company') || '';
  const programId = params.get('program') || '';
  const term = params.get('term') || '';
  const requestedMode = params.get('mode');
  const mode = requestedMode === 'program' || requestedMode === 'flow' ? requestedMode : programId ? 'program' : 'company';
  const focusEntity = params.get('focus') || '';
  const block = params.get('block') || '';
  const [draft, setDraft] = useState(term);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailKey, setDetailKey] = useState('');
  const [error, setError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [retry, setRetry] = useState(0);
  const [limit, setLimit] = useState(30);
  const [source, setSource] = useState('all');
  const [yearBasis, setYearBasis] = useState('all');
  const [year, setYear] = useState('all');
  const [amountKind, setAmountKind] = useState('all');
  const [focusOnly, setFocusOnly] = useState(false);
  const selectedKey = `${entityId}|${programId}`;
  const navigationKey = JSON.stringify([selectedKey, term, mode]);
  const [previousNavigation, setPreviousNavigation] = useState(navigationKey);
  if (previousNavigation !== navigationKey) {
    setPreviousNavigation(navigationKey);
    setDraft(term); setLimit(30); setSource('all'); setYearBasis('all');
    setYear('all'); setAmountKind('all'); setFocusOnly(false); setDetailError('');
  }
  useEffect(() => {
    let active = true;
    (async () => {
      const response = await fetch('data/explorer/manifest.json', { cache: 'no-store' });
      if (!response.ok) throw new Error('企業・事業の索引を読み込めませんでした');
      const m = await response.json() as Manifest;
      if (m.schemaVersion !== 2 || !m.files || !m.counts) throw new Error('索引の形式を確認できません');
      const [es, ps] = await Promise.all([verifiedJson<Entity[]>(m.entitiesFile, m), verifiedJson<Program[]>(m.programsFile, m)]);
      if (!Array.isArray(es) || !Array.isArray(ps) || es.length !== m.counts.entities || ps.length !== m.counts.programs) throw new Error('索引の件数が一致しません');
      if (active) { setError(''); setEntities(es); setPrograms(ps); setManifest(m); }
    })().catch(e => { if (active) setError(e instanceof Error ? e.message : '読み込みに失敗しました'); });
    return () => { active = false; };
  }, [retry]);
  const entitiesById = useMemo(() => new Map(entities.map(e => [e.id, e])), [entities]);
  const programsById = useMemo(() => new Map(programs.map(p => [p.id, p])), [programs]);
  const entity = entitiesById.get(entityId);
  const program = programsById.get(programId);
  useEffect(() => {
    let active = true;
    if (!manifest || (!entity && !program)) return;
    const selected = program || entity!;
    verifiedJson<Detail & { schemaVersion: number; program?: Program }>(selected.file, manifest).then(d => {
      if (d.schemaVersion !== 2 || !Array.isArray(d.observations) || (program && d.program?.id !== program.id)) throw new Error('明細の対応関係を確認できません');
      if (active) {
        const observations = program ? d.observations : d.observations.filter(o => o.entityId === entity!.id);
        if (observations.length !== (program ? program.coverage.rows : entity!.count)) throw new Error('明細件数が索引と一致しません');
        setDetailError(''); setDetail({ observations, candidates: d.candidates, facts: d.facts, graph: d.graph }); setDetailKey(selectedKey);
      }
    }).catch(e => { if (active) setDetailError(e instanceof Error ? e.message : '明細を取得できません'); });
    return () => { active = false; };
  }, [manifest, entity, program, selectedKey, retry]);
  const indexedEntities = useMemo(() => createEntitySearch(entities), [entities]);
  const companyMode = mode === 'company';
  const flowMode = mode === 'flow';
  const hits = useMemo(() => {
    const q = normalize(term); if (!q) return [];
    const terms = term.trim().split(/[\s　]+/).map(normalize);
    if (!companyMode) return programs.filter(p => (!flowMode || p.flowEdges > 0) && terms.every(t => normalize(`${p.name} ${p.projectNumber} ${p.organization}`).includes(t))).sort((a, b) => b.sheetYear - a.sheetYear || a.name.localeCompare(b.name, 'ja'));
    return searchEntities(indexedEntities, term) as Entity[];
  }, [term, companyMode, flowMode, programs, indexedEntities]);
  const currentDetail = detailKey === selectedKey ? detail : null;
  const observations = currentDetail?.observations ?? emptyObservations;
  const years = [...new Set(observations.map(o => yearBasis === 'sheet' ? o.sheetYear : o.dateYear).filter((y): y is number => y !== null))].sort((a, b) => b - a);
  const factsById = useMemo(() => new Map((currentDetail?.facts || []).map(f => [f.id, f])), [currentDetail]);
  const filtered = useMemo(() => (filterEvidence(observations, { source, yearBasis, year }) as Observation[]).filter(o => (!block || o.block === block) && (!focusOnly || o.entityId === focusEntity) && (amountKind === 'all' || factsById.get(o.factId)?.amountStage === amountKind)), [observations, source, yearBasis, year, block, focusOnly, focusEntity, amountKind, factsById]);
  const evidenceGroups = useMemo(() => groupEvidence(filtered) as Observation[][], [filtered]);
  const relatedPrograms = entity ? entity.programIds.map(id => programsById.get(id)).filter((p): p is Program => Boolean(p)) : [];
  const selected = Boolean(entityId || programId);
  function submit(event: React.FormEvent) { event.preventDefault(); navigate({ mode, term: draft.trim() }); }
  function link(event: React.MouseEvent<HTMLAnchorElement>, values: Record<string, string>) { if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return; event.preventDefault(); navigate(values); }
  function companyLink(id: string, name: string) { return <a href={href({ company: id })} onClick={e => link(e, { company: id })}>{name}</a>; }
  function programLink(p: Program) { const values = { program: p.id, ...(entityId ? { focus: entityId } : {}) }; return <a href={href(values)} onClick={e => link(e, values)}>{p.name}</a>; }
  function evidence(o: Observation) {
    const fact = factsById.get(o.factId);
    return <article className={`fx-evidence${focusEntity === o.entityId ? " fx-focused" : ""}`} key={o.id}>
      {focusEntity === o.entityId && <p className="fx-focus-label">選択した企業の掲載</p>}
      <div className="fx-evidence-heading"><span className={`fx-tag fx-${o.source}`}>{sourceLabels[o.source]}</span><span>{o.sheetYear !== null ? `${o.sheetYear}年度シート` : o.dateYear !== null ? `${o.dateYear}年度（${o.source === 'gbiz' ? '日付基準' : '公表資料の年度'}）` : '年度不明'}</span></div>
      <h3>{o.title}</h3>{o.theme && o.theme !== o.title && <p>{o.theme}</p>}
      {program && <p className="fx-recipient">支出先：{companyLink(o.entityId, o.organization)}</p>}
      <p className="fx-value">{yen(o.amount)}<span>{o.amountLabel}</span></p>
      {o.amount === null && o.amountRaw && <p>原文：{o.amountRaw}</p>}
      {o.amount === 0 && <p className="fx-context">原資料の0円表示です。最終的な受領額はこの行だけでは確定できません。</p>}
      {o.sharedRecipients.length > 1 && <p className="fx-context">共同受注・連名：{o.sharedRecipients.join(' ／ ')}。掲載額は各社の配分額ではありません。</p>}
      {o.route && o.route.length > 1 ? <p className="fx-route">{o.routeStatus.startsWith('legacy') ? '旧資料の経路記載（対応未確認）：' : '支出ブロックの経路：'}{o.route.join(' → ')}</p> : o.upstreamNames.length > 0 ? <p className="fx-route">資料に記載された上流：{o.upstreamNames.join(' ／ ')}</p> : <p className="fx-meta">資金経路の記載なし</p>}
      {o.source === 'review' && <p className="fx-meta">{o.flowLevel === 'disclosed_intermediary' ? '資料に下流の支出先の記載あり' : o.flowLevel === 'terminal_in_disclosed_graph' ? 'この資料で追える経路はここまで' : '経路上の役割は未確認'}{o.block ? ` ／ 支出ブロック ${o.block}` : ''}</p>}
      <div className="fx-evidence-footer"><span>{o.publisher ? `公表組織：${o.publisher}` : ''}{o.date ? ` ／ ${o.date}` : ''}</span><a href={o.sourceUrl} target="_blank" rel="noreferrer">根拠資料を開く ↗</a></div>
      {o.programId && !program && programsById.get(o.programId) && <p>関係事業：{programLink(programsById.get(o.programId)!)}</p>}
      <details className="fx-locator"><summary>掲載箇所</summary><p>{fact?.status === "reviewed_same_fact" ? `同じ事実として照合済み：根拠${fact.evidenceIds.length}行` : "掲載事実。別資料との同一案件照合は未確定"}{fact?.supersededBy ? " ／ 後続の変更記録あり" : ""}{fact?.caseId ? " ／ 案件の変更履歴を確認済み" : ""}</p><p>識別子：{o.sourceKey}{o.sourceRowNumber !== null ? ` ／ 取得CSV ${o.sourceRowNumber}行目` : ''}</p><p>同じタイトルや金額でも、別の案件・年度・段階の可能性があります。</p></details>
    </article>;
  }
  return <main className="funding-explorer" id="top">
    <header className="fx-header"><a href={href({})} onClick={e => link(e, {})}>経産省関連の事業費額<span>（非公式）</span></a><nav aria-label="資料別の検索"><a href="?view=source#records">資料別検索</a><a href="review/">レビュー詳細</a></nav></header>
    <section className="fx-search" aria-labelledby="fx-title"><h1 id="fx-title">企業と事業から、資金のつながりを調べる</h1>
      <form onSubmit={submit}><div className="fx-modes" role="group" aria-label="検索の入口"><button type="button" aria-pressed={mode === 'company'} onClick={() => navigate({ mode: 'company', term: draft })}>企業・団体から</button><button type="button" aria-pressed={mode === 'program'} onClick={() => navigate({ mode: 'program', term: draft })}>事業から</button><button type="button" aria-pressed={mode === 'flow'} onClick={() => navigate({ mode: 'flow', term: draft })}>資金経路から</button></div>
        <div className="fx-search-row"><label htmlFor="fx-query" className="sr-only">{mode === 'company' ? '企業・団体名または法人番号' : '事業名または予算事業ID'}</label><input id="fx-query" type="search" value={draft} onChange={e => setDraft(e.target.value)} maxLength={100} placeholder={mode === 'company' ? '企業・団体名、法人番号' : '事業名、予算事業ID、担当組織'} /><button type="submit">検索</button></div>
      </form><p className="fx-search-note">公表資料で確認できた関係を表示します。金額の種類と根拠は各明細で確認できます。</p>
    </section>
    <section className="fx-results" aria-live="polite" aria-busy={!manifest || Boolean(selected && !currentDetail && !detailError)}>
      {error && <div className="fx-error" role="alert"><p>{error}</p><button onClick={() => { setError(''); setDetailError(''); setRetry(retry + 1); }}>もう一度読み込む</button></div>}
      {!manifest && !error && <p>企業・事業の索引を読み込んでいます…</p>}
      {manifest && selected && !entity && !program && <p>この識別子に対応する企業・事業は、現在の収録データでは確認できません。検索し直してください。</p>}
      {manifest && !selected && !term && <div className="fx-start"><h2>知りたい企業や事業を選んでください</h2><div className="fx-examples"><button onClick={() => navigate({ mode: 'company', term: '日本電気' })}>日本電気</button><button onClick={() => navigate({ mode: 'program', term: 'GX' })}>GXの事業</button><button onClick={() => navigate({ mode: 'company', term: 'キャッシュレス推進協議会' })}>キャッシュレス推進協議会</button></div><p>企業の関係事業、事業の支出先、各明細の根拠を続けて確認できます。</p><p className="fx-meta">収録根拠：GビズINFO {count(manifest.counts.gbiz)}行 ／ レビュー {count(manifest.counts.review)}行 ／ 機関公表資料 {count(manifest.counts.official)}行</p></div>}
      {manifest && !selected && term && <><h2>「{term}」の検索結果 <small>{count(hits.length)}{mode !== 'company' ? '件（年度別シート）' : '件（法人・番号なしの記載）'}</small></h2>{!hits.length && <p>収録資料では確認できませんでした。表記を変えて検索できます。</p>}<div className="fx-hit-list">{hits.slice(0, limit).map(hit => 'corporateNumber' in hit ? <article key={hit.id}><h3>{companyLink(hit.id, hit.name)}</h3><p>{hit.corporateNumber ? `法人番号 ${hit.corporateNumber}` : '法人番号のない記載。この行単位で表示しています。'}</p><p>{hit.sources.map(s => sourceLabels[s]).join(' ／ ')} · {count(hit.count)}掲載行</p></article> : <article key={hit.id}><h3>{programLink(hit)}</h3><p>{hit.sheetYear}年度シート · 予算事業ID {hit.projectNumber}</p><p>{hit.organization} ／ 支出先 {count(hit.coverage.rows)}掲載行</p></article>)}</div>{hits.length > limit && <button className="fx-more" onClick={() => setLimit(limit + 30)}>さらに30件表示</button>}</>}
      {(entity || program) && <><button className="fx-back" onClick={() => navigate({ mode, term: term || (entity ? entity.name : program!.name) })}>検索結果へ</button><header className="fx-profile"><p className="fx-overline">{entity ? '企業・団体' : `${program!.sheetYear}年度の事業シート`}</p><h2>{entity?.name || program?.name}</h2><p>{entity ? entity.corporateNumber ? `法人番号 ${entity.corporateNumber}` : '法人番号のない記載のため、他の同名記載とはまとめていません。' : `予算事業ID ${program!.projectNumber} ／ ${program!.organization}`}</p>{entity && entity.aliases.length > 0 && <details><summary>同じ法人番号で掲載された名称</summary><p>{entity.aliases.join(' ／ ')}</p></details>}</header>
        {program && <><div className="fx-budget"><div><span>{program.budgetYear === null ? '年度不明' : `${program.budgetYear}年度`} 当初予算</span><strong>{yen(program.initialBudget)}</strong></div><div><span>{program.executionYear === null ? '年度不明' : `${program.executionYear}年度`} 執行額</span><strong>{yen(program.execution)}</strong></div><a href={program.sourceUrl} target="_blank" rel="noreferrer">事業の根拠資料 ↗</a></div><p className="fx-meta">事業全体の掲載額です。下記の支出先明細との対応・差額は未確認です。</p><div className="fx-coverage"><h3>この事業で確認できる範囲</h3><dl><div><dt>支出先の掲載</dt><dd>{count(program.coverage.rows)}行</dd></div><div><dt>金額の記載</dt><dd>{count(program.coverage.amountKnown)}行</dd></div><div><dt>経路の記載</dt><dd>{count(program.coverage.routeKnown)}行</dd></div></dl><p>支出先名・ブロック等の不足により支出先一覧にできない原資料行：{count(program.coverage.excludedRows)}行。下流の内訳が非公表か未取得かは未判定です。</p></div></>}
        {program && currentDetail?.graph && <section className="fx-graph" aria-labelledby="fx-graph-title"><h3 id="fx-graph-title">資料で追える資金経路</h3>
          <p>支出ブロック間の関係です。各ブロックを選ぶと、その中の支出先と掲載額を確認できます。</p>
          <div className="fx-blocks">{currentDetail.graph.nodes.map(n => <button key={n.id} disabled={n.id === 'government'} aria-pressed={block === n.id} onClick={() => { setLimit(30); navigate({ program: program.id, ...(focusEntity ? { focus: focusEntity } : {}), ...(block === n.id ? {} : { block: n.id }) }); }}><strong>{n.label}</strong>{n.id !== "government" && <span>{[...new Set(n.entityIds.map(id => entitiesById.get(id)?.name).filter(Boolean))].slice(0, 3).join(" ／ ")}{n.entityIds.length > 3 ? " ほか" : ""}</span>}<span>{n.id === 'government' ? '支出元' : `${count(n.observationIds.length)}掲載行`}</span>{n.id !== 'government' && <span>{n.tracking === 'downstream_disclosed' ? '先のブロックを確認' : n.tracking === 'end_of_disclosed_route' ? 'この資料の経路はここまで' : '上流の対応未確認'}</span>}</button>)}</div>
          {currentDetail.graph.edges.length > 0 ? <div className="fx-table-scroll"><table><thead><tr><th>支出元ブロック</th><th>支出先ブロック</th><th>確認できる関係</th></tr></thead><tbody>{currentDetail.graph.edges.map(e => <tr key={e.id}><td>{e.from === 'government' ? '経済産業省（担当組織）' : e.from}</td><td>{e.to}</td><td>ブロック間のつながり。個社間の送金額は未確定</td></tr>)}</tbody></table></div> : <p>この収録資料から復元できるブロック間の経路はありません。</p>}
          <details><summary>経路の根拠</summary>{currentDetail.graph.receipts.map(r => <p key={r.url}><a href={r.url} target="_blank" rel="noreferrer">{r.filename}</a></p>)}<p>末端ブロックは最終受益者とは限りません。ブロック間や掲載行を足し合わせた総額は算出していません。</p></details>
          {block && <button className="fx-more" onClick={() => navigate({ program: program.id, ...(focusEntity ? { focus: focusEntity } : {}) })}>全ブロックの支出先を表示</button>}
        </section>}
        {entity && <section className="fx-related"><h3>原資料で対応を確認できる事業</h3>{relatedPrograms.length ? <ul>{relatedPrograms.map(p => <li key={p.id}>{programLink(p)}<span>{p.sheetYear}年度シート · 支出先一覧へ</span></li>)}</ul> : <p>収録レビューシートの事業との対応は未確認です。掲載された事業・件名は下の明細で確認できます。</p>}</section>}
        {detailError && <div className="fx-error" role="alert"><p>{detailError}</p><button onClick={() => { setError(''); setDetailError(''); setRetry(retry + 1); }}>明細を再読み込み</button></div>}
        {!currentDetail && !detailError && <p>対応する明細を読み込んでいます…</p>}
        {currentDetail && <><div className="fx-detail-heading"><h3>{program ? 'この事業の支出先と根拠' : '掲載された事業・案件と根拠'}</h3><span>{count(filtered.length)}掲載行</span></div><div className="fx-filters">{focusEntity && <label className="fx-focus-toggle"><input type="checkbox" checked={focusOnly} onChange={e => setFocusOnly(e.target.checked)} />選択した企業だけ</label>}<label>金額の種類<select value={amountKind} onChange={e => { setAmountKind(e.target.value); setLimit(30); }}><option value="all">すべて</option>{Object.entries(stageLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>資料<select value={source} onChange={e => { setSource(e.target.value); setLimit(30); }}><option value="all">すべて</option>{Object.entries(sourceLabels).map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></label><label>年度の種類<select value={yearBasis} onChange={e => { setYearBasis(e.target.value); setYear('all'); setLimit(30); }}><option value="all">年度で絞らない</option><option value="sheet">レビューシート年度</option><option value="event">GビズINFOの日付年度</option><option value="published">機関公表資料の年度</option></select></label>{yearBasis !== 'all' && <label>年度<select value={year} onChange={e => { setYear(e.target.value); setLimit(30); }}><option value="all">すべて</option>{years.map(y => <option key={y} value={y}>{y}年度</option>)}{yearBasis !== 'sheet' && <option value="unknown">年度不明</option>}</select></label>}</div><p className="fx-meta">掲載行ごとに金額を表示します。レビューシート年度は、個別の支払年度とは異なります。</p>
          <div className="fx-evidence-list">{evidenceGroups.slice(0, limit).map(group => group.length === 1 ? evidence(group[0]) : <details className="fx-candidates" key={group[0].id}><summary><span>同名・同額の掲載 {group.length}行</span><strong>{group[0].title}</strong><span>{yen(group[0].amount)} · 各掲載行の金額</span></summary><p>再掲か別案件かは未確認です。原行を残しており、削除・合算していません。</p>{group.map(evidence)}</details>)}</div>{!filtered.length && <p>この条件に該当する掲載行はありません。</p>}{evidenceGroups.length > limit && <button className="fx-more" onClick={() => setLimit(limit + 30)}>さらに30件表示</button>}
          {program && Boolean(currentDetail.candidates?.length) && <details className="fx-program-candidates"><summary>事業名が一致する他資料の候補（{currentDetail.candidates!.length}行）</summary><p>名称の一致だけで抽出しています。この事業・年度との対応や同一案件であることは未確認です。上の支出先一覧には含めていません。</p>{currentDetail.candidates!.slice(0, limit).map(evidence)}{currentDetail.candidates!.length > limit && <button onClick={() => setLimit(limit + 30)}>候補をさらに表示</button>}</details>}
        </>}
      </>}
    </section>
    <footer className="fx-footer"><details><summary>収録範囲と金額の読み方</summary><p>経済産業省および関係機関の公表資料のうち、取得・検証済みの範囲を収録しています。所管法人の掲載情報すべてについて経産省由来の財源を確認したものではありません。</p><p>企業は法人番号で結び付けています。事業との確定対応はレビューシートの事業IDに基づきます。機関名・事業名・金額の一致から支払関係を推定しません。公開経路の終端は最終受益者を意味しません。</p><p>補助金額、契約・落札金額、レビュー支出先額は異なる定義です。支出階層や資料・年度を跨いだ合計は表示しません。0円・金額なし・年度不明を区別します。</p>{manifest && Object.entries(manifest.sources).map(([s, date]) => <p key={s}>{sourceLabels[s as Source]}：{date ? new Date(date).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' }) : '日時記録なし'}時点の収録データ</p>)}</details><a href="?view=source#sources">更新状況</a><a href="official/#reconciliation-records">照合の記録</a><a href="corrections/">訂正・確認</a></footer>
  </main>;
}
