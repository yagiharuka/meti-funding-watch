import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("year filter warning visibly explains the SMEA-heavy undated rows", async () => {
  const css = await readFile("pages-site/data-reading-guide.css", "utf8");
  assert.match(css, /#records \.filters \+ \.filter-note::after/);
  assert.match(css, /日付の記載がない行の大半は中小企業庁の補助金です/);
  assert.match(css, /年度指定時の結果では中小企業庁の補助金が大きく欠けます/);
});
