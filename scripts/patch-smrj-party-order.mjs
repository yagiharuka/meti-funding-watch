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
  `  parseSmrjListingHtml,
  parseSmrjPartyLines,
  parseSmrjPositionedPages,`,
  "SMRJ party test import",
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
`;
await writeFile(testPath, tests);

console.log("Patched SMRJ party ordering, diagnostics, and the regression test.");
