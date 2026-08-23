import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";

export const COMPANY_SEARCH_BUCKET_COUNT = 32;

export async function buildGbizCompanySearchArtifacts({ rows, generatedAt, outputDirectory }) {
  if (!Array.isArray(rows) || !rows.length) throw new Error("GビズINFO企業検索索引の元データがありません");
  if (typeof generatedAt !== "string" || !generatedAt) throw new Error("GビズINFO企業検索索引の生成日時がありません");

  const entitiesByNumber = new Map();
  const rowsByBucket = new Map();
  const agencies = new Set();

  for (const row of rows) {
    const corporateNumber = String(row.corporateNumber ?? "");
    if (!/^\d{13}$/.test(corporateNumber)) throw new Error("企業検索索引に法人番号が不正な行があります");
    const bucket = bucketForCompany(corporateNumber);
    const entity = entitiesByNumber.get(corporateNumber) ?? {
      organization: row.organization,
      corporateNumber,
      aliases: new Set(),
      bucket,
      records: 0,
    };
    entity.aliases.add(row.organization);
    entity.records += 1;
    entitiesByNumber.set(corporateNumber, entity);
    const bucketRows = rowsByBucket.get(bucket) ?? [];
    bucketRows.push(row);
    rowsByBucket.set(bucket, bucketRows);
    agencies.add(row.sourceAgency);
  }

  const entities = [...entitiesByNumber.values()]
    .map((entity) => ({
      organization: entity.organization,
      corporateNumber: entity.corporateNumber,
      aliases: [...entity.aliases].filter((name) => name !== entity.organization).sort((a, b) => a.localeCompare(b, "ja")),
      bucket: entity.bucket,
      records: entity.records,
    }))
    .sort((a, b) => a.corporateNumber.localeCompare(b.corporateNumber));
  const index = {
    schemaVersion: 1,
    generatedAt,
    entityCount: entities.length,
    recordCount: rows.length,
    bucketCount: COMPANY_SEARCH_BUCKET_COUNT,
    agencies: [...agencies].sort((a, b) => a.localeCompare(b, "ja")),
    entities,
  };

  await mkdir(outputDirectory, { recursive: true });
  const indexFilename = "gbiz-company-search-index.json";
  await writeFile(new URL(indexFilename, outputDirectory), `${JSON.stringify(index)}\n`);
  const bucketFilenames = [];
  for (let index = 0; index < COMPANY_SEARCH_BUCKET_COUNT; index += 1) {
    const bucket = index.toString(16).padStart(2, "0");
    const filename = `gbiz-company-records-${bucket}.json`;
    bucketFilenames.push(filename);
    await writeFile(new URL(filename, outputDirectory), `${JSON.stringify(rowsByBucket.get(bucket) ?? [])}\n`);
  }
  return { indexFilename, bucketFilenames, entityCount: entities.length, recordCount: rows.length };
}

export function bucketForCompany(value) {
  const byte = createHash("sha256").update(String(value)).digest()[0];
  return (byte % COMPANY_SEARCH_BUCKET_COUNT).toString(16).padStart(2, "0");
}
