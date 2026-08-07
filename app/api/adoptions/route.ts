import {
  buildMirasapoSourceUrl,
  normalizeMirasapoSearchParams,
  parseMirasapoSearchHtml,
} from "@/scripts/mirasapo-search.mjs";

const GITHUB_PAGES_ORIGIN = "https://yagiharuka.github.io";

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
  let criteria;
  try {
    criteria = normalizeMirasapoSearchParams(new URL(request.url).searchParams);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "検索条件が不正です" }, 400);
  }

  const sourceUrl = buildMirasapoSourceUrl(criteria);
  try {
    const response = await fetch(sourceUrl, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "METI-Funding-Watch/1.0 (+https://yagiharuka.github.io/meti-funding-watch/)",
      },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new Error(`公式検索がHTTP ${response.status}を返しました`);
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("text/html")) {
      throw new Error("公式検索の応答形式がHTMLではありません");
    }

    const parsed = parseMirasapoSearchHtml(await readHtmlWithLimit(response));
    if (parsed.totalRecords === 0 ? criteria.page !== 1 : criteria.page > parsed.totalPages) {
      return json({ error: "指定されたページは検索結果の範囲外です", sourceUrl: sourceUrl.toString() }, 400);
    }
    return json({
      ...parsed,
      page: criteria.page,
      pageSize: 20,
      retrievedAt: new Date().toISOString(),
      sourceUrl: sourceUrl.toString(),
    }, 200, true);
  } catch (error) {
    console.error("Mirasapo search proxy failed", error);
    return json({
      error: "中小企業庁の公式検索から現在データを取得できません。時間をおいて再度お試しください。",
      sourceUrl: sourceUrl.toString(),
    }, 502);
  }
}
