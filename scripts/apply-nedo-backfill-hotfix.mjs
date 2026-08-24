import { readFile, writeFile } from "node:fs/promises";

const path = "scripts/nedo-public-results.mjs";
let source = await readFile(path, "utf8");

function replaceRequired(oldText, newText, label) {
  if (!source.includes(oldText)) throw new Error(`NEDO hotfix target not found: ${label}`);
  source = source.replace(oldText, newText);
}

replaceRequired(
  'import { pathToFileURL } from "node:url";',
  'import { fileURLToPath, pathToFileURL } from "node:url";',
  "node:url import",
);

replaceRequired(
  'const PARTICIPANT_SECTION_PATTERN = /(実施予定先|実施先|実施者|委託予定先|委託先|助成予定先|助成先|交付予定先|交付決定事業者|交付決定先|採択事業者|採択者|採択先)/u;',
  'const PARTICIPANT_SECTION_PATTERN = /(実施予定先|実施先|実施者|委託予定先|委託先|助成予定先|助成先|交付予定先|交付決定事業者|交付決定先|採択事業者|採択者|採択先|採択提案|採択テーマ|採択案件|受入機関|受賞者|審査結果)/u;',
  "participant section labels",
);

replaceRequired(
  'const PARTICIPANT_CONTEXT_PATTERN = /(実施予定先|委託予定先|助成予定先|交付決定|採択(?:先|者|事業者|テーマ))/u;',
  'const PARTICIPANT_CONTEXT_PATTERN = /(実施予定先|委託予定先|助成予定先|交付決定|採択(?:先|者|事業者|テーマ|提案)|受賞者)/u;\nconst NON_FUNDING_DECISION_PATTERN = /(公募中止|RFI(?:実施)?結果|情報提供依頼.*結果|一次審査通過|1次審査通過|予選通過|スクリーニング通過|ファイナリスト決定)/iu;',
  "non-funding decision classification",
);

replaceRequired(
  '/<(?:td|th|li|p|dd)\\b[^>]*>([\\s\\S]*?)<\\/(?:td|th|li|p|dd)>/gi',
  '/<(?:td|th|li|p|dd|dt|div|span|strong|a)\\b[^>]*>([\\s\\S]*?)<\\/(?:td|th|li|p|dd|dt|div|span|strong|a)>/gi',
  "participant section HTML elements",
);

replaceRequired(
  '    const url = canonicalSourceUrl(match[1], sourcePageUrl);\n    const item = { url, label };',
  '    const candidateUrl = nedoOrWarpUrl(match[1], sourcePageUrl);\n    if (!candidateUrl) continue;\n    const url = canonicalSourceUrl(candidateUrl.href, sourcePageUrl);\n    const item = { url, label };',
  "ignore external attachments",
);

replaceRequired(
  '    noSelection: NO_SELECTION_PATTERN.test(plain),\n    selectedCount,',
  '    noSelection: NO_SELECTION_PATTERN.test(plain),\n    nonFundingDecision: NON_FUNDING_DECISION_PATTERN.test(plain),\n    selectedCount,',
  "decision classification result",
);

replaceRequired(
  '    .replace(/(?:（|\\().*?(?:）|\\))$/u, "")\n    .trim();',
  '    .trim();',
  "preserve parenthetical participant lists",
);

replaceRequired(
`function organizationFragments(value) {
  const normalized = trimCandidate(value);
  if (!normalized) return [];
  const pieces = normalized.split(/[|｜;；]/u).map(trimCandidate).filter(Boolean);
  const found = new Set();
  for (const piece of pieces) {
    if (plausibleOrganization(piece) && !HEADER_NOISE_PATTERN.test(piece)) found.add(piece);
    for (const form of PREFIX_FORMS) {
      let index = piece.indexOf(form);
      while (index >= 0) {
        const candidate = trimCandidate(piece.slice(index, Math.min(piece.length, index + 100)));
        if (plausibleOrganization(candidate) && !HEADER_NOISE_PATTERN.test(candidate)) found.add(candidate);
        index = piece.indexOf(form, index + form.length);
      }
    }
    for (const form of SUFFIX_FORMS) {
      let index = piece.indexOf(form);
      while (index >= 0) {
        const candidate = trailingTokenCandidate(piece, index + form.length);
        if (candidate) found.add(candidate);
        index = piece.indexOf(form, index + form.length);
      }
    }
    if (ENGLISH_FORM_PATTERN.test(piece) && plausibleOrganization(piece)) found.add(piece);
  }
  return [...found];
}`,
`function organizationFragments(value) {
  const normalized = trimCandidate(value);
  if (!normalized) return [];
  const sources = [normalized];
  for (const match of normalized.matchAll(/[（(]([^）)]{2,300})[）)]/gu)) sources.push(match[1]);
  const pieces = sources
    .flatMap((item) => item.split(/[|｜;；、，,／/]/u))
    .map(trimCandidate)
    .filter(Boolean);
  const found = new Set();
  for (const piece of pieces) {
    if (plausibleOrganization(piece) && !HEADER_NOISE_PATTERN.test(piece)) found.add(piece);
    for (const form of PREFIX_FORMS) {
      let index = piece.indexOf(form);
      while (index >= 0) {
        const tail = piece.slice(index, Math.min(piece.length, index + 100));
        const boundary = tail.search(/[、，,;；|｜／/）)]/u);
        const candidate = trimCandidate(boundary > 0 ? tail.slice(0, boundary) : tail);
        if (plausibleOrganization(candidate) && !HEADER_NOISE_PATTERN.test(candidate)) found.add(candidate);
        index = piece.indexOf(form, index + form.length);
      }
    }
    for (const form of SUFFIX_FORMS) {
      let index = piece.indexOf(form);
      while (index >= 0) {
        const candidate = trailingTokenCandidate(piece, index + form.length);
        if (candidate) found.add(candidate);
        index = piece.indexOf(form, index + form.length);
      }
    }
    if (ENGLISH_FORM_PATTERN.test(piece) && plausibleOrganization(piece)) found.add(piece);
  }
  return [...found];
}`,
  "parenthetical/comma organization extraction",
);

replaceRequired(
  '        if (gap > 24) break;',
  '        if (gap > 48) break;',
  "PDF adjacent item gap",
);

replaceRequired(
`  }
  return strings;
}

async function parsePdfOrganizations(buffer, url) {`,
`  }
  const sourceOrder = items.filter((item) => typeof item?.str === "string" && item.str.trim()).map((item) => text(item.str));
  for (let start = 0; start < sourceOrder.length; start += 1) {
    let value = sourceOrder[start];
    for (let end = start + 1; end < Math.min(sourceOrder.length, start + 5); end += 1) {
      value += \` \${sourceOrder[end]}\`;
      if (PREFIX_FORMS.some((form) => value.includes(form)) || SUFFIX_FORMS.some((form) => value.includes(form))) strings.push(value);
    }
  }
  return strings;
}

const PDFJS_CMAP_URL = \`\${fileURLToPath(new URL("../node_modules/pdfjs-dist/cmaps/", import.meta.url))}/\`;
const PDFJS_STANDARD_FONT_DATA_URL = \`\${fileURLToPath(new URL("../node_modules/pdfjs-dist/standard_fonts/", import.meta.url))}/\`;

async function parsePdfOrganizations(buffer, url) {`,
  "PDF split-name reconstruction and font resources",
);

replaceRequired(
  'const task = getDocument({ data: new Uint8Array(buffer), disableFontFace: true, isEvalSupported: false, useSystemFonts: false, verbosity: 0 });',
  'const task = getDocument({ data: new Uint8Array(buffer), disableFontFace: true, isEvalSupported: false, useSystemFonts: false, cMapUrl: PDFJS_CMAP_URL, cMapPacked: true, standardFontDataUrl: PDFJS_STANDARD_FONT_DATA_URL, verbosity: 0 });',
  "PDF.js cMap/font configuration",
);

replaceRequired(
  'async function parseDecisionParticipants(decision, fetchImpl) {\n  if (decision.noSelection) return [];',
  'async function parseDecisionParticipants(decision, fetchImpl) {\n  if (decision.noSelection || decision.nonFundingDecision) return [];',
  "skip non-funding outcomes",
);

replaceRequired(
  '  let noSelectionDecisionCount = 0;\n  const rows = [];',
  '  let noSelectionDecisionCount = 0;\n  let excludedDecisionCount = 0;\n  const rows = [];',
  "excluded decision counter",
);

replaceRequired(
  '          noSelection: decision.noSelection,',
  '          noSelection: decision.noSelection,\n          nonFundingDecision: decision.nonFundingDecision,',
  "diagnostic classification",
);

replaceRequired(
  '    if (result.decision.noSelection) noSelectionDecisionCount += 1;\n    rows.push(...result.participants);',
  '    if (result.decision.noSelection) noSelectionDecisionCount += 1;\n    if (result.decision.nonFundingDecision) excludedDecisionCount += 1;\n    rows.push(...result.participants);',
  "count excluded decisions",
);

replaceRequired(
  '  return { rows, parsedDecisionCount, noSelectionDecisionCount };',
  '  return { rows, parsedDecisionCount, noSelectionDecisionCount, excludedDecisionCount };',
  "return excluded count",
);

source = source.replaceAll(
  '        noSelectionDecisionCount: result.noSelectionDecisionCount,\n        participantRecordCount:',
  '        noSelectionDecisionCount: result.noSelectionDecisionCount,\n        excludedDecisionCount: result.excludedDecisionCount,\n        participantRecordCount:',
);

await writeFile(path, source);
