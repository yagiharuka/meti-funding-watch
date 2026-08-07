import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, stat, writeFile } from "node:fs/promises";
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
};
await writeFile(
  new URL("../dist-pages/release.json", import.meta.url),
  `${JSON.stringify(release, null, 2)}\n`,
);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
