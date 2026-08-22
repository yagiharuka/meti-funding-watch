import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("one-shot metadata repair is push-only and never runs the external refresh on that push", async () => {
  const [workflow, repair] = await Promise.all([
    readFile(new URL("../.github/workflows/refresh-gbiz-data.yml", import.meta.url), "utf8"),
    readFile(new URL("../scripts/repair-source-metadata-once.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(workflow, /push:[\s\S]*scripts\/repair-source-metadata-once\.mjs/);
  assert.match(workflow, /repair_metadata:\n\s+if: github\.event_name == 'push'/);
  assert.match(workflow, /refresh:\n\s+if: github\.event_name != 'push'/);
  assert.match(workflow, /node scripts\/repair-source-metadata-once\.mjs/);
  assert.match(workflow, /git add scripts\/update-data\.mjs data\/funding-data\.json data\/funding-summary\.json/);
  assert.doesNotMatch(workflow.slice(workflow.indexOf("repair_metadata:"), workflow.indexOf("\n  refresh:")), /npm run update:data|GBIZINFO_API_TOKEN/);

  assert.match(repair, /GビズINFO全件CSVを毎日再取得/);
  assert.match(repair, /method: source\.method/);
  assert.match(repair, /frequency: source\.frequency/);
  assert.match(repair, /assert\.doesNotMatch\(nextUpdater, \/GビズINFO全件CSVを毎日再取得\//);
  assert.match(repair, /source\.method = gbiz\.method/);
  assert.match(repair, /source\.frequency = gbiz\.frequency/);
});
