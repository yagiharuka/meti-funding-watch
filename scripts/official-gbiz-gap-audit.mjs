import { readFile, readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export function normalizeProgramForGapAudit(value = "") {
  return String(value)
    .normalize("NFKC")
    .toLocaleLowerCase("ja-JP")
    .replace(/(?:20\d{2}|令和\d{1,2})年度/gu, "")
    .replace(/[\s　「」『』【】()（）・,，.。:：/／_\-]+/gu, "");
}

export function programsLookSameForGapAudit(left, right) {
  const a = normalizeProgramForGapAudit(left);
  const b = normalizeProgramForGapAudit(right);
  if (!a || !b) return false;
  if (a === b) return true;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  return shorter.length >= 12 && longer.includes(shorter) && shorter.length / longer.length >= 0.65;
}

function asGapSources(document, filename) {
  if (Array.isArray(document?.sources)) {
    return document.sources
      .filter((source) => source?.gbizAbsenceRequired === true)
      .map((source) => ({ ...source, filename }));
  }
  if (document?.gbizAbsenceRequired === true && document?.id) {
    return [{ ...document, filename }];
  }
  return [];
}

async function loadGapSources(dataDirectory) {
  const filenames = (await readdir(dataDirectory))
    .filter((name) => /^official-supplement-.*\.json$/u.test(name) && name !== "official-supplement-index.json")
    .sort();
  const sources = [];
  for (const filename of filenames) {
    const document = JSON.parse(await readFile(`${dataDirectory}/${filename}`, "utf8"));
    sources.push(...asGapSources(document, filename));
  }
  return sources;
}

export async function auditOfficialGbizAbsence({ dataDirectory = "data", pagesDirectory = "data/pages" } = {}) {
  const sources = await loadGapSources(dataDirectory);
  if (!sources.length) throw new Error("GビズINFO欠落を収録条件にする公式補足ソースがありません");

  const targets = [];
  const structuralViolations = [];
  for (const source of sources) {
    if (!Array.isArray(source.records) || !source.records.length) {
      structuralViolations.push(`${source.id}: 欠落検証対象レコードが0件です`);
      continue;
    }
    for (const row of source.records) {
      if (!/^\d{13}$/u.test(row?.corporateNumber ?? "")) {
        structuralViolations.push(`${source.id}/${row?.id ?? "unknown"}: 法人番号がないためGビズINFO欠落を検証できません`);
        continue;
      }
      if (!Number.isInteger(row?.fiscalYear)) {
        structuralViolations.push(`${source.id}/${row?.id ?? "unknown"}: 年度がないためGビズINFO欠落を検証できません`);
        continue;
      }
      if (!normalizeProgramForGapAudit(row?.program)) {
        structuralViolations.push(`${source.id}/${row?.id ?? "unknown"}: 件名がないためGビズINFO欠落を検証できません`);
        continue;
      }
      targets.push({ sourceId: source.id, sourceFile: source.filename, ...row });
    }
  }

  const manifest = JSON.parse(await readFile(`${pagesDirectory}/manifest.json`, "utf8"));
  if (!manifest?.commitments || typeof manifest.commitments !== "object") {
    throw new Error("GビズINFO公開manifestが不正です");
  }

  const corporateNumbers = new Set(targets.map((row) => row.corporateNumber));
  const requiredKeys = new Set(["unclassified", ...targets.map((row) => String(row.fiscalYear))]);
  const gbizByCorporateNumber = new Map();
  for (const key of requiredKeys) {
    const filename = manifest.commitments[key];
    if (!filename) {
      structuralViolations.push(`GビズINFO ${key}: 対応する公開ファイルがありません`);
      continue;
    }
    const rows = JSON.parse(await readFile(`${pagesDirectory}/${filename}`, "utf8"));
    for (const row of rows) {
      if (!corporateNumbers.has(row.corporateNumber)) continue;
      const bucket = gbizByCorporateNumber.get(row.corporateNumber) ?? [];
      bucket.push(row);
      gbizByCorporateNumber.set(row.corporateNumber, bucket);
    }
  }

  const overlaps = [];
  for (const target of targets) {
    const candidates = gbizByCorporateNumber.get(target.corporateNumber) ?? [];
    for (const row of candidates) {
      if (row.fiscalYear !== null && row.fiscalYear !== target.fiscalYear) continue;
      if (!programsLookSameForGapAudit(target.program, row.program)) continue;
      overlaps.push({
        sourceId: target.sourceId,
        officialId: target.id,
        corporateNumber: target.corporateNumber,
        fiscalYear: target.fiscalYear,
        officialProgram: target.program,
        gbizProgram: row.program,
        gbizId: row.id,
        gbizFiscalYear: row.fiscalYear,
      });
    }
  }

  return {
    sourceIds: sources.map((source) => source.id).sort(),
    declaredRecordCount: sources.reduce((sum, source) => sum + (Array.isArray(source.records) ? source.records.length : 0), 0),
    verifiedRecordCount: targets.length,
    structuralViolations,
    overlaps,
  };
}

export async function assertOfficialGbizAbsence(options = {}) {
  const result = await auditOfficialGbizAbsence(options);
  const failures = [
    ...result.structuralViolations,
    ...result.overlaps.map((row) => `${row.sourceId}/${row.officialId}: GビズINFO側に同一案件候補 ${row.gbizId} (${row.gbizFiscalYear ?? "年度不明"}) があります`),
  ];
  if (failures.length) {
    throw new Error(`公式補足のGビズINFO欠落検証に失敗しました:\n${failures.slice(0, 20).join("\n")}${failures.length > 20 ? `\n...ほか${failures.length - 20}件` : ""}`);
  }
  return result;
}

async function main() {
  const result = await assertOfficialGbizAbsence();
  console.log(`Official/Gbiz gap audit: ${result.sourceIds.join(",")} / ${result.verifiedRecordCount} records verified absent`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
