export function cleanCell(value = "") {
  return String(value)
    .replace(/^\uFEFF/, "")
    .replace(/[\u3000\s]+/g, " ")
    .trim();
}

export function parseJapaneseDate(value) {
  const normalized = cleanCell(value);
  const iso = normalized.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (iso) return validIsoDate(iso[1], iso[2], iso[3]);
  const compact = normalized.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return validIsoDate(compact[1], compact[2], compact[3]);
  const japanese = normalized.match(/(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/);
  if (!japanese) return null;
  return validIsoDate(japanese[1], japanese[2], japanese[3]);
}

function validIsoDate(yearValue, monthValue, dayValue) {
  const year = Number(yearValue);
  const month = Number(monthValue);
  const day = Number(dayValue);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year
    || candidate.getUTCMonth() !== month - 1
    || candidate.getUTCDate() !== day
  ) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function fiscalYear(date) {
  const [year, month] = date.split("-").map(Number);
  return month <= 3 ? year - 1 : year;
}

export function parseAmount(value) {
  if (value === null || value === undefined || cleanCell(value) === "") return null;
  let normalized = cleanCell(value)
    .replaceAll(",", "")
    .replace(/[円￥]/g, "");
  if (/^[△▲]/.test(normalized)) normalized = `-${normalized.slice(1)}`;
  if (/^\(.+\)$/.test(normalized)) normalized = `-${normalized.slice(1, -1)}`;
  const amount = Number(normalized);
  return Number.isSafeInteger(amount) ? amount : null;
}

export function hasValidCorporateNumber(value) {
  if (!/^\d{13}$/.test(value)) return false;
  const digits = value.slice(1).split("").map(Number);
  const weightedSum = digits.reduce(
    (sum, digit, index) => sum + digit * (index % 2 === 0 ? 2 : 1),
    0,
  );
  return Number(value[0]) === 9 - (weightedSum % 9);
}
