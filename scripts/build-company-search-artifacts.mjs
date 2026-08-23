import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";

import { normalizeCompanyIdentity } from "./company-search.mjs";

export const COMPANY_SEARCH_BUCKET_COUNT = 32;

export async function buildGbizCompanySearchArtifacts({ rows, generatedAt, outputDirectory }) {
  if (!Array.isArray(rows) || !rows.length) throw new Error("GビズINFO企業検索索引の元データがありません");
  if (typeof generatedAt !== "string" || !generatedAt) throw new Error("GビズINFO企業検索索引の生成日時がありません");

  const entitiesByNumber = new Map();
  const rowsByBucket = new Map();
  const rowsByFilterPartition = new Map();
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
    const partitionKey = JSON.stringify([row.fiscalYear, row.sourceAgency, row.stage]);
    const partitionRows = rowsByFilterPartition.get(partitionKey) ?? [];
    partitionRows.push(row);
    rowsByFilterPartition.set(partitionKey, partitionRows);
    agencies.add(row.sourceAgency);
  }

  const entities = [...entitiesByNumber.values()]
    .map((entity) => {
      const aliases = [...entity.aliases].filter((name) => name !== entity.organization).sort((a, b) => a.localeCompare(b, "ja"));
      const identity = normalizeCompanyIdentity(entity.organization);
      const aliasIdentities = [...new Set(aliases.map(normalizeCompanyIdentity))]
        .filter((aliasIdentity) => aliasIdentity && aliasIdentity !== identity)
        .sort((a, b) => a.localeCompare(b, "ja"));
      if (!identity) throw new Error(`企業検索索引の法人名を正規化できません: ${entity.corporateNumber}`);
      return {
        organization: entity.organization,
        corporateNumber: entity.corporateNumber,
        identity,
        aliases,
        aliasIdentities,
        bucket: entity.bucket,
        records: entity.records,
      };
    })
    .sort((a, b) => a.corporateNumber.localeCompare(b.corporateNumber));
  const filterPartitions = [...rowsByFilterPartition.entries()]
    .map(([key, partitionRows]) => {
      const [fiscalYear, sourceAgency, stage] = JSON.parse(key);
      return {
        filename: `gbiz-filter-records-${createHash("sha256").update(key).digest("hex").slice(0, 16)}.json`,
        fiscalYear,
        sourceAgency,
        stage,
        rows: partitionRows.length,
        partitionRows,
      };
    })
    .sort((left, right) => (right.fiscalYear ?? Number.NEGATIVE_INFINITY) - (left.fiscalYear ?? Number.NEGATIVE_INFINITY)
      || left.sourceAgency.localeCompare(right.sourceAgency, "ja") || left.stage.localeCompare(right.stage));
  if (new Set(filterPartitions.map((partition) => partition.filename)).size !== filterPartitions.length) {
    throw new Error("企業フィルタ検索ファイル名が衝突しました");
  }
  const index = {
    schemaVersion: 2,
    generatedAt,
    entityCount: entities.length,
    recordCount: rows.length,
    bucketCount: COMPANY_SEARCH_BUCKET_COUNT,
    filterPartitionCount: filterPartitions.length,
    agencies: [...agencies].sort((a, b) => a.localeCompare(b, "ja")),
    entities,
    filterPartitions: filterPartitions.map((partition) => ({
      filename: partition.filename,
      fiscalYear: partition.fiscalYear,
      sourceAgency: partition.sourceAgency,
      stage: partition.stage,
      rows: partition.rows,
    })),
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
  const filterFilenames = [];
  for (const partition of filterPartitions) {
    filterFilenames.push(partition.filename);
    await writeFile(new URL(partition.filename, outputDirectory), `${JSON.stringify(partition.partitionRows)}\n`);
  }
  return { indexFilename, bucketFilenames, filterFilenames, entityCount: entities.length, recordCount: rows.length };
}

export function bucketForCompany(value) {
  const byte = createHash("sha256").update(String(value)).digest()[0];
  return (byte % COMPANY_SEARCH_BUCKET_COUNT).toString(16).padStart(2, "0");
}
