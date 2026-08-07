import { normalizeFundingSearchParams, searchFundingRecords } from "@/scripts/funding-search.mjs";

const ORIGIN = "https://yagiharuka.github.io";
const CURRENT_KEY = "funding-index/current.json";
const buckets = new Map<string, { start: number; count: number }>();
let cache: { commit: string; records: Record<string, unknown>[] } | null = null;

function headers(cacheable = false) {
  return { "Access-Control-Allow-Origin": ORIGIN, "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Cache-Control": cacheable ? "public, max-age=0, s-maxage=60" : "no-store", Vary: "Origin" };
}
function json(value: unknown, status = 200, cacheable = false) { return Response.json(value, { status, headers: headers(cacheable) }); }
function limited(request: Request) {
  const now = Date.now();
  const key = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const item = buckets.get(key);
  if (!item || now - item.start >= 60_000) { buckets.set(key, { start: now, count: 1 }); return false; }
  item.count += 1;
  return item.count > 120;
}

export async function OPTIONS() { return new Response(null, { status: 204, headers: headers() }); }

export async function GET(request: Request) {
  if (limited(request)) return json({ error: "検索が集中しています。少し待ってから再度お試しください。" }, 429);
  try {
    const bucket = await getBucket();
    const metadataObject = await bucket.get(CURRENT_KEY);
    if (!metadataObject) return json({ error: "検索データを準備しています。" }, 503);
    const metadata = await metadataObject.json() as {
      releaseCommit: string; generatedAt: string; recordCount: number; idSetSha256: string;
      objectKey: string; agencies: string[]; syncedAt: string;
    };
    if (!/^[0-9a-f]{40}$/.test(metadata.releaseCommit) || !Array.isArray(metadata.agencies)) throw new Error("検索metadataが不正です");
    if (!cache || cache.commit !== metadata.releaseCommit) {
      const object = await bucket.get(metadata.objectKey);
      if (!object) throw new Error("検索indexがありません");
      const stream = object.body.pipeThrough(new DecompressionStream("gzip"));
      const records = JSON.parse(await new Response(stream).text());
      if (!Array.isArray(records) || records.length !== metadata.recordCount) throw new Error("検索indexの行数が不正です");
      cache = { commit: metadata.releaseCommit, records };
    }
    const criteria = normalizeFundingSearchParams(new URL(request.url).searchParams);
    const result = searchFundingRecords(cache.records, criteria, metadata.agencies);
    return json({ ...result, agencies: metadata.agencies, releaseCommit: metadata.releaseCommit, generatedAt: metadata.generatedAt, syncedAt: metadata.syncedAt }, 200, true);
  } catch (error) {
    if (error instanceof RangeError) return json({ error: error.message }, 400);
    console.error(`Funding search failed: ${error instanceof Error ? error.message : String(error)}`);
    return json({ error: "検索データを現在取得できません。時間をおいて再度お試しください。" }, 503);
  }
}

async function getBucket() {
  const { env } = await import("cloudflare:workers");
  return env.BUCKET;
}
