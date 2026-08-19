import { readFile, writeFile } from "node:fs/promises";

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after === before) console.log(`unchanged: ${path}`);
  else { await writeFile(path, after); console.log(`updated: ${path}`); }
}

await update("app/page.tsx", (source) => {
  let next = source;
  if (!next.includes('import CombinedCompanyResults from "@/app/CombinedCompanyResults";')) {
    const anchor = 'import ViewTabs from "@/app/ViewTabs";';
    if (!next.includes(anchor)) throw new Error("app/page.tsx: ViewTabs import anchor not found");
    next = next.replace(anchor, `${anchor}\nimport CombinedCompanyResults from "@/app/CombinedCompanyResults";`);
  }
  if (!next.includes("<CombinedCompanyResults query={query} />")) {
    const summaryAnchor = "検索結果サマリー（現在の検索条件）";
    const summaryPos = next.indexOf(summaryAnchor);
    if (summaryPos < 0) throw new Error("app/page.tsx: company summary anchor not found");
    const resultBar = '\n        <div className="result-bar">';
    const insertPos = next.indexOf(resultBar, summaryPos);
    if (insertPos < 0) throw new Error("app/page.tsx: result bar after company summary not found");
    next = `${next.slice(0, insertPos)}\n\n        <CombinedCompanyResults query={query} />${next.slice(insertPos)}`;
  }
  return next;
});

await update("package.json", (source) => {
  const pkg = JSON.parse(source);
  pkg.scripts["update:review"] = "node scripts/update-review-data.mjs && node scripts/build-review-company-index.mjs";
  return `${JSON.stringify(pkg, null, 2)}\n`;
});

await update("vite.pages.config.ts", (source) => {
  if (source.includes("review-company-index.json")) return source;
  const anchor = "        await copyReviewData(dataDirectory);";
  if (!source.includes(anchor)) throw new Error("vite.pages.config.ts: copyReviewData anchor not found");
  return source.replace(anchor, `${anchor}\n        const reviewCompanyIndex = await readFile(new URL("./data/review-company-index.json", import.meta.url), "utf8");\n        const parsedReviewCompanyIndex = JSON.parse(reviewCompanyIndex) as { schemaVersion?: number; recipients?: unknown[] };\n        if (parsedReviewCompanyIndex.schemaVersion !== 1 || !Array.isArray(parsedReviewCompanyIndex.recipients)) {\n          throw new Error("行政事業レビュー企業索引が不正です");\n        }\n        await writeFile(new URL("./dist-pages/data/review-company-index.json", import.meta.url), reviewCompanyIndex);`);
});
