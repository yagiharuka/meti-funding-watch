import { readFile, writeFile } from "node:fs/promises";

const path = "scripts/nedo-public-results.mjs";
let source = await readFile(path, "utf8");

function replaceRequired(oldText, newText, label) {
  if (!source.includes(oldText)) throw new Error(`NEDO direct HTML hotfix target not found: ${label}`);
  source = source.replace(oldText, newText);
}

replaceRequired(
  '/<(?:td|th|li|p|dd|dt|div|span|strong|a)\\b[^>]*>([\\s\\S]*?)<\\/(?:td|th|li|p|dd|dt|div|span|strong|a)>/gi',
  '/<(?:td|th|li|p|dd|dt)\\b[^>]*>([\\s\\S]*?)<\\/(?:td|th|li|p|dd|dt)>/gi',
  "avoid outer container matches swallowing participant cells",
);

replaceRequired(
`  if (!directOrganizations.length && selectedCount === 1) {
    const wholePageOrganizations = extractOrganizations(extractCellStringsFromHtml(html));
    if (wholePageOrganizations.length === 1) directOrganizations = wholePageOrganizations;
  }`,
`  if (!directOrganizations.length) {
    const wholePageOrganizations = extractOrganizations(extractCellStringsFromHtml(html));
    if (selectedCount === 1 && wholePageOrganizations.length === 1) {
      directOrganizations = wholePageOrganizations;
    } else if (sectionStrings.length && wholePageOrganizations.length) {
      directOrganizations = wholePageOrganizations;
    }
  }`,
  "fallback for direct participant tables and paragraphs",
);

await writeFile(path, source);
