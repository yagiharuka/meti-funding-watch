type Stage = "contracted" | "subsidy_published";

type FundingRecord = {
  id: string;
  fiscalYear: number | null;
  date: string | null;
  organization: string;
  corporateNumber: string;
  sourceAgency: string;
  program: string;
  amount: number | null;
  amountRaw?: string;
  stage: Stage;
  sourceKey: string;
  sourceRowNumber: number;
  sourceSystem: string;
};

type DataChunkManifest = {
  generatedAt: string;
  commitments: Record<string, string>;
};

type DataRelease = {
  schemaVersion: 1;
  commitSha: string;
  generatedAt: string;
  recordCount: number;
  idSetSha256: string;
  files: Record<string, { sha256: string; bytes: number; rows: number }>;
};

type InitializeMessage = {
  type: "initialize";
  publicBaseUrl: string;
  manifest: DataChunkManifest;
  release: DataRelease;
};

type SearchMessage = {
  type: "search";
  requestId: number;
  parameters: string;
};

const pageSize = 100;
let records: FundingRecord[] = [];
let agencies: string[] = [];
let activeRelease: DataRelease | null = null;

self.addEventListener("message", (event: MessageEvent<InitializeMessage | SearchMessage>) => {
  if (event.data.type === "initialize") {
    initialize(event.data).catch((error: unknown) => {
      postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
    });
    return;
  }
  search(event.data);
});

async function initialize(message: InitializeMessage) {
  const nextRecords: FundingRecord[] = [];
  const ids = new Set<string>();
  const entries = Object.entries(message.manifest.commitments).sort(([left], [right]) => left.localeCompare(right));

  for (const [yearKey, filename] of entries) {
    const metadata = message.release.files[filename];
    if (!metadata) throw new Error(`${filename}のrelease情報がありません`);
    const dataUrl = new URL(`data/${filename}`, message.publicBaseUrl);
    dataUrl.searchParams.set("release", message.release.commitSha);
    const response = await fetch(dataUrl, { cache: "no-store" });
    if (!response.ok) throw new Error(`${filename}を取得できません（HTTP ${response.status}）`);
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength !== metadata.bytes) throw new Error(`${filename}のバイト数が一致しません`);
    if (await sha256(bytes) !== metadata.sha256) throw new Error(`${filename}のSHA-256が一致しません`);
    const rows = parseRows(bytes, filename);
    if (rows.length !== metadata.rows) throw new Error(`${filename}の行数が一致しません`);
    for (const row of rows) {
      if (yearKey === "unclassified" ? row.fiscalYear !== null : String(row.fiscalYear) !== yearKey) {
        throw new Error(`${filename}の年度がmanifestと一致しません`);
      }
      if (ids.has(row.id)) throw new Error("公開明細IDが重複しています");
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

function search(message: SearchMessage) {
  try {
    if (!activeRelease) throw new Error("検索データの検証が完了していません");
    const parameters = new URLSearchParams(message.parameters);
    const query = (parameters.get("q") ?? "").trim();
    const agency = parameters.get("agency") ?? "all";
    const stage = parameters.get("stage") ?? "all";
    const year = parameters.get("year") ?? "all";
    const page = Number(parameters.get("page") ?? "1");
    if (query.length > 100) throw new Error("検索語は100文字以内です");
    if (agency !== "all" && !agencies.includes(agency)) throw new Error("公表組織が検索対象にありません");
    if (stage !== "all" && stage !== "contracted" && stage !== "subsidy_published") throw new Error("掲載区分が不正です");
    if (year !== "all" && year !== "unclassified" && !/^\d{4}$/.test(year)) throw new Error("年度が不正です");
    if (!Number.isSafeInteger(page) || page < 1 || page > 10_000) throw new Error("ページが不正です");

    const needle = query.toLocaleLowerCase("ja-JP");
    const matching = records.filter((row) => {
      if (needle && !`${row.organization} ${row.corporateNumber}`.toLocaleLowerCase("ja-JP").includes(needle)) return false;
      if (agency !== "all" && row.sourceAgency !== agency) return false;
      if (stage !== "all" && row.stage !== stage) return false;
      if (year === "unclassified" && row.fiscalYear !== null) return false;
      if (/^\d{4}$/.test(year) && String(row.fiscalYear) !== year) return false;
      return true;
    });
    const totalRecords = matching.length;
    const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));
    const effectivePage = Math.min(page, totalPages);
    const offset = (effectivePage - 1) * pageSize;
    postMessage({
      type: "result",
      requestId: message.requestId,
      result: {
        totalRecords,
        totalPages,
        page: effectivePage,
        pageSize,
        records: matching.slice(offset, offset + pageSize),
        releaseCommit: activeRelease.commitSha,
        generatedAt: activeRelease.generatedAt,
      },
    });
  } catch (error) {
    postMessage({
      type: "error",
      requestId: message.requestId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function parseRows(bytes: ArrayBuffer, filename: string): FundingRecord[] {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error(`${filename}のJSONが不正です`);
  }
  if (!Array.isArray(value)) throw new Error(`${filename}が配列ではありません`);
  for (const [index, raw] of value.entries()) validateRow(raw, `${filename} ${index + 1}行目`);
  return value as FundingRecord[];
}

function validateRow(raw: unknown, label: string): asserts raw is FundingRecord {
  if (!raw || typeof raw !== "object") throw new Error(`${label}の形式が不正です`);
  const row = raw as Partial<FundingRecord>;
  if (
    typeof row.id !== "string" || !row.id
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
    || typeof row.sourceSystem !== "string" || !row.sourceSystem
  ) throw new Error(`${label}が公開スキーマと一致しません`);
}

function sortFundingRecords(rows: FundingRecord[]) {
  return rows.sort((left, right) =>
    (right.fiscalYear ?? Number.NEGATIVE_INFINITY) - (left.fiscalYear ?? Number.NEGATIVE_INFINITY)
    || (right.date ?? "").localeCompare(left.date ?? "")
    || left.organization.localeCompare(right.organization, "ja"));
}

async function sha256(bytes: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}
