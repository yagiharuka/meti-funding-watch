export const UPDATE_ISSUE_TITLE = "【自動通知】GビズINFO更新停止";

export function escapeTable(value) {
  if (value === undefined) return "—";
  return String(value === null ? "null" : value).replaceAll("|", "\\|").replace(/\r?\n/g, " ");
}

export function correctionTable(candidates = []) {
  const rows = [];
  for (const candidate of candidates) {
    const fields = candidate.changedFields ?? candidate.changedFieldNames ?? [];
    for (const field of fields) {
      rows.push(`| ${escapeTable(candidate.key)} | ${escapeTable(candidate.candidate?.organization ?? candidate.previous?.organization)} | ${escapeTable(field)} | ${escapeTable(candidate.previous?.[field])} | ${escapeTable(candidate.candidate?.[field])} |`);
    }
  }
  return rows.length
    ? ["| 出典キー | 法人等 | 変更項目 | 変更前 | 変更後 |", "|---|---|---|---|---|", ...rows].join("\n")
    : "訂正候補の詳細は証跡artifactを確認してください。";
}

export function buildFailureBody({ runUrl, snapshot, failure }) {
  return [
    "GビズINFOの自動更新を停止しました。検証済みの前回データを維持し、新しいデータは公開していません。",
    "",
    `- 実行: ${runUrl}`,
    `- 検出日時: ${failure?.failedAt ?? new Date().toISOString()}`,
    `- 理由: ${escapeTable(failure?.message ?? "更新処理失敗")}`,
    "- 証跡: この実行の `gbiz-source-evidence` artifact",
    "",
    "### 訂正候補",
    correctionTable(snapshot?.correctionCandidates),
  ].join("\n");
}
