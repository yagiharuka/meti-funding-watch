import { pathToFileURL } from "node:url";

export const GBIZ_REFRESH_WORKFLOW = "refresh-gbiz-data.yml";
export const GBIZ_CADENCE_ISSUE_TITLE = "【自動通知】GビズINFO週次更新未実行";
const HOUR_MS = 60 * 60 * 1000;
const EARLY_TOLERANCE_MS = 15 * 60 * 1000;

function validDate(value, label) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${label}が不正です`);
  return date;
}

export function expectedGbizRefreshAt(now = new Date()) {
  const current = validDate(now, "現在時刻");
  const candidate = new Date(current);
  const daysSinceMonday = (candidate.getUTCDay() + 6) % 7;
  candidate.setUTCDate(candidate.getUTCDate() - daysSinceMonday);
  candidate.setUTCHours(21, 0, 0, 0);
  if (candidate.getTime() > current.getTime()) candidate.setUTCDate(candidate.getUTCDate() - 7);
  return candidate;
}

export function evaluateGbizRefreshCadence({ runs = [], now = new Date(), graceHours = 6 } = {}) {
  const current = validDate(now, "現在時刻");
  if (!Number.isFinite(graceHours) || graceHours < 0 || graceHours > 48) throw new Error("graceHoursが不正です");
  const expectedAt = expectedGbizRefreshAt(current);
  const deadlineAt = new Date(expectedAt.getTime() + graceHours * HOUR_MS);
  if (current.getTime() < deadlineAt.getTime()) {
    return { status: "not_due", expectedAt: expectedAt.toISOString(), deadlineAt: deadlineAt.toISOString(), matchingRun: null };
  }

  const lowerBound = expectedAt.getTime() - EARLY_TOLERANCE_MS;
  const matchingRuns = runs
    .map((run) => ({ ...run, createdDate: validDate(run.created_at, "workflow run作成日時") }))
    .filter((run) => run.createdDate.getTime() >= lowerBound && run.createdDate.getTime() <= current.getTime())
    .sort((left, right) => right.createdDate.getTime() - left.createdDate.getTime());
  const matchingRun = matchingRuns[0] ?? null;
  return {
    status: matchingRun ? "ok" : "missed",
    expectedAt: expectedAt.toISOString(),
    deadlineAt: deadlineAt.toISOString(),
    matchingRun: matchingRun ? {
      id: matchingRun.id,
      event: matchingRun.event,
      status: matchingRun.status,
      conclusion: matchingRun.conclusion ?? null,
      created_at: matchingRun.created_at,
      html_url: matchingRun.html_url,
    } : null,
  };
}

async function requestJson(url, token, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers ?? {}),
    },
  });
  if (!response.ok) throw new Error(`GitHub API ${response.status}: ${url}`);
  return response.status === 204 ? null : response.json();
}

export async function runCadenceWatch({
  token = process.env.GITHUB_TOKEN,
  repository = process.env.GITHUB_REPOSITORY,
  serverUrl = process.env.GITHUB_SERVER_URL ?? "https://github.com",
  now = new Date(),
} = {}) {
  if (!token || !repository) throw new Error("GビズINFO週次監視に必要な環境変数がありません");
  const api = `https://api.github.com/repos/${repository}`;
  const workflowRuns = await requestJson(`${api}/actions/workflows/${GBIZ_REFRESH_WORKFLOW}/runs?per_page=20`, token);
  const evaluation = evaluateGbizRefreshCadence({ runs: workflowRuns?.workflow_runs ?? [], now });
  const issues = await requestJson(`${api}/issues?state=open&per_page=100`, token);
  const issue = issues.find((item) => !item.pull_request && item.title === GBIZ_CADENCE_ISSUE_TITLE);

  if (evaluation.status === "not_due") return evaluation;
  if (evaluation.status === "ok") {
    if (issue) {
      const runUrl = evaluation.matchingRun?.html_url ?? `${serverUrl}/${repository}/actions/workflows/${GBIZ_REFRESH_WORKFLOW}`;
      await requestJson(`${api}/issues/${issue.number}/comments`, token, {
        method: "POST",
        body: JSON.stringify({ body: `週次更新runを確認したため自動クローズします。\n\n- 実行: ${runUrl}` }),
        headers: { "Content-Type": "application/json" },
      });
      await requestJson(`${api}/issues/${issue.number}`, token, {
        method: "PATCH",
        body: JSON.stringify({ state: "closed" }),
        headers: { "Content-Type": "application/json" },
      });
    }
    return evaluation;
  }

  const workflowUrl = `${serverUrl}/${repository}/actions/workflows/${GBIZ_REFRESH_WORKFLOW}`;
  const body = [
    "GビズINFOの週次更新について、予定時刻から猶予時間を過ぎてもworkflow run自体を確認できませんでした。",
    "",
    `- 予定実行: ${evaluation.expectedAt}`,
    `- 検知期限: ${evaluation.deadlineAt}`,
    `- workflow: ${workflowUrl}`,
    "- 判定: workflow run未作成（更新処理の成功・失敗以前の問題）",
    "",
    "GitHub Actionsのschedule停止・無効化・権限変更等を確認してください。",
  ].join("\n");
  if (issue) {
    await requestJson(`${api}/issues/${issue.number}/comments`, token, {
      method: "POST",
      body: JSON.stringify({ body }),
      headers: { "Content-Type": "application/json" },
    });
  } else {
    await requestJson(`${api}/issues`, token, {
      method: "POST",
      body: JSON.stringify({ title: GBIZ_CADENCE_ISSUE_TITLE, body }),
      headers: { "Content-Type": "application/json" },
    });
  }
  throw new Error(`GビズINFO週次更新runがありません: expected ${evaluation.expectedAt}`);
}

async function main() {
  const result = await runCadenceWatch();
  console.log(`Gbiz cadence watch: ${result.status} / expected ${result.expectedAt}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
