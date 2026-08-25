import { readFile, writeFile } from "node:fs/promises";

const path = "scripts/smrj-official-supplement.mjs";
const before = await readFile(path, "utf8");
const oldBlock = `  if (corporateIndexes.length) {
    let previousBoundary = -1;
    for (const index of corporateIndexes) {
      const line = values[index];
      const corporateNumber = line.match(/(\\d{13})/u)?.[1] ?? "";
      const sameLineName = clean(line.split(/法人(?:番号|場号)/u)[0].replace(/[()（）:：]/gu, " "));
      let organization = sameLineName;
      if (!organization) {
        const names = [];
        for (let cursor = index - 1; cursor > previousBoundary && names.length < 3; cursor -= 1) {
          const candidate = values[cursor];
          if (looksLikeAddress(candidate) || /法人(?:番号|場号)/u.test(candidate)) break;
          names.unshift(candidate);
          if (ORGANIZATION_MARKER.test(candidate) || candidate.length > 8) break;
        }
        organization = clean(names.join(" "));
      }
      if (!organization || !validCorporateNumber(corporateNumber)) {
        throw new Error(\`中小機構本部: 契約相手方と法人番号の対応を確定できません (\${values.join(" / ")})\`);
      }
      parties.push({ organization: normalizeOrganization(organization), corporateNumber });
      previousBoundary = index;
    }
  } else {`;

const newBlock = `  if (corporateIndexes.length) {
    for (let position = 0; position < corporateIndexes.length; position += 1) {
      const index = corporateIndexes[position];
      const previousBoundary = corporateIndexes[position - 1] ?? -1;
      const nextBoundary = corporateIndexes[position + 1] ?? values.length;
      const line = values[index];
      const corporateNumber = line.match(/(\\d{13})/u)?.[1] ?? "";
      const sameLineName = clean(line.split(/法人(?:番号|場号)/u)[0].replace(/[()（）:：]/gu, " "));
      let organization = sameLineName;
      if (!organization) {
        const namesBefore = [];
        for (let cursor = index - 1; cursor > previousBoundary && namesBefore.length < 3; cursor -= 1) {
          const candidate = values[cursor];
          if (/法人(?:番号|場号)/u.test(candidate)) break;
          if (looksLikeAddress(candidate)) {
            if (namesBefore.length) break;
            continue;
          }
          namesBefore.unshift(candidate);
          if (ORGANIZATION_MARKER.test(candidate) || candidate.length > 8) break;
        }
        organization = clean(namesBefore.join(" "));
      }
      if (!organization) {
        const namesAfter = [];
        for (let cursor = index + 1; cursor < nextBoundary && namesAfter.length < 3; cursor += 1) {
          const candidate = values[cursor];
          if (/法人(?:番号|場号)/u.test(candidate)) break;
          if (looksLikeAddress(candidate)) {
            if (namesAfter.length) break;
            continue;
          }
          namesAfter.push(candidate);
          if (ORGANIZATION_MARKER.test(candidate) || candidate.length > 8) break;
        }
        organization = clean(namesAfter.join(" "));
      }
      if (!organization || !validCorporateNumber(corporateNumber)) {
        throw new Error(\`中小機構本部: 契約相手方と法人番号の対応を確定できません (\${values.join(" / ")})\`);
      }
      parties.push({ organization: normalizeOrganization(organization), corporateNumber });
    }
  } else {`;

const index = before.indexOf(oldBlock);
if (index < 0) throw new Error("SMRJ party-order patch target not found");
if (before.indexOf(oldBlock, index + oldBlock.length) >= 0) throw new Error("SMRJ party-order patch target is not unique");
const after = `${before.slice(0, index)}${newBlock}${before.slice(index + oldBlock.length)}`;
await writeFile(path, after);
console.log("Patched SMRJ party parsing for address/corporate-number/name order.");
