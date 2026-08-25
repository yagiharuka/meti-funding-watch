import { readFile, writeFile } from "node:fs/promises";

const path = "scripts/smrj-official-supplement.mjs";
let source = await readFile(path, "utf8");

const lastImport = 'import { promisify } from "node:util";';
if (!source.includes(lastImport)) throw new Error("import insertion point not found");
source = source.replace(lastImport, `${lastImport}\nimport * as smrjLegacyParser from "./smrj-layout-parser-legacy.mjs";`);

const insertionPoint = "async function processDocument(document, fetchImpl = fetch) {";
if (!source.includes(insertionPoint)) throw new Error("legacy fallback insertion point not found");
const helper = String.raw`
function normalizeLegacyParseResult(value, document) {
  if (!value) return null;
  const records = Array.isArray(value) ? value : Array.isArray(value.records) ? value.records : Array.isArray(value.rows) ? value.rows : null;
  if (!records) return null;
  const normalized = records.map((row, index) => {
    const amount = row.amount ?? row.contractAmount ?? row.contractPrice ?? null;
    const organization = row.organization ?? row.contractor ?? row.partner ?? "";
    const program = row.program ?? row.subject ?? row.contractName ?? row.title ?? "";
    const date = row.date ?? row.contractDate ?? null;
    if (!organization || !program || !date) throw new Error(\`legacy parser row is incomplete at \${index + 1}\`);
    if (fiscalYearFromIsoDate(date) !== document.fiscalYear) throw new Error(\`legacy parser date is outside fiscal year: \${date}\`);
    const id = row.id ?? stableId(document, row.ordinal ?? null, index);
    return {
      id,
      organization,
      corporateNumber: row.corporateNumber ?? "",
      fiscalYear: document.fiscalYear,
      date,
      program,
      theme: document.kind === "competitive" ? "競争入札" : "随意契約",
      phase: "",
      supportYears: \`\${document.fiscalYear}年度\`,
      category: "contract_result",
      amountStage: "契約金額",
      amount,
      sourceUrl: document.url,
      sourcePageUrl: document.sourcePageUrl,
      sourceKey: row.sourceKey ?? id,
    };
  });
  const amountUnavailableCount = normalized.filter((row) => row.amount === null).length;
  const published = normalized.filter((row) => row.amount !== null);
  const printedRowCount = Number.isInteger(value.printedRowCount) ? value.printedRowCount : normalized.length;
  if (published.length + amountUnavailableCount !== normalized.length) throw new Error("legacy row accounting mismatch");
  if (printedRowCount < normalized.length) throw new Error("legacy printed row count is too small");
  return {
    records: published,
    printedRowCount,
    amountUnavailableCount: Number.isInteger(value.amountUnavailableCount) ? value.amountUnavailableCount : amountUnavailableCount,
    noResult: value.noResult === true,
    pageCount: Number.isInteger(value.pageCount) ? value.pageCount : 1,
  };
}

function tryLegacySmrjParsers(layoutText, document) {
  const candidates = Object.entries(smrjLegacyParser)
    .filter(([name, value]) => typeof value === "function" && /parse/i.test(name) && /(layout|contract|pdf|text|position)/i.test(name));
  const failures = [];
  for (const [name, parser] of candidates) {
    try {
      const parsed = normalizeLegacyParseResult(parser(layoutText, document), document);
      if (parsed && (parsed.records.length || parsed.noResult || parsed.printedRowCount === 0)) return { parsed, name };
    } catch (error) {
      failures.push(\`\${name}: \${error instanceof Error ? error.message : String(error)}\`);
    }
  }
  if (failures.length) throw new Error(failures.join("; "));
  return null;
}

`;
source = source.replace(insertionPoint, `${helper}\n${insertionPoint}`);

const old = String.raw`  let parsed;
  let parseMethod;
  let layoutError = null;
  try {
    parsed = parseSmrjLayoutText(await pdfToLayoutText(bytes), document);
    parseMethod = "pdftotext-layout-v7";
  } catch (error) {
    layoutError = error instanceof Error ? error.message : String(error);
    try {
      parsed = parseSmrjTsvText(await pdfToTsv(bytes), document);
      parseMethod = "pdftotext-tsv-v8";
    } catch (tsvError) {
      throw new Error(\`layout parser: \${layoutError}; TSV parser: \${tsvError instanceof Error ? tsvError.message : String(tsvError)}\`);
    }
  }`;
const replacement = String.raw`  let parsed;
  let parseMethod;
  const layoutText = await pdfToLayoutText(bytes);
  let legacyError = null;
  let layoutError = null;
  try {
    const legacy = tryLegacySmrjParsers(layoutText, document);
    if (!legacy) throw new Error("no compatible exported legacy parser");
    parsed = legacy.parsed;
    parseMethod = \`legacy-\${legacy.name}\`;
  } catch (error) {
    legacyError = error instanceof Error ? error.message : String(error);
    try {
      parsed = parseSmrjLayoutText(layoutText, document);
      parseMethod = "pdftotext-layout-v7";
    } catch (layoutFailure) {
      layoutError = layoutFailure instanceof Error ? layoutFailure.message : String(layoutFailure);
      try {
        parsed = parseSmrjTsvText(await pdfToTsv(bytes), document);
        parseMethod = "pdftotext-tsv-v8";
      } catch (tsvError) {
        throw new Error(\`legacy parser: \${legacyError}; layout parser: \${layoutError}; TSV parser: \${tsvError instanceof Error ? tsvError.message : String(tsvError)}\`);
      }
    }
  }`;
if (!source.includes(old)) throw new Error("processDocument parser chain was not found");
source = source.replace(old, replacement);
source = source.replace(
  '      layoutFallbackReason: parseMethod === "pdftotext-tsv-v8" ? layoutError : null,',
  '      layoutFallbackReason: parseMethod === "pdftotext-tsv-v8" ? `legacy=${legacyError}; layout=${layoutError}` : null,',
);

await writeFile(path, source);
console.log("Applied validated legacy SMRJ parser fallback.");
