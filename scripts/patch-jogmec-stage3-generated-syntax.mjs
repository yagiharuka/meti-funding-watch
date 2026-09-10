import { readFile, writeFile } from "node:fs/promises";

// Stage three is generated through String.raw. Repair the generated module before
// Node parses it, and keep ordinal row labels out of the first semantic column.
const path = "scripts/jogmec-reingest-stage1-20260826.mjs";
const before = await readFile(path, "utf8");
let after = before;

const invalidParseMethod = "      parsed.record.parseMethod = \\\`pdf_positioned_\\${anchorType}\\\`;";
const validParseMethod = '      parsed.record.parseMethod = "pdf_positioned_" + anchorType;';
const invalidParseMethodCount = after.split(invalidParseMethod).length - 1;
if (invalidParseMethodCount === 1) {
  after = after.replace(invalidParseMethod, validParseMethod);
} else if (!(invalidParseMethodCount === 0 && after.includes(validParseMethod))) {
  throw new Error(`JOGMEC generated parseMethod syntax: expected one invalid or one repaired line, got invalid=${invalidParseMethodCount}`);
}

const unfilteredRowItems = "    const rowItems = page.items.filter((item) => item.y <= upper && item.y > lower);";
const filteredRowItems = `    const rowItems = page.items.filter((item) =>
      item.y <= upper
      && item.y > lower
      && !(anchorType === "ordinal" && item === anchor.item));`;
const unfilteredRowCount = after.split(unfilteredRowItems).length - 1;
if (unfilteredRowCount === 1) {
  after = after.replace(unfilteredRowItems, filteredRowItems);
} else if (!(unfilteredRowCount === 0 && after.includes(filteredRowItems))) {
  throw new Error(`JOGMEC generated ordinal-anchor filter: expected one unfiltered or one repaired block, got unfiltered=${unfilteredRowCount}`);
}

if (after !== before) {
  await writeFile(path, after);
  console.log("Repaired generated JOGMEC positioned-parser syntax and ordinal anchors.");
} else {
  console.log("Generated JOGMEC positioned-parser repairs were already applied.");
}
