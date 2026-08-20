import { readFile, writeFile } from "node:fs/promises";

const path = "scripts/oneoff-build-smrj-nedo-history.mjs";
let source = await readFile(path, "utf8");

const oldColumns = `function smrjColumns(page, previous = null) {
  const c = {
    ordinal: headerCenter(page.items, /物品役務等の名称及び数量/),
    officer: headerCenter(page.items, /契約担当官/),
    date: headerCenter(page.items, /契約を締結した日/),
    organization: headerCenter(page.items, /契約の相手方の商号又は名称及び住所/),
    reason: headerCenter(page.items, /随意契約によることとした|一般競争入札/),
    planned: headerCenter(page.items, /予定価格/),
    amount: headerCenter(page.items, /契約金額/),
    rate: headerCenter(page.items, /落札率/),
    notes: headerCenter(page.items, /備考/),
  };
  const present = Object.values(c).filter(Number.isFinite).length;
  return present >= 6 ? boundariesFromCenters(c) : previous;
}
`;
const newColumns = `function smrjColumns(page, previous = null) {
  const centers = {
    program: headerCenter(page.items, /物品役務等の名称及び数量/),
    officer: headerCenter(page.items, /契約担当官/),
    date: headerCenter(page.items, /契約を締結した日/),
    organization: headerCenter(page.items, /契約の相手方の商号又は名称及び住所/),
    reason: headerCenter(page.items, /随意契約によることとした|一般競争入札/),
    planned: headerCenter(page.items, /予定価格/),
    amount: headerCenter(page.items, /契約金額/),
    rate: headerCenter(page.items, /落札率/),
    notes: headerCenter(page.items, /備考/),
  };
  if (!["program", "date", "organization", "amount"].every((key) => Number.isFinite(centers[key]))) return previous;
  return { ranges: boundariesFromCenters(centers), programCenter: centers.program };
}
`;
if (!source.includes(oldColumns)) throw new Error("SMRJ column block not found");
source = source.replace(oldColumns, newColumns);

const oldLoop = `  let columns = null;
  let anchorCount = 0;
  for (const page of pages) {
    columns = smrjColumns(page, columns);
    if (!columns?.date || !columns.organization || !columns.amount || !columns.ordinal) throw new Error(\`${source.url}: SMRJ列見出しを確定できません p${page.pageNumber}\`);
    const programRange = columns.ordinal;
    const ordinalLimit = Math.min(programRange[0] + 0.035, programRange[1]);
    const anchors = page.items.filter((item) => /^\\d{1,3}$/.test(item.t) && item.x < ordinalLimit && item.y < 0.92 && item.y > 0.03)
      .sort((a, b) => b.y - a.y || a.x - b.x);
    anchorCount += anchors.length;
    for (let i = 0; i < anchors.length; i += 1) {
      const anchor = anchors[i];
      const nextY = i + 1 < anchors.length ? anchors[i + 1].y : 0.025;
      const rowItems = page.items.filter((item) => item.y <= anchor.y + 0.012 && item.y > nextY + 0.002);
      const dateText = textFrom(rowItems.filter((item) => inColumn(item, columns.date)));
`;
const newLoop = `  let schema = null;
  let anchorCount = 0;
  for (const page of pages) {
    schema = smrjColumns(page, schema);
    const columns = schema?.ranges;
    if (!columns?.date || !columns.organization || !columns.amount || !columns.program || !Number.isFinite(schema?.programCenter)) {
      throw new Error(\`${source.url}: SMRJ列見出しを確定できません p${page.pageNumber}\`);
    }
    const programRange = columns.program;
    const ordinalMin = Math.max(0, schema.programCenter - 0.14);
    const ordinalMax = Math.max(ordinalMin + 0.015, schema.programCenter - 0.04);
    const anchors = page.items.filter((item) => {
      const center = item.x + item.w / 2;
      return /^\\d{1,3}$/.test(item.t)
        && center >= ordinalMin && center < ordinalMax
        && item.y < 0.90 && item.y > 0.025;
    }).sort((a, b) => b.y - a.y || a.x - b.x);
    anchorCount += anchors.length;
    for (let i = 0; i < anchors.length; i += 1) {
      const anchor = anchors[i];
      const previousY = i > 0 ? anchors[i - 1].y : Math.min(0.89, anchor.y + 0.08);
      const nextY = i + 1 < anchors.length ? anchors[i + 1].y : Math.max(0.02, anchor.y - 0.08);
      const upperY = (previousY + anchor.y) / 2;
      const lowerY = (anchor.y + nextY) / 2;
      const rowItems = page.items.filter((item) => item.y <= upperY && item.y > lowerY);
      const dateText = textFrom(rowItems.filter((item) => inColumn(item, columns.date)));
`;
if (!source.includes(oldLoop)) throw new Error("SMRJ row loop block not found");
source = source.replace(oldLoop, newLoop);

const oldProgram = `      const program = textFrom(rowItems.filter((item) => inColumn(item, programRange) && item.x >= ordinalLimit));
`;
const newProgram = `      const program = textFrom(rowItems.filter((item) => {
        if (!inColumn(item, programRange)) return false;
        const center = item.x + item.w / 2;
        return !(center >= ordinalMin && center < ordinalMax && /^\\d{1,3}$/.test(item.t));
      }));
`;
if (!source.includes(oldProgram)) throw new Error("SMRJ program block not found");
source = source.replace(oldProgram, newProgram);

await writeFile(path, source);
console.log("SMRJ parser geometry patched");
