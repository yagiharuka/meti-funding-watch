import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const sources = [
  ["smrj-2017-discretionary", "https://www.smrj.go.jp/procurement/bid/contract/fbrion000000dvwx-att/zuiikeiyakuhonbu2017all.pdf"],
  ["smrj-2017-competitive", "https://www.smrj.go.jp/procurement/bid/contract/fbrion000000dvwx-att/nyuusatuhonbu2017all.pdf"],
  ["nedo-2017-q1", "https://www.nedo.go.jp/content/100867505.pdf"],
  ["nedo-2017-q2", "https://www.nedo.go.jp/content/100870810.pdf"],
  ["nedo-2017-q3", "https://www.nedo.go.jp/content/100873968.pdf"],
  ["nedo-2017-q4", "https://www.nedo.go.jp/content/100878277.pdf"],
];
const dir = await mkdtemp(join(tmpdir(), "meti-funding-pdf-probe-"));
try {
  for (const [id, url] of sources) {
    const response = await fetch(url, { headers: { "user-agent": "Mozilla/5.0", accept: "application/pdf,*/*;q=0.1" }, redirect: "follow" });
    const buffer = Buffer.from(await response.arrayBuffer());
    console.log(`SOURCE ${id} status=${response.status} bytes=${buffer.length} magic=${buffer.subarray(0,5).toString("ascii")}`);
    if (!response.ok || buffer.subarray(0, 5).toString("ascii") !== "%PDF-") continue;
    const pdf = join(dir, `${id}.pdf`);
    const txt = join(dir, `${id}.txt`);
    await writeFile(pdf, buffer);
    await execFileAsync("pdftotext", ["-layout", "-nopgbrk", pdf, txt], { maxBuffer: 50_000_000 });
    const text = await readFile(txt, "utf8");
    const lines = text.split(/\r?\n/);
    console.log(`BEGIN ${id} lines=${lines.length}`);
    console.log(lines.slice(0, id.startsWith("smrj") ? 260 : 180).join("\n"));
    console.log(`END ${id}`);
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}
