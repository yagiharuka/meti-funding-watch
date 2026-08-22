import { readFile, writeFile } from "node:fs/promises";

const registryPath = new URL("../data/source-registry.json", import.meta.url);
const dataPaths = [
  { url: new URL("../data/funding-data.json", import.meta.url), pretty: false },
  { url: new URL("../data/funding-summary.json", import.meta.url), pretty: true },
];

const registry = JSON.parse(await readFile(registryPath, "utf8"));
const configured = new Map(
  (registry.sources ?? []).map((source) => [source.id, source]),
);

for (const { url, pretty } of dataPaths) {
  const original = await readFile(url, "utf8");
  const data = JSON.parse(original);
  let changed = false;

  for (const source of data.sources ?? []) {
    const declared = configured.get(source.id);
    if (!declared) continue;
    for (const field of ["method", "frequency"]) {
      const value = declared[field];
      if (typeof value !== "string" || !value.trim()) {
        throw new Error(`source-registry.json: ${source.id}.${field} が未定義です`);
      }
      if (source[field] !== value) {
        source[field] = value;
        changed = true;
      }
    }
  }

  if (!changed) continue;
  const serialized = pretty
    ? `${JSON.stringify(data, null, 2)}\n`
    : `${JSON.stringify(data)}\n`;
  await writeFile(url, serialized);
  console.log(`Synced source metadata: ${url.pathname}`);
}
