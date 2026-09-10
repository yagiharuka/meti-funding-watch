import { readFile, writeFile } from "node:fs/promises";

function replaceOnce(source, search, replacement, label) {
  const index = source.indexOf(search);
  if (index < 0) throw new Error(`${label}: target not found`);
  if (source.indexOf(search, index + search.length) >= 0) throw new Error(`${label}: target is not unique`);
  return `${source.slice(0, index)}${replacement}${source.slice(index + search.length)}`;
}

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after === before) throw new Error(`${path}: no change produced`);
  await writeFile(path, after);
}

await update("scripts/jogmec-inventory-20260826.mjs", (input) => {
  let source = input;
  if (source.includes("documentTextSample")) throw new Error("JOGMEC content-level inventory classification already applied");
  source = replaceOnce(
    source,
    'import { readFile, writeFile } from "node:fs/promises";',
    'import { readFile, writeFile } from "node:fs/promises";\nimport { fileURLToPath } from "node:url";\nimport { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";\nimport { xlsxRowsFromBuffer } from "./jogmec-xlsx-reader-20260826.mjs";',
    "inventory parser imports",
  );
  source = replaceOnce(
    source,
    'const MAX_BYTES = 30 * 1024 * 1024;',
    'const MAX_BYTES = 30 * 1024 * 1024;\nconst STANDARD_FONT_DATA_URL = `${fileURLToPath(new URL("../node_modules/pdfjs-dist/standard_fonts/", import.meta.url))}/`;',
    "inventory PDF font path",
  );
  source = replaceOnce(
    source,
    `function fileType(url, contentType = "") {`,
    `function decodeTabularText(buffer) {
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  const replacementCount = (utf8.match(/�/gu) ?? []).length;
  if (replacementCount <= Math.max(2, utf8.length / 5000)) return utf8;
  try { return new TextDecoder("shift_jis", { fatal: false }).decode(buffer); }
  catch { return utf8; }
}

async function pdfTextSample(buffer) {
  const task = getDocument({ data: new Uint8Array(buffer), disableFontFace: true, isEvalSupported: false, standardFontDataUrl: STANDARD_FONT_DATA_URL, useSystemFonts: false });
  const values = [];
  try {
    const pdf = await task.promise;
    for (let pageNumber = 1; pageNumber <= Math.min(pdf.numPages, 3); pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent({ disableNormalization: false, includeMarkedContent: false });
      values.push(content.items.filter((item) => typeof item?.str === "string").map((item) => item.str).join(" "));
      page.cleanup();
    }
  } finally { await task.destroy().catch(() => {}); }
  return clean(values.join(" ")).slice(0, 30_000);
}

async function documentTextSample(type, buffer) {
  if (type === "html") return clean(buffer.toString("utf8")).slice(0, 30_000);
  if (type === "pdf") return pdfTextSample(buffer);
  if (type === "csv") return clean(decodeTabularText(buffer)).slice(0, 30_000);
  if (type === "xlsx") {
    const sheets = xlsxRowsFromBuffer(buffer);
    return clean(sheets.slice(0, 5).flatMap((sheet) => sheet.rows.slice(0, 40).flat()).join(" ")).slice(0, 30_000);
  }
  return "";
}

function targetStatus(classification, titleAndSample) {
  if (ANNOUNCEMENT_ONLY.test(titleAndSample) && !RESULT.test(titleAndSample)) return "announcement_only";
  if (["selection_result", "discretionary_contract", "bid_result", "contract_result"].includes(classification)) return "result";
  if (RESULT.test(titleAndSample)) return "result";
  return "unknown";
}

function fileType(url, contentType = "") {`,
    "inventory content sample helpers",
  );

  const previousCandidateBlock = [
    "        let documentTitle = candidate.anchorText;",
    "        let bodyClassification = candidate.classification;",
    "        let bodyYears = candidate.inferredYears;",
    '        if (type === "html") {',
    '          const html = fetched.buffer.toString("utf8");',
    "          documentTitle = titleFromHtml(html) || documentTitle;",
    "          const sample = clean(html).slice(0, 20_000);",
    '          bodyClassification = classify(`${candidate.context} ${documentTitle} ${sample}`);',
    '          bodyYears = [...new Set([...bodyYears, ...inferYears(`${documentTitle} ${sample}`)])].sort((a, b) => a - b);',
    "        }",
    "        return {",
    "          ...candidate,",
    "          finalUrl: fetched.finalUrl,",
    "          title: documentTitle,",
    "          classification: bodyClassification,",
    "          inferredYears: bodyYears,",
    "          fileType: type,",
  ].join("\n");
  const classifiedCandidateBlock = [
    "        let documentTitle = candidate.anchorText;",
    '        if (type === "html") documentTitle = titleFromHtml(fetched.buffer.toString("utf8")) || documentTitle;',
    '        let sample = "";',
    "        let sampleError = null;",
    "        try { sample = await documentTextSample(type, fetched.buffer); }",
    "        catch (error) { sampleError = error instanceof Error ? error.message : String(error); }",
    '        const evidenceText = [candidate.context, documentTitle, sample].join(" ");',
    "        const bodyClassification = classify(evidenceText);",
    '        const titleAndSample = [documentTitle, sample].join(" ");',
    "        const bodyYears = [...new Set([...candidate.inferredYears, ...inferYears(titleAndSample)])].sort((a, b) => a - b);",
    "        const actualTargetStatus = targetStatus(bodyClassification, titleAndSample);",
    "        return {",
    "          ...candidate,",
    "          finalUrl: fetched.finalUrl,",
    "          title: documentTitle,",
    "          classification: bodyClassification,",
    '          resultLikely: actualTargetStatus === "result",',
    "          targetStatus: actualTargetStatus,",
    "          inferredYears: bodyYears,",
    "          textSample: sample.slice(0, 4_000),",
    "          sampleError,",
    "          fileType: type,",
  ].join("\n");
  source = replaceOnce(
    source,
    previousCandidateBlock,
    classifiedCandidateBlock,
    "inventory content-level classification",
  );
  source = replaceOnce(
    source,
    `          ...candidate,
          finalUrl: candidate.url,
          title: candidate.anchorText,
          fileType: fileType(candidate.url),`,
    `          ...candidate,
          finalUrl: candidate.url,
          title: candidate.anchorText,
          targetStatus: "fetch_failed",
          textSample: "",
          sampleError: null,
          fileType: fileType(candidate.url),`,
    "inventory failed candidate status",
  );
  source = replaceOnce(
    source,
    `const resultCandidates = fetchedCandidates.filter((candidate) => candidate.resultLikely || ["selection_result", "discretionary_contract", "bid_result", "contract_result"].includes(candidate.classification));`,
    `const resultCandidates = fetchedCandidates.filter((candidate) => candidate.targetStatus === "result");`,
    "inventory target result count",
  );
  return source;
});

await update("scripts/jogmec-reingest-stage1-20260826.mjs", (input) => {
  let source = input;
  source = source.replace(
    `    && (candidate.resultLikely || RESULT_TYPES.has(candidate.classification))
    && ["html", "pdf", "csv", "xlsx"].includes(candidate.fileType));`,
    `    && (candidate.targetStatus === "result" || (!candidate.targetStatus && (candidate.resultLikely || RESULT_TYPES.has(candidate.classification))))
    && ["html", "pdf", "csv", "xlsx"].includes(candidate.fileType));`,
  );
  source = source.replace(
    `    && (candidate.resultLikely || RESULT_TYPES.has(candidate.classification))
    && !["html", "pdf", "csv", "xlsx"].includes(candidate.fileType));`,
    `    && (candidate.targetStatus === "result" || (!candidate.targetStatus && (candidate.resultLikely || RESULT_TYPES.has(candidate.classification))))
    && !["html", "pdf", "csv", "xlsx"].includes(candidate.fileType));`,
  );
  if (!source.includes('candidate.targetStatus === "result"')) throw new Error("stage1 target-status patch did not apply");
  return source;
});

await update("tests/jogmec-reingest-stage1.test.mjs", (input) => {
  let source = input;
  source += `

test("JOGMEC inventory contracts require content-level result status before stage-one processing", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) => readFile(new URL("../scripts/jogmec-reingest-stage1-20260826.mjs", import.meta.url), "utf8"));
  assert.match(source, /candidate\\.targetStatus === "result"/u);
  assert.match(source, /!candidate\\.targetStatus/u);
});
`;
  return source;
});

console.log("Applied JOGMEC content-level result classification.");
