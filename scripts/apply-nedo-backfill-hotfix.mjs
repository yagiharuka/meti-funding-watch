import { readFile, writeFile } from "node:fs/promises";

const path = "scripts/nedo-public-results.mjs";
let source = await readFile(path, "utf8");
const original = source;

source = source.replace(
  '    const rowText = text(row[1]);\n    if (!rowText.includes("決定")) continue;\n    const anchors = [...row[1].matchAll(/<a\\b[^>]*href=["\']([^"\']+)["\'][^>]*>([\\s\\S]*?)<\\/a>/gi)];',
  '    const rowText = text(row[1]);\n    const cells = [...row[1].matchAll(/<td\\b[^>]*>([\\s\\S]*?)<\\/td>/gi)].map((match) => compact(match[1]));\n    if (!cells.includes("決定")) continue;\n    const anchors = [...row[1].matchAll(/<a\\b[^>]*href=["\']([^"\']+)["\'][^>]*>([\\s\\S]*?)<\\/a>/gi)];',
);

source = source.replace(
  '  if (!value || value.length < 3 || value.length > 100) return false;\n  if (value.includes(NEDO_NAME)',
  '  if (!value || value.length < 3 || value.length > 100) return false;\n  if (PREFIX_FORMS.includes(value) || SUFFIX_FORMS.includes(value)) return false;\n  if (value.includes(NEDO_NAME)',
);

if (source === original) {
  console.log("NEDO parser hotfix already applied.");
} else {
  await writeFile(path, source);
  console.log("Applied NEDO parser hotfix.");
}
