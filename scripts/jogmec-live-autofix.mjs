import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const MAX_ATTEMPTS = 30;
const PARSER_PATH = "scripts/jogmec-official-supplement.mjs";
const TEST_PATH = "tests/jogmec-official-supplement.test.mjs";
const CLASSIFIER_NEEDLE = "export function classifyJogmecAmount(value, contractType) {\n  const raw = clean(value);";
const TEST_ANCHOR = '  assert.equal(classifyJogmecAmount("2640/1頁", "competitive").amountStatus, "non_total");';

function jsString(value) {
  return JSON.stringify(value);
}

function classifyUnknownAmount(raw) {
  const normalized = raw.normalize("NFKC").replace(/[\s　]+/g, " ").trim();
  const lower = normalized.toLocaleLowerCase("ja-JP").replace(/／/g, "/");
  const unitSuffix = /\/\s*(?:kwh?|mwh|gwh|kw|wh|kg|g|t|ton|m3|㎥|m2|㎡|l|kl|頁|ページ|枚|件|人|人日|人月|日|月|年|時間|hour|h|台|式|回|個|冊|本|m|km)(?:\b|$)/iu;
  const unitWording = /(?:単価|月額|日額|時間額|従量料金|基本料金|1\s*(?:件|人|台|式|枚|頁|ページ|kg|t|kw|kwh|mwh|m3|㎥)\s*(?:当たり|あたり))/iu;
  if (/\d/u.test(lower) && (unitSuffix.test(lower) || unitWording.test(lower))) {
    return { status: "non_total" };
  }
  if (
    /(?:別紙参照|非公表|記載なし|未定|契約金額なし|公表しない)/u.test(normalized)
    && !/(?:¥|￥)\s*\d|\d[\d,]*\s*円/u.test(normalized)
  ) {
    return { status: "unavailable" };
  }
  const cleaned = normalized.replace(/(?:令和|平成)(?:元|\d{1,2})年\d{1,2}月\d{1,2}日(?:作成)?/gu, "").trim();
  const singlePublished = cleaned.match(/^[\-－—―]*\s*[¥￥]?\s*(\d[\d,]*)\s*円?$/u);
  if (singlePublished) {
    return { status: "published", amount: Number(singlePublished[1].replace(/,/g, "")) };
  }
  const monetaryValues = [...normalized.matchAll(/(?:¥|￥)\s*(\d[\d,]*(?:\.\d+)?)/gu)]
    .map((match) => match[1]);
  if (monetaryValues.length > 1 || /(?:～|〜|から|まで|×|\+|及び|または)/u.test(normalized)) {
    return { status: "non_total" };
  }
  return null;
}

async function addExactOverride(raw, classification) {
  let parser = await readFile(PARSER_PATH, "utf8");
  if (!parser.includes(CLASSIFIER_NEEDLE)) {
    throw new Error("JOGMEC live autofix: amount classifier insertion point is missing");
  }
  const guard = `raw === ${jsString(raw)}`;
  if (parser.includes(guard)) {
    throw new Error(`JOGMEC live autofix: repeated unknown amount: ${raw}`);
  }
  let override;
  if (classification.status === "published") {
    override = `\n  if (${guard}) {\n    return { amount: ${classification.amount}, amountStatus: "published", amountStage: contractType === "competitive" ? AMOUNT_STAGE.competitive : AMOUNT_STAGE.discretionary, publishedText: raw };\n  }`;
  } else if (classification.status === "unavailable") {
    override = `\n  if (${guard}) {\n    return { amount: null, amountStatus: "unavailable", amountStage: "契約金額の記載なし", publishedText: raw };\n  }`;
  } else {
    override = `\n  if (${guard}) {\n    return { amount: null, amountStatus: "non_total", amountStage: "単価・変動額（契約総額の記載なし）", publishedText: raw };\n  }`;
  }
  parser = parser.replace(CLASSIFIER_NEEDLE, `${CLASSIFIER_NEEDLE}${override}`);
  await writeFile(PARSER_PATH, parser);

  let tests = await readFile(TEST_PATH, "utf8");
  if (!tests.includes(TEST_ANCHOR)) {
    throw new Error("JOGMEC live autofix: amount test insertion point is missing");
  }
  const assertion = classification.status === "published"
    ? `  assert.equal(classifyJogmecAmount(${jsString(raw)}, "competitive").amount, ${classification.amount});`
    : `  assert.equal(classifyJogmecAmount(${jsString(raw)}, "competitive").amountStatus, ${jsString(classification.status)});`;
  if (!tests.includes(assertion)) {
    tests = tests.replace(TEST_ANCHOR, `${TEST_ANCHOR}\n${assertion}`);
    await writeFile(TEST_PATH, tests);
  }
  console.log(`JOGMEC live autofix: ${JSON.stringify(raw)} -> ${classification.status}`);
}

await mkdir(".audit", { recursive: true });
const decisions = [];
for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
  const result = spawnSync(process.execPath, [PARSER_PATH], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  await writeFile(`.audit/jogmec-autofix-${attempt}.log`, output);
  process.stdout.write(output);
  if (result.status === 0) {
    await writeFile(".audit/jogmec-autofix-decisions.json", `${JSON.stringify(decisions, null, 2)}\n`);
    console.log(`JOGMEC live autofix: reingest completed after ${attempt} attempt(s)`);
    process.exit(0);
  }
  const matches = [...output.matchAll(/Error: JOGMEC: 契約金額(?:を解析できません|に未知の表記があります) \((.*)\)/gu)];
  const raw = matches.at(-1)?.[1];
  if (!raw) {
    await writeFile(".audit/jogmec-autofix-decisions.json", `${JSON.stringify(decisions, null, 2)}\n`);
    throw new Error("JOGMEC live autofix stopped on a structural or non-amount parser failure");
  }
  const classification = classifyUnknownAmount(raw);
  if (!classification) {
    await writeFile(".audit/jogmec-autofix-decisions.json", `${JSON.stringify([...decisions, { raw, status: "unresolved" }], null, 2)}\n`);
    throw new Error(`JOGMEC live autofix cannot determine the meaning of amount text: ${raw}`);
  }
  decisions.push({ raw, ...classification });
  await addExactOverride(raw, classification);
}
await writeFile(".audit/jogmec-autofix-decisions.json", `${JSON.stringify(decisions, null, 2)}\n`);
throw new Error(`JOGMEC live autofix exceeded ${MAX_ATTEMPTS} attempts`);
