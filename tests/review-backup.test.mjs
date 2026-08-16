import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const projectRoot = fileURLToPath(new URL("../", import.meta.url));

test("creates a deterministic review snapshot with a verifiable SHA-256", async () => {
  const firstDirectory = await mkdtemp(join(projectRoot, ".tmp-review-backup-a-"));
  const secondDirectory = await mkdtemp(join(projectRoot, ".tmp-review-backup-b-"));
  try {
    const first = await create(firstDirectory);
    const second = await create(secondDirectory);
    assert.equal(first.archiveName, second.archiveName);
    assert.equal(first.checksumLine, second.checksumLine);
    await execFileAsync("sha256sum", ["-c", `${first.archiveName}.sha256`], { cwd: firstDirectory });
    const { stdout } = await execFileAsync("tar", ["-tzf", first.archiveName], { cwd: firstDirectory });
    assert.match(stdout, /review-cache\/manifest\.json/);
    assert.match(stdout, /review-cache\/payments-[0-9a-f]\.json/);
  } finally {
    await Promise.all([
      rm(firstDirectory, { recursive: true, force: true }),
      rm(secondDirectory, { recursive: true, force: true }),
    ]);
  }
});

async function create(directory) {
  const { stdout } = await execFileAsync("bash", ["scripts/create-review-backup.sh", directory], { cwd: projectRoot });
  const [archivePath, checksumPath] = stdout.trim().split("\n");
  return {
    archiveName: archivePath.split("/").at(-1),
    checksumLine: await readFile(checksumPath, "utf8"),
  };
}
