#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
destination="${1:-${project_root}/backups}"
manifest="${project_root}/data/review-cache/manifest.json"

test -f "${manifest}"
mkdir -p "${destination}"

snapshot_id="$(node --input-type=module -e '
  import fs from "node:fs";
  const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const generated = String(manifest.generatedAt ?? "unknown").replace(/[^0-9TZ]/g, "");
  const provenance = String(manifest.bootstrapProvenance?.commit ?? "no-provenance").slice(0, 12);
  process.stdout.write(`${generated}-${provenance}`);
' "${manifest}")"

archive_name="review-cache-${snapshot_id}.tar.gz"
archive="${destination}/${archive_name}"
checksum="${archive}.sha256"

if [[ -e "${archive}" || -e "${checksum}" ]]; then
  echo "Backup already exists: ${archive}" >&2
  exit 1
fi

tar --sort=name --mtime='UTC 1970-01-01' --owner=0 --group=0 --numeric-owner \
  -C "${project_root}/data" -cf - review-cache | gzip -n > "${archive}"
(
  cd "${destination}"
  sha256sum "${archive_name}" > "${archive_name}.sha256"
)

echo "${archive}"
echo "${checksum}"
