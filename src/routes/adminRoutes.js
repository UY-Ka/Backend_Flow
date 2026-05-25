import express from "express";
import multer from "multer";
import xlsx from "xlsx";

import User from "../models/User.js";
import Group from "../models/Group.js";
import ScheduleItem from "../models/ScheduleItem.js";
import Program from "../models/Program.js";
import Faculty from "../models/Faculty.js";
import Grade from "../models/Grade.js";
import News from "../models/News.js";
import { requireAuth } from "../middleware/authMiddleware.js";
import { ensureDeanAcademicHierarchy } from "../lib/deanAcademicSeed.js";

const router = express.Router();

router.use(requireAuth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = String(file.originalname || "").toLowerCase();
    if (ext.endsWith(".xlsx") || ext.endsWith(".xls")) return cb(null, true);
    return cb(new Error("Загрузите файл .xlsx или .xls"), false);
  },
});

function mustAdmin(user) {
  return user?.role === "admin";
}

function normalizeCellText(v) {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v;
  return String(v)
    .normalize("NFKC")
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "\n")
    .trim();
}

function normalizeToken(v) {
  return String(normalizeCellText(v) || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[«»"'`]/g, "")
    .replace(/[\s\-_.:,;()[\]{}\\/№]+/g, "")
    .trim();
}

function normalizeLessonType(v) {
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

function normalizeStudyForm(v) {
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

function normalizeSubgroup(v, fallback = "all") {
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
  if (["a", "а", "1", "i", "первая", "перв", "подгруппаa", "подгруппаа", "подгруппа1", "пг1"].includes(key)) {
    return "a";
  }
  if (["b", "б", "2", "ii", "вторая", "втор", "подгруппаb", "подгруппаб", "подгруппа2", "пг2"].includes(key)) {
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

function normalizeControlType(v) {
  const s = String(v || "").toLowerCase().trim();
  if (s === "credit" || s.includes("зач")) return "credit";
  return "exam";
}

function formatClockTime(hours, minutes) {
  const hh = Number(hours);
  const mm = Number(minutes);
  if (!Number.isInteger(hh) || !Number.isInteger(mm)) return "";
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return "";
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function excelNumberToClockTime(raw) {
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

function normalizeClockTime(raw) {
  if (raw instanceof Date) {
    return formatClockTime(raw.getHours(), raw.getMinutes());
  }

  if (typeof raw === "number") {
    return excelNumberToClockTime(raw) || String(raw).trim();
  }

  const s = String(normalizeCellText(raw) || "").trim();
  if (!s) return "";

  const compact = s.replace(/\s+/g, "");
  const dashHm = compact.match(/^(\d{1,2})-(\d{2})$/);
  if (dashHm) {
    return formatClockTime(Number(dashHm[1]), Number(dashHm[2])) || s;
  }

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

function clockTimeVariants(raw) {
  const normalized = normalizeClockTime(raw);
  const out = new Set([normalized]);
  const match = normalized.match(/^0(\d):(\d{2})$/);
  if (match) out.add(`${Number(match[1])}:${match[2]}`);
  return [...out].filter(Boolean);
}

function clockTimeToMinutes(raw) {
  const time = normalizeClockTime(raw);
  const match = String(time || "").match(/^(\d{2}):(\d{2})$/);
  if (!match) return Number.MAX_SAFE_INTEGER;
  return Number(match[1]) * 60 + Number(match[2]);
}

function compareScheduleItems(a, b) {
  return (
    Number(a.dayOfWeek || 0) - Number(b.dayOfWeek || 0) ||
    clockTimeToMinutes(a.startTime) - clockTimeToMinutes(b.startTime) ||
    clockTimeToMinutes(a.endTime) - clockTimeToMinutes(b.endTime) ||
    String(a.subject || "").localeCompare(String(b.subject || ""), "ru")
  );
}

function isValidClockTime(raw) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(normalizeClockTime(raw) || ""));
}

function normalizeTextKey(v) {
  return normalizeToken(v);
}

function normalizeProgramName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim();
}

function dedupeProgramsByName(programs = []) {
  const seen = new Set();
  const out = [];
  for (const program of programs) {
    const key = normalizeProgramName(program?.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(program);
  }
  return out;
}

function parseTimeRange(raw) {
  const s = String(normalizeCellText(raw) || "")
    .replace(/[–—−]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return null;

  const chained = s.match(/^(\d{1,2}-\d{2})-(\d{1,2}-\d{2})$/);
  if (chained) {
    const startTime = normalizeClockTime(chained[1]);
    const endTime = normalizeClockTime(chained[2]);
    if (isValidClockTime(startTime) && isValidClockTime(endTime)) {
      return { startTime, endTime };
    }
  }

  const spacedPair = s.match(/^(\d{1,2}-\d{2})\s+-\s+(\d{1,2}-\d{2})$/);
  if (spacedPair) {
    const startTime = normalizeClockTime(spacedPair[1]);
    const endTime = normalizeClockTime(spacedPair[2]);
    if (isValidClockTime(startTime) && isValidClockTime(endTime)) {
      return { startTime, endTime };
    }
  }

  const dashParts = s.split(/\s*-\s*/).filter(Boolean);
  if (dashParts.length >= 2) {
    const startTime = normalizeClockTime(dashParts[0]);
    const endTime = normalizeClockTime(dashParts[1]);
    if (isValidClockTime(startTime) && isValidClockTime(endTime)) {
      return { startTime, endTime };
    }
  }

  const matches = [...s.matchAll(/(\d{1,2}\s*[:.]\s*\d{1,2}(?::\d{1,2})?|\b\d{3,4}\b)/g)]
    .map((match) => normalizeClockTime(match[1]))
    .filter(isValidClockTime);
  if (matches.length >= 2) {
    return { startTime: matches[0], endTime: matches[1] };
  }

  return null;
}

function parseWeekType(raw, fallback = 1) {
  const n = Number(raw);
  if (n === 1 || n === 2) return n;

  const key = normalizeToken(raw);
  if (!key) return fallback;
  if (key.includes("нечет") || key.includes("числ") || key.includes("верх") || key.includes("odd") || key.includes("first") || key.includes("первая") || key.includes("1")) {
    return 1;
  }
  if (key.includes("знамен") || key.includes("ниж") || key.includes("even") || key.includes("second") || key.includes("вторая") || key.includes("2") || key.includes("чет")) {
    return 2;
  }
  return fallback;
}

function parseWeekTypes(raw, fallback = 1) {
  const key = normalizeToken(raw);
  if (key.includes("кажд") || key.includes("еженед") || key.includes("обе") || key.includes("всенед") || key.includes("both")) {
    return [1, 2];
  }
  return [parseWeekType(raw, fallback)];
}

function parseDayOfWeek(raw) {
  if (raw instanceof Date) {
    const jsDay = raw.getDay();
    return jsDay === 0 ? 7 : jsDay;
  }

  const n = Number(raw);
  if (Number.isInteger(n) && n >= 1 && n <= 7) return n;

  const key = normalizeToken(raw);
  if (!key) return 0;

  const exact = {
    пн: 1,
    пон: 1,
    понедельник: 1,
    monday: 1,
    mon: 1,
    вт: 2,
    вторник: 2,
    tuesday: 2,
    tue: 2,
    ср: 3,
    среда: 3,
    wednesday: 3,
    wed: 3,
    чт: 4,
    четверг: 4,
    thursday: 4,
    thu: 4,
    пт: 5,
    пятница: 5,
    friday: 5,
    fri: 5,
    сб: 6,
    суббота: 6,
    saturday: 6,
    sat: 6,
    вс: 7,
    воскресенье: 7,
    sunday: 7,
    sun: 7,
  };
  if (exact[key]) return exact[key];
  if (key.includes("понед")) return 1;
  if (key.includes("втор")) return 2;
  if (key.includes("сред")) return 3;
  if (key.includes("четвер")) return 4;
  if (key.includes("пятниц")) return 5;
  if (key.includes("суббот")) return 6;
  if (key.includes("воскрес")) return 7;
  return 0;
}

const FIELD_ALIASES = {
  group: ["group", "группа", "учебная группа", "группа студента"],
  weekType: ["weekType", "week", "неделя", "тип недели", "числитель", "знаменатель"],
  studyForm: ["studyForm", "форма", "форма обучения"],
  subgroup: ["subgroup", "подгруппа", "подгруппа (A/B/ALL)", "п/г", "пг"],
  dayOfWeek: ["dayOfWeek", "day", "день", "день недели"],
  startTime: ["startTime", "start", "начало", "начало пары", "с"],
  endTime: ["endTime", "end", "конец", "окончание", "окончание пары", "до"],
  timeRange: ["time", "время", "время пары", "пара", "интервал"],
  subject: ["subject", "предмет", "дисциплина", "занятие", "наименование дисциплины"],
  teacher: ["teacher", "преподаватель", "педагог"],
  room: ["room", "аудитория", "ауд.", "место", "кабинет"],
  lessonType: ["lessonType", "type", "вид", "тип", "тип занятия"],
  note: ["note", "заметка", "примечание", "комментарий"],
};

function getRowValue(row, aliases) {
  if (!row) return "";
  for (const alias of aliases) {
    if (Object.prototype.hasOwnProperty.call(row, alias) && row[alias] !== "") return row[alias];
  }

  const aliasKeys = aliases.map(normalizeToken).filter(Boolean);
  for (const [key, value] of Object.entries(row)) {
    const headerKey = normalizeToken(key);
    if (!headerKey) continue;
    if (
      aliasKeys.includes(headerKey) ||
      aliasKeys.some((aliasKey) => headerKey.includes(aliasKey) || aliasKey.includes(headerKey))
    ) {
      return value;
    }
  }

  return "";
}

function inferSubgroupFromText(raw) {
  const text = String(normalizeCellText(raw) || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .trim();
  if (!text) return "";
  const explicit = normalizeSubgroup(text, "");
  if (explicit) return explicit;
  if (/[(/\\-]\s*(a|а)\s*\)?$/i.test(text)) return "a";
  if (/[(/\\-]\s*(b|б)\s*\)?$/i.test(text)) return "b";
  return "";
}

function stripSubgroupLabelFromGroupName(raw) {
  return String(normalizeCellText(raw) || "")
    .replace(/\(?\s*(подгруппа|п\/г|пг|subgroup|sg)\s*(a|а|b|б|1|2)\s*\)?/gi, "")
    .replace(/\s*[/\\]\s*(a|а|b|б)\s*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function findGroupInCache(groups = [], groupName) {
  const candidates = [
    String(groupName || "").trim(),
    stripSubgroupLabelFromGroupName(groupName),
  ].filter(Boolean);

  for (const candidate of candidates) {
    const targetKey = normalizeTextKey(candidate);
    const exact = groups.find((group) => normalizeTextKey(group.name) === targetKey);
    if (exact) return exact;

    const partial = groups.find((group) => {
      const groupKey = normalizeTextKey(group.name);
      return groupKey.includes(targetKey) || targetKey.includes(groupKey);
    });
    if (partial) return partial;
  }

  return null;
}

function findMatrixLayout(rows, groups = []) {
  const maxHeaderRows = Math.min(rows.length, 10);
  let groupRowIndex = 1;
  let firstGroupCol = 2;
  let bestScore = 0;

  for (let r = 0; r < maxHeaderRows; r++) {
    const row = rows[r] || [];
    let score = 0;
    let firstCol = -1;
    for (let c = 0; c < row.length; c++) {
      if (findGroupInCache(groups, row[c])) {
        score += 1;
        if (firstCol === -1) firstCol = c;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      groupRowIndex = r;
      firstGroupCol = firstCol >= 0 ? firstCol : 2;
    }
  }

  let subgroupRowIndex = groupRowIndex + 1;
  let subgroupScore = -1;
  for (let r = groupRowIndex + 1; r <= Math.min(groupRowIndex + 3, rows.length - 1); r++) {
    const row = rows[r] || [];
    const score = row.reduce((count, value) => count + (normalizeSubgroup(value, "") ? 1 : 0), 0);
    if (score > subgroupScore) {
      subgroupScore = score;
      subgroupRowIndex = r;
    }
  }

  return {
    groupRowIndex,
    subgroupRowIndex,
    firstGroupCol: Math.max(firstGroupCol, 0),
    dataStartRow: Math.max(groupRowIndex, subgroupRowIndex) + 1,
  };
}

function inheritedLabels(row, startCol = 0) {
  const out = [];
  let current = "";
  for (let col = 0; col < row.length; col++) {
    const value = String(normalizeCellText(row[col]) || "").trim();
    if (col >= startCol && value) current = value;
    out[col] = col >= startCol ? current : value;
  }
  return out;
}

function findDayCell(row, firstGroupCol) {
  const limit = Math.min(firstGroupCol, 4);
  for (let col = 0; col <= limit; col++) {
    const dayOfWeek = parseDayOfWeek(row[col]);
    if (dayOfWeek) return { col, dayOfWeek };
  }
  return { col: -1, dayOfWeek: 0 };
}

function findTimeCell(row, firstGroupCol) {
  const limit = Math.min(firstGroupCol, 4);
  for (let col = 0; col <= limit; col++) {
    const timeRange = parseTimeRange(row[col]);
    if (timeRange) return { col, timeRange };
  }
  return { col: -1, timeRange: null };
}

function findWeekTypesInRow(row, firstGroupCol, excludedCols, fallback) {
  const limit = Math.min(firstGroupCol, 4);
  for (let col = 0; col <= limit; col++) {
    if (excludedCols.has(col)) continue;
    const value = row[col];
    const key = normalizeToken(value);
    const n = Number(value);
    if (
      key.includes("нед") ||
      key.includes("числ") ||
      key.includes("знамен") ||
      key.includes("верх") ||
      key.includes("ниж") ||
      key.includes("чет") ||
      key.includes("odd") ||
      key.includes("even") ||
      n === 1 ||
      n === 2
    ) {
      return parseWeekTypes(value, fallback);
    }
  }
  return null;
}

function normalizeTeacherKey(v) {
  return String(v || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
}

function teacherVariants(user) {
  const out = new Set();
  const fullName = String(user?.fullName || "").trim();
  const username = String(user?.username || "").trim();
  const email = String(user?.email || "").trim();

  if (fullName) {
    const parts = fullName.split(/\s+/).filter(Boolean);
    out.add(normalizeTeacherKey(fullName));
    if (parts.length >= 2) {
      const surname = parts[0];
      const initials = parts
        .slice(1)
        .map((p) => `${p[0] || ""}.`)
        .join("");
      if (surname) {
        out.add(normalizeTeacherKey(surname));
        if (initials) out.add(normalizeTeacherKey(`${surname} ${initials}`));
      }
    }
  }

  if (username) out.add(normalizeTeacherKey(username));
  if (email) {
    out.add(normalizeTeacherKey(email));
    const emailPrefix = email.includes("@") ? email.split("@")[0] : email;
    if (emailPrefix) out.add(normalizeTeacherKey(emailPrefix));
  }

  return [...out].filter(Boolean);
}

function resolveTeacherMatch(teacherLabel, teachers = []) {
  const raw = String(teacherLabel || "").trim();
  if (!raw) return null;
  const normalized = normalizeTeacherKey(raw);
  const labelSurname = normalized.split(/\s+/)[0] || "";

  for (const teacher of teachers) {
    const variants = teacherVariants(teacher);
    if (variants.includes(normalized)) return teacher;
  }

  if (!labelSurname) return null;
  for (const teacher of teachers) {
    const variants = teacherVariants(teacher);
    if (variants.some((variant) => variant === labelSurname || variant.startsWith(`${labelSurname} `))) {
      return teacher;
    }
  }

  return null;
}

function splitLessonCell(raw) {
  const text = String(normalizeCellText(raw) || "").trim();
  if (!text) return null;

  const lines = text
    .split(/\n|;/)
    .map((line) => String(line || "").trim())
    .filter(Boolean);

  if (lines.length === 0) return null;

  let subject = "";
  let teacher = "";
  let room = "";
  const noteLines = [];
  let lessonType = normalizeLessonType(text);

  for (const rawLine of lines) {
    const line = String(rawLine || "").trim();
    const lineKey = normalizeToken(line);
    const typeMatch = line.match(/^(.*?)(?:[-–—,()]|\s)+(Лекц(?:ия)?|Лаб|Сем|Практ(?:ика)?|lecture|practice)\s*\)?$/i);
    const cleanedLine = String(typeMatch?.[1] || line)
      .replace(/^(дисциплина|предмет|занятие)\s*[:\-]\s*/i, "")
      .trim();

    if (typeMatch?.[2]) lessonType = normalizeLessonType(typeMatch[2]);
    if (!cleanedLine || ["лекция", "практика", "семинар", "лабораторная"].includes(lineKey)) continue;

    if (!teacher && /(преп|преподаватель|teacher|доц|проф|ст\.?\s*преп)/i.test(line)) {
      teacher = line.replace(/^(преподаватель|преп\.?|teacher)\s*[:\-]?\s*/i, "").trim();
      continue;
    }

    if (!room && /(ауд|аудитория|каб|кабинет|room|корп)/i.test(line)) {
      room = line.replace(/^(аудитория|ауд\.?|кабинет|каб\.?|room)\s*[:\-]?\s*/i, "").trim();
      continue;
    }

    if (!subject) subject = cleanedLine;
    else if (!teacher) teacher = line;
    else if (!room) room = line;
    else noteLines.push(line);
  }

  if (!room) {
    const roomMatch = text.match(/(?:аудитория|ауд\.?|кабинет|каб\.?|room)\s*[:\-]?\s*([^\n;,]+)/i);
    if (roomMatch?.[1]) room = roomMatch[1].trim();
  }

  return {
    subject,
    teacher,
    room,
    lessonType,
    note: noteLines.join("\n").trim(),
  };
}

function expandMergedRows(rows, merges = []) {
  const out = rows.map((row) => row.slice());
  for (const merge of merges) {
    const startRow = merge?.s?.r ?? 0;
    const endRow = merge?.e?.r ?? 0;
    const startCol = merge?.s?.c ?? 0;
    const endCol = merge?.e?.c ?? 0;
    const source = out[startRow]?.[startCol] ?? "";
    for (let r = startRow; r <= endRow; r++) {
      if (!out[r]) out[r] = [];
      for (let c = startCol; c <= endCol; c++) {
        out[r][c] = source;
      }
    }
  }
  return out;
}

async function findProgramGroup(programId, groupName, groupsCache = null) {
  const groups = groupsCache || (await Group.find({ programId }).select("_id name programId"));
  return findGroupInCache(groups, groupName);
}

async function upsertScheduleRow({
  rowIndex,
  group,
  weekType,
  studyForm,
  subgroup,
  dayOfWeek,
  startTime,
  endTime,
  subject,
  teacher,
  teacherUserId,
  room,
  lessonType,
  note,
  errors,
}) {
  if (!group?._id) {
    errors.push({ row: rowIndex, message: "Группа не найдена" });
    return { created: 0, updated: 0 };
  }

  const filter = {
    groupId: group._id,
    weekType,
    studyForm,
    subgroup,
    dayOfWeek,
    startTime: { $in: clockTimeVariants(startTime) },
    endTime: { $in: clockTimeVariants(endTime) },
    subject,
  };

  const update = {
    groupId: group._id,
    groupLabel: "",
    weekType,
    studyForm,
    subgroup,
    dayOfWeek,
    startTime,
    endTime,
    subject,
    teacher,
    teacherUserId: teacherUserId || null,
    room,
    lessonType,
    note,
  };

  const existing = await ScheduleItem.findOne(filter).select("_id");
  if (existing) {
    await ScheduleItem.updateOne({ _id: existing._id }, { $set: update });
    return { created: 0, updated: 1 };
  }

  await ScheduleItem.create(update);
  return { created: 1, updated: 0 };
}

function normalizeGroupToken(raw) {
  return String(raw || "")
    .replace(/[()]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function expandGroupToken(rawToken) {
  const token = normalizeGroupToken(rawToken);
  if (!token) return [];

  const parts = token
    .split("/")
    .map((part) => normalizeGroupToken(part))
    .filter(Boolean);
  if (parts.length <= 1) return [token];

  const first = parts[0];
  const dashIndex = first.lastIndexOf("-");
  const prefix = dashIndex >= 0 ? first.slice(0, dashIndex + 1) : "";
  const out = [first];

  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;
    if (part.includes("-") || !prefix) {
      out.push(part);
      continue;
    }
    out.push(`${prefix}${part}`);
  }

  return [...new Set(out)];
}

function extractRoomFromTail(text) {
  const source = String(text || "").trim();
  if (!source) return "";

  const roomPatterns = [
    /(\d{1,4}[а-яa-z]?(?:\s+[а-яa-z]{1,8})?)$/i,
    /((?:ауд\.?|аудитория|каб\.?|кабинет)\s*[0-9а-яa-z\-\/ ]+)$/i,
  ];

  for (const pattern of roomPatterns) {
    const match = source.match(pattern);
    if (match?.[1]) return normalizeCellText(match[1]);
  }
  return "";
}

function stripTrailingPunct(s) {
  return String(s || "").replace(/[/\\.,;]+$/g, "").trim();
}

function parseRoomForWeekType(roomRaw, weekType) {
  const s = String(roomRaw || "").trim();
  if (!s || s === "—") return s || "—";
  const noSpace = s.replace(/\s+/g, "");
  const m = noSpace.match(/^(\d{1,4}[а-яёa-z]?)\/(\d{1,4}[а-яёa-z]?)$/i);
  if (m) {
    return (weekType === 1 ? m[1] : m[2]).trim();
  }

  const parts = s
    .split("/")
    .map((x) => stripTrailingPunct(x.trim()))
    .filter(Boolean);
  if (parts.length === 2) {
    const [a, b] = parts;
    if (
      /^\d{1,4}[а-яёa-z]?$/i.test(a) &&
      /^\d{1,4}[а-яёa-z]?$/i.test(b) &&
      a.length <= 8 &&
      b.length <= 8
    ) {
      return weekType === 1 ? a : b;
    }
  }
  return s;
}

function isLikelyRoomToken(tok) {
  const s = stripTrailingPunct(tok);
  if (!s) return false;
  const noSpace = s.replace(/\s+/g, "");
  if (/^\d{1,4}[а-яёa-z]?\s*\/\s*\d{1,4}[а-яёa-z]?$/i.test(noSpace)) return true;
  if (/^\d{1,2}-\d{1,2}$/.test(s)) return false;
  if (/^\d+-\d+$/.test(s) && s.length < 8) return false;
  if (/^\d{3,4}$/.test(s)) return true;
  if (/^\d{3,4}[а-яё]{1,3}$/i.test(s)) return true;
  if (/^\d{2,3}[а-яё]$/i.test(s)) return true;
  if (/^(ауд|каб)/i.test(s)) return true;
  return false;
}

function isLessonTypeAbbrevToken(tok) {
  const s = String(tok || "").trim();
  if (!s || s.length > 20) return false;
  const st = stripTrailingPunct(s);
  if (/^лекц/i.test(st)) return true;
  if (/^практ/i.test(st)) return true;
  if (/^сем(ин|инар)?/i.test(st)) return true;
  if (/^лаб(ор|ораторн)?/i.test(st)) return true;
  if (/^лк$/i.test(st)) return true;
  if (/^проф/i.test(st)) return true;
  if (/^випк/i.test(st)) return true;
  if (/^инд(ивид)?/i.test(st)) return true;
  if (/^дв$/i.test(st) || /^дв[:.]$/i.test(st)) return true;
  if (/^курс$/i.test(st) || /^курс\.$/i.test(st)) return true;
  const key = normalizeToken(st);
  return (
    key.length <= 10 &&
    (key.includes("лекц") || key.includes("практ") || key.includes("семин"))
  );
}

function roomFallbackFromLine(line) {
  const raw = String(line || "").trim();
  if (!raw) return "";
  const tokens = raw
    .split(/\s+/)
    .map(stripTrailingPunct)
    .filter(Boolean);
  if (tokens.length && isLikelyRoomToken(tokens[tokens.length - 1])) {
    return stripTrailingPunct(tokens[tokens.length - 1]);
  }
  return extractRoomFromTail(raw);
}

function splitTeacherMatrixCell(raw, groupsCache = []) {
  const text = String(normalizeCellText(raw) || "").trim();
  if (!text) return null;

  const lines = text
    .split(/\n|;/)
    .map((line) => String(line || "").trim())
    .filter(Boolean);
  if (lines.length === 0) return null;

  const tokens = lines[0]
    .split(/\s+/)
    .map(stripTrailingPunct)
    .filter(Boolean);
  if (tokens.length === 0) return null;

  let room = "";
  let workTokens = tokens;
  if (workTokens.length && isLikelyRoomToken(workTokens[workTokens.length - 1])) {
    room = stripTrailingPunct(workTokens[workTokens.length - 1]);
    workTokens = workTokens.slice(0, -1);
  }

  let lessonTypeTokenIdx = -1;
  for (let i = 1; i < workTokens.length; i++) {
    if (isLessonTypeAbbrevToken(workTokens[i])) {
      lessonTypeTokenIdx = i;
      break;
    }
  }

  let groups;
  let subject;
  let lessonType = "practice";

  if (lessonTypeTokenIdx >= 1) {
    const groupPart = workTokens.slice(0, lessonTypeTokenIdx).join(" ").trim();
    groups = expandGroupToken(groupPart);
    lessonType = normalizeLessonType(workTokens[lessonTypeTokenIdx]);
    subject = [workTokens.slice(lessonTypeTokenIdx + 1).join(" "), ...lines.slice(1)]
      .join("\n")
      .trim();
  } else {
    const maxK = Math.min(8, workTokens.length - 1);
    let best = null;
    let bestScore = -Infinity;

    for (let k = 1; k <= maxK; k++) {
      const groupPart = workTokens.slice(0, k).join(" ").trim();
      const subjectPart = workTokens.slice(k).join(" ").trim();
      if (!groupPart || !subjectPart) continue;

      const groupMatch = findGroupInCache(groupsCache, groupPart);
      let score = (groupMatch ? 10000 : 0) + k * 10 + subjectPart.replace(/\s+/g, "").length;
      const compactSubject = subjectPart.replace(/\s+/g, "");
      if (/^\d{1,4}\/\d{1,4}$/.test(compactSubject)) score -= 8000;
      if (/^\d{1,4}$/.test(compactSubject)) score -= 3000;
      if (subjectPart.length >= 3 && /[А-Яа-яЁёA-Za-z]{3,}/.test(subjectPart)) score += 400;

      if (score > bestScore) {
        bestScore = score;
        best = {
          groups: expandGroupToken(groupPart),
          subject: [subjectPart, ...lines.slice(1)].join("\n").trim(),
        };
      }
    }

    if (best) {
      groups = best.groups;
      subject = best.subject;
    } else if (workTokens.length === 1) {
      groups = expandGroupToken(workTokens[0]);
      subject = lines.slice(1).join("\n").trim() || "Занятие";
    }
  }

  if (!groups?.length || !subject) return null;

  if (!room) {
    room =
      roomFallbackFromLine(lines[0]) ||
      (lines[1] ? roomFallbackFromLine(lines[1]) : "") ||
      "—";
  }
  if (room && room !== "—") {
    const escapedRoom = room.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    subject = String(subject || "").replace(new RegExp(`\\s*${escapedRoom}\\s*$`, "i"), "").trim() || subject;
  }

  return {
    groups,
    subject: String(subject || "").trim(),
    room,
    lessonType,
    note: "",
  };
}

async function importFlatSchedule({ rows, program, errors, groups, teachers }) {
  let created = 0;
  let updated = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] || {};
    const rawGroupName = String(normalizeCellText(getRowValue(r, FIELD_ALIASES.group)) || "").trim();
    const groupName = stripSubgroupLabelFromGroupName(rawGroupName) || rawGroupName;
    const groupSubgroup = inferSubgroupFromText(rawGroupName);
    const weekTypes = parseWeekTypes(getRowValue(r, FIELD_ALIASES.weekType), 1);
    const dayOfWeek = parseDayOfWeek(getRowValue(r, FIELD_ALIASES.dayOfWeek));

    const timeRange = parseTimeRange(getRowValue(r, FIELD_ALIASES.timeRange));
    const startTime = normalizeClockTime(getRowValue(r, FIELD_ALIASES.startTime) || timeRange?.startTime);
    const endTime = normalizeClockTime(getRowValue(r, FIELD_ALIASES.endTime) || timeRange?.endTime);

    const subjectCell = getRowValue(r, FIELD_ALIASES.subject);
    const lessonCell = splitLessonCell(
      getRowValue(r, ["lesson", "занятие", "занятие подробно", "описание пары", "ячейка"]) ||
        subjectCell
    );
    const subject = String(
      lessonCell?.subject || normalizeCellText(subjectCell) || ""
    ).trim();
    const teacher = String(
      normalizeCellText(getRowValue(r, FIELD_ALIASES.teacher)) || lessonCell?.teacher || ""
    ).trim();
    const room = String(
      normalizeCellText(getRowValue(r, FIELD_ALIASES.room)) || lessonCell?.room || ""
    ).trim();
    const lessonType = normalizeLessonType(getRowValue(r, FIELD_ALIASES.lessonType) || lessonCell?.lessonType || "");
    const studyForm = normalizeStudyForm(getRowValue(r, FIELD_ALIASES.studyForm));
    const subgroup = normalizeSubgroup(getRowValue(r, FIELD_ALIASES.subgroup) || groupSubgroup, "all");
    const note = String(
      normalizeCellText(getRowValue(r, FIELD_ALIASES.note)) || lessonCell?.note || ""
    )
      .trim()
      .slice(0, 500);

    if (!groupName || !subject || !teacher || !room || !startTime || !endTime) {
      errors.push({ row: i + 2, message: "Не хватает обязательных полей" });
      continue;
    }
    if (!isValidClockTime(startTime) || !isValidClockTime(endTime)) {
      errors.push({ row: i + 2, message: "Время должно быть в формате HH:MM" });
      continue;
    }
    if (clockTimeToMinutes(startTime) >= clockTimeToMinutes(endTime)) {
      errors.push({ row: i + 2, message: "Начало пары должно быть раньше конца" });
      continue;
    }
    if (!(dayOfWeek >= 1 && dayOfWeek <= 7)) {
      errors.push({ row: i + 2, message: "dayOfWeek должен быть 1..7" });
      continue;
    }

    const group = await findProgramGroup(program._id, groupName, groups);
    if (!group) {
      errors.push({ row: i + 2, message: `Группа не найдена в этом направлении: ${groupName}` });
      continue;
    }

    const teacherMatch = resolveTeacherMatch(teacher, teachers);
    for (const weekType of weekTypes) {
      const result = await upsertScheduleRow({
        rowIndex: i + 2,
        group,
        weekType,
        studyForm,
        subgroup,
        dayOfWeek,
        startTime,
        endTime,
        subject,
        teacher,
        teacherUserId: teacherMatch?._id || null,
        room,
        lessonType,
        note,
        errors,
      });
      created += result.created;
      updated += result.updated;
    }
  }

  return { created, updated };
}

async function importMatrixSchedule({ rows, merges, program, errors, groups, teachers }) {
  const preparedRows = expandMergedRows(rows, merges);
  const layout = findMatrixLayout(preparedRows, groups);
  const groupRow = inheritedLabels(preparedRows[layout.groupRowIndex] || [], layout.firstGroupCol);
  const subgroupRow = preparedRows[layout.subgroupRowIndex] || [];

  let created = 0;
  let updated = 0;
  let currentDayOfWeek = 0;
  const timeSeenByDay = new Map();

  for (let rowIndex = layout.dataStartRow; rowIndex < preparedRows.length; rowIndex++) {
    const row = preparedRows[rowIndex] || [];
    const dayCell = findDayCell(row, layout.firstGroupCol);
    if (dayCell.dayOfWeek) {
      currentDayOfWeek = dayCell.dayOfWeek;
      if (!timeSeenByDay.has(currentDayOfWeek)) {
        timeSeenByDay.set(currentDayOfWeek, new Map());
      }
    }

    const timeCell = findTimeCell(row, layout.firstGroupCol);
    const timeRange = timeCell.timeRange;
    if (!currentDayOfWeek || !timeRange) continue;
    if (!isValidClockTime(timeRange.startTime) || !isValidClockTime(timeRange.endTime)) continue;

    const perDayMap = timeSeenByDay.get(currentDayOfWeek) || new Map();
    const timeKey = `${timeRange.startTime}-${timeRange.endTime}`;
    const seenCount = perDayMap.get(timeKey) || 0;
    const inferredWeekType = seenCount % 2 === 0 ? 1 : 2;
    perDayMap.set(timeKey, seenCount + 1);
    timeSeenByDay.set(currentDayOfWeek, perDayMap);
    const weekTypes =
      findWeekTypesInRow(
        row,
        layout.firstGroupCol,
        new Set([dayCell.col, timeCell.col]),
        inferredWeekType
      ) || [inferredWeekType];

    for (let col = layout.firstGroupCol; col < row.length; col++) {
      const rawCell = String(normalizeCellText(row[col]) || "").trim();
      if (!rawCell) continue;

      const rawGroupName = String(normalizeCellText(groupRow[col]) || "").trim();
      const groupName = stripSubgroupLabelFromGroupName(rawGroupName) || rawGroupName;
      const subgroup = normalizeSubgroup(
        subgroupRow[col] || inferSubgroupFromText(rawGroupName),
        "all"
      );
      const lesson = splitLessonCell(rawCell);
      if (!groupName || !lesson?.subject || !lesson?.teacher || !lesson?.room) {
        errors.push({ row: rowIndex + 1, message: `Не удалось разобрать ячейку в колонке ${col + 1}` });
        continue;
      }

      const group = await findProgramGroup(program._id, groupName, groups);
      if (!group) {
        errors.push({ row: rowIndex + 1, message: `Группа не найдена в этом направлении: ${groupName}` });
        continue;
      }

      const teacherMatch = resolveTeacherMatch(lesson.teacher, teachers);
      for (const weekType of weekTypes) {
        const result = await upsertScheduleRow({
          rowIndex: rowIndex + 1,
          group,
          weekType,
          studyForm: "full-time",
          subgroup,
          dayOfWeek: currentDayOfWeek,
          startTime: timeRange.startTime,
          endTime: timeRange.endTime,
          subject: lesson.subject,
          teacher: lesson.teacher,
          teacherUserId: teacherMatch?._id || null,
          room: lesson.room,
          lessonType: lesson.lessonType,
          note: lesson.note,
          errors,
        });
        created += result.created;
        updated += result.updated;
      }
    }
  }

  return { created, updated };
}

async function importTeacherMatrixSchedule({ rows, program, errors, groups, teachers }) {
  const headerRowLegacy = rows.findIndex((row) => {
    const day = normalizeToken(row?.[0]);
    const time = normalizeToken(row?.[1]);
    const week = normalizeToken(row?.[2]);
    return day.includes("дни") && time.includes("врем") && week.includes("недел");
  });
  const headerRowCompact = rows.findIndex((row) => {
    const time = normalizeToken(row?.[0]);
    const week = normalizeToken(row?.[1]);
    return time.includes("врем") && week.includes("недел") && !time.includes("дни");
  });

  const mode = headerRowLegacy >= 0 ? "legacy" : headerRowCompact >= 0 ? "compact" : null;
  const headerRowIndex =
    mode === "legacy" ? headerRowLegacy : mode === "compact" ? headerRowCompact : -1;

  if (headerRowIndex < 0) {
    errors.push({ row: 1, message: "Не найдена строка заголовков формата преподавателей" });
    return { created: 0, updated: 0 };
  }

  const header = rows[headerRowIndex] || [];
  const teacherColumns = [];
  const firstTeacherCol = mode === "legacy" ? 3 : 2;
  for (let col = firstTeacherCol; col < header.length; col++) {
    const title = String(normalizeCellText(header[col]) || "").trim();
    if (!title || parseDayOfWeek(title) || normalizeToken(title).includes("неделя")) continue;
    teacherColumns.push({ col, title, user: resolveTeacherMatch(title, teachers) });
  }

  if (teacherColumns.length === 0) {
    errors.push({ row: headerRowIndex + 1, message: "Не найдены колонки преподавателей" });
    return { created: 0, updated: 0 };
  }

  let created = 0;
  let updated = 0;
  let currentDayOfWeek = mode === "compact" ? 1 : 0;
  let currentTimeRange = null;
  let currentWeekTypes = [1];
  let lastCompactSlotStartMin = -1;

  for (let rowIndex = headerRowIndex + 1; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex] || [];
    if (mode === "legacy") {
      const dayOfWeek = parseDayOfWeek(row[0] || row[29]);
      const timeRange = parseTimeRange(row[1] || row[28]);
      if (dayOfWeek) currentDayOfWeek = dayOfWeek;
      if (timeRange) currentTimeRange = timeRange;
    } else {
      const timeRange = parseTimeRange(row[0] || row[28]);
      if (
        timeRange?.startTime &&
        timeRange?.endTime &&
        isValidClockTime(timeRange.startTime) &&
        isValidClockTime(timeRange.endTime)
      ) {
        const startMinutes = clockTimeToMinutes(timeRange.startTime);
        if (lastCompactSlotStartMin >= 0 && startMinutes < lastCompactSlotStartMin - 15) {
          currentDayOfWeek = currentDayOfWeek >= 7 ? 1 : currentDayOfWeek + 1;
        }
        lastCompactSlotStartMin = startMinutes;
        currentTimeRange = timeRange;
      }
    }

    const weekRaw = mode === "legacy" ? row[2] || row[27] : row[1] ?? row[27];
    const weekToken = normalizeToken(weekRaw);

    if (weekToken || Number(weekRaw) === 1 || Number(weekRaw) === 2) {
      currentWeekTypes = parseWeekTypes(weekRaw, 1);
    }

    if (!currentDayOfWeek || !currentTimeRange?.startTime || !currentTimeRange?.endTime) continue;

    for (const teacherCol of teacherColumns) {
      const rawCell = String(normalizeCellText(row[teacherCol.col]) || "").trim();
      if (!rawCell) continue;

      const parsed = splitTeacherMatrixCell(rawCell, groups);
      if (!parsed?.subject || !parsed?.room || !parsed.groups?.length) {
        errors.push({
          row: rowIndex + 1,
          message: `Не удалось разобрать ячейку преподавателя ${teacherCol.title}`,
        });
        continue;
      }

      const teacherName = String(teacherCol.user?.fullName || teacherCol.title).trim();

      for (const groupName of parsed.groups) {
        const group = await findProgramGroup(program._id, groupName, groups);
        if (!group) {
          errors.push({
            row: rowIndex + 1,
            message: `Группа не найдена: ${groupName} (${teacherCol.title})`,
          });
          continue;
        }

        for (const weekType of currentWeekTypes) {
          const result = await upsertScheduleRow({
            rowIndex: rowIndex + 1,
            group,
            weekType,
            studyForm: "full-time",
            subgroup: "all",
            dayOfWeek: currentDayOfWeek,
            startTime: currentTimeRange.startTime,
            endTime: currentTimeRange.endTime,
            subject: parsed.subject,
            teacher: teacherName,
            teacherUserId: teacherCol.user?._id || null,
            room: parseRoomForWeekType(parsed.room, weekType),
            lessonType: parsed.lessonType,
            note: parsed.note,
            errors,
          });
          created += result.created;
          updated += result.updated;
        }
      }
    }
  }

  return { created, updated };
}

function detectScheduleFormat(rows) {
  const headerKeys = Object.keys(rows?.[0] || {}).map(normalizeToken);
  const hasAlias = (aliases) => aliases.some((alias) => headerKeys.includes(normalizeToken(alias)));
  const flatScore = [
    FIELD_ALIASES.group,
    FIELD_ALIASES.dayOfWeek,
    FIELD_ALIASES.startTime,
    FIELD_ALIASES.timeRange,
    FIELD_ALIASES.subject,
    FIELD_ALIASES.teacher,
    FIELD_ALIASES.room,
  ].reduce((score, aliases) => score + (hasAlias(aliases) ? 1 : 0), 0);

  if (flatScore >= 2) {
    return "flat-table";
  }
  const firstMatrixRow = rows?.[0] || {};
  if (
    normalizeToken(firstMatrixRow?.[0]).includes("дни") &&
    normalizeToken(firstMatrixRow?.[1]).includes("врем") &&
    normalizeToken(firstMatrixRow?.[2]).includes("неделя")
  ) {
    return "teacher-matrix";
  }
  if (
    normalizeToken(firstMatrixRow?.[0]).includes("врем") &&
    normalizeToken(firstMatrixRow?.[1]).includes("неделя")
  ) {
    return "teacher-matrix";
  }
  return "matrix-grid";
}

router.get("/academic/faculties", async (req, res) => {
  try {
    const admin = await User.findById(req.user.userId).select("role");
    if (!admin) return res.status(404).json({ message: "Пользователь не найден" });
    if (!mustAdmin(admin)) return res.status(403).json({ message: "Доступ только для администрации" });

    await ensureDeanAcademicHierarchy();
    const faculties = await Faculty.find({
      name: { $not: /информац.*технолог/i },
    })
      .sort({ name: 1 })
      .select("name code");
    return res.status(200).json({
      faculties: faculties.map((f) => ({ id: f._id, name: f.name, code: f.code })),
    });
  } catch (error) {
    console.log("Ошибка в GET /admin/academic/faculties:", error);
    return res.status(500).json({ message: "Внутренняя ошибка сервера" });
  }
});

router.get("/academic/programs", async (req, res) => {
  try {
    const admin = await User.findById(req.user.userId).select("role");
    if (!admin) return res.status(404).json({ message: "Пользователь не найден" });
    if (!mustAdmin(admin)) return res.status(403).json({ message: "Доступ только для администрации" });

    const facultyId = String(req.query.facultyId || "").trim();
    if (!facultyId) return res.status(400).json({ message: "Укажите facultyId" });

    const programs = await Program.find({ facultyId })
      .sort({ name: 1 })
      .select("name code facultyId");
    const filteredPrograms = dedupeProgramsByName(programs);
    return res.status(200).json({
      programs: filteredPrograms.map((p) => ({
        id: p._id,
        name: p.name,
        code: p.code,
      })),
    });
  } catch (error) {
    console.log("Ошибка в GET /admin/academic/programs:", error);
    return res.status(500).json({ message: "Внутренняя ошибка сервера" });
  }
});

router.get("/users/teachers", async (req, res) => {
  try {
    const admin = await User.findById(req.user.userId).select("role");
    if (!admin) return res.status(404).json({ message: "Пользователь не найден" });
    if (!mustAdmin(admin)) return res.status(403).json({ message: "Доступ только для администрации" });

    await ensureDeanAcademicHierarchy();

    const teachers = await User.find({ role: "teacher" })
      .sort({ fullName: 1, username: 1 })
      .select("username email department fullName");

    return res.status(200).json({
      teachers: teachers.map((t) => ({
        id: t._id,
        username: t.username,
        email: t.email,
        department: t.department || "",
        fullName: t.fullName || "",
      })),
    });
  } catch (error) {
    console.log("Ошибка в GET /admin/users/teachers:", error);
    return res.status(500).json({ message: "Внутренняя ошибка сервера" });
  }
});

router.get("/academic/groups", async (req, res) => {
  try {
    const admin = await User.findById(req.user.userId).select("role");
    if (!admin) return res.status(404).json({ message: "Пользователь не найден" });
    if (!mustAdmin(admin)) return res.status(403).json({ message: "Доступ только для администрации" });

    const programId = String(req.query.programId || "").trim();
    if (!programId) return res.status(400).json({ message: "Укажите programId" });

    const groups = await Group.find({
      programId,
      name: { $not: /^ИВТ/i },
    })
      .sort({ name: 1 })
      .select("name course programId");
    return res.status(200).json({
      groups: groups.map((g) => ({
        id: g._id,
        name: g.name,
        course: g.course,
      })),
    });
  } catch (error) {
    console.log("Ошибка в GET /admin/academic/groups:", error);
    return res.status(500).json({ message: "Внутренняя ошибка сервера" });
  }
});

router.get("/academic/students", async (req, res) => {
  try {
    const admin = await User.findById(req.user.userId).select("role");
    if (!admin) return res.status(404).json({ message: "Пользователь не найден" });
    if (!mustAdmin(admin)) return res.status(403).json({ message: "Доступ только для администрации" });

    const groupId = String(req.query.groupId || "").trim();
    if (!groupId) return res.status(400).json({ message: "Укажите groupId" });

    const students = await User.find({ role: "student", groupId })
      .sort({ fullName: 1, username: 1 })
      .select("username email fullName groupId studyForm subgroup");

    return res.status(200).json({
      students: students.map((s) => ({
        id: s._id,
        username: s.username,
        email: s.email,
        fullName: s.fullName || "",
        studyForm: s.studyForm || "full-time",
        subgroup: s.subgroup || "a",
      })),
    });
  } catch (error) {
    console.log("Ошибка в GET /admin/academic/students:", error);
    return res.status(500).json({ message: "Внутренняя ошибка сервера" });
  }
});

router.get("/grades", async (req, res) => {
  try {
    const admin = await User.findById(req.user.userId).select("role");
    if (!admin) return res.status(404).json({ message: "Пользователь не найден" });
    if (!mustAdmin(admin)) return res.status(403).json({ message: "Доступ только для администрации" });

    const studentId = String(req.query.studentId || "").trim();
    if (!studentId) return res.status(400).json({ message: "Укажите studentId" });

    const grades = await Grade.find({ userId: studentId }).sort({ date: -1, createdAt: -1 });
    return res.status(200).json({ grades });
  } catch (error) {
    console.log("Ошибка в GET /admin/grades:", error);
    return res.status(500).json({ message: "Внутренняя ошибка сервера" });
  }
});

router.post("/grades", async (req, res) => {
  try {
    const admin = await User.findById(req.user.userId).select("role");
    if (!admin) return res.status(404).json({ message: "Пользователь не найден" });
    if (!mustAdmin(admin)) return res.status(403).json({ message: "Доступ только для администрации" });

    const { studentId, subject, controlType, semester, value, date, comment } = req.body || {};
    const uid = String(studentId || "").trim();
    const subj = String(subject || "").trim();
    const sem = String(semester || "").trim() || "Текущий семестр";
    const ct = normalizeControlType(controlType);
    const note = String(comment || "").trim().slice(0, 300);

    if (!uid || !subj) {
      return res.status(400).json({ message: "Укажите studentId и предмет" });
    }

    const student = await User.findById(uid).select("role");
    if (!student || student.role !== "student") {
      return res.status(400).json({ message: "Студент не найден" });
    }

    let normalizedValue = value;
    if (ct === "credit") {
      normalizedValue = "зачет";
    } else {
      const n = Number(value);
      if (![2, 3, 4, 5].includes(n)) {
        return res.status(400).json({ message: "Оценка за экзамен должна быть 2..5" });
      }
      normalizedValue = n;
    }

    const gradeDate = date ? new Date(date) : new Date();
    const doc = await Grade.findOneAndUpdate(
      {
        userId: uid,
        subject: subj,
        semester: sem,
        controlType: ct,
      },
      {
        $set: {
          value: normalizedValue,
          date: Number.isNaN(gradeDate.getTime()) ? new Date() : gradeDate,
          comment: note,
        },
      },
      {
        upsert: true,
        returnDocument: "after",
        setDefaultsOnInsert: true,
      }
    );

    return res.status(201).json({ grade: doc });
  } catch (error) {
    console.log("Ошибка в POST /admin/grades:", error);
    return res.status(500).json({ message: "Внутренняя ошибка сервера" });
  }
});

router.delete("/grades/:id", async (req, res) => {
  try {
    const admin = await User.findById(req.user.userId).select("role");
    if (!admin) return res.status(404).json({ message: "Пользователь не найден" });
    if (!mustAdmin(admin)) return res.status(403).json({ message: "Доступ только для администрации" });

    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ message: "Нет id" });
    const deleted = await Grade.findByIdAndDelete(id);
    if (!deleted) return res.status(404).json({ message: "Оценка не найдена" });
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.log("Ошибка в DELETE /admin/grades/:id:", error);
    return res.status(500).json({ message: "Внутренняя ошибка сервера" });
  }
});

router.get("/schedule/items", async (req, res) => {
  try {
    const admin = await User.findById(req.user.userId).select("role");
    if (!admin) return res.status(404).json({ message: "Пользователь не найден" });
    if (!mustAdmin(admin)) return res.status(403).json({ message: "Доступ только для администрации" });

    const groupId = String(req.query.groupId || "").trim();
    const weekType = Number(req.query.weekType);
    const studyForm = normalizeStudyForm(req.query.studyForm);
    const subgroup = normalizeSubgroup(req.query.subgroup, "all");
    if (!groupId) return res.status(400).json({ message: "Укажите groupId" });
    if (!(weekType === 1 || weekType === 2)) {
      return res.status(400).json({ message: "weekType должен быть 1 или 2" });
    }

    const sf = normalizeStudyForm(studyForm);
    const studyFormClause =
      sf === "full-time"
        ? {
            $or: [{ studyForm: "full-time" }, { studyForm: { $exists: false } }],
          }
        : { studyForm: sf };
    const subgroupClause =
      subgroup === "all"
        ? {}
        : { $or: [{ subgroup }, { subgroup: "all" }, { subgroup: { $exists: false } }] };

    const items = await ScheduleItem.find({
      groupId,
      weekType,
      ...studyFormClause,
      ...subgroupClause,
    });
    items.sort(compareScheduleItems);
    return res.status(200).json({ items });
  } catch (error) {
    console.log("Ошибка в GET /admin/schedule/items:", error);
    return res.status(500).json({ message: "Внутренняя ошибка сервера" });
  }
});

router.post("/schedule/items", async (req, res) => {
  try {
    const admin = await User.findById(req.user.userId).select("role");
    if (!admin) return res.status(404).json({ message: "Пользователь не найден" });
    if (!mustAdmin(admin)) return res.status(403).json({ message: "Доступ только для администрации" });

    const {
      groupId,
      weekType,
      studyForm,
      subgroup,
      dayOfWeek,
      startTime,
      endTime,
      subject,
      teacher,
      teacherUserId,
      room,
      lessonType,
      note,
    } = req.body || {};

    const gid = String(groupId || "").trim();
    const wt = Number(weekType);
    const sf = normalizeStudyForm(studyForm);
    const sg = normalizeSubgroup(subgroup, "all");
    const dow = Number(dayOfWeek);
    const st = normalizeClockTime(startTime);
    const et = normalizeClockTime(endTime);
    const subj = String(subject || "").trim();
    let teach = String(teacher || "").trim();
    const tid = String(teacherUserId || "").trim();
    let teacherObjectId = null;
    if (tid) {
      const tu = await User.findById(tid).select("username role fullName");
      if (tu?.role === "teacher" && tu.username) {
        const fn = String(tu.fullName || "").trim();
        teach = fn || String(tu.username).trim();
        teacherObjectId = tu._id;
      }
    }
    const rm = String(room || "").trim();
    const lt = normalizeLessonType(lessonType);
    const nt = String(note || "").trim().slice(0, 500);

    if (!gid) return res.status(400).json({ message: "Укажите groupId" });
    if (!(wt === 1 || wt === 2)) return res.status(400).json({ message: "weekType должен быть 1 или 2" });
    if (!(dow >= 1 && dow <= 7)) return res.status(400).json({ message: "dayOfWeek 1..7" });
    if (!isValidClockTime(st) || !isValidClockTime(et)) {
      return res.status(400).json({ message: "Время должно быть в формате HH:MM" });
    }
    if (clockTimeToMinutes(st) >= clockTimeToMinutes(et)) {
      return res.status(400).json({ message: "Начало пары должно быть раньше конца" });
    }
    if (!st || !et || !subj || !teach || !rm) {
      return res.status(400).json({ message: "Заполните предмет, аудиторию, время и преподавателя" });
    }

    const group = await Group.findById(gid).select("_id");
    if (!group) return res.status(400).json({ message: "Группа не найдена" });

    const doc = await ScheduleItem.create({
      groupId: group._id,
      groupLabel: "",
      weekType: wt,
      studyForm: sf,
      subgroup: sg,
      dayOfWeek: dow,
      startTime: st,
      endTime: et,
      subject: subj,
      teacher: teach,
      teacherUserId: teacherObjectId,
      room: rm,
      lessonType: lt,
      note: nt,
    });

    return res.status(201).json({ item: doc });
  } catch (error) {
    console.log("Ошибка в POST /admin/schedule/items:", error);
    return res.status(500).json({ message: "Внутренняя ошибка сервера" });
  }
});

router.patch("/schedule/items/:id", async (req, res) => {
  try {
    const admin = await User.findById(req.user.userId).select("role");
    if (!admin) return res.status(404).json({ message: "Пользователь не найден" });
    if (!mustAdmin(admin)) return res.status(403).json({ message: "Доступ только для администрации" });

    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ message: "Нет id" });

    const item = await ScheduleItem.findById(id);
    if (!item) return res.status(404).json({ message: "Запись не найдена" });

    const body = req.body || {};

    if (body.groupId !== undefined) {
      const gid = String(body.groupId || "").trim();
      if (gid) {
        const group = await Group.findById(gid).select("_id");
        if (!group) return res.status(400).json({ message: "Группа не найдена" });
        item.groupId = group._id;
      }
    }
    if (body.weekType !== undefined) {
      const wt = Number(body.weekType);
      if (wt === 1 || wt === 2) item.weekType = wt;
    }
    if (body.studyForm !== undefined) {
      item.studyForm = normalizeStudyForm(body.studyForm);
    }
    if (body.subgroup !== undefined) {
      item.subgroup = normalizeSubgroup(body.subgroup, "all");
    }
    if (body.dayOfWeek !== undefined) {
      const dow = Number(body.dayOfWeek);
      if (dow >= 1 && dow <= 7) item.dayOfWeek = dow;
    }
    if (body.startTime !== undefined) item.startTime = String(body.startTime || "").trim();
    if (body.endTime !== undefined) item.endTime = String(body.endTime || "").trim();
    if (body.subject !== undefined) item.subject = String(body.subject || "").trim();
    if (body.room !== undefined) item.room = String(body.room || "").trim();
    if (body.lessonType !== undefined) item.lessonType = normalizeLessonType(body.lessonType);
    if (body.note !== undefined) item.note = String(body.note || "").trim().slice(0, 500);

    if (body.teacherUserId !== undefined) {
      const tid = String(body.teacherUserId || "").trim();
      if (tid) {
        const tu = await User.findById(tid).select("username role fullName");
        if (tu?.role === "teacher" && tu.username) {
          const fn = String(tu.fullName || "").trim();
          item.teacher = fn || String(tu.username).trim();
          item.teacherUserId = tu._id;
        }
      } else {
        item.teacherUserId = null;
      }
    } else if (body.teacher !== undefined) {
      item.teacher = String(body.teacher || "").trim();
    }

    const st = String(item.startTime || "").trim();
    const et = String(item.endTime || "").trim();
    const subj = String(item.subject || "").trim();
    const teach = String(item.teacher || "").trim();
    const rm = String(item.room || "").trim();
    if (!st || !et || !subj || !teach || !rm) {
      return res.status(400).json({
        message: "Заполните предмет, аудиторию, время и преподавателя",
      });
    }

    await item.save();
    return res.status(200).json({ item });
  } catch (error) {
    console.log("Ошибка в PATCH /admin/schedule/items/:id:", error);
    return res.status(500).json({ message: "Внутренняя ошибка сервера" });
  }
});

router.post("/schedule/items/delete", async (req, res) => {
  try {
    const admin = await User.findById(req.user.userId).select("role");
    if (!admin) return res.status(404).json({ message: "Пользователь не найден" });
    if (!mustAdmin(admin)) return res.status(403).json({ message: "Доступ только для администрации" });

    const id = String(req.body?.id || "").trim();
    if (!id) return res.status(400).json({ message: "Нет id" });

    const deleted = await ScheduleItem.findByIdAndDelete(id);
    if (!deleted) return res.status(404).json({ message: "Запись не найдена" });

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.log("Ошибка в POST /admin/schedule/items/delete:", error);
    return res.status(500).json({ message: "Внутренняя ошибка сервера" });
  }
});

router.delete("/schedule/items/:id", async (req, res) => {
  try {
    const admin = await User.findById(req.user.userId).select("role");
    if (!admin) return res.status(404).json({ message: "Пользователь не найден" });
    if (!mustAdmin(admin)) return res.status(403).json({ message: "Доступ только для администрации" });

    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ message: "Нет id" });
    const deleted = await ScheduleItem.findByIdAndDelete(id);
    if (!deleted) return res.status(404).json({ message: "Запись не найдена" });
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.log("Ошибка в DELETE /admin/schedule/items/:id:", error);
    return res.status(500).json({ message: "Внутренняя ошибка сервера" });
  }
});

router.get("/programs", async (req, res) => {
  try {
    const admin = await User.findById(req.user.userId).select("role");
    if (!admin) return res.status(404).json({ message: "Пользователь не найден" });
    if (!mustAdmin(admin))
      return res.status(403).json({ message: "Доступ только для администрации" });

    const programs = await Program.find()
      .populate("facultyId", "name code")
      .sort({ "facultyId.name": 1, name: 1 });
    const filteredPrograms = dedupeProgramsByName(programs);

    return res.status(200).json({
      programs: filteredPrograms.map((p) => ({
        id: p._id,
        name: p.name,
        code: p.code,
        facultyName: p.facultyId?.name || null,
        facultyCode: p.facultyId?.code || null,
      })),
      formats: [
        {
          id: "matrix-grid",
          label: "Матрица деканата (основной формат)",
          description:
            "Поддерживается типовой файл расписания с днями по строкам, группами и подгруппами по колонкам, где две строки пары означают 1 и 2 неделю.",
        },
        {
          id: "teacher-matrix",
          label: "Матрица преподавателей (завкафедрой)",
          description:
            "Поддерживается файл, где в колонках преподаватели, а в ячейках: группа, предмет и аудитория.",
        },
      ],
    });
  } catch (error) {
    console.log("Ошибка в GET /admin/programs:", error);
    return res.status(500).json({ message: "Внутренняя ошибка сервера" });
  }
});

router.get("/schedule/template", async (req, res) => {
  try {
    const admin = await User.findById(req.user.userId).select("role");
    if (!admin) return res.status(404).json({ message: "Пользователь не найден" });
    if (!mustAdmin(admin)) return res.status(403).json({ message: "Доступ только для администрации" });

    const programId = String(req.query.programId || "").trim();
    const format = String(req.query.format || "flat-table").trim();
    if (!programId) {
      return res.status(400).json({ message: "Укажите programId" });
    }
    if (format !== "flat-table") {
      return res.status(400).json({
        message:
          "Для матрицы деканата шаблон не генерируется. Используйте исходный Excel-файл деканата.",
      });
    }

    // Берем пример группы из выбранного направления (если есть).
    const exampleGroup = await Group.findOne({ programId }).sort({ name: 1 }).select("name");
    const groupName = exampleGroup?.name || "ПИ 4-10";

    const header = [
      {
        group: groupName,
        weekType: 1,
        studyForm: "full-time",
        subgroup: "all",
        dayOfWeek: 1,
        startTime: "08:00",
        endTime: "09:35",
        subject: "Пример предмета",
        teacher: "Иванов И.И.",
        room: "Ауд. 2000",
        lessonType: "lecture",
        note: "",
      },
      {
        group: groupName,
        weekType: 1,
        studyForm: "full-time",
        subgroup: "all",
        dayOfWeek: 1,
        startTime: "09:50",
        endTime: "11:25",
        subject: "Пример практики",
        teacher: "Петров П.П.",
        room: "Ауд. 115",
        lessonType: "practice",
        note: "",
      },
    ];

    const wb = xlsx.utils.book_new();
    const ws = xlsx.utils.json_to_sheet(header, {
      header: [
        "group",
        "weekType",
        "studyForm",
        "subgroup",
        "dayOfWeek",
        "startTime",
        "endTime",
        "subject",
        "teacher",
        "room",
        "lessonType",
        "note",
      ],
    });
    xlsx.utils.book_append_sheet(wb, ws, "schedule");

    const buf = xlsx.write(wb, { type: "buffer", bookType: "xlsx" });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="schedule_template.xlsx"'
    );
    return res.status(200).send(buf);
  } catch (error) {
    console.log("Ошибка в GET /admin/schedule/template:", error);
    return res.status(500).json({ message: "Внутренняя ошибка сервера" });
  }
});

router.post("/schedule/upload", upload.single("file"), async (req, res) => {
  try {
    const admin = await User.findById(req.user.userId).select("role");
    if (!admin) return res.status(404).json({ message: "Пользователь не найден" });
    if (!mustAdmin(admin)) return res.status(403).json({ message: "Доступ только для администрации" });

    if (!req.file?.buffer) {
      return res.status(400).json({ message: "Файл не найден" });
    }

    const { programId, format } = req.body || {};
    if (format && !["flat-table", "matrix-grid", "teacher-matrix"].includes(String(format))) {
      return res.status(400).json({ message: "Неизвестный формат расписания" });
    }

    const wb = xlsx.read(req.file.buffer, { type: "buffer", cellDates: true });
    const sheetName = wb.SheetNames?.[0];
    if (!sheetName) return res.status(400).json({ message: "Пустой Excel" });
    const sheet = wb.Sheets[sheetName];

    const rows = xlsx.utils.sheet_to_json(sheet, { defval: "", raw: false });
    const rawRows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
    const errors = [];
    const teachers = await User.find({ role: "teacher" }).select("_id username email fullName");
    const maybeTeacherMatrix = rawRows.some((row) => {
      const day = normalizeToken(row?.[0]);
      const time = normalizeToken(row?.[1]);
      const week = normalizeToken(row?.[2]);
      const compactTime = normalizeToken(row?.[0]);
      const compactWeek = normalizeToken(row?.[1]);
      return (
        (day.includes("дни") && time.includes("врем") && week.includes("неделя")) ||
        (compactTime.includes("врем") && compactWeek.includes("неделя"))
      );
    });
    const detectedFormat = maybeTeacherMatrix ? "teacher-matrix" : detectScheduleFormat(rows);
    const requestedFormat = String(format || "").trim();
    const formatId = ["flat-table", "matrix-grid", "teacher-matrix"].includes(requestedFormat)
      ? requestedFormat
      : detectedFormat;
    const isTeacherMatrix = formatId === "teacher-matrix";

    let program = null;
    if (!isTeacherMatrix) {
      if (!programId) {
        return res.status(400).json({ message: "Укажите направление (programId)" });
      }
      program = await Program.findById(programId).select("_id");
      if (!program) {
        return res.status(400).json({ message: "Направление не найдено" });
      }
    } else {
      program = { _id: null };
    }
    const groups = isTeacherMatrix
      ? await Group.find({}).select("_id name programId")
      : await Group.find({ programId: program._id }).select("_id name programId");

    let result = { created: 0, updated: 0 };
    if (formatId === "teacher-matrix") {
      result = await importTeacherMatrixSchedule({
        rows: rawRows,
        program,
        errors,
        groups,
        teachers,
      });
    } else if (formatId === "matrix-grid") {
      result = await importMatrixSchedule({
        rows: rawRows,
        merges: sheet["!merges"] || [],
        program,
        errors,
        groups,
        teachers,
      });
    } else {
      result = await importFlatSchedule({
        rows,
        program,
        errors,
        groups,
        teachers,
      });
    }

    return res.status(200).json({ created: result.created, updated: result.updated, errors });
  } catch (error) {
    console.log("Ошибка в POST /admin/schedule/upload:", error);
    return res.status(500).json({ message: "Внутренняя ошибка сервера" });
  }
});

function newsToDto(doc) {
  return {
    id: String(doc._id),
    title: doc.title,
    text: doc.text,
    publishedAt: doc.publishedAt,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

router.get("/news", async (req, res) => {
  try {
    const admin = await User.findById(req.user.userId).select("role");
    if (!admin) return res.status(404).json({ message: "Пользователь не найден" });
    if (!mustAdmin(admin)) return res.status(403).json({ message: "Доступ только для администрации" });

    const items = await News.find().sort({ publishedAt: -1 });
    return res.status(200).json({ news: items.map(newsToDto) });
  } catch (error) {
    console.log("Ошибка в GET /admin/news:", error);
    return res.status(500).json({ message: "Внутренняя ошибка сервера" });
  }
});

router.post("/news", async (req, res) => {
  try {
    const admin = await User.findById(req.user.userId).select("role");
    if (!admin) return res.status(404).json({ message: "Пользователь не найден" });
    if (!mustAdmin(admin)) return res.status(403).json({ message: "Доступ только для администрации" });

    const title = String(req.body?.title || "").trim();
    const text = String(req.body?.text || "").trim();
    if (!title || !text) {
      return res.status(400).json({ message: "Укажите заголовок и текст новости" });
    }
    let publishedAt = new Date();
    if (req.body?.publishedAt) {
      const d = new Date(req.body.publishedAt);
      if (!Number.isNaN(d.getTime())) publishedAt = d;
    }
    const doc = await News.create({ title, text, publishedAt });
    return res.status(201).json({ news: newsToDto(doc) });
  } catch (error) {
    console.log("Ошибка в POST /admin/news:", error);
    return res.status(500).json({ message: "Внутренняя ошибка сервера" });
  }
});

router.patch("/news/:id", async (req, res) => {
  try {
    const admin = await User.findById(req.user.userId).select("role");
    if (!admin) return res.status(404).json({ message: "Пользователь не найден" });
    if (!mustAdmin(admin)) return res.status(403).json({ message: "Доступ только для администрации" });

    const id = String(req.params.id || "").trim();
    const doc = await News.findById(id);
    if (!doc) return res.status(404).json({ message: "Новость не найдена" });

    if (req.body?.title !== undefined) {
      const title = String(req.body.title || "").trim();
      if (!title) return res.status(400).json({ message: "Заголовок не может быть пустым" });
      doc.title = title;
    }
    if (req.body?.text !== undefined) {
      const text = String(req.body.text || "").trim();
      if (!text) return res.status(400).json({ message: "Текст не может быть пустым" });
      doc.text = text;
    }
    if (req.body?.publishedAt !== undefined) {
      const d = new Date(req.body.publishedAt);
      if (Number.isNaN(d.getTime())) return res.status(400).json({ message: "Некорректная дата публикации" });
      doc.publishedAt = d;
    }
    await doc.save();
    return res.status(200).json({ news: newsToDto(doc) });
  } catch (error) {
    console.log("Ошибка в PATCH /admin/news/:id:", error);
    return res.status(500).json({ message: "Внутренняя ошибка сервера" });
  }
});

router.delete("/news/:id", async (req, res) => {
  try {
    const admin = await User.findById(req.user.userId).select("role");
    if (!admin) return res.status(404).json({ message: "Пользователь не найден" });
    if (!mustAdmin(admin)) return res.status(403).json({ message: "Доступ только для администрации" });

    const id = String(req.params.id || "").trim();
    const deleted = await News.findByIdAndDelete(id);
    if (!deleted) return res.status(404).json({ message: "Новость не найдена" });
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.log("Ошибка в DELETE /admin/news/:id:", error);
    return res.status(500).json({ message: "Внутренняя ошибка сервера" });
  }
});

export default router;
