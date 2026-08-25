import { readFile, writeFile } from "node:fs/promises";

const path = "scripts/smrj-official-supplement.mjs";
let source = await readFile(path, "utf8");

function replaceOnce(before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one target, got ${count}`);
  source = source.replace(before, after);
}

replaceOnce(
  '  if (suspicious.length) {\n    throw new Error(`中小機構本部の契約PDF候補で年度または区分を判定できません:\\n${suspicious.slice(0, 30).join("\\n")}`);\n  }\n  documents.push(...extractExplicitNoResults(html, pageUrl));',
  '  // Unclassified PDFs can include procurement guidance and unrelated attachments.\n  // Keep them out of the population and let the year×contract-kind coverage check fail\n  // if a genuinely required contract document was missed.\n  documents.push(...extractExplicitNoResults(html, pageUrl));',
  "ignore unrelated PDF candidates",
);

replaceOnce(
  '    const dateStart = midpoint(columns.officer, columns.date);\n    const dateEnd = midpoint(columns.date, columns.partner);',
  '    const dateStart = Math.max(0, columns.date - 4);\n    const dateEnd = Math.max(dateStart + 8, columns.partner - 2);',
  "date column bounds",
);

replaceOnce(
  '    const programEnd = midpoint(columns.officer, columns.date);\n    const partnerStart = midpoint(columns.date, columns.partner);\n    const partnerEnd = midpoint(columns.partner, columns.corp);\n    const corpStart = partnerEnd;\n    const corpEnd = midpoint(columns.corp, columns.planned);\n    const amountStart = midpoint(columns.planned, columns.amount);\n    const amountEnd = midpoint(columns.amount, columns.rate);',
  '    const programEnd = Math.max(columns.name + 8, columns.officer - 2);\n    const partnerStart = Math.max(0, columns.partner - 3);\n    const partnerEnd = Math.max(partnerStart + 8, columns.corp - 2);\n    const corpStart = Math.max(partnerStart, columns.corp - 3);\n    const corpEnd = Math.max(corpStart + 8, columns.planned - 2);\n    const amountStart = Math.max(0, columns.amount - 3);\n    const amountEnd = Math.max(amountStart + 8, columns.rate - 2);',
  "data column bounds",
);

replaceOnce(
  '  const start = midpoint(columns.officer, columns.date);\n  const end = midpoint(columns.date, columns.partner);',
  '  const start = Math.max(0, columns.date - 4);\n  const end = Math.max(start + 8, columns.partner - 2);',
  "date fallback bounds",
);

await writeFile(path, source);
console.log("Applied SMRJ HQ v7 real-PDF boundary patches.");
