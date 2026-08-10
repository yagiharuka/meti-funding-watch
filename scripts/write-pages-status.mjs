import { readFile, writeFile } from "node:fs/promises";
import { buildPublicUpdateStatus } from "./pages-update-status.mjs";

const release = JSON.parse(await readFile(new URL("../dist-pages/release.json", import.meta.url), "utf8"));
const summary = JSON.parse(await readFile(new URL("../data/funding-summary.json", import.meta.url), "utf8"));
const gbiz = summary.sources?.find((source) => source.id === "gbiz");
if (!gbiz) throw new Error("更新状態に必要なGビズINFO情報がありません");

const outcome = process.env.PAGES_UPDATE_OUTCOME ?? "unknown";
const runId = process.env.GITHUB_RUN_ID ?? null;
const runAttempt = process.env.GITHUB_RUN_ATTEMPT ?? null;
const repository = process.env.GITHUB_REPOSITORY;
const server = process.env.GITHUB_SERVER_URL ?? "https://github.com";
const runUrl = runId && repository === "yagiharuka/meti-funding-watch"
  ? `${server}/${repository}/actions/runs/${runId}`
  : null;
const status = buildPublicUpdateStatus({
  outcome,
  runId,
  runAttempt,
  attemptedAt: process.env.PAGES_UPDATE_ATTEMPTED_AT ?? new Date().toISOString(),
  runUrl,
  release,
  lastSuccessfulImportAt: gbiz.lastSuccessfulImportAt ?? null,
});

await writeFile(
  new URL("../dist-pages/update-status.json", import.meta.url),
  `${JSON.stringify(status, null, 2)}\n`,
);
