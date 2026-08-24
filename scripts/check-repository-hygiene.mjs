import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const DEPENDENCY_FILES = new Set(["package.json", "package-lock.json"]);
const DEPENDENCY_HEADING = "### 依存関係の変更理由";

function sectionAfterHeading(body, heading) {
  const start = body.indexOf(heading);
  if (start === -1) return "";
  const after = body.slice(start + heading.length);
  const next = after.search(/\n#{2,3}\s/u);
  return (next === -1 ? after : after.slice(0, next))
    .replace(/<!--[\s\S]*?-->/gu, "")
    .trim();
}

export function validateRepositoryHygiene({ changedFiles = [], trackedFiles = [], body = "", eventName = "" }) {
  const temporary = trackedFiles.filter((path) => path.split("/").some((part) => /^tmp-/u.test(part)));
  if (temporary.length) {
    return { ok: false, message: `一時ファイルを追跡しないでください: ${temporary.join(", ")}` };
  }

  if (eventName === "pull_request" && changedFiles.some((path) => DEPENDENCY_FILES.has(path))) {
    const reason = sectionAfterHeading(body, DEPENDENCY_HEADING).replace(/\s+/gu, " ").trim();
    if (reason.length < 10) {
      return { ok: false, message: `依存ファイルを変更するPRには「${DEPENDENCY_HEADING}」と具体的な理由が必要です。` };
    }
  }

  return { ok: true };
}

async function main() {
  const trackedFiles = execFileSync("git", ["ls-files"], { encoding: "utf8" })
    .split("\n").map((value) => value.trim()).filter(Boolean);
  let changedFiles = [];
  let body = "";

  if (process.env.GITHUB_EVENT_NAME === "pull_request") {
    if (!process.env.GITHUB_EVENT_PATH) throw new Error("GITHUB_EVENT_PATH is required for pull_request events");
    const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, "utf8"));
    const baseSha = event.pull_request?.base?.sha;
    const headSha = event.pull_request?.head?.sha;
    if (!baseSha || !headSha) throw new Error("pull request base/head SHA is missing");
    changedFiles = execFileSync("git", ["diff", "--name-only", `${baseSha}...${headSha}`], { encoding: "utf8" })
      .split("\n").map((value) => value.trim()).filter(Boolean);
    body = event.pull_request.body ?? "";
  }

  const result = validateRepositoryHygiene({
    changedFiles,
    trackedFiles,
    body,
    eventName: process.env.GITHUB_EVENT_NAME ?? "",
  });
  if (!result.ok) {
    console.error(`Repository hygiene gate: ${result.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
