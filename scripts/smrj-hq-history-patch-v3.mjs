import { readFile, writeFile } from "node:fs/promises";

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after === before) throw new Error(`${path}: no changes were produced`);
  await writeFile(path, after);
}

function replaceRequired(source, search, replacement, label) {
  const matches = typeof search === "string" ? source.split(search).length - 1 : [...source.matchAll(new RegExp(search.source, search.flags.includes("g") ? search.flags : `${search.flags}g`))].length;
  if (matches < 1) throw new Error(`${label}: replacement target was not found`);
  return source.replace(search, replacement);
}

function replaceTestBlock(source, titleFragment, transform) {
  const start = source.indexOf(`test("${titleFragment}`);
  if (start < 0) throw new Error(`test block not found: ${titleFragment}`);
  const next = source.indexOf("\ntest(", start + 6);
  const end = next < 0 ? source.length : next;
  const block = source.slice(start, end);
  const updated = transform(block);
  if (updated === block) throw new Error(`test block unchanged: ${titleFragment}`);
  return `${source.slice(0, start)}${updated}${source.slice(end)}`;
}

await update("scripts/smrj-official-supplement.mjs", (source) => replaceRequired(
  source,
  '    const raw = normalizeText(lines[index]);',
  '    const raw = String(lines[index]).normalize("NFKC");',
  "preserve pdftotext column positions",
));

await update("scripts/build-official-supplement-index.mjs", (source) => {
  let next = replaceRequired(source, /const MIN_FISCAL_YEAR\s*=\s*2021;/u, "const MIN_FISCAL_YEAR = 2015;", "official supplement minimum year");
  next = replaceRequired(
    next,
    "2021年度以降を基本対象とする",
    "中小企業基盤整備機構本部は2015年度以降、その他の機関は2021年度以降を基本対象とする",
    "official supplement scope note",
  );
  return next;
});

await update("scripts/build-official-company-index.mjs", (source) => {
  let next = replaceRequired(source, /const MIN_FISCAL_YEAR\s*=\s*2017;/u, "const MIN_FISCAL_YEAR = 2015;", "official company minimum year");
  next = replaceRequired(
    next,
    "2017年度以降を対象方針とし",
    "中小企業基盤整備機構本部は2015年度以降、その他の機関は2017年度以降を対象方針とし",
    "official company scope note",
  );
  return next;
});

await update("tests/company-evidence-ui.test.mjs", (source) => replaceTestBlock(
  source,
  "official company index uses central bodies only with a FY2017 target floor",
  (block) => block
    .replace("official company index uses central bodies only with a FY2017 target floor", "official company index uses central bodies only with source-declared floors from FY2015")
    .replaceAll("2017", "2015")
    .replaceAll("2015年度以降を対象方針", "中小企業基盤整備機構本部は2015年度以降"),
));

await update("tests/official-supplement.test.mjs", (source) => {
  let next = source.replaceAll("row.fiscalYear >= 2021", "row.fiscalYear >= 2015");
  next = next.replaceAll("2021年度以降を基本対象とする", "中小企業基盤整備機構本部は2015年度以降、その他の機関は2021年度以降を基本対象とする");
  if (next === source) {
    next = `${source}\n\ntest("SMRJ HQ history can extend the official supplement floor to FY2015", async () => {\n  const index = await readJson("data/official-supplement-index.json");\n  const rows = index.records.filter((row) => row.sourceId === "smrj");\n  assert.ok(rows.some((row) => row.fiscalYear === 2015));\n  assert.ok(rows.every((row) => row.fiscalYear >= 2015));\n  assert.match(index.scopeNote, /中小企業基盤整備機構本部は2015年度以降/);\n});\n`;
  }
  return next;
});

console.log("Applied SMRJ HQ history compatibility patches.");
