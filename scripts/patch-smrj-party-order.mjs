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
  `function parseJapaneseEraDate(raw, fiscalYear) {
  const match = clean(raw).match(/^(\\d{1,2})\\.(\\d{1,2})\\.(\\d{1,2})$/u);
  if (!match) return null;
  const eraYear = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidates = [1988 + eraYear, 2018 + eraYear]
    .map((year) => ({ year, date: validDate(year, month, day) }))
    .filter((candidate) => candidate.date && fiscalYearForDate(candidate.year, month) === fiscalYear);
  return candidates.length === 1 ? candidates[0].date : null;
}`,
  `function parseJapaneseEraDate(raw, fiscalYear) {
  const match = clean(raw).match(/^(\\d{1,2})\\.(\\d{1,2})\\.(\\d{1,2})$/u);
  if (!match) return null;
  const eraYear = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidates = [1988 + eraYear, 2018 + eraYear]
    .map((year) => ({
      year,
      date: validDate(year, month, day),
      fiscalDistance: Math.abs(fiscalYearForDate(year, month) - fiscalYear),
    }))
    .filter((candidate) => candidate.date)
    .sort((left, right) => left.fiscalDistance - right.fiscalDistance || left.year - right.year);
  if (!candidates.length || candidates[0].fiscalDistance > 1) return null;
  if (candidates[1]?.fiscalDistance === candidates[0].fiscalDistance) return null;
  return candidates[0].date;
}

export function parseSmrjContractDate(raw, fiscalYear) {
  return parseJapaneseEraDate(raw, fiscalYear);
}`,
  "SMRJ fiscal-year-crossing date",
);
parser = replaceOnce(
  parser,
  `      let organization = sameLineName;
      if (!organization) {
        const names = [];
        for (let cursor = index - 1; cursor > previousBoundary && names.length < 3; cursor -= 1) {
          const candidate = values[cursor];
          if (looksLikeAddress(candidate) || /法人(?:番号|場号)/u.test(candidate)) break;
          names.unshift(candidate);
          if (ORGANIZATION_MARKER.test(candidate) || candidate.length > 8) break;
        }
        organization = clean(names.join(" "));
      }`,
  `      let organization = sameLineName;
      if (!organization) {
        const nextBoundary = corporateIndexes.find((candidateIndex) => candidateIndex > index) ?? values.length;
        const candidateIndexes = [];
        for (let cursor = previousBoundary + 1; cursor < nextBoundary; cursor += 1) {
          if (cursor === index) continue;
          const candidate = values[cursor];
          if (!candidate || looksLikeAddress(candidate) || /法人(?:番号|場号)/u.test(candidate)) continue;
          candidateIndexes.push(cursor);
        }
        candidateIndexes.sort((left, right) =>
          Math.abs(left - index) - Math.abs(right - index)
          || Number(ORGANIZATION_MARKER.test(values[right])) - Number(ORGANIZATION_MARKER.test(values[left]))
          || Number(left > index) - Number(right > index));
        const nearest = candidateIndexes[0];
        if (Number.isInteger(nearest)) {
          const direction = nearest < index ? -1 : 1;
          const names = [];
          for (
            let cursor = nearest;
            cursor > previousBoundary && cursor < nextBoundary && names.length < 3;
            cursor += direction
          ) {
            if (cursor === index) break;
            const candidate = values[cursor];
            if (!candidate || looksLikeAddress(candidate) || /法人(?:番号|場号)/u.test(candidate)) break;
            if (direction < 0) names.unshift(candidate);
            else names.push(candidate);
          }
          organization = clean(names.join(" "));
        }
      }`,
  "SMRJ party order",
);
parser = replaceOnce(
  parser,
  `  return result;
}

function headerStart(items, pattern) {`,
  `  return result;
}

export function parseSmrjPartyLines(lines) {
  return parseParties(lines);
}

function headerStart(items, pattern) {`,
  "SMRJ party test export",
);
parser = replaceOnce(
  parser,
  `  return deduplicated;
}

function inWindow(item, left, right) {`,
  `  return deduplicated.filter((anchor, index, anchors) => {
    const upper = index === 0
      ? (schema.headerY + anchor.y) / 2
      : (anchors[index - 1].y + anchor.y) / 2;
    const lower = index + 1 < anchors.length
      ? (anchor.y + anchors[index + 1].y) / 2
      : 0.015;
    const rowItems = page.items.filter((item) => item !== anchor.item && item.y <= upper && item.y > lower);
    const hasProgram = rowItems.some((item) =>
      item.x >= Math.max(0, schema.starts.program - 0.055)
      && item.x < schema.starts.officer - 0.01
      && clean(item.text));
    const hasDate = rowItems.some((item) =>
      item.x >= schema.starts.date - 0.03
      && item.x < schema.starts.organization - 0.015
      && /\\d{1,2}\\.\\d{1,2}\\.\\d{1,2}/u.test(item.text));
    const hasOrganization = rowItems.some((item) =>
      item.x >= schema.starts.organization - 0.035
      && item.x < schema.starts.reason - 0.015
      && clean(item.text));
    return hasProgram || (hasDate && hasOrganization);
  });
}

function inWindow(item, left, right) {`,
  "SMRJ isolated ordinal filtering",
);
parser = replaceOnce(
  parser,
  `      if (!program) throw new Error(\`中小機構本部: \${document.url} p\${page.pageNumber} \${anchor.ordinal}行目の件名が空です\`);`,
  `      if (!program) {
        const diagnostics = rowItems
          .map((item) => \`\${item.text}@\${item.x.toFixed(4)},\${item.y.toFixed(4)}\`)
          .join(" | ");
        throw new Error(\`中小機構本部: \${document.url} p\${page.pageNumber} \${anchor.ordinal}行目の件名が空です (anchor=\${anchor.x.toFixed(4)},\${anchor.y.toFixed(4)} program=\${schema.starts.program.toFixed(4)} officer=\${schema.starts.officer.toFixed(4)} items=\${diagnostics})\`);
      }`,
  "SMRJ empty program diagnostics",
);
await writeFile(parserPath, parser);

const testPath = "tests/smrj-official-supplement.test.mjs";
let tests = await readFile(testPath, "utf8");
tests = replaceOnce(
  tests,
  `  parseSmrjListingHtml,
  parseSmrjPositionedPages,`,
  `  parseSmrjContractDate,
  parseSmrjListingHtml,
  parseSmrjPartyLines,
  parseSmrjPositionedPages,`,
  "SMRJ regression imports",
);
if (tests.includes("address-number-name ordering")) throw new Error("SMRJ party regression test already exists");
tests = `${tests.trimEnd()}

test("SMRJ party parser accepts address-number-name ordering without losing the corporation", () => {
  assert.deepEqual(
    parseSmrjPartyLines([
      "東京都中央区銀座7-16-21",
      "(法人番号 5010001067883)",
      "(株)アイネット",
    ]),
    [{ organization: "株式会社アイネット", corporateNumber: "5010001067883" }],
  );
});

test("SMRJ contract date parser accepts a prior-fiscal-year original date only when the era is unambiguous", () => {
  assert.equal(parseSmrjContractDate("28.3.23", 2016), "2016-03-23");
  assert.equal(parseSmrjContractDate("8.4.10", 2026), "2026-04-10");
  assert.equal(parseSmrjContractDate("28.3.23", 2026), null);
});

test("SMRJ positioned parser ignores a standalone ordinal-like layout number with no row content", () => {
  const page = positionedPage();
  page.items.push(item("4", 0.015, 0.20, 0.01));
  const parsed = parseSmrjPositionedPages({
    url: "https://www.smrj.go.jp/procurement/bid/contract/example-layout-number.pdf",
    sourcePageUrl: SMRJ_HQ_CONTRACT_URL,
    fiscalYear: 2026,
    contractType: "competitive",
  }, [page]);
  assert.equal(parsed.totalRows, 3);
  assert.equal(parsed.records.length, 3);
});
`;
await writeFile(testPath, tests);

console.log("Patched SMRJ dates, party ordering, ordinal filtering, diagnostics, and regression tests.");
