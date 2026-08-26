import { readFile, writeFile } from "node:fs/promises";

// Stage three is generated through String.raw, so its escaped nested template literal
// must be converted before Node parses the generated stage-one module.
const path = "scripts/jogmec-reingest-stage1-20260826.mjs";
const before = await readFile(path, "utf8");
const invalid = "      parsed.record.parseMethod = \\\`pdf_positioned_\\${anchorType}\\\`;";
const valid = '      parsed.record.parseMethod = "pdf_positioned_" + anchorType;';
const matches = before.split(invalid).length - 1;
if (matches !== 1) {
  throw new Error(`JOGMEC generated parseMethod syntax: expected one invalid line, got ${matches}`);
}
const after = before.replace(invalid, valid);
await writeFile(path, after);
console.log("Repaired generated JOGMEC positioned-parser parseMethod syntax.");
