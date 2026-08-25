import { readFile, writeFile } from "node:fs/promises";

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(path, after);
}

await update("scripts/build-official-supplement-index.mjs", (source) => {
  let next = source.replace(/const MIN_FISCAL_YEAR\s*=\s*2021;/u, "const MIN_FISCAL_YEAR = 2015;");
  if (!next.includes("中小企業基盤整備機構本部は2015年度以降")) {
    next = next.replace(
      "2021年度以降を基本対象とする",
      "中小企業基盤整備機構本部は2015年度以降、その他の機関は2021年度以降を基本対象とする",
    );
  }
  return next;
});

await update("scripts/build-official-company-index.mjs", (source) => {
  let next = source.replace(/const MIN_FISCAL_YEAR\s*=\s*2017;/u, "const MIN_FISCAL_YEAR = 2015;");
  if (!next.includes("中小企業基盤整備機構本部は2015年度以降")) {
    next = next.replace(
      "2017年度以降を対象方針とし",
      "中小企業基盤整備機構本部は2015年度以降、その他の機関は2017年度以降を対象方針とし",
    );
  }
  return next;
});

await update("tests/company-evidence-ui.test.mjs", (source) => {
  let next = source
    .replace("official company index uses central bodies only with a FY2017 target floor", "official company index uses central bodies only with source-declared floors from FY2015")
    .replace(/assert\.equal\(index\.minFiscalYear,\s*2017\)/gu, "assert.equal(index.minFiscalYear, 2015)")
    .replace(/assert\.ok\(row\.fiscalYear >= 2017/gu, "assert.ok(row.fiscalYear >= 2015");
  if (!next.includes("中小企業基盤整備機構本部は2015年度以降")) {
    next = next.replace(/assert\.match\(index\.scopeNote, \/2017年度以降[^\n]+/u, 'assert.match(index.scopeNote, /中小企業基盤整備機構本部は2015年度以降/);');
  }
  return next;
});

await update("tests/official-supplement.test.mjs", (source) => {
  let next = source.replaceAll("row.fiscalYear >= 2021", "row.fiscalYear >= 2015");
  if (!next.includes("SMRJ HQ history extends the official supplement floor to FY2015")) {
    next += `\n\ntest("SMRJ HQ history extends the official supplement floor to FY2015", async () => {\n  const index = await readJson("data/official-supplement-index.json");\n  const rows = index.records.filter((row) => row.sourceId === "smrj");\n  assert.ok(rows.length >= 50);\n  assert.ok(rows.some((row) => row.fiscalYear === 2015));\n  assert.ok(rows.every((row) => row.fiscalYear >= 2015));\n  assert.match(index.scopeNote, /中小企業基盤整備機構本部は2015年度以降/);\n});\n`;
  }
  return next;
});

console.log("SMRJ HQ FY2015 index compatibility is ready.");
