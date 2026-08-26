import { readFile, writeFile } from "node:fs/promises";

function replaceOnce(source, search, replacement, label) {
  const index = source.indexOf(search);
  if (index < 0) throw new Error(`${label}: replacement target not found`);
  if (source.indexOf(search, index + search.length) >= 0) throw new Error(`${label}: replacement target is not unique`);
  return `${source.slice(0, index)}${replacement}${source.slice(index + search.length)}`;
}

const parserPath = "scripts/smrj-official-supplement.mjs";
let parser = await readFile(parserPath, "utf8");
parser = replaceOnce(
  parser,
  `      const rawDate = dateText.match(/\\d{1,2}\\.\\d{1,2}\\.\\d{1,2}/u)?.[0] ?? "";
      const date = parseJapaneseEraDate(rawDate, document.fiscalYear);
      if (!date) throw new Error(\`中小機構本部: \${document.url} p\${page.pageNumber} \${anchor.ordinal}行目の契約日が不正です (\${dateText})\`);`,
  `      const rawDate = dateText.match(/\\d{1,2}\\.\\d{1,2}\\.\\d{1,2}/u)?.[0] ?? "";
      const date = rawDate ? parseJapaneseEraDate(rawDate, document.fiscalYear) : null;
      if (rawDate && !date) throw new Error(\`中小機構本部: \${document.url} p\${page.pageNumber} \${anchor.ordinal}行目の契約日が不正です (\${dateText})\`);`,
  "SMRJ missing contract date",
);
await writeFile(parserPath, parser);

const testPath = "tests/smrj-official-supplement.test.mjs";
let tests = await readFile(testPath, "utf8");
if (tests.includes("missing contract-date cell")) throw new Error("SMRJ missing date regression test already exists");
tests = `${tests.trimEnd()}

test("SMRJ positioned parser preserves a missing contract-date cell as null", () => {
  const page = positionedPage();
  page.items = page.items.filter((value) => value.text !== "8.4.10");
  page.items.push(item("随意契約（特命随契）", 0.38, 0.72, 0.08));
  const parsed = parseSmrjPositionedPages({
    url: "https://www.smrj.go.jp/procurement/bid/contract/example-missing-date.pdf",
    sourcePageUrl: SMRJ_HQ_CONTRACT_URL,
    fiscalYear: 2026,
    contractType: "discretionary",
  }, [page]);
  const row = parsed.records.find((value) => value.sourceRowNumber === 1);
  assert.ok(row);
  assert.equal(row.date, null);
});
`;
await writeFile(testPath, tests);

console.log("Patched SMRJ missing contract dates and added the regression test.");
