// Connector-triggered replay after exact sparse-row parser support.
import { readFile } from "node:fs/promises";
import { parseOfficialPdf } from "./official-pdf.mjs";

const WIDTH = 841.68;
const pageSize = { width: WIDTH, height: 595.2, tolerance: 0.2 };
const grantColumns = (lefts) => [
  ["ordinal",["番号"]],["program",["事業名"]],["organization",["交付先名"]],["corporateNumber",["法人番号"]],
  ["amount",["交付決定額"]],["account",["支出元会計区分"]],["budgetItem",["支出元(目)名称"]],["date",["交付決定日"]],
  ["publicInterestClass",["公益法人の区分"]],["jurisdictionClass",["国所管、都道府"]],
].map(([key,headerAliases],i)=>({key,headerAliases,leftRatio:lefts[i]/WIDTH}));
const competitiveColumns = (lefts) => [
  ["program",["物品役務等の"]],["officer",["契約担当官等の"]],["date",["契約を締結"]],["organization",["商号又は名称"]],
  ["corporateNumber",["法人番号"]],["address",["住所"]],["method",["一般競争入札・"]],["plannedAmount",["予定価格"]],
  ["amount",["契約金額"]],["awardRate",["落札率"]],["notes",["備考"]],["publicInterestClass",["公益法人"]],
  ["jurisdictionClass",["国所管、"]],["bidderCount",["応札・"]],
].map(([key,headerAliases],i)=>({key,headerAliases,leftRatio:lefts[i]/WIDTH}));
const discretionaryColumns = (lefts) => [
  ["program",["物品役務等の"]],["officer",["契約担当官等の"]],["date",["契約を締結"]],["organization",["方の商号"]],
  ["corporateNumber",["法人番号"]],["address",["の住所"]],["legalReason",["随意契約によること"]],["plannedAmount",["予定価格"]],
  ["amount",["契約金額"]],["awardRate",["落札率"]],["reemployedOfficerCount",["再就職"]],["notes",["備考"]],
  ["publicInterestClass",["公益法人"]],["jurisdictionClass",["国所管、"]],["bidderCount",["応札・"]],
].map(([key,headerAliases],i)=>({key,headerAliases,leftRatio:lefts[i]/WIDTH}));

const base = {executorId:"chubu",executorName:"中部経済産業局",fiscalYear:2023,format:"pdf",sourcePageUrl:"https://www.chubu.meti.go.jp/a41kaikei/kouhyou/index.html"};
const docs = [
  {...base,id:"trial-g1",category:"grant_decision",kind:"補助金等の交付決定（4月～9月）",amountStage:"交付決定額欄の掲載値",file:"r5fy_4-9.pdf",pdfSchema:{schemaVersion:1,extractionMode:"positioned_text_only",normalizeCompatibilityText:true,expectedBytes:418926,expectedSha256:"9ff29945ebc29911b723f5ac557e67f94890b6d9282c6986fff3c891606cff74",expectedPageCount:15,expectedPageSize:pageSize,expectedRowsPerPage:[10,12,12,12,12,12,12,12,12,12,12,12,12,12,4],expectedRecordCount:170,expectedRowNumbers:{start:1,end:170},headersOnFirstPageOnly:true,requiredPageText:[],requiredFirstPageText:["令和05年度補助金等の情報","中部経済産業局"],columns:grantColumns([28,50,215,340,405,460,550,665,725,760]),recordMapping:{ordinalColumn:"ordinal",programColumn:"program",organizationColumn:"organization",corporateNumberColumn:"corporateNumber",amountColumn:"amount",dateColumn:"date",notesColumns:["account","budgetItem"]},allowedDateFormats:["reiwa_ymd_ja"],dateRange:{start:"2023-04-01",end:"2023-09-30"},corporateNumberMissingSentinels:["","-","－"],minimumPositionedTextItems:1}},
  {...base,id:"trial-g2",category:"grant_decision",kind:"補助金等の交付決定（10月～3月）",amountStage:"交付決定額欄の掲載値",file:"r5fy_10-3.pdf",pdfSchema:{schemaVersion:1,extractionMode:"positioned_text_only",normalizeCompatibilityText:true,expectedBytes:201458,expectedSha256:"d81b9409cf04fee5ce77245d179e66a34789df635e616575e6adff21580055a7",expectedPageCount:4,expectedPageSize:pageSize,expectedRowsPerPage:[12,14,14,14],expectedRecordCount:54,expectedRowNumbers:{start:1,end:58,omitted:[11,12,15,17]},expectedBlankOrganizationOrdinals:[27,28,29],headersOnFirstPageOnly:true,requiredPageText:[],requiredFirstPageText:["令和05年度補助金等の情報","中部経済産業局"],columns:grantColumns([28,50,200,320,385,445,545,665,725,760]),recordMapping:{ordinalColumn:"ordinal",programColumn:"program",organizationColumn:"organization",corporateNumberColumn:"corporateNumber",amountColumn:"amount",dateColumn:"date",notesColumns:["account","budgetItem"]},allowedDateFormats:["reiwa_ymd_ja"],dateRange:{start:"2023-10-01",end:"2024-03-31"},corporateNumberMissingSentinels:["","-","－"],minimumPositionedTextItems:1}},
  {...base,id:"trial-c1",category:"contract_result",kind:"競争入札（委託費の類）",amountStage:"契約金額欄の掲載値",file:"23-nyusatsu-itaku.pdf",pdfSchema:{schemaVersion:1,extractionMode:"positioned_text_only",normalizeCompatibilityText:true,rowAnchorMode:"date",expectedBytes:120104,expectedSha256:"666ab5fba88ef2b043b939a64bf7cf6de0bef50e548531cafcfd0239004739d9",expectedPageCount:2,expectedPageSize:pageSize,expectedRowsPerPage:[5,2],expectedRecordCount:7,expectedRowNumbers:{start:1,end:7},headersOnFirstPageOnly:true,requiredPageText:[],requiredFirstPageText:["公共調達の適正化について","競争入札に係る情報の公表"],columns:competitiveColumns([15,75,155,215,280,345,415,500,550,600,645,680,725,780]),recordMapping:{programColumn:"program",organizationColumn:"organization",corporateNumberColumn:"corporateNumber",amountColumn:"amount",dateColumn:"date",methodColumn:"method",notesColumns:["notes"]},allowedDateFormats:["western_ymd_ja"],dateRange:{start:"2023-04-01",end:"2024-03-31"},corporateNumberMissingSentinels:["-","－","法人番号なし"],minimumPositionedTextItems:1}},
  {...base,id:"trial-c2",category:"contract_result",kind:"競争入札（庁費の類）",amountStage:"契約金額欄の掲載値",file:"23-ukeoi.pdf",pdfSchema:{schemaVersion:1,extractionMode:"positioned_text_only",normalizeCompatibilityText:true,rowAnchorMode:"date",expectedBytes:171505,expectedSha256:"226da7ccb6ba81e52c33fb5c2ca52e2056466142730db5624452dd7157756987",expectedPageCount:5,expectedPageSize:pageSize,expectedRowsPerPage:[6,7,6,8,2],expectedRecordCount:29,expectedRowNumbers:{start:1,end:29},headersOnFirstPageOnly:true,requiredPageText:[],requiredFirstPageText:["公共調達の適正化について","競争入札に係る情報の公表"],columns:competitiveColumns([15,75,155,215,280,345,415,495,545,595,640,675,715,765]),recordMapping:{programColumn:"program",organizationColumn:"organization",corporateNumberColumn:"corporateNumber",amountColumn:"amount",dateColumn:"date",methodColumn:"method",notesColumns:["notes"]},allowedDateFormats:["western_ymd_ja"],dateRange:{start:"2023-04-01",end:"2024-03-31"},corporateNumberMissingSentinels:["-","－","法人番号なし"],minimumPositionedTextItems:1}},
  {...base,id:"trial-d1",category:"contract_result",kind:"随意契約（委託費の類）",amountStage:"契約金額欄の掲載値",file:"23-zuikei-itaku.pdf",pdfSchema:{schemaVersion:1,extractionMode:"positioned_text_only",normalizeCompatibilityText:true,rowAnchorMode:"date",expectedBytes:223892,expectedSha256:"68d9e5c9c2e60d3882bc9f362cffb387513348824c664ff1eb9fcb68305be6da",expectedPageCount:10,expectedPageSize:pageSize,expectedRowsPerPage:[5,5,5,5,3,3,3,4,4,4],expectedRecordCount:41,expectedRowNumbers:{start:1,end:41},headersOnFirstPageOnly:true,requiredPageText:[],requiredFirstPageText:["公共調達の適正化について","随意契約に係る情報の公表"],columns:discretionaryColumns([15,70,140,195,245,305,370,465,520,570,610,645,680,725,780]),recordMapping:{programColumn:"program",organizationColumn:"organization",corporateNumberColumn:"corporateNumber",amountColumn:"amount",dateColumn:"date",methodColumn:"legalReason",notesColumns:["notes"]},allowedDateFormats:["western_ymd_ja"],dateRange:{start:"2023-04-01",end:"2024-03-31"},corporateNumberMissingSentinels:["-","－","法人番号なし"],minimumPositionedTextItems:1}},
  {...base,id:"trial-d2",category:"contract_result",kind:"随意契約（庁費の類）",amountStage:"契約金額欄の掲載値",file:"23-zuikei-ukeoi.pdf",pdfSchema:{schemaVersion:1,extractionMode:"positioned_text_only",normalizeCompatibilityText:true,rowAnchorMode:"date",expectedBytes:115261,expectedSha256:"5471dad9fd1006fc0d252f85e64e56e98af32760f4b1fe84862c592c42f9ea6e",expectedPageCount:1,expectedPageSize:pageSize,expectedRowsPerPage:[5],expectedRecordCount:5,expectedRowNumbers:{start:1,end:5},requiredPageText:[],requiredFirstPageText:["公共調達の適正化について","随意契約に係る情報の公表"],columns:discretionaryColumns([15,70,140,195,245,305,375,465,520,570,610,645,680,725,780]),recordMapping:{programColumn:"program",organizationColumn:"organization",corporateNumberColumn:"corporateNumber",amountColumn:"amount",dateColumn:"date",methodColumn:"legalReason",notesColumns:["notes"]},allowedDateFormats:["western_ymd_ja"],dateRange:{start:"2023-04-01",end:"2024-03-31"},corporateNumberMissingSentinels:["-","－","法人番号なし"],minimumPositionedTextItems:1}},
];

let failed=0;
for (const document of docs) {
  try {
    const records=await parseOfficialPdf(await readFile(new URL(`../.audit-chubu/${document.file}`, import.meta.url)),document);
    console.log(`PASS ${document.id} rows=${records.length}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${document.id}: ${error.message}`);
  }
}
if (failed) process.exit(1);
