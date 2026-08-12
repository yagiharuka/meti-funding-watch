import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const DISCOVERY_ISSUE_TITLE = "【自動通知】公式資料の新規リンク候補";

export function discoveryIssueBody(report, runUrl) {
  return [
    "登録済みの公式入口を確認し、未登録リンクまたは取得不能な入口を検出しました。候補は自動公開せず、原資料の形式と意味を検証してから取込定義へ追加します。",
    "",
    `- 実行: ${runUrl}`,
    `- 確認時刻: ${report.checkedAt}`,
    `- 新規資料候補: ${report.unknownDocuments.length}件`,
    `- 新規年度ページ候補: ${report.unknownYearPages.length}件`,
    `- 取得不能: ${report.failures.length}件`,
    "",
    section("新規資料候補", report.unknownDocuments),
    section("新規年度ページ候補", report.unknownYearPages),
    section("取得不能な入口・年度ページ", report.failures.map((item) => `${item.url} (${item.reasonCode})`)),
    "",
    "証跡はこの実行の `official-source-discovery` artifact に保存しています。",
  ].join("\n");
}

function section(title, values) {
  if (!values.length) return `### ${title}\nなし`;
  const visible = values.slice(0, 100).map((value) => `- ${value}`);
  if (values.length > visible.length) visible.push(`- ほか${values.length - visible.length}件（artifact参照）`);
  return `### ${title}\n${visible.join("\n")}`;
}

async function main() {
  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  if (!token || !repository) throw new Error("公式資料リンク通知に必要な環境変数がありません");
  const report = JSON.parse(await readFile(".audit/official-discovery/report.json", "utf8"));
  const api = `https://api.github.com/repos/${repository}`;
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  const runUrl = `${process.env.GITHUB_SERVER_URL ?? "https://github.com"}/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}`;

  async function request(path, options = {}) {
    const response = await fetch(`${api}${path}`, { ...options, headers: { ...headers, ...options.headers } });
    if (!response.ok) throw new Error(`GitHub API ${response.status}: ${path}`);
    return response.status === 204 ? null : response.json();
  }

  const issues = await request("/issues?state=open&per_page=100");
  const issue = issues.find((item) => !item.pull_request && item.title === DISCOVERY_ISSUE_TITLE);
  const needsReview = report.unknownDocuments.length || report.unknownYearPages.length || report.failures.length;
  if (!needsReview) {
    if (issue) {
      await request(`/issues/${issue.number}/comments`, {
        method: "POST",
        body: JSON.stringify({ body: `新規候補・取得失敗がなくなったため自動クローズします。\n\n- 実行: ${runUrl}` }),
        headers: { "Content-Type": "application/json" },
      });
      await request(`/issues/${issue.number}`, { method: "PATCH", body: JSON.stringify({ state: "closed" }), headers: { "Content-Type": "application/json" } });
    }
  } else {
    const body = discoveryIssueBody(report, runUrl);
    if (issue) {
      await request(`/issues/${issue.number}`, { method: "PATCH", body: JSON.stringify({ body }), headers: { "Content-Type": "application/json" } });
    } else {
      await request("/issues", { method: "POST", body: JSON.stringify({ title: DISCOVERY_ISSUE_TITLE, body }), headers: { "Content-Type": "application/json" } });
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
