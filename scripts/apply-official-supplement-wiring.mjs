import { readFile, writeFile } from "node:fs/promises";

async function replaceOnce(path, before, after) {
  const current = await readFile(path, "utf8");
  if (!current.includes(before)) throw new Error(`${path}: 置換対象が見つかりません`);
  const next = current.replace(before, after);
  if (next === current) throw new Error(`${path}: 変更がありません`);
  await writeFile(path, next);
}

await replaceOnce(
  "vite.pages.config.ts",
  `        await writeFile(new URL("./dist-pages/data/review-company-index.json", import.meta.url), reviewCompanyIndex);\n`,
  `        await writeFile(new URL("./dist-pages/data/review-company-index.json", import.meta.url), reviewCompanyIndex);\n\n        const officialSupplementIndex = await readFile(new URL("./data/official-supplement-index.json", import.meta.url), "utf8");\n        const parsedOfficialSupplementIndex = JSON.parse(officialSupplementIndex) as { schemaVersion?: number; recordCount?: number; sources?: unknown[]; records?: unknown[] };\n        if (\n          parsedOfficialSupplementIndex.schemaVersion !== 1\n          || !Array.isArray(parsedOfficialSupplementIndex.sources)\n          || !Array.isArray(parsedOfficialSupplementIndex.records)\n          || parsedOfficialSupplementIndex.recordCount !== parsedOfficialSupplementIndex.records.length\n        ) {\n          throw new Error("公式補足企業索引が不正です");\n        }\n        await writeFile(new URL("./dist-pages/data/official-supplement-index.json", import.meta.url), officialSupplementIndex);\n`,
);

await replaceOnce(
  ".github/workflows/update-data.yml",
  `      - "data/official-reconciliation.json"\n      - "data/funding-data.json"\n`,
  `      - "data/official-reconciliation.json"\n      - "data/official/**"\n      - "data/official-supplement-seeds.json"\n      - "data/official-supplement-index.json"\n      - "data/funding-data.json"\n`,
);

await replaceOnce(
  ".github/workflows/refresh-official-data.yml",
  `          if git diff --quiet -- data/official; then\n`,
  `          if git diff --quiet -- data/official data/official-supplement-index.json; then\n`,
);
await replaceOnce(
  ".github/workflows/refresh-official-data.yml",
  `          git add data/official\n`,
  `          git add data/official data/official-supplement-index.json\n`,
);

const refreshPath = ".github/workflows/refresh-official-data.yml";
const refresh = await readFile(refreshPath, "utf8");
const publishStep = `      - name: Publish refreshed official supplement\n        if: steps.commit_data.outputs.changed == 'true'\n        env:\n          GH_TOKEN: \${{ github.token }}\n        run: gh workflow run update-data.yml --ref main -f publish_only=true\n`;
if (!refresh.includes("Publish refreshed official supplement")) {
  await writeFile(refreshPath, `${refresh.trimEnd()}\n${publishStep}`);
}
