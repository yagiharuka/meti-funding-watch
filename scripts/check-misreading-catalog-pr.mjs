import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const CATALOG_PATH = "docs/MISREADING_CATALOG.md";
const SECTION_HEADING = "### このPRが触るカタログID";

export function hasCatalogRowDiff(catalogDiff = "") {
  return catalogDiff
    .split("\n")
    .some((line) => /^[+-]\s*\| M-\d{3} \|/u.test(line));
}

export function validateCatalogPassage({ body = "", changedFiles = [], catalogDiff = "" }) {
  if (changedFiles.includes(CATALOG_PATH) && hasCatalogRowDiff(catalogDiff)) {
    return { ok: true, reason: "catalog-updated" };
  }

  const start = body.indexOf(SECTION_HEADING);
  if (start === -1) return { ok: false, message: `PR本文に「${SECTION_HEADING}」がありません。` };

  const afterHeading = body.slice(start + SECTION_HEADING.length);
  const nextHeading = afterHeading.search(/\n#{2,3}\s/u);
  const section = (nextHeading === -1 ? afterHeading : afterHeading.slice(0, nextHeading))
    .replace(/<!--[\s\S]*?-->/gu, "")
    .trim();
  const match = section.match(/該当なし\s*[：:]\s*(.+)/su);
  if (!match) {
    const detail = changedFiles.includes(CATALOG_PATH)
      ? "カタログ差分に M-xxx 行の追加・更新がありません。"
      : "カタログ差分がありません。";
    return { ok: false, message: `${detail}「該当なし：理由」を記載してください。` };
  }

  const reason = match[1].replace(/\s+/gu, " ").trim();
  if (reason.length < 5) return { ok: false, message: "「該当なし」の理由を具体的に記載してください。" };
  return { ok: true, reason: "explicit-no-impact" };
}

async function main() {
  if (process.env.GITHUB_EVENT_NAME !== "pull_request") return;
  if (!process.env.GITHUB_EVENT_PATH) throw new Error("GITHUB_EVENT_PATH is required for pull_request events");

  const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, "utf8"));
  const baseSha = event.pull_request?.base?.sha;
  const headSha = event.pull_request?.head?.sha;
  if (!baseSha || !headSha) throw new Error("pull request base/head SHA is missing");

  const diffRange = `${baseSha}...${headSha}`;
  const changedFiles = execFileSync("git", ["diff", "--name-only", diffRange], { encoding: "utf8" })
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean);
  const catalogDiff = changedFiles.includes(CATALOG_PATH)
    ? execFileSync("git", ["diff", "--unified=0", diffRange, "--", CATALOG_PATH], { encoding: "utf8" })
    : "";
  const result = validateCatalogPassage({ body: event.pull_request.body ?? "", changedFiles, catalogDiff });
  if (!result.ok) {
    console.error(`Misreading catalog gate: ${result.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
