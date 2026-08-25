import { readFile, writeFile } from "node:fs/promises";

const path = "scripts/smrj-official-supplement.mjs";
let source = await readFile(path, "utf8");

const replacements = [
  [
    '      if (!isHeadquartersContext(anchor.context)) continue;',
    '      if (REGION_PATTERN.test(`${anchor.linkText} ${url.pathname}`)) continue;',
    "headquarters PDF filter",
  ],
  [
    '  const normalizedLine = normalizeText(line);',
    '  const normalizedLine = String(line).normalize("NFKC").replace(/\\u00a0/g, " ");',
    "fixed-width header positions",
  ],
  [
    '    name: findColumn(pageLines, ["物品役務等の名称及び数量", "物品役務等の名称", "名称及び数量"]),',
    '    name: findColumn(pageLines, ["物品役務等の名称及び数量", "物品役務等の名称", "名称及び数量", "物品役務"]),',
    "name header variants",
  ],
  [
    '    officer: findColumn(pageLines, ["契約担当役", "契約担当者"]),',
    '    officer: findColumn(pageLines, ["契約担当役", "契約担当者", "契約担当"]),',
    "officer header variants",
  ],
  [
    '    date: findColumn(pageLines, ["契約を締結した日", "契約締結日"]),',
    '    date: findColumn(pageLines, ["契約を締結した日", "契約締結日", "契約を", "締結日"]),',
    "date header variants",
  ],
];

for (const [before, after, label] of replacements) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one target, got ${count}`);
  source = source.replace(before, after);
}

await writeFile(path, source);
console.log("Applied SMRJ HQ parser hotfixes.");
