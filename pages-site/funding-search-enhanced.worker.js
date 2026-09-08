import { filterCompanyRecords } from "../scripts/company-search.mjs";
import { classifySubsidyDuplicates, subsidyAggregationValue } from "../scripts/subsidy-deduplication.mjs";

const pageSize = 100;
const detailRowsPerOrganization = 100;
const maxOrganizationSummaries = 50;
let records = [];
let agencies = [];
let activeRelease = null;
self.addEventListener("message", (event) => {
    if (event.data.type === "initialize") {
        initialize(event.data).catch((error) => {
            postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
        });
        return;
    }
    search(event.data);
});
async function initialize(message) {
    const nextRecords = [];
    const ids = new Set();
    const entries = Object.entries(message.manifest.commitments).sort(([left], [right]) => left.localeCompare(right));
    const loaded = new Array(entries.length);
    let nextIndex = 0;
    const loadNext = async () => {
        while (nextIndex < entries.length) {
            const index = nextIndex++;
            const [yearKey, filename] = entries[index];
            loaded[index] = { yearKey, filename, rows: await loadChunk(message, filename) };
        }
    };
    await Promise.all(Array.from({ length: Math.min(4, entries.length) }, loadNext));
    for (const { yearKey, filename, rows } of loaded) {
        const metadata = message.release.files[filename];
        if (rows.length !== metadata.rows)
            throw new Error(`${filename}の行数が一致しません`);
        for (const row of rows) {
            if (yearKey === "unclassified" ? row.fiscalYear !== null : String(row.fiscalYear) !== yearKey) {
                throw new Error(`${filename}の年度がmanifestと一致しません`);
            }
            if (ids.has(row.id))
                throw new Error("公開明細IDが重複しています");
            ids.add(row.id);
            nextRecords.push(row);
        }
    }
    if (nextRecords.length !== message.release.recordCount) {
        throw new Error("公開明細の総行数がreleaseと一致しません");
    }
    const idSetBytes = new TextEncoder().encode(`${[...ids].sort().join("\n")}\n`);
    if (await sha256(idSetBytes.buffer) !== message.release.idSetSha256) {
        throw new Error("公開明細のID集合がreleaseと一致しません");
    }
    records = sortFundingRecords(nextRecords);
    agencies = [...new Set(records.map((row) => row.sourceAgency))].sort((left, right) => left.localeCompare(right, "ja"));
    activeRelease = message.release;
    postMessage({
        type: "ready",
        agencies,
        releaseCommit: message.release.commitSha,
        generatedAt: message.release.generatedAt,
    });
}
async function loadChunk(message, filename) {
    const metadata = message.release.files[filename];
    if (!metadata)
        throw new Error(`${filename}のrelease情報がありません`);
    const dataUrl = new URL(`data/${filename}`, message.publicBaseUrl);
    dataUrl.searchParams.set("release", message.release.commitSha);
    const response = await fetch(dataUrl, { cache: "no-store" });
    if (!response.ok)
        throw new Error(`${filename}を取得できません（HTTP ${response.status}）`);
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength !== metadata.bytes)
        throw new Error(`${filename}のバイト数が一致しません`);
    if (await sha256(bytes) !== metadata.sha256)
        throw new Error(`${filename}のSHA-256が一致しません`);
    return parseRows(bytes, filename);
}
function search(message) {
    try {
        if (!activeRelease)
            throw new Error("検索データの検証が完了していません");
        const parameters = new URLSearchParams(message.parameters);
        const query = (parameters.get("q") ?? "").trim();
        const agency = parameters.get("agency") ?? "all";
        const stage = parameters.get("stage") ?? "all";
        const year = parameters.get("year") ?? "all";
        const page = Number(parameters.get("page") ?? "1");
        if (query.length > 100)
            throw new Error("検索語は100文字以内です");
        if (agency !== "all" && !agencies.includes(agency))
            throw new Error("公表組織が検索対象にありません");
        if (stage !== "all" && stage !== "contracted" && stage !== "subsidy_published")
            throw new Error("掲載区分が不正です");
        if (year !== "all" && year !== "unclassified" && !/^\d{4}$/.test(year))
            throw new Error("年度が不正です");
        if (!Number.isSafeInteger(page) || page < 1 || page > 10_000)
            throw new Error("ページが不正です");
        const matching = filterCompanyRecords(records, { query, agency, stage, year });
        const totalRecords = matching.length;
        const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));
        const effectivePage = Math.min(page, totalPages);
        const offset = (effectivePage - 1) * pageSize;
        const duplicateContext = query ? filterCompanyRecords(records, { query }) : matching;
        const duplicateClassification = classifySubsidyDuplicates(duplicateContext);
        const summary = summarizeFundingRecords(matching, duplicateClassification);
        const organizationSummaries = query
            ? summarizeOrganizations(matching, duplicateClassification).slice(0, maxOrganizationSummaries)
            : [];
        postMessage({
            type: "result",
            requestId: message.requestId,
            result: {
                totalRecords,
                totalPages,
                page: effectivePage,
                pageSize,
                records: matching.slice(offset, offset + pageSize),
                summary,
                organizationSummaries,
                organizationSummariesTruncated: query ? summary.organizationCount > maxOrganizationSummaries : false,
                releaseCommit: activeRelease.commitSha,
                generatedAt: activeRelease.generatedAt,
            },
        });
    }
    catch (error) {
        postMessage({
            type: "error",
            requestId: message.requestId,
            message: error instanceof Error ? error.message : String(error),
        });
    }
}
function summarizeOrganizations(rows, duplicateClassification) {
    const groups = new Map();
    for (const row of rows) {
        const current = groups.get(row.corporateNumber);
        if (current)
            current.push(row);
        else
            groups.set(row.corporateNumber, [row]);
    }
    return [...groups.values()]
        .map((group) => summarizeOrganization(group, duplicateClassification))
        .sort((left, right) => right.records - left.records || left.name.localeCompare(right.name, "ja"));
}
function emptyAmountSummary() {
    return { records: 0, amount: 0, amountKnownCount: 0, amountIncludedCount: 0, duplicateExcludedCount: 0 };
}
function summarizeOrganization(rows, duplicateClassification) {
    const first = rows[0];
    const stages = new Map();
    const years = new Map();
    const programs = new Map();
    let amountUnknownCount = 0;
    let duplicateExcludedCount = 0;
    for (const row of rows) {
        if (row.amount === null)
            amountUnknownCount += 1;
        const aggregation = subsidyAggregationValue(row, duplicateClassification);
        if (aggregation.duplicateExcluded)
            duplicateExcludedCount += 1;
        const stageItem = stages.get(row.stage) ?? { stage: row.stage, ...emptyAmountSummary() };
        stageItem.records += 1;
        stageItem.amount += aggregation.amount;
        if (row.amount !== null)
            stageItem.amountKnownCount += 1;
        if (aggregation.amountIncluded)
            stageItem.amountIncludedCount += 1;
        if (aggregation.duplicateExcluded)
            stageItem.duplicateExcludedCount += 1;
        stages.set(row.stage, stageItem);
        const yearKey = row.fiscalYear === null ? "unclassified" : String(row.fiscalYear);
        const yearItem = years.get(yearKey) ?? {
            fiscalYear: row.fiscalYear,
            contracted: emptyAmountSummary(),
            subsidy_published: emptyAmountSummary(),
            amountUnknownCount: 0,
        };
        const yearStage = yearItem[row.stage];
        yearStage.records += 1;
        yearStage.amount += aggregation.amount;
        if (row.amount !== null)
            yearStage.amountKnownCount += 1;
        else
            yearItem.amountUnknownCount += 1;
        if (aggregation.amountIncluded)
            yearStage.amountIncludedCount += 1;
        if (aggregation.duplicateExcluded)
            yearStage.duplicateExcludedCount += 1;
        years.set(yearKey, yearItem);
        const programName = aggregation.program.trim() || "活動名称・件名の記載なし";
        const programKey = `${row.stage}\u0000${programName}`;
        const programItem = programs.get(programKey) ?? {
            stage: row.stage,
            program: programName,
            records: 0,
            amount: 0,
            amountKnownCount: 0,
            amountIncludedCount: 0,
            duplicateExcludedCount: 0,
        };
        programItem.records += 1;
        programItem.amount += aggregation.amount;
        if (row.amount !== null)
            programItem.amountKnownCount += 1;
        if (aggregation.amountIncluded)
            programItem.amountIncludedCount += 1;
        if (aggregation.duplicateExcluded)
            programItem.duplicateExcludedCount += 1;
        programs.set(programKey, programItem);
    }
    return {
        name: first.organization,
        corporateNumber: first.corporateNumber,
        records: rows.length,
        amountUnknownCount,
        duplicateExcludedCount,
        byStage: [...stages.values()].sort((left, right) => left.stage.localeCompare(right.stage)),
        byYear: [...years.values()]
            .sort((left, right) => (right.fiscalYear ?? Number.NEGATIVE_INFINITY) - (left.fiscalYear ?? Number.NEGATIVE_INFINITY)),
        topPrograms: [...programs.values()]
            .sort((left, right) => right.amount - left.amount || right.records - left.records || left.program.localeCompare(right.program, "ja"))
            .slice(0, 10),
        detailRows: rows.slice(0, detailRowsPerOrganization),
        detailTruncated: rows.length > detailRowsPerOrganization,
    };
}
function summarizeFundingRecords(rows, duplicateClassification) {
    let amountKnownTotal = 0;
    let amountKnownCount = 0;
    let amountIncludedCount = 0;
    let duplicateExcludedCount = 0;
    const organizations = new Map();
    const stages = new Map();
    const years = new Map();
    const programs = new Map();
    for (const row of rows) {
        const aggregation = subsidyAggregationValue(row, duplicateClassification);
        if (row.amount !== null)
            amountKnownCount += 1;
        if (aggregation.amountIncluded) {
            amountKnownTotal += aggregation.amount;
            amountIncludedCount += 1;
        }
        if (aggregation.duplicateExcluded)
            duplicateExcludedCount += 1;
        const organization = organizations.get(row.corporateNumber) ?? {
            name: row.organization,
            corporateNumber: row.corporateNumber,
            records: 0,
            amount: 0,
        };
        organization.records += 1;
        organization.amount += aggregation.amount;
        organizations.set(row.corporateNumber, organization);
        const stageItem = stages.get(row.stage) ?? { stage: row.stage, ...emptyAmountSummary() };
        stageItem.records += 1;
        stageItem.amount += aggregation.amount;
        if (row.amount !== null)
            stageItem.amountKnownCount += 1;
        if (aggregation.amountIncluded)
            stageItem.amountIncludedCount += 1;
        if (aggregation.duplicateExcluded)
            stageItem.duplicateExcludedCount += 1;
        stages.set(row.stage, stageItem);
        const yearKey = row.fiscalYear === null ? "unclassified" : String(row.fiscalYear);
        const yearItem = years.get(yearKey) ?? { fiscalYear: row.fiscalYear, ...emptyAmountSummary() };
        yearItem.records += 1;
        yearItem.amount += aggregation.amount;
        if (row.amount !== null)
            yearItem.amountKnownCount += 1;
        if (aggregation.amountIncluded)
            yearItem.amountIncludedCount += 1;
        if (aggregation.duplicateExcluded)
            yearItem.duplicateExcludedCount += 1;
        years.set(yearKey, yearItem);
        const programName = aggregation.program.trim() || "活動名称・件名の記載なし";
        const programItem = programs.get(programName) ?? { program: programName, ...emptyAmountSummary() };
        programItem.records += 1;
        programItem.amount += aggregation.amount;
        if (row.amount !== null)
            programItem.amountKnownCount += 1;
        if (aggregation.amountIncluded)
            programItem.amountIncludedCount += 1;
        if (aggregation.duplicateExcluded)
            programItem.duplicateExcludedCount += 1;
        programs.set(programName, programItem);
    }
    return {
        amountKnownTotal,
        amountKnownCount,
        amountIncludedCount,
        duplicateExcludedCount,
        amountUnknownCount: rows.length - amountKnownCount,
        organizationCount: organizations.size,
        organizations: [...organizations.values()]
            .sort((left, right) => right.records - left.records || left.name.localeCompare(right.name, "ja"))
            .slice(0, 10),
        byStage: [...stages.values()].sort((left, right) => left.stage.localeCompare(right.stage)),
        byYear: [...years.values()]
            .sort((left, right) => (right.fiscalYear ?? Number.NEGATIVE_INFINITY) - (left.fiscalYear ?? Number.NEGATIVE_INFINITY))
            .slice(0, 5),
        topPrograms: [...programs.values()]
            .sort((left, right) => right.amount - left.amount || right.records - left.records || left.program.localeCompare(right.program, "ja"))
            .slice(0, 5),
    };
}
function parseRows(bytes, filename) {
    let value;
    try {
        value = JSON.parse(new TextDecoder().decode(bytes));
    }
    catch {
        throw new Error(`${filename}のJSONが不正です`);
    }
    if (!Array.isArray(value))
        throw new Error(`${filename}が配列ではありません`);
    for (const [index, raw] of value.entries())
        validateRow(raw, `${filename} ${index + 1}行目`);
    return value;
}
function validateRow(raw, label) {
    if (!raw || typeof raw !== "object")
        throw new Error(`${label}の形式が不正です`);
    const row = raw;
    if (typeof row.id !== "string" || !row.id
        || (row.fiscalYear !== null && !Number.isInteger(row.fiscalYear))
        || (row.date !== null && typeof row.date !== "string")
        || typeof row.organization !== "string" || !row.organization
        || typeof row.corporateNumber !== "string" || !/^\d{13}$/.test(row.corporateNumber)
        || typeof row.sourceAgency !== "string" || !row.sourceAgency
        || typeof row.program !== "string"
        || (row.amount !== null && (typeof row.amount !== "number" || !Number.isFinite(row.amount)))
        || (row.amountRaw !== undefined && typeof row.amountRaw !== "string")
        || (row.stage !== "contracted" && row.stage !== "subsidy_published")
        || typeof row.sourceKey !== "string" || !row.sourceKey
        || !Number.isSafeInteger(row.sourceRowNumber) || (row.sourceRowNumber ?? 0) < 1
        || typeof row.sourceSystem !== "string" || !row.sourceSystem)
        throw new Error(`${label}が公開スキーマと一致しません`);
}
function sortFundingRecords(rows) {
    return rows.sort((left, right) => (right.fiscalYear ?? Number.NEGATIVE_INFINITY) - (left.fiscalYear ?? Number.NEGATIVE_INFINITY)
        || (right.date ?? "").localeCompare(left.date ?? "")
        || left.organization.localeCompare(right.organization, "ja"));
}
async function sha256(bytes) {
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}
