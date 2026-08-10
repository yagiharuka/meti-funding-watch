import { readFile } from "node:fs/promises";
import { UPDATE_ISSUE_TITLE, buildFailureBody } from "./update-issue.mjs";

const token = process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;
const outcome = process.env.UPDATE_OUTCOME ?? process.env.REFRESH_OUTCOME;
if (!token || !repository || !outcome) throw new Error("更新通知に必要な環境変数がありません");
if (outcome !== "success" && outcome !== "failure") throw new Error("更新通知の結果が不正です");
const phase = process.env.UPDATE_PHASE ?? "official-data-refresh";
const reason = process.env.FAILURE_REASON;
const api = `https://api.github.com/repos/${repository}`;
const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
const runUrl = `${process.env.GITHUB_SERVER_URL ?? "https://github.com"}/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}`;

async function request(path, options = {}) {
  const response = await fetch(`${api}${path}`, { ...options, headers: { ...headers, ...options.headers } });
  if (!response.ok) throw new Error(`GitHub API ${response.status}: ${path}`);
  return response.status === 204 ? null : response.json();
}

const issues = await request(`/issues?state=open&per_page=100`);
const issue = issues.find((item) => !item.pull_request && item.title === UPDATE_ISSUE_TITLE);
if (outcome === "success") {
  if (issue) {
    await request(`/issues/${issue.number}/comments`, { method: "POST", body: JSON.stringify({ body: `更新に成功したため自動クローズします。\n\n- 実行: ${runUrl}` }), headers: { "Content-Type": "application/json" } });
    await request(`/issues/${issue.number}`, { method: "PATCH", body: JSON.stringify({ state: "closed" }), headers: { "Content-Type": "application/json" } });
  }
} else {
  const [snapshot, failure] = await Promise.all([
    readJson(".audit/gbiz/snapshot.json"),
    readJson(".audit/gbiz/failure.json"),
  ]);
  const body = buildFailureBody({ runUrl, snapshot, failure, phase, reason });
  if (issue) {
    await request(`/issues/${issue.number}/comments`, { method: "POST", body: JSON.stringify({ body }), headers: { "Content-Type": "application/json" } });
  } else {
    await request("/issues", { method: "POST", body: JSON.stringify({ title: UPDATE_ISSUE_TITLE, body }), headers: { "Content-Type": "application/json" } });
  }
}

async function readJson(path) {
  try { return JSON.parse(await readFile(path, "utf8")); } catch { return null; }
}
