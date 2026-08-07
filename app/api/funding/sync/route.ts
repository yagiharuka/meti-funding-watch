import { sortFundingRecords } from "@/scripts/funding-search.mjs";

const REPOSITORY = "yagiharuka/meti-funding-watch";
const AUDIENCE = "meti-funding-watch-sync";
const ISSUER = "https://token.actions.githubusercontent.com";
const PAGES = "https://yagiharuka.github.io/meti-funding-watch/";
const CURRENT_KEY = "funding-index/current.json";

export async function POST(request: Request) {
  try {
    const bucket = await getBucket();
    const authorization = request.headers.get("Authorization") ?? "";
    if (!authorization.startsWith("Bearer ")) throw new Error("OIDC tokenがありません");
    const claims = await verifyOidc(authorization.slice(7));
    const body = await request.json() as { expectedCommit?: string };
    if (!body.expectedCommit || !/^[0-9a-f]{40}$/.test(body.expectedCommit)) throw new Error("commitが不正です");
    await verifyCommitRelationship(claims, body.expectedCommit);
    const release = await fetchJson(`${PAGES}release.json`);
    if (release.commitSha !== body.expectedCommit) throw new Error("公開releaseと同期対象commitが一致しません");
    const manifestResponse = await fetch(`${PAGES}data/manifest.json`, { redirect: "manual", signal: AbortSignal.timeout(15_000) });
    if (!manifestResponse.ok) throw new Error("manifestを取得できません");
    const manifestBytes = await manifestResponse.arrayBuffer();
    if (await sha256(manifestBytes) !== release.manifestSha256) throw new Error("manifest SHAが一致しません");
    const manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
    const records: Record<string, unknown>[] = [];
    const ids = new Set<string>();
    for (const filename of Object.values(manifest.commitments) as string[]) {
      const expected = release.files[filename];
      if (!expected) throw new Error(`releaseに${filename}がありません`);
      const response = await fetch(`${PAGES}data/${filename}`, { redirect: "manual", signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`${filename}を取得できません`);
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength !== expected.bytes || await sha256(bytes) !== expected.sha256) throw new Error(`${filename}の証跡が一致しません`);
      const rows = JSON.parse(new TextDecoder().decode(bytes));
      if (!Array.isArray(rows) || rows.length !== expected.rows) throw new Error(`${filename}の行数が一致しません`);
      for (const row of rows) {
        validateRow(row);
        if (ids.has(row.id)) throw new Error("明細IDが重複しています");
        ids.add(row.id);
        records.push(row);
      }
    }
    if (records.length !== release.recordCount || await idSetSha(ids) !== release.idSetSha256) throw new Error("release全体の証跡が一致しません");
    const sorted = sortFundingRecords(records);
    const payload = new TextEncoder().encode(JSON.stringify(sorted));
    const compressed = await new Response(new Blob([payload]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
    const objectKey = `funding-index/${body.expectedCommit}.json.gz`;
    await bucket.put(objectKey, compressed, { httpMetadata: { contentType: "application/json", contentEncoding: "gzip" }, customMetadata: { commit: body.expectedCommit } });
    const metadata = {
      schemaVersion: 1,
      releaseCommit: body.expectedCommit,
      generatedAt: release.generatedAt,
      recordCount: records.length,
      idSetSha256: release.idSetSha256,
      objectKey,
      agencies: [...new Set(records.map((row) => String(row.sourceAgency)))].sort((a, b) => a.localeCompare(b, "ja")),
      syncedAt: new Date().toISOString(),
    };
    await bucket.put(CURRENT_KEY, JSON.stringify(metadata), { httpMetadata: { contentType: "application/json" } });
    return Response.json(metadata, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error(`Funding sync rejected: ${error instanceof Error ? error.message : String(error)}`);
    return Response.json({ error: "同期を受け付けられませんでした。" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
}

async function getBucket() {
  const { env } = await import("cloudflare:workers");
  return env.BUCKET;
}

async function verifyOidc(token: string) {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("JWT形式が不正です");
  const header = JSON.parse(decode(parts[0]));
  const claims = JSON.parse(decode(parts[1]));
  if (header.alg !== "RS256" || !header.kid) throw new Error("JWT headerが不正です");
  const jwks = await fetchJson(`${ISSUER}/.well-known/jwks`);
  const jwk = jwks.keys?.find((key: JsonWebKey & { kid?: string }) => key.kid === header.kid);
  if (!jwk) throw new Error("JWT署名鍵がありません");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, bytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  const now = Math.floor(Date.now() / 1000);
  if (!valid || claims.iss !== ISSUER || claims.aud !== AUDIENCE || claims.repository !== REPOSITORY || claims.ref !== "refs/heads/main" || claims.exp < now || claims.nbf > now + 30) throw new Error("JWT claimsが不正です");
  if (!String(claims.workflow_ref ?? "").includes(`${REPOSITORY}/.github/workflows/update-data.yml@refs/heads/main`)) throw new Error("workflowが不正です");
  return claims;
}

async function verifyCommitRelationship(claims: Record<string, string>, expectedCommit: string) {
  const head = await fetchJson(`https://api.github.com/repos/${REPOSITORY}/commits/main`);
  if (head.sha !== expectedCommit) throw new Error("mainのHEADではありません");
  if (claims.sha === expectedCommit) return;
  const commit = await fetchJson(`https://api.github.com/repos/${REPOSITORY}/commits/${expectedCommit}`);
  if (!commit.parents?.some((parent: { sha: string }) => parent.sha === claims.sha)) throw new Error("workflow起点commitとの親子関係がありません");
}

async function fetchJson(url: string) {
  const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "METI-Funding-Watch/1.0" }, redirect: "manual", signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  return response.json();
}
function decode(value: string) { return new TextDecoder().decode(bytes(value)); }
function bytes(value: string) { const normalized = value.replaceAll("-", "+").replaceAll("_", "/"); return Uint8Array.from(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")), (char) => char.charCodeAt(0)); }
async function sha256(value: ArrayBuffer) { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", value))].map((item) => item.toString(16).padStart(2, "0")).join(""); }
async function idSetSha(ids: Set<string>) { return sha256(new TextEncoder().encode(`${[...ids].sort().join("\n")}\n`).buffer as ArrayBuffer); }
function validateRow(row: Record<string, unknown>) {
  if (!row || typeof row.id !== "string" || !row.id || typeof row.organization !== "string" || !/^\d{13}$/.test(String(row.corporateNumber)) || typeof row.sourceAgency !== "string" || !["contracted", "subsidy_published"].includes(String(row.stage)) || typeof row.sourceKey !== "string") throw new Error("公開行の形式が不正です");
}
