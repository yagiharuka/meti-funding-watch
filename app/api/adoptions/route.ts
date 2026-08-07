import {
  buildMirasapoSourceUrl,
  normalizeMirasapoSearchParams,
  parseMirasapoSearchHtml,
  validateMirasapoSearchResult,
} from "@/scripts/mirasapo-search.mjs";

const GITHUB_PAGES_ORIGIN = "https://yagiharuka.github.io";
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_REQUESTS = 30;
const rateLimitBuckets = new Map<string, { startedAt: number; count: number }>();

function enforceRateLimit(request: Request) {
  const now = Date.now();
  const clientKey = request.headers.get("CF-Connecting-IP")
    || request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim()
    || "unknown";
  const current = rateLimitBuckets.get(clientKey);
  if (!current || now - current.startedAt >= RATE_LIMIT_WINDOW_MS) {
    rateLimitBuckets.set(clientKey, { startedAt: now, count: 1 });
    return null;
  }
  current.count += 1;
  if (rateLimitBuckets.size > 5_000) {
    for (const [key, bucket] of rateLimitBuckets) {
      if (now - bucket.startedAt >= RATE_LIMIT_WINDOW_MS) rateLimitBuckets.delete(key);
    }
  }
  return current.count > RATE_LIMIT_REQUESTS
    ? Math.max(1, Math.ceil((RATE_LIMIT_WINDOW_MS - (now - current.startedAt)) / 1_000))
    : null;
}

function corsHeaders(cacheable = false) {
  return {
    "Access-Control-Allow-Origin": GITHUB_PAGES_ORIGIN,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": cacheable ? "public, max-age=0, s-maxage=300" : "no-store",
    Vary: "Origin",
  };
}

function json(body: unknown, status = 200, cacheable = false) {
  return Response.json(body, { status, headers: corsHeaders(cacheable) });
}

async function readHtmlWithLimit(response: Response, maximumBytes = 1_000_000) {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    throw new Error("公式検索の応答が想定サイズを超えました");
  }
  if (!response.body) throw new Error("公式検索の応答本文がありません");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maximumBytes) {
      await reader.cancel();
      throw new Error("公式検索の応答が想定サイズを超えました");
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function GET(request: Request) {
  const retryAfter = enforceRateLimit(request);
  if (retryAfter !== null) {
    const response = json({ error: "検索が集中しています。少し待ってから再度お試しください。" }, 429);
    response.headers.set("Retry-After", String(retryAfter));
    return response;
  }
  let criteria;
  try {
    criteria = normalizeMirasapoSearchParams(new URL(request.url).searchParams);
  } catch (error) {
    const diagnostic = error instanceof Error
      ? `${error.name}: ${error.message}`
      : `Unknown error: ${String(error)}`;
    console.error(`Mirasapo search request rejected: ${diagnostic}`);
    return json({ error: "検索条件が不正です。入力内容を確認してください。" }, 400);
  }

  const sourceUrl = buildMirasapoSourceUrl(criteria);
  try {
    const response = await fetch(sourceUrl, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "METI-Funding-Watch/1.0 (+https://yagiharuka.github.io/meti-funding-watch/)",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status >= 300 && response.status < 400) {
      throw new Error(`公式検索がHTTP ${response.status}のリダイレクトを返しました`);
    }
    if (!response.ok) {
      throw new Error(`公式検索がHTTP ${response.status}を返しました`);
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("text/html")) {
      throw new Error("公式検索の応答形式がHTMLではありません");
    }

    const parsed = parseMirasapoSearchHtml(await readHtmlWithLimit(response), { includeQuery: true });
    try {
      validateMirasapoSearchResult(parsed, criteria);
    } catch (error) {
      if (error instanceof RangeError) {
        return json({ error: "指定されたページは検索結果の範囲外です。" }, 400);
      }
      throw error;
    }
    return json({
      totalRecords: parsed.totalRecords,
      totalPages: parsed.totalPages,
      records: parsed.records,
      page: criteria.page,
      pageSize: 20,
      retrievedAt: new Date().toISOString(),
      sourceUrl: sourceUrl.toString(),
    }, 200, true);
  } catch (error) {
    const diagnostic = error instanceof Error
      ? `${error.name}: ${error.message}`
      : `Unknown error: ${String(error)}`;
    console.error(`Mirasapo search proxy failed: ${diagnostic}`);
    return json({
      error: "中小企業庁の公式検索から現在データを取得できません。時間をおいて再度お試しください。",
    }, 502);
  }
}
