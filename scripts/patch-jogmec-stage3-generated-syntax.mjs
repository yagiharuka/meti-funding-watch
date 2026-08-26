import { readFile, writeFile } from "node:fs/promises";

// Stage three is generated through String.raw, so its escaped nested template literal
// must be converted before Node parses the generated stage-one module.
const path = "scripts/jogmec-reingest-stage1-20260826.mjs";
const before = await readFile(path, "utf8");
const invalid = "      parsed.record.parseMethod = \\\`pdf_positioned_\\${anchorType}\\\`;";
const valid = '      parsed.record.parseMethod = "pdf_positioned_" + anchorType;';
const matches = before.split(invalid).length - 1;
if (matches === 1) {
  await writeFile(path, before.replace(invalid, valid));
  console.log("Repaired generated JOGMEC positioned-parser parseMethod syntax.");
} else if (matches === 0 && before.includes(valid)) {
  console.log("Generated JOGMEC positioned-parser syntax was already repaired.");
} else {
  throw new Error(`JOGMEC generated parseMethod syntax: expected one invalid or one repaired line, got invalid=${matches}`);
}
