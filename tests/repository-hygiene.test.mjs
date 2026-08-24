import assert from "node:assert/strict";
import test from "node:test";

import { validateRepositoryHygiene } from "../scripts/check-repository-hygiene.mjs";

test("rejects tracked tmp files", () => {
  const result = validateRepositoryHygiene({ trackedFiles: ["src/a.ts", "tmp-do-not-use"] });
  assert.equal(result.ok, false);
  assert.match(result.message, /tmp-do-not-use/);
});

test("requires a dependency-change rationale in PRs", () => {
  const missing = validateRepositoryHygiene({
    eventName: "pull_request",
    changedFiles: ["package-lock.json"],
    trackedFiles: [],
    body: "### このPRが触るカタログID\n該当なし：依存更新のみ",
  });
  assert.equal(missing.ok, false);
  assert.match(missing.message, /依存関係の変更理由/);

  const present = validateRepositoryHygiene({
    eventName: "pull_request",
    changedFiles: ["package.json", "package-lock.json"],
    trackedFiles: [],
    body: "### 依存関係の変更理由\n脆弱性修正のため依存ライブラリを更新する。\n\n### このPRが触るカタログID\n該当なし：依存更新のみ",
  });
  assert.equal(present.ok, true);
});

test("does not require dependency text when dependency files are untouched", () => {
  const result = validateRepositoryHygiene({
    eventName: "pull_request",
    changedFiles: ["app/page.tsx"],
    trackedFiles: ["app/page.tsx"],
    body: "",
  });
  assert.equal(result.ok, true);
});
