import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const dataDirectory = new URL("../dist-pages/data/", import.meta.url);
const manifestUrl = new URL("manifest.json", dataDirectory);
const manifestText = await readFile(manifestUrl, "utf8");
const manifest = JSON.parse(manifestText);
const summary = JSON.parse(await readFile(new URL("../data/funding-summary.json", import.meta.url), "utf8"));
const gbizSource = summary.sources?.find((source) => source.id === "gbiz");
if (
  !gbizSource
  || typeof gbizSource.csvRetrievedAt !== "string"
  || !/^[0-9a-f]{64}$/i.test(gbizSource.csvSubsidySha256 ?? "")
  || !/^[0-9a-f]{64}$/i.test(gbizSource.csvProcurementSha256 ?? "")
  || !Number.isSafeInteger(gbizSource.csvSubsidyFileBytes)
  || !Number.isSafeInteger(gbizSource.csvProcurementFileBytes)
) throw new Error("公開releaseに必要なGビズINFO取得元情報がありません");
const filenames = Object.values(manifest.commitments ?? {}).sort();
if (!filenames.length) throw new Error("公開releaseにGビズINFO明細ファイルがありません");

const ids = [];
const files = {};
for (const filename of filenames) {
  const fileUrl = new URL(filename, dataDirectory);
  const text = await readFile(fileUrl, "utf8");
  const rows = JSON.parse(text);
  if (!Array.isArray(rows)) throw new Error(`${filename}が配列ではありません`);
  ids.push(...rows.map((row) => row.id));
  files[filename] = {
    sha256: sha256(text),
    bytes: (await stat(fileUrl)).size,
    rows: rows.length,
  };
}
if (new Set(ids).size !== ids.length) {
  throw new Error("公開releaseの明細IDが重複しています");
}

const officialDirectory = new URL("official/", dataDirectory);
const officialManifestText = await readFile(new URL("manifest.json", officialDirectory), "utf8");
const officialManifest = JSON.parse(officialManifestText);
if (
  officialManifest.schemaVersion !== 1 || typeof officialManifest.generatedAt !== "string"
  || !Number.isSafeInteger(officialManifest.recordCount) || officialManifest.recordCount < 1
  || !officialManifest.files || typeof officialManifest.files !== "object"
) throw new Error("公開releaseの公式資料manifestが不正です");
const officialIds = [];
const officialFiles = {};
for (const filename of Object.values(officialManifest.files).sort()) {
  if (!/^records-\d{4}\.json$/.test(filename)) throw new Error(`公式資料の公開ファイル名が不正です: ${filename}`);
  const fileUrl = new URL(filename, officialDirectory);
  const text = await readFile(fileUrl, "utf8");
  const rows = JSON.parse(text);
  if (!Array.isArray(rows)) throw new Error(`${filename}が配列ではありません`);
  officialIds.push(...rows.map((row) => row.id));
  officialFiles[filename] = {
    sha256: sha256(text),
    bytes: (await stat(fileUrl)).size,
    rows: rows.length,
  };
}
if (officialIds.length !== officialManifest.recordCount || new Set(officialIds).size !== officialIds.length) {
  throw new Error("公開releaseの公式資料行数またはID一意性が不正です");
}

const reviewDirectory = new URL("review/", dataDirectory);
const reviewManifestText = await readFile(new URL("manifest.json", reviewDirectory), "utf8");
const reviewManifest = JSON.parse(reviewManifestText);
if (reviewManifest.schemaVersion !== 3 || !Number.isSafeInteger(reviewManifest.programCount) || !Number.isSafeInteger(reviewManifest.paymentCount)) {
  throw new Error("公開releaseの行政事業レビューmanifestが不正です");
}
const reviewFiles = {};
for (const filename of [reviewManifest.programsFile, ...reviewManifest.paymentFiles]) {
  const fileUrl = new URL(filename, reviewDirectory); const text = await readFile(fileUrl, "utf8"); const rows = JSON.parse(text);
  if (!Array.isArray(rows)) throw new Error(`${filename}が配列ではありません`);
  reviewFiles[filename] = { sha256: sha256(text), bytes: (await stat(fileUrl)).size, rows: rows.length };
}

const appShell = {};
const outputDirectory = new URL("../dist-pages/", import.meta.url);
for (const relativePath of await listFiles(outputDirectory)) {
  if (relativePath.startsWith("data/") || relativePath === "release.json" || relativePath === "update-status.json") continue;
  const fileUrl = new URL(relativePath, outputDirectory);
  const bytes = await readFile(fileUrl);
  appShell[relativePath] = {
    sha256: sha256(bytes),
    bytes: bytes.byteLength,
  };
}
if (!("index.html" in appShell) || !Object.keys(appShell).some((path) => path.startsWith("assets/"))) {
  throw new Error("公開releaseに画面成果物がありません");
}

const commitSha = process.env.RELEASE_COMMIT_SHA?.trim()
  || (await execFileAsync("git", ["rev-parse", "HEAD"], {
    cwd: new URL("..", import.meta.url),
  })).stdout.trim();
if (!/^[0-9a-f]{40}$/i.test(commitSha)) throw new Error("公開releaseのcommit SHAが不正です");

const release = {
  schemaVersion: 1,
  commitSha,
  generatedAt: manifest.generatedAt,
  recordCount: ids.length,
  manifestSha256: sha256(manifestText),
  idSetSha256: sha256(`${[...ids].sort().join("\n")}\n`),
  appShell,
  sourceSnapshots: {
    gbiz: {
      csvRetrievedAt: gbizSource.csvRetrievedAt,
      subsidy: {
        sha256: gbizSource.csvSubsidySha256,
        bytes: gbizSource.csvSubsidyFileBytes,
        filename: gbizSource.csvSubsidyReceipt?.contentDisposition ?? "Hojokinjoho.csv",
      },
      procurement: {
        sha256: gbizSource.csvProcurementSha256,
        bytes: gbizSource.csvProcurementFileBytes,
        filename: gbizSource.csvProcurementReceipt?.contentDisposition ?? "Chotatsujoho.csv",
      },
    },
  },
  files,
  review: {
    generatedAt: reviewManifest.generatedAt,
    reviewSheetYears: reviewManifest.reviewSheetYears,
    programCount: reviewManifest.programCount,
    paymentCount: reviewManifest.paymentCount,
    manifestSha256: sha256(reviewManifestText),
    files: reviewFiles,
  },
  official: {
    generatedAt: officialManifest.generatedAt,
    recordCount: officialIds.length,
    manifestSha256: sha256(officialManifestText),
    idSetSha256: sha256(`${[...officialIds].sort().join("\n")}\n`),
    files: officialFiles,
  },
};
await writeFile(
  new URL("../dist-pages/release.json", import.meta.url),
  `${JSON.stringify(release, null, 2)}\n`,
);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function listFiles(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = [];
  for (const entry of entries) {
    const relativePath = `${prefix}${entry.name}`;
    if (entry.isDirectory()) paths.push(...await listFiles(new URL(`${entry.name}/`, directory), `${relativePath}/`));
    else if (entry.isFile()) paths.push(relativePath);
  }
  return paths.sort();
}
