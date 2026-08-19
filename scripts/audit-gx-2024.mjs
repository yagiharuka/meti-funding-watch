import { readFile, writeFile, mkdir } from "node:fs/promises";

const companies = [
  { name: "株式会社NABLA Mobility", aliases: ["NABLA Mobility", "ＮＡＢＬＡ Ｍｏｂｉｌｉｔｙ"], nedoAmount: 397000000 },
  { name: "株式会社3DC", aliases: ["株式会社3DC", "株式会社３ＤＣ", "3DC", "３ＤＣ"], nedoAmount: 499000000 },
  { name: "株式会社グリーンケミカル", aliases: ["グリーンケミカル"], nedoAmount: 280000000 },
  { name: "京都フュージョニアリング株式会社", aliases: ["京都フュージョニアリング"], nedoAmount: 499000000 },
  { name: "株式会社FullDepth", aliases: ["FullDepth", "ＦｕｌｌＤｅｐｔｈ"], nedoAmount: 292000000 },
  { name: "Planet Savers株式会社", aliases: ["Planet Savers", "Ｐｌａｎｅｔ Ｓａｖｅｒｓ"], nedoAmount: 500000000 },
  { name: "株式会社マテリアルゲート", aliases: ["マテリアルゲート"], nedoAmount: 279000000 },
  { name: "株式会社OOYOO", aliases: ["OOYOO", "ＯＯＹＯＯ"], nedoAmount: 894000000 },
  { name: "ウミトロン株式会社", aliases: ["ウミトロン"], nedoAmount: 381000000 },
];

function norm(v = "") {
  return String(v).normalize("NFKC").toLowerCase().replace(/[\s　・･.．,，()（）株式会社合同会社]/g, "");
}
function matches(rowName, c) {
  const n = norm(rowName);
  return [c.name, ...c.aliases].some((a) => {
    const x = norm(a);
    return x.length >= 3 && (n.includes(x) || x.includes(n));
  });
}

const reviewManifest = JSON.parse(await readFile("data/review-cache/manifest.json", "utf8"));
const reviewRows = (await Promise.all(reviewManifest.paymentFiles.map(async f => JSON.parse(await readFile(`data/review-cache/${f}`, "utf8"))))).flat();
const projectRows = reviewRows.filter(r => r.reviewProjectId === "rs-2025-7096");
const funding = JSON.parse(await readFile("data/funding-data.json", "utf8"));
const gbizRows = funding.records ?? [];

const results = companies.map(c => {
  const review = projectRows.filter(r => matches(r.organization, c));
  const gbiz = gbizRows.filter(r => matches(r.organization, c));
  const gbizNedo = gbiz.filter(r => norm(r.sourceAgency).includes(norm("NEDO")) || norm(r.sourceAgency).includes(norm("新エネルギー・産業技術総合開発機構")));
  const gbizNedoSubsidy = gbizNedo.filter(r => r.stage === "subsidy_published");
  return {
    name: c.name,
    nedoOfficialGrantDecisionAmount: c.nedoAmount,
    reviewMatches: review.map(r => ({ amount: r.amount, amountRaw: r.amountRaw, block: r.block, sourceAgency: r.sourceAgency, route: r.route, corporateNumber: r.corporateNumber, sourceRowNumber: r.sourceRowNumber })),
    reviewPublishedAmountTotalWithinProject: review.reduce((s,r)=>s+(r.amount ?? 0),0),
    gbizAllMatches: gbiz.map(r => ({ amount: r.amount, stage: r.stage, sourceAgency: r.sourceAgency, program: r.program, fiscalYear: r.fiscalYear, date: r.date, corporateNumber: r.corporateNumber })),
    gbizNedoMatches: gbizNedo.map(r => ({ amount: r.amount, stage: r.stage, sourceAgency: r.sourceAgency, program: r.program, fiscalYear: r.fiscalYear, date: r.date })),
    gbizNedoSubsidyMatches: gbizNedoSubsidy.map(r => ({ amount: r.amount, sourceAgency: r.sourceAgency, program: r.program, fiscalYear: r.fiscalYear, date: r.date })),
    siteReviewPresent: review.length > 0,
    siteGbizPresent: gbiz.length > 0,
    siteGbizNedoSubsidyPresent: gbizNedoSubsidy.length > 0,
  };
});

const output = {
  generatedAt: new Date().toISOString(),
  reviewProjectId: "rs-2025-7096",
  reviewProjectRows: projectRows.map(r => ({ organization: r.organization, amount: r.amount, amountRaw: r.amountRaw, block: r.block, sourceAgency: r.sourceAgency, route: r.route, corporateNumber: r.corporateNumber, sourceRowNumber: r.sourceRowNumber })),
  results,
};
await mkdir("data/audits", { recursive: true });
await writeFile("data/audits/gx-2024-crosswalk.json", JSON.stringify(output, null, 2) + "\n");
console.log(JSON.stringify(output, null, 2));