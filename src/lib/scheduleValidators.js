/** Общие правила парсинга полей записи расписания (совпадают с админским импортом). */

export function normalizeCellText(v) {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v;
  return String(v)
    .normalize("NFKC")
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "\n")
    .trim();
}

export function normalizeToken(v) {
  return String(normalizeCellText(v) || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[«»"'`]/g, "")
    .replace(/[\s\-_.:,;()[\]{}\\/№]+/g, "")
    .trim();
}

export function normalizeLessonType(v) {
  const key = normalizeToken(v);
  if (
    key.startsWith("lec") ||
    key.includes("lecture") ||
    key.includes("лекц") ||
    key === "лк"
  ) {
    return "lecture";
  }
  return "practice";
}

export function normalizeStudyForm(v) {
  const key = normalizeToken(v);
  if (!key) return "full-time";
  if (key === "parttime" || key.includes("очнозаоч") || key.includes("вечер")) {
    return "part-time";
  }
  if (key === "distance" || key.includes("дистан") || key.includes("заоч")) {
    return "distance";
  }
  return "full-time";
}

export function normalizeSubgroup(v, fallback = "all") {
  const raw = String(normalizeCellText(v) || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .trim();
  const key = normalizeToken(raw);
  if (!key) return fallback;

  if (
    ["all", "any", "все", "всягруппа", "общая", "общий", "общ", "безподгруппы", "0"].includes(key)
  ) {
    return "all";
  }
  if (
    ["a", "а", "1", "i", "первая", "перв", "подгруппаa", "подгруппаа", "подгруппа1", "пг1"].includes(
      key
    )
  ) {
    return "a";
  }
  if (
    ["b", "б", "2", "ii", "вторая", "втор", "подгруппаb", "подгруппаб", "подгруппа2", "пг2"].includes(
      key
    )
  ) {
    return "b";
  }

  if (/(^|[^a-zа-я0-9])(a|а|1)([^a-zа-я0-9]|$)/i.test(raw) && /(подгруп|п\/г|пг|subgroup|sg)/i.test(raw)) {
    return "a";
  }
  if (/(^|[^a-zа-я0-9])(b|б|2)([^a-zа-я0-9]|$)/i.test(raw) && /(подгруп|п\/г|пг|subgroup|sg)/i.test(raw)) {
    return "b";
  }

  return fallback;
}

export function formatClockTime(hours, minutes) {
  const hh = Number(hours);
  const mm = Number(minutes);
  if (!Number.isInteger(hh) || !Number.isInteger(mm)) return "";
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return "";
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

export function excelNumberToClockTime(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return "";

  if (n >= 0 && n < 1) {
    const totalMinutes = Math.round(n * 24 * 60) % (24 * 60);
    return formatClockTime(Math.floor(totalMinutes / 60), totalMinutes % 60);
  }

  if (n >= 1 && n < 24) {
    const hours = Math.floor(n);
    const minutes = Math.round((n - hours) * 60);
    return formatClockTime(hours, minutes);
  }

  if (n >= 24 && n % 1 !== 0) {
    const fraction = n - Math.floor(n);
    const totalMinutes = Math.round(fraction * 24 * 60) % (24 * 60);
    return formatClockTime(Math.floor(totalMinutes / 60), totalMinutes % 60);
  }

  if (Number.isInteger(n) && n >= 100 && n <= 2359) {
    return formatClockTime(Math.floor(n / 100), n % 100);
  }

  return "";
}

export function normalizeClockTime(raw) {
  if (raw instanceof Date) {
    return formatClockTime(raw.getHours(), raw.getMinutes());
  }

  if (typeof raw === "number") {
    return excelNumberToClockTime(raw) || String(raw).trim();
  }

  const s = String(normalizeCellText(raw) || "").trim();
  if (!s) return "";

  const compact = s.replace(/\s+/g, "");
  const numeric = compact.replace(",", ".");
  if (/^\d+(\.\d+)?$/.test(numeric)) {
    const fromNumber = excelNumberToClockTime(Number(numeric));
    if (fromNumber) return fromNumber;
  }

  let match = s.match(/(\d{1,2})\s*[:.]\s*(\d{1,2})(?::\d{1,2})?/);
  if (!match) {
    match = s.match(/(\d{1,2})\s*(?:ч|h)\s*(\d{1,2})?/i);
  }
  if (match) {
    return formatClockTime(Number(match[1]), Number(match[2] || 0)) || s;
  }

  const digits = compact.match(/^\d{3,4}$/);
  if (digits) {
    const fromNumber = excelNumberToClockTime(Number(compact));
    if (fromNumber) return fromNumber;
  }

  if (/^\d{1,2}$/.test(compact)) {
    return formatClockTime(Number(compact), 0) || s;
  }

  return s;
}

export function clockTimeVariants(raw) {
  const normalized = normalizeClockTime(raw);
  const out = new Set([normalized]);
  const match = normalized.match(/^0(\d):(\d{2})$/);
  if (match) out.add(`${Number(match[1])}:${match[2]}`);
  return [...out].filter(Boolean);
}

export function clockTimeToMinutes(raw) {
  const time = normalizeClockTime(raw);
  const match = String(time || "").match(/^(\d{2}):(\d{2})$/);
  if (!match) return Number.MAX_SAFE_INTEGER;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function isValidClockTime(raw) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(normalizeClockTime(raw) || ""));
}

export function compareScheduleItems(a, b) {
  return (
    Number(a.dayOfWeek || 0) - Number(b.dayOfWeek || 0) ||
    clockTimeToMinutes(a.startTime) - clockTimeToMinutes(b.startTime) ||
    clockTimeToMinutes(a.endTime) - clockTimeToMinutes(b.endTime) ||
    String(a.subject || "").localeCompare(String(b.subject || ""), "ru")
  );
}
