import { readFile, writeFile } from "node:fs/promises";

const path = "scripts/oneoff-build-smrj-nedo-history.mjs";
let source = await readFile(path, "utf8");
const oldLine = '      const sourceKey = `${source.url}#p${page.pageNumber}-row${ordinal}`;\n';
const newLine = '      const sourceKey = `${source.url}#p${page.pageNumber}-y${anchor.y.toFixed(6)}-row${ordinal}`;\n';
if (!source.includes(oldLine)) throw new Error("central history sourceKey anchor not found");
source = source.replace(oldLine, newLine);
await writeFile(path, source);
console.log("central history sourceKey now includes stable PDF row position");
