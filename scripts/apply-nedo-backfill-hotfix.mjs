import { readFile, writeFile } from "node:fs/promises";

const path = "scripts/nedo-public-results.mjs";
let source = await readFile(path, "utf8");
const original = source;

source = source.replace(
  '    const rowText = text(row[1]);\n    if (!rowText.includes("決定")) continue;\n    const anchors = [...row[1].matchAll(/<a\\b[^>]*href=["\']([^"\']+)["\'][^>]*>([\\s\\S]*?)<\\/a>/gi)];',
  '    const rowText = text(row[1]);\n    const cells = [...row[1].matchAll(/<td\\b[^>]*>([\\s\\S]*?)<\\/td>/gi)].map((match) => compact(match[1]));\n    if (!cells.includes("決定")) continue;\n    const anchors = [...row[1].matchAll(/<a\\b[^>]*href=["\']([^"\']+)["\'][^>]*>([\\s\\S]*?)<\\/a>/gi)];',
);

source = source.replace(
  '    const rowText = text(row[1]);\n    const cells = [...row[1].matchAll(/<td\\b[^>]*>([\\s\\S]*?)<\\/td>/gi)].map((match) => compact(match[1]));\n    if (!cells.includes("決定")) continue;\n    const anchors = [...row[1].matchAll(/<a\\b[^>]*href=["\']([^"\']+)["\'][^>]*>([\\s\\S]*?)<\\/a>/gi)];',
  '    const anchors = [...row[1].matchAll(/<a\\b[^>]*href=["\']([^"\']+)["\'][^>]*>([\\s\\S]*?)<\\/a>/gi)];\n    if (anchors.length < 2) continue;',
);

source = source.replace(
  '  if (!value || value.length < 3 || value.length > 100) return false;\n  if (value.includes(NEDO_NAME)',
  '  if (!value || value.length < 3 || value.length > 100) return false;\n  if (PREFIX_FORMS.includes(value) || SUFFIX_FORMS.includes(value)) return false;\n  if (value.includes(NEDO_NAME)',
);

source = source.replace(
  'const PARTICIPANT_ATTACHMENT_PATTERN = /(実施予定先|実施先一覧|実施者一覧|委託予定先|委託先予定|委託先一覧|助成予定先|助成先一覧|助成金交付予定先|交付予定先|交付決定事業者|交付決定先|採択事業者|採択者一覧|採択先一覧|採択テーマ一覧|採択案件一覧|採択結果|実施体制)/u;',
  'const PARTICIPANT_ATTACHMENT_PATTERN = /(実施予定先|実施先一覧|実施者一覧|委託予定先|委託先予定|委託先一覧|助成予定先|助成先一覧|助成金交付予定先|交付予定先|交付決定事業者|交付決定先|採択事業者|採択者一覧|採択先一覧|採択テーマ一覧|採択案件一覧|採択結果|認定VC|実施体制)/u;',
);

source = source.replace(
  'const NO_SELECTION_PATTERN = /(採択候補(?:は)?なし|採択者(?:は)?なし|実施予定先(?:は)?なし|提案が\\s*0\\s*件|応募が\\s*0\\s*件|応募なし|採択に至りませんでした)/u;',
  'const NO_SELECTION_PATTERN = /(採択候補(?:は)?なし|採択者(?:は)?なし|実施予定先(?:は)?なし|提案が\\s*0\\s*件|応募が\\s*0\\s*件|応募(?:が)?ありませんでした|応募なし|採択に至りませんでした)/u;',
);

source = source.replace(
  'const ENGLISH_FORM_PATTERN = /\\b(?:Inc\\.?|Incorporated|Corp\\.?|Corporation|Co\\.?\\s*,?\\s*Ltd\\.?|Ltd\\.?|LLC|L\\.L\\.C\\.|GmbH|S\\.A\\.|B\\.V\\.)$/iu;',
  'const ENGLISH_FORM_PATTERN = /\\b(?:Inc\\.?|Incorporated|Corp\\.?|Corporation|Co\\.?\\s*,?\\s*Ltd\\.?|Ltd\\.?|LLC|L\\.L\\.C\\.|GmbH|S\\.A\\.|B\\.V\\.|AS(?:A)?(?:,\\s*Japan Branch)?|Japan Branch)$/iu;',
);

if (source === original) {
  console.log("NEDO parser hotfix already applied.");
} else {
  await writeFile(path, source);
  console.log("Applied NEDO parser hotfix.");
}
