import { createHash } from "node:crypto";
import { validatePublicUpdateStatus } from "./pages-update-status.mjs";

export async function verifyLivePages({
  baseUrl,
  expectedRunId,
  expectedRunAttempt,
  expectedOutcome,
  expectedCommit,
  fetchImpl = fetch,
  cacheBust = Date.now(),
}) {
  const base = new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  const read = async (path) => {
    const url = new URL(path, base);
    url.searchParams.set("verify", String(cacheBust));
    const response = await fetchImpl(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  };
  const [releaseBytes, statusBytes, manifestBytes, officialManifestBytes] = await Promise.all([
    read("release.json"),
    read("update-status.json"),
    read("data/manifest.json"),
    read("data/official/manifest.json"),
  ]);
  const release = parseJson(releaseBytes, "release.json");
  const status = validatePublicUpdateStatus(parseJson(statusBytes, "update-status.json"));
  const manifest = parseJson(manifestBytes, "data/manifest.json");
  const officialManifest = parseJson(officialManifestBytes, "data/official/manifest.json");
  if (release.commitSha !== expectedCommit) throw new Error("公開commitが期待値と一致しません");
  if (status.attempt.runId !== String(expectedRunId)) throw new Error("公開更新状態のrun IDが一致しません");
  if (status.attempt.runAttempt !== Number(expectedRunAttempt)) throw new Error("公開更新状態のrun attemptが一致しません");
  if (status.attempt.outcome !== expectedOutcome) throw new Error("公開更新状態の結果が一致しません");
  if (
    status.publishedRelease.commitSha !== release.commitSha
    || status.publishedRelease.generatedAt !== release.generatedAt
    || manifest.generatedAt !== release.generatedAt
  ) throw new Error("公開更新状態・release・manifestが同じ世代ではありません");
  if (sha256(manifestBytes) !== release.manifestSha256) throw new Error("公開manifestのSHAが一致しません");
  if (!release.official || sha256(officialManifestBytes) !== release.official.manifestSha256) {
    throw new Error("公開公式資料manifestのSHAが一致しません");
  }
  const appShellEntries = Object.entries(release.appShell ?? {});
  if (!appShellEntries.some(([path]) => path === "index.html")) throw new Error("公開releaseに画面情報がありません");
  for (const [path, metadata] of appShellEntries) {
    const bytes = await read(path);
    if (bytes.byteLength !== metadata.bytes || sha256(bytes) !== metadata.sha256) {
      throw new Error(`${path}の公開内容がreleaseと一致しません`);
    }
  }
  const manifestFiles = Object.values(manifest.commitments ?? {}).sort();
  if (JSON.stringify(manifestFiles) !== JSON.stringify(Object.keys(release.files ?? {}).sort())) {
    throw new Error("公開manifestとreleaseのファイル一覧が一致しません");
  }
  const ids = [];
  for (const filename of manifestFiles) {
    const bytes = await read(`data/${filename}`);
    const metadata = release.files[filename];
    if (bytes.byteLength !== metadata.bytes || sha256(bytes) !== metadata.sha256) {
      throw new Error(`${filename}の公開内容がreleaseと一致しません`);
    }
    const rows = parseJson(bytes, filename);
    if (!Array.isArray(rows) || rows.length !== metadata.rows) throw new Error(`${filename}の行数が一致しません`);
    ids.push(...rows.map((row) => row.id));
  }
  if (ids.length !== release.recordCount || new Set(ids).size !== ids.length) {
    throw new Error("公開明細の総行数またはID一意性が一致しません");
  }
  if (sha256(Buffer.from(`${[...ids].sort().join("\n")}\n`)) !== release.idSetSha256) {
    throw new Error("公開明細のID集合が一致しません");
  }
  const officialFilenames = Object.values(officialManifest.files ?? {}).sort();
  if (JSON.stringify(officialFilenames) !== JSON.stringify(Object.keys(release.official.files ?? {}).sort())) {
    throw new Error("公開公式資料manifestとreleaseのファイル一覧が一致しません");
  }
  const officialIds = [];
  for (const filename of officialFilenames) {
    const bytes = await read(`data/official/${filename}`);
    const metadata = release.official.files[filename];
    if (bytes.byteLength !== metadata.bytes || sha256(bytes) !== metadata.sha256) {
      throw new Error(`${filename}の公開公式資料がreleaseと一致しません`);
    }
    const rows = parseJson(bytes, filename);
    if (!Array.isArray(rows) || rows.length !== metadata.rows) throw new Error(`${filename}の公式資料行数が一致しません`);
    officialIds.push(...rows.map((row) => row.id));
  }
  if (
    officialManifest.generatedAt !== release.official.generatedAt
    || officialIds.length !== release.official.recordCount
    || officialIds.length !== officialManifest.recordCount
    || new Set(officialIds).size !== officialIds.length
    || sha256(Buffer.from(`${[...officialIds].sort().join("\n")}\n`)) !== release.official.idSetSha256
  ) throw new Error("公開公式資料の世代・総行数またはID集合が一致しません");
  return { release, status, recordCount: ids.length, officialRecordCount: officialIds.length };
}

function parseJson(bytes, label) {
  try { return JSON.parse(bytes.toString("utf8")); } catch { throw new Error(`${label}のJSONが不正です`); }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
