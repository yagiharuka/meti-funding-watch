const SOURCE_PAGE_URL = "https://www.kanto.meti.go.jp/chotatsu/chotatsu/index_keiyaku.html";
const WARP_PROVIDER = "国立国会図書館インターネット資料収集保存事業（WARP）";
const BASE_COLUMNS = [
  ["program", ["名称及び数量"]], ["contractOfficer", ["契約担当官等の"]],
  ["date", ["した日"]], ["organization", ["商号又は名称"]],
  ["corporateNumber", ["法人番号"]], ["address", ["住所"]],
  ["procurementBasis", ["一般競争入札・", "随意契約によることとした"]],
  ["plannedPrice", ["予定価格"]], ["amount", ["契約金額"]], ["postAmount", ["落札率"]],
];

const SIMPLE_DATE_SPLIT = (expectedMatches) => [{
  id: "date-organization", kind: "date_then_text", fromColumn: "date", toColumn: "organization", expectedMatches,
}];

const SPECS = [
  [2022, "competitive-goods-services", "4fy_keiyakuteiketsu_kyoso_bupin.pdf", "競争入札（物品役務等）", "競争入札", "20221108/20221101040205", 116124, "fd6d97dc44a4ea1394c5901305b3ede316bf28f0a84061d47287af99adae0f5e", [10, 2], 257, 842, 595.22, [50,112,198,234,306,341,428,487,528,567], { program:["物品役務等の名称"], procurementBasis:["一般競争入札・指"] }],
  [2022, "competitive-commission", "4fy_keiyakuteiketsu_kyoso_itaku.pdf", "競争入札（委託契約）", "競争入札", "20220912/20220901062557", 91620, "46e8b5505bd140dedee7df9c44ddf552eadc91a1e55cf1e35cf603b8d5384a8c", [1], 51, 842, 595.22, [50,112,198,234,306,341,428,487,528,567], { program:["物品役務等の名称"], procurementBasis:["一般競争入札・指"] }],
  [2022, "discretionary-goods-services", "4fy_keiyakuteiketsu_zuii_bupin.pdf", "随意契約（物品役務等）", "随意契約", "20221208/20221201033217", 104451, "4d99d18645dfd2cb33cf38a1170ffc8232086d6e8eb29b97044f64981b2a7af4", [5], 154, 842, 595.22, [52,107,160,212,265,318,391,479,538,571], { organization:["又は名称"], address:["の住所"], procurementBasis:["随意契約によること"] }],
  [2022, "discretionary-commission", "4fy_keiyakuteiketsu_zuii_itaku.pdf", "随意契約（委託契約）", "随意契約", "20221208/20221201033218", 149938, "bd49eb510eb62e7dcf0d23107bd4ff3f242256ff08ff30d2626df383bea7bfd9", [12,14,14,13,4], 1354, 842, 595.22, [60,127,185,237,290,343,416,504,563,596], { organization:["又は名称"], address:["の住所"], procurementBasis:["随意契約によること"] }],
  [2023, "competitive-goods-services", "5fy_keiyakuteitestu_kyoso_bupin.pdf", "競争入札（物品役務等）", "競争入札", "20231206/20231201022647", 94037, "ddf1dc6460c6581ec4d99a83d6b7a40ca4c42ffdc946e55a2cbcd0802720d4ac", [8,8], 393, 842, 595.22, [10,73,145,211,276,344,416,490,552,603], {}, SIMPLE_DATE_SPLIT(5)],
  [2023, "competitive-commission", "5fy_keiyakuteitestu_kyoso_itaku.pdf", "競争入札（委託契約）", "競争入札", "20231007/20231001023149", 76664, "261859e01e5071259ab8c45f41c35166340e631e95760cf5507b54d16a1bd825", [4], 135, 842, 595.22, [10,73,145,211,276,344,416,490,552,603], {}, SIMPLE_DATE_SPLIT(1)],
  [2023, "discretionary-goods-services", "5fy_keiyakuteiketsu_zuii_bupin.pdf", "随意契約（物品役務等）", "随意契約", "20230709/20230703034242", 77015, "3af1cb788163fbe3da65fea30c7c9e1edbbd3f3b882d2a393531b06402c681e5", [4], 171, 842, 595.22, [7,69,131,189,245,307,379,456,521,572], { organization:["又は名称"], address:["の住所"], procurementBasis:["随意契約によること"] }],
  [2023, "discretionary-commission", "5fy_keiyakuteitestu_zuii_itaku.pdf", "随意契約（委託契約）", "随意契約", "20231007/20231001023159", 116366, "7fd5533d7a0ad6261d89d03c4177025ec9bb5dbbd67a00665bec3d7e882ff590", [5,8,8,8,3,3,3,4,7,1], 1604, 842, 595.22, [16,77,138,194,248,310,380,455,519,569], { organization:["又は名称"], address:["の住所"], procurementBasis:["随意契約によること"] }, [
    { id:"date-organization-corporate-number", kind:"date_then_text_and_corporate_number", fromColumn:"date", toColumn:"organization", thirdColumn:"corporateNumber", expectedMatches:1 },
    ...SIMPLE_DATE_SPLIT(4),
  ]],
  [2024, "competitive-goods-services", "6fy_keiyakuteiketsu_kyoso_bupin.pdf", "競争入札（物品役務等）", "競争入札", "20241007/20241001023126", 174702, "bbb715c180c7dbe65ea30362e5139017820a0b1088ba7d15e2e81102a69444a7", [14], 240, 841.68, 595.2, [50,112,198,234,306,341,428,487,528,567]],
  [2024, "competitive-commission", "6fy_keiyakuteiketsu_kyoso_itaku.pdf", "競争入札（委託契約）", "競争入札", "20241007/20241001023127", 120858, "9241b5cdf13ee01e5f56c6bf4914bca8e5f44b7496f24fee61b1f6cc6dba3ad4", [4], 104, 841.68, 595.2, [50,112,198,234,306,341,428,487,528,567]],
  [2024, "discretionary-goods-services", "6fy_keiyakuteiketsu_zuii_bupin.pdf", "随意契約（物品役務等）", "随意契約", "20241007/20241001023129", 116100, "81be8496aeafc400e6e2a497f32621e3e580bbef7690070884e79bd0acf07a74", [3], 92, 841.68, 595.2, [50,107,185,218,284,316,395,483,525,556]],
  [2024, "discretionary-commission", "6fy_keiyakuteiketsu_zuii_itaku.pdf", "随意契約（委託契約）", "随意契約", "20241007/20241001023131", 323087, "d77537d25eeb5bceac03263aca338919dbf7d61e5e68330b8869bdf5ca6c6a26", [22,27], 1008, 1190.4, 841.68, [43,142,233,290,382,430,560,664,738,789]],
];

function makeDocument(spec) {
  const [fiscalYear, suffix, filename, kind, titleClass, capture, bytes, sha256, rowsPerPage,
    positionedTextItems, pageWidth, pageHeight, leftPoints, aliases = {}, crossColumnSplitRules = []] = spec;
  const id = `kanto-${fiscalYear}-contracts-${suffix}`;
  const originalUrl = `https://www.kanto.meti.go.jp/chotatsu/chotatsu/data/${filename}`;
  const expectedRecordCount = rowsPerPage.reduce((sum, count) => sum + count, 0);
  return Object.freeze({
    id, executorId:"kanto", executorName:"関東経済産業局", fiscalYear,
    category:"contract_result", kind, amountStage:"契約金額欄の掲載値", format:"pdf",
    discoveryStatus:"archived_official_file", verifiedAt:"2026-08-13", sourcePageUrl:SOURCE_PAGE_URL,
    originalUrl, url:`https://warp.ndl.go.jp/${capture}/${originalUrl}`, archiveProvider:WARP_PROVIDER,
    archiveVerifiedAt:"2026-08-13",
    archiveVerification:"WARPの公式URL完全一致検索で保存時刻を特定し、保存済み公式PDF原本をFull GETしてPDF magic・byte数・SHA-256・ページ数・契約日行を照合",
    archiveExpectedBytes:bytes, archiveExpectedSha256:sha256, archiveExpectedRecordCount:expectedRecordCount,
    coverageClaim:`WARP保存時点の令和${fiscalYear - 2018}年度${kind}PDF全${rowsPerPage.length}ページに掲載された${expectedRecordCount}行（保存時点以降の追加行は未収録）`,
    pdfSchema:{
      schemaVersion:1, extractionMode:"positioned_text_only", normalizeCompatibilityText:true,
      expectedBytes:bytes, expectedSha256:sha256, expectedPageCount:rowsPerPage.length,
      expectedPageSize:{width:pageWidth,height:pageHeight,tolerance:0.25}, expectedRowsPerPage:rowsPerPage,
      expectedRecordCount, expectedRowNumbers:{start:1,end:expectedRecordCount}, headersOnFirstPageOnly:rowsPerPage.length>1,
      recordGranularity:"date_anchor_rows", requiredPageText:[],
      requiredFirstPageText:["公共調達の適正化について",`${titleClass}に係る情報の公表`,kind.includes("物品")?"庁費の類":"委託費の類"],
      columns:BASE_COLUMNS.map(([key,defaults],index)=>({key,headerAliases:aliases[key]??defaults,leftRatio:leftPoints[index]/pageWidth})),
      recordMapping:{programColumn:"program",organizationColumn:"organization",corporateNumberColumn:"corporateNumber",amountColumn:"amount",dateColumn:"date",notesColumns:["procurementBasis"]},
      crossColumnSplitRules, allowedDateFormats:["western_ymd_ja"],
      dateRange:{start:`${fiscalYear}-04-01`,end:`${fiscalYear+1}-03-31`}, corporateNumberMissingSentinels:["-","－"],
      minimumPositionedTextItems:positionedTextItems, expectedPositionedTextItemCount:positionedTextItems,
    },
  });
}

export const KANTO_2022_2024_CONTRACT_DOCUMENTS = Object.freeze(SPECS.map(makeDocument));
