import express from "express";
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import multer from "multer";
import xlsx from "xlsx";
import User from "../models/User.js";
import Group from "../models/Group.js";
import ScheduleItem from "../models/ScheduleItem.js";
import Grade from "../models/Grade.js";
import News from "../models/News.js";
import { requireAuth } from "../middleware/authMiddleware.js";
import { ensureDefaultAcademicData } from "../lib/academicSeed.js";
import {
  normalizeClockTime,
  isValidClockTime,
  clockTimeToMinutes,
  normalizeStudyForm,
  normalizeSubgroup,
  normalizeLessonType,
} from "../lib/scheduleValidators.js";

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

const avatarsDir = path.join(process.cwd(), "uploads", "avatars");
fs.mkdirSync(avatarsDir, { recursive: true });

const avatarStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, avatarsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const safeExt = [".jpg", ".jpeg", ".png", ".webp"].includes(ext) ? ext : ".jpg";
    const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    cb(null, `avatar-${unique}${safeExt}`);
  },
});

const avatarUpload = multer({
  storage: avatarStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const okMime = new Set(["image/jpeg", "image/png", "image/webp"]);
    if (file.mimetype && okMime.has(file.mimetype)) return cb(null, true);
    const ext = path.extname(file.originalname || "").toLowerCase();
    if ([".jpg", ".jpeg", ".png", ".webp"].includes(ext)) return cb(null, true);
    cb(new Error("Допустимы только изображения JPG, PNG, WebP"), false);
  },
});

function normalizeTeacherKey(v) {
  return String(v || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeToken(v) {
  return String(v || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[«»"'`]/g, "")
    .replace(/[\s\-_.:,;()[\]{}\\/№]+/g, "")
    .trim();
}

function parseWeekType(raw, fallback = 1) {
  const n = Number(raw);
  if (n === 1 || n === 2) return n;

  const key = normalizeToken(raw);
  if (!key) return fallback;
  if (
    key.includes("нечет") ||
    key.includes("числ") ||
    key.includes("верх") ||
    key.includes("odd") ||
    key.includes("first") ||
    key.includes("первая") ||
    key === "1"
  ) {
    return 1;
  }
  if (
    key.includes("знамен") ||
    key.includes("ниж") ||
    key.includes("even") ||
    key.includes("second") ||
    key.includes("вторая") ||
    key.includes("четн") ||
    key === "2"
  ) {
    return 2;
  }
  return fallback;
}

function parseWeekTypes(raw, fallback = 1) {
  const key = normalizeToken(raw);
  if (
    key.includes("кажд") ||
    key.includes("еженед") ||
    key.includes("обе") ||
    key.includes("всенед") ||
    key.includes("both")
  ) {
    return [1, 2];
  }
  return [parseWeekType(raw, fallback)];
}

function teacherLookupKeys(user, explicitTeacher = "") {
  const keys = new Set();
  const username = String(user?.username || "").trim();
  const email = String(user?.email || "").trim();
  const emailPrefix = email.includes("@") ? email.split("@")[0] : "";
  const fullName = String(user?.fullName || "").trim();

  [explicitTeacher, fullName, username, emailPrefix, email].forEach((value) => {
    const trimmed = String(value || "").trim();
    if (trimmed) keys.add(trimmed);
  });

  if (fullName) {
    const parts = fullName.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      const surname = parts[0];
      const initials = parts
        .slice(1)
        .map((part) => `${part[0] || ""}.`)
        .join("");
      if (surname) keys.add(surname);
      if (surname && initials) keys.add(`${surname} ${initials}`);
    }
  }

  return [...keys];
}

function teacherDisplayName(user) {
  const fn = String(user?.fullName || "").trim();
  return fn || String(user?.username || "").trim();
}

/** Тот же фильтр, что и в GET /me/schedule — удаление/редактирование не должны расходиться со списком. */
function buildTeacherScheduleItemAccessQuery(user, explicitTeacher = "") {
  const uid = user?._id || user?.id;
  if (!uid) return { _id: null };
  const keys = teacherLookupKeys(user, explicitTeacher);
  const uniq = [...new Set(keys)];
  if (uniq.length === 0) {
    return { teacherUserId: uid };
  }
  const orTeacher = uniq.map((rawKey) => {
    const escaped = rawKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return { teacher: { $regex: new RegExp(escaped, "i") } };
  });
  return {
    $or: [{ teacherUserId: uid }, ...orTeacher],
  };
}

router.get("/me", async (req, res) => {
  try {
    const user = await User.findById(req.user.userId)
      .select("-password")
      .populate({
        path: "groupId",
        populate: {
          path: "programId",
          populate: {
            path: "facultyId",
          },
        },
      });

    if (!user) return res.status(404).json({ message: "Пользователь не найден" });


    const refreshedUser = await User.findById(user._id)
      .select("-password")
      .populate({
        path: "groupId",
        populate: {
          path: "programId",
          populate: {
            path: "facultyId",
          },
        },
      });

    return res.status(200).json({ user: refreshedUser });
  } catch (error) {
    console.log("Ошибка в /academic/me:", error);
    return res.status(500).json({ message: "Внутренняя ошибка сервера" });
  }
});

router.post("/me/profile/avatar", avatarUpload.single("file"), async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select("_id");
    if (!user) return res.status(404).json({ message: "Пользователь не найден" });
    if (!req.file) {
      return res.status(400).json({ message: "Выберите файл изображения" });
    }

    const proto = req.headers["x-forwarded-proto"]
      ? String(req.headers["x-forwarded-proto"])
      : req.protocol;
    const host = req.headers["x-forwarded-host"]
      ? String(req.headers["x-forwarded-host"])
      : req.get("host");
    const url = `${proto}://${host}/uploads/avatars/${req.file.filename}`;

    await User.updateOne({ _id: user._id }, { $set: { profileImage: url } });

    const refreshedUser = await User.findById(user._id)
      .select("-password")
      .populate({
        path: "groupId",
        populate: {
          path: "programId",
          populate: {
            path: "facultyId",
          },
        },
      });

    return res.status(200).json({ profileImage: url, user: refreshedUser });
  } catch (error) {
    console.log("Ошибка в POST /academic/me/profile/avatar:", error);
    const msg = error?.message ? String(error.message) : "Внутренняя ошибка сервера";
    return res.status(500).json({ message: msg });
  }
});

router.get("/me/schedule", async (req, res) => {
  try {
    let user = await User.findById(req.user.userId).select(
      "groupId role username email studyForm subgroup fullName"
    );
    if (!user) return res.status(404).json({ message: "Пользователь не найден" });

    const week = Number(req.query.week);
    const weekFilter = week === 1 || week === 2 ? { weekType: week } : {};

    // Для преподавателя: сначала ищем точные привязки teacherUserId, затем fallback по строковому полю teacher.
    if (user.role === "teacher") {
      const explicitTeacher = String(req.query.teacher || "").trim();
      const keys = teacherLookupKeys(user, explicitTeacher);
      const uniq = [...new Set(keys)];
      if (uniq.length === 0 && !user._id) {
        return res.status(200).json({ schedule: [] });
      }
      const teacherQuery = buildTeacherScheduleItemAccessQuery(user, explicitTeacher);

      const scheduleDocs = await ScheduleItem.find({
        ...weekFilter,
        ...teacherQuery,
      })
        .populate({ path: "groupId", select: "name" })
        .sort({ dayOfWeek: 1, startTime: 1 });

      const schedule = scheduleDocs.map((d) => {
        const obj = d.toObject();
        return {
          ...obj,
          group:
            (obj.groupLabel && String(obj.groupLabel).trim()) || obj.groupId?.name || null,
        };
      });

      return res.status(200).json({ schedule });
    }

    // Для студента: ищем по группе. Если группа не назначена — возвращаем пусто.
    if (!user.groupId) {
      return res.status(200).json({ schedule: [] });
    }

    const studyForm = user.studyForm || "full-time";
    const subgroup = String(user.subgroup || "a");
    // Старые записи без поля studyForm считаем очной формой
    const studyFormClause =
      studyForm === "full-time"
        ? {
            $or: [{ studyForm: "full-time" }, { studyForm: { $exists: false } }],
          }
        : { studyForm };
    const subgroupClause =
      subgroup === "a" || subgroup === "b"
        ? {
            $or: [{ subgroup }, { subgroup: "all" }, { subgroup: { $exists: false } }],
          }
        : {
            $or: [{ subgroup: "all" }, { subgroup: { $exists: false } }],
          };

    const scheduleDocs = await ScheduleItem.find({
      ...weekFilter,
      groupId: user.groupId,
      ...studyFormClause,
      ...subgroupClause,
    })
      .populate({ path: "groupId", select: "name" })
      .sort({
        dayOfWeek: 1,
        startTime: 1,
      });

    const schedule = scheduleDocs.map((d) => {
      const obj = d.toObject();
      return {
        ...obj,
        group:
          (obj.groupLabel && String(obj.groupLabel).trim()) || obj.groupId?.name || null,
      };
    });

    return res.status(200).json({ schedule });
  } catch (error) {
    console.log("Ошибка в /academic/me/schedule:", error);
    return res.status(500).json({ message: "Внутренняя ошибка сервера" });
  }
});

router.post("/me/schedule/upload", upload.single("file"), async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select(
      "_id role username email fullName"
    );
    if (!user) return res.status(404).json({ message: "Пользователь не найден" });
    if (user.role !== "teacher") {
      return res.status(403).json({ message: "Доступ только для преподавателя" });
    }

    if (!req.file?.buffer) {
      return res.status(400).json({ message: "Файл не найден" });
    }

    const wb = xlsx.read(req.file.buffer, { type: "buffer", cellDates: true });
    const sheetName = wb.SheetNames?.[0];
    if (!sheetName) return res.status(400).json({ message: "Пустой Excel" });
    const sheet = wb.Sheets[sheetName];
    const rawRows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
    const merges = sheet["!merges"] || [];

    const keys = teacherLookupKeys(user, "");
    const keysNorm = keys.map(normalizeTeacherKey).filter(Boolean);
    const errors = [];
    let created = 0;
    let updated = 0;
    let skipped = 0;

    const applyScheduleUpsert = async (filter, update, rowHint) => {
      try {
        const existing = await ScheduleItem.findOne(filter).select("_id");
        if (existing) {
          await ScheduleItem.updateOne({ _id: existing._id }, { $set: update });
          updated += 1;
          return;
        }
        await ScheduleItem.create(update);
        created += 1;
      } catch (e) {
        const msg =
          e?.name === "ValidationError" && e.errors
            ? Object.values(e.errors)
                .map((x) => x.message)
                .join("; ")
            : e?.message || String(e);
        errors.push({ row: rowHint, message: msg });
      }
    };

    const groups = await Group.find().select("_id name");

    const formatCell = (v) => {
      if (v === null || v === undefined) return "";
      if (v instanceof Date) return v;
      return String(v)
        .normalize("NFKC")
        .replace(/\u00a0/g, " ")
        .replace(/\r/g, "\n")
        .trim();
    };

    const formatClockTime = (hours, minutes) => {
      const hh = Number(hours);
      const mm = Number(minutes);
      if (!Number.isInteger(hh) || !Number.isInteger(mm)) return "";
      if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return "";
      return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
    };

    const excelNumberToClockTime = (raw) => {
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
    };

    const normalizeClockTime = (raw) => {
      if (raw instanceof Date) return formatClockTime(raw.getHours(), raw.getMinutes());
      if (typeof raw === "number") return excelNumberToClockTime(raw) || String(raw).trim();
      const s = String(formatCell(raw) || "").trim();
      if (!s) return "";
      const compact = s.replace(/\s+/g, "");
      const dashHm = compact.match(/^(\d{1,2})-(\d{2})$/);
      if (dashHm) return formatClockTime(Number(dashHm[1]), Number(dashHm[2])) || s;
      const numeric = compact.replace(",", ".");
      if (/^\d+(\.\d+)?$/.test(numeric)) {
        const fromNumber = excelNumberToClockTime(Number(numeric));
        if (fromNumber) return fromNumber;
      }
      let match = s.match(/(\d{1,2})\s*[:.]\s*(\d{1,2})(?::\d{1,2})?/);
      if (!match) match = s.match(/(\d{1,2})\s*(?:ч|h)\s*(\d{1,2})?/i);
      if (match) return formatClockTime(Number(match[1]), Number(match[2] || 0)) || s;
      const digits = compact.match(/^\d{3,4}$/);
      if (digits) {
        const fromNumber = excelNumberToClockTime(Number(compact));
        if (fromNumber) return fromNumber;
      }
      if (/^\d{1,2}$/.test(compact)) return formatClockTime(Number(compact), 0) || s;
      return s;
    };

    const isValidClockTime = (raw) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(normalizeClockTime(raw) || ""));

    const parseDayOfWeek = (raw) => {
      const n = Number(raw);
      if (Number.isInteger(n) && n >= 1 && n <= 7) return n;
      const s = normalizeTeacherKey(raw);
      const map = { пн: 1, пон: 1, вт: 2, ср: 3, чт: 4, пт: 5, сб: 6, вс: 7 };
      if (map[s]) return map[s];
      if (s.includes("понед")) return 1;
      if (s.includes("втор")) return 2;
      if (s.includes("сред")) return 3;
      if (s.includes("четвер")) return 4;
      if (s.includes("пятниц")) return 5;
      if (s.includes("суббот")) return 6;
      if (s.includes("воскрес")) return 7;
      return 0;
    };

    const findWeekTypesInRow = (row, firstGroupCol, excludedCols, fallback) => {
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
    };

    const parseTimeRange = (raw) => {
      const s = String(formatCell(raw) || "")
        .replace(/[–—−]/g, "-")
        .replace(/\s+/g, " ")
        .trim();
      if (!s) return null;
      const chained = s.match(/^(\d{1,2}-\d{2})-(\d{1,2}-\d{2})$/);
      if (chained) {
        const startTime = normalizeClockTime(chained[1]);
        const endTime = normalizeClockTime(chained[2]);
        if (isValidClockTime(startTime) && isValidClockTime(endTime)) return { startTime, endTime };
      }
      const spacedPair = s.match(/^(\d{1,2}-\d{2})\s+-\s+(\d{1,2}-\d{2})$/);
      if (spacedPair) {
        const startTime = normalizeClockTime(spacedPair[1]);
        const endTime = normalizeClockTime(spacedPair[2]);
        if (isValidClockTime(startTime) && isValidClockTime(endTime)) return { startTime, endTime };
      }
      const parts = s.split(/\s*-\s*/).filter(Boolean);
      if (parts.length >= 2) {
        const startTime = normalizeClockTime(parts[0]);
        const endTime = normalizeClockTime(parts[1]);
        if (isValidClockTime(startTime) && isValidClockTime(endTime)) return { startTime, endTime };
      }
      const matches = [...s.matchAll(/(\d{1,2}\s*[:.]\s*\d{1,2}(?::\d{1,2})?|\b\d{3,4}\b)/g)]
        .map((m) => normalizeClockTime(m[1]))
        .filter(isValidClockTime);
      if (matches.length >= 2) return { startTime: matches[0], endTime: matches[1] };
      return null;
    };

    const expandMergedRows = (rows, mergesList = []) => {
      const out = rows.map((r) => (Array.isArray(r) ? r.slice() : []));
      for (const merge of mergesList) {
        const startRow = merge?.s?.r ?? 0;
        const endRow = merge?.e?.r ?? 0;
        const startCol = merge?.s?.c ?? 0;
        const endCol = merge?.e?.c ?? 0;
        const source = out[startRow]?.[startCol] ?? "";
        for (let r = startRow; r <= endRow; r++) {
          if (!out[r]) out[r] = [];
          for (let c = startCol; c <= endCol; c++) out[r][c] = source;
        }
      }
      return out;
    };

    const compactGroupKey = (v) =>
      normalizeTeacherKey(v)
        .replace(/[«»"'`]/g, "")
        .replace(/[^a-zа-яё0-9]/g, "");

    const findGroupInCache = (groupName) => {
      const target = String(groupName || "").trim();
      if (!target) return null;
      const key = normalizeTeacherKey(target).replace(/[«»"'`]/g, "");
      const ck = compactGroupKey(key);
      const exact = groups.find((g) => normalizeTeacherKey(g.name).replace(/[«»"'`]/g, "") === key);
      if (exact) return exact;
      for (const g of groups) {
        const gk = normalizeTeacherKey(g.name).replace(/[«»"'`]/g, "");
        if (compactGroupKey(g.name) === ck && ck.length >= 3) return g;
      }
      let best = null;
      let bestLen = 0;
      for (const g of groups) {
        const gk = normalizeTeacherKey(g.name).replace(/[«»"'`]/g, "");
        if (!gk) continue;
        if (gk.includes(key) || key.includes(gk)) {
          const minLen = Math.min(key.length, gk.length);
          if (minLen < 4) continue;
          if (gk.length > bestLen) {
            best = g;
            bestLen = gk.length;
          }
        }
      }
      if (best) return best;
      if (ck.length >= 4) {
        for (const g of groups) {
          const gCompact = compactGroupKey(g.name);
          if (!gCompact) continue;
          if (ck === gCompact || ck.startsWith(gCompact) || gCompact.startsWith(ck)) {
            if (gCompact.length > bestLen) {
              best = g;
              bestLen = gCompact.length;
            }
          }
        }
      }
      return best;
    };

    const extractRoomFromTail = (line) => {
      const source = String(line || "").trim();
      if (!source) return "";
      const roomPatterns = [
        /(\d{1,4}[а-яa-z]?(?:\s+[а-яa-z]{1,8})?)$/i,
        /((?:ауд\.?|аудитория|каб\.?|кабинет)\s*[0-9а-яa-z\-\/ ]+)$/i,
      ];
      for (const pattern of roomPatterns) {
        const match = source.match(pattern);
        if (match?.[1]) return String(match[1]).trim();
      }
      return "";
    };

    const extractRoomFromLine = (line) => {
      const text = String(line || "").trim();
      if (!text) return "";
      const byKeyword = text.match(/(?:аудитория|ауд\.?|кабинет|каб\.?|room)\s*[:\-]?\s*([^\n;,]+)/i);
      if (byKeyword?.[1]) return String(byKeyword[1]).trim();
      const byTail = text.match(/(\d{3,4}(?:[а-яёa-z]{1,4})?)$/i);
      if (byTail?.[1]) return String(byTail[1]).trim();
      const byTailWide = text.match(/(\d{1,4}[а-яa-z]?(?:\s+[а-яa-z]{1,8})?)$/i);
      return byTailWide?.[1] ? String(byTailWide[1]).trim() : "";
    };

    const normalizeGroupToken = (raw) =>
      String(raw || "")
        .replace(/[()]/g, "")
        .replace(/\s+/g, " ")
        .trim();

    const expandGroupToken = (rawToken) => {
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
        out.push(part.includes("-") || !prefix ? part : `${prefix}${part}`);
      }
      return [...new Set(out)];
    };

    const stripTrailingPunct = (s) => String(s || "").replace(/[/\\.,;]+$/g, "").trim();

    /** 242/123 в ячейке = ауд. 242 (числитель), 123 (знаменатель). */
    const parseRoomForWeekType = (roomRaw, weekType) => {
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
    };

    const isLikelyRoomToken = (tok) => {
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
    };

    const isLessonTypeAbbrevToken = (tok) => {
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
      const nk = normalizeToken(st);
      if (
        nk.length <= 10 &&
        (nk.includes("лекц") || nk.includes("практ") || nk.includes("семин"))
      ) {
        return true;
      }
      return false;
    };

    /** Аудитория с конца строки без «съедания» фрагментов группы вроде 9-10. */
    const roomFallbackFromLine = (line) => {
      const raw = String(line || "").trim();
      if (!raw) return "";
      const toks = raw
        .split(/\s+/)
        .map(stripTrailingPunct)
        .filter(Boolean);
      if (toks.length && isLikelyRoomToken(toks[toks.length - 1])) {
        return stripTrailingPunct(toks[toks.length - 1]);
      }
      return extractRoomFromLine(raw);
    };

    /**
     * Ячейка «группа в шапке столбца»: строка 1 — тип / дисциплина / аудитория;
     * строка 2 — часто ФИО преподавателя.
     */
    const splitLessonCell = (raw) => {
      const text = String(formatCell(raw) || "").trim();
      if (!text) return null;
      const lines = text
        .split(/\n|;/)
        .map((l) => String(l || "").trim())
        .filter(Boolean);
      if (lines.length === 0) return null;

      const first = lines[0];
      let tokens = first.split(/\s+/).map(stripTrailingPunct).filter(Boolean);
      if (!tokens.length) return null;

      let room = "";
      if (tokens.length && isLikelyRoomToken(tokens[tokens.length - 1])) {
        room = stripTrailingPunct(tokens[tokens.length - 1]);
        tokens = tokens.slice(0, -1);
      }

      let lessonTypeTokenIdx = -1;
      for (let i = 0; i < tokens.length; i++) {
        if (isLessonTypeAbbrevToken(tokens[i])) {
          lessonTypeTokenIdx = i;
          break;
        }
      }

      let lessonTypeNorm = "practice";
      let subjectCore = "";
      if (lessonTypeTokenIdx >= 0) {
        lessonTypeNorm = normalizeLessonType(tokens[lessonTypeTokenIdx]);
        subjectCore = [...tokens.slice(0, lessonTypeTokenIdx), ...tokens.slice(lessonTypeTokenIdx + 1)]
          .join(" ")
          .trim();
      } else {
        subjectCore = tokens.join(" ").trim();
      }

      let teacher = "";
      let subject = subjectCore;
      if (lines.length >= 2) {
        teacher = lines[1];
        if (lines.length >= 3) {
          subject = [subjectCore, ...lines.slice(2)].join("\n").trim();
        }
      }

      if (!room) {
        room = roomFallbackFromLine(first) || "";
      }
      if (!room && lines[1]) {
        room = roomFallbackFromLine(lines[1]) || "";
      }
      room = String(room || "").trim() || "—";

      return {
        subject: subject.trim(),
        teacher: teacher.trim(),
        room,
        lessonType: lessonTypeNorm === "lecture" ? "lecture" : "practice",
      };
    };

    /** Формат ячейки: «группа… тип занятия дисциплина номер_аудитории» (напр. Пи4 9-10 Лекц ОбучПользИС 239). */
    const splitTeacherMatrixCell = (raw) => {
      const text = String(formatCell(raw) || "").trim();
      if (!text) return null;
      const lines = text
        .split(/\n|;/)
        .map((line) => String(line || "").trim())
        .filter(Boolean);
      if (!lines.length) return null;

      let tokens = lines[0]
        .split(/\s+/)
        .map(stripTrailingPunct)
        .filter(Boolean);
      if (!tokens.length) return null;

      let room = "";
      if (tokens.length && isLikelyRoomToken(tokens[tokens.length - 1])) {
        room = stripTrailingPunct(tokens[tokens.length - 1]);
        tokens = tokens.slice(0, -1);
      }

      let lessonTypeTokenIdx = -1;
      for (let i = 1; i < tokens.length; i++) {
        if (isLessonTypeAbbrevToken(tokens[i])) {
          lessonTypeTokenIdx = i;
          break;
        }
      }

      let groupsList;
      let subject;
      let lessonTypeNorm = "practice";

      if (lessonTypeTokenIdx >= 1) {
        const groupPart = tokens.slice(0, lessonTypeTokenIdx).join(" ").trim();
        if (!groupPart) return null;
        const ltTok = tokens[lessonTypeTokenIdx];
        lessonTypeNorm = normalizeLessonType(ltTok);
        const subjectTokens = tokens.slice(lessonTypeTokenIdx + 1);
        const expanded = expandGroupToken(groupPart);
        groupsList = expanded.length ? expanded : [groupPart];
        subject = [subjectTokens.join(" "), ...lines.slice(1)].join("\n").trim();
      } else {
        const maxK = Math.min(8, tokens.length - 1);
        let best = null;
        let bestScore = -Infinity;
        for (let k = 1; k <= maxK; k++) {
          const prefix = tokens.slice(0, k).join(" ");
          const expanded = expandGroupToken(prefix);
          const groupsCandidate = expanded.length ? expanded : [prefix];
          const sub = tokens.slice(k).join(" ").trim();
          if (!sub) continue;
          let score = k * 500 + sub.replace(/\s+/g, "").length;
          const subNs = sub.replace(/\s+/g, "");
          if (/^\d{1,4}\/\d{1,4}$/.test(subNs)) score -= 8000;
          if (/^\d{1,4}$/.test(subNs)) score -= 3000;
          if (sub.length >= 3 && /[А-Яа-яЁёA-Za-z]{3,}/.test(sub)) score += 400;
          if (score > bestScore) {
            bestScore = score;
            best = {
              groupsList: groupsCandidate,
              subject: [sub, ...lines.slice(1)].join("\n").trim(),
            };
          }
        }
        if (best) {
          groupsList = best.groupsList;
          subject = best.subject;
        } else if (tokens.length === 1) {
          const expanded = expandGroupToken(tokens[0]);
          groupsList = expanded.length ? expanded : [tokens[0]];
          subject = lines.slice(1).join("\n").trim() || "Занятие";
        } else {
          return null;
        }
      }

      if (!subject) subject = lines.slice(1).join("\n").trim() || "Занятие";

      if (!room) {
        room =
          roomFallbackFromLine(lines[0]) ||
          (lines[1] ? roomFallbackFromLine(lines[1]) : "") ||
          "—";
      }

      return {
        groups: groupsList,
        subject: String(subject || "").trim(),
        room,
        lessonType: lessonTypeNorm === "lecture" ? "lecture" : "practice",
      };
    };

    const resolveTeacherByHeader = (title, allTeachers) => {
      const norm = normalizeTeacherKey(title);
      const surname = norm.split(" ")[0] || "";
      return (
        allTeachers.find((t) => {
          const fn = normalizeTeacherKey(t.fullName || "");
          const un = normalizeTeacherKey(t.username || "");
          return fn === norm || fn.startsWith(`${surname} `) || un === norm;
        }) || null
      );
    };

    const preparedRows = expandMergedRows(rawRows, merges);

    /** Длинная шапка: Дни | Время занятий | Неделя | преподаватели… */
    const headerRowLegacy = preparedRows.findIndex((row) => {
      const day = normalizeToken(row?.[0]);
      const time = normalizeToken(row?.[1]);
      const week = normalizeToken(row?.[2]);
      return day.includes("дни") && time.includes("врем") && week.includes("недел");
    });
    /** Компактная шапка (рас.xlsx): Время занятий | Неделя | преподаватели… — без колонки «Дни». */
    const headerRowCompact = preparedRows.findIndex((row) => {
      const a = normalizeToken(row?.[0]);
      const b = normalizeToken(row?.[1]);
      return a.includes("врем") && b.includes("недел") && !a.includes("дни");
    });

    const teacherMatrixMode =
      headerRowLegacy >= 0 ? "legacy" : headerRowCompact >= 0 ? "compact" : null;
    const headerRowIndex =
      teacherMatrixMode === "legacy"
        ? headerRowLegacy
        : teacherMatrixMode === "compact"
          ? headerRowCompact
          : -1;
    const isTeacherMatrix = teacherMatrixMode !== null;
    const fnNorm = normalizeTeacherKey(user.fullName || "");
    const unNorm = normalizeTeacherKey(user.username || "");
    const isHeadOfDepartment =
      fnNorm.includes("подколзин") || unNorm.includes("podkolzin") || unNorm.includes("подколзин");

    if (isTeacherMatrix) {
      const allTeachers = await User.find({ role: "teacher" }).select("_id fullName username email");
      const header = preparedRows[headerRowIndex] || [];
      const firstTeacherCol = teacherMatrixMode === "legacy" ? 3 : 2;
      const teacherColsAll = [];
      for (let col = firstTeacherCol; col < header.length; col++) {
        const title = String(formatCell(header[col]) || "").trim();
        if (!title || normalizeToken(title).includes("неделя") || parseDayOfWeek(title)) continue;
        teacherColsAll.push({
          col,
          title,
          teacher: resolveTeacherByHeader(title, allTeachers),
        });
      }

      const ownKeys = keysNorm;
      const teacherCols = isHeadOfDepartment
        ? teacherColsAll
        : teacherColsAll.filter((tc) => {
            const tNorm = normalizeTeacherKey(tc.title);
            return ownKeys.some((k) => k && (tNorm === k || tNorm.includes(k) || k.includes(tNorm)));
          });

      let currentDayOfWeek = teacherMatrixMode === "compact" ? 1 : 0;
      let currentTimeRange = null;
      let currentWeekTypes = [1];
      let lastCompactSlotStartMin = -1;

      for (let rowIndex = headerRowIndex + 1; rowIndex < preparedRows.length; rowIndex++) {
        const row = preparedRows[rowIndex] || [];

        if (teacherMatrixMode === "legacy") {
          const dow = parseDayOfWeek(row[0] || row[29]);
          if (dow) currentDayOfWeek = dow;
          const tr = parseTimeRange(row[1] || row[28]);
          if (tr?.startTime && tr?.endTime) currentTimeRange = tr;
        } else {
          const tr = parseTimeRange(row[0] || row[28]);
          if (
            tr?.startTime &&
            tr?.endTime &&
            isValidClockTime(tr.startTime) &&
            isValidClockTime(tr.endTime)
          ) {
            const sm = clockTimeToMinutes(tr.startTime);
            if (lastCompactSlotStartMin >= 0 && sm < lastCompactSlotStartMin - 15) {
              currentDayOfWeek = currentDayOfWeek >= 7 ? 1 : currentDayOfWeek + 1;
            }
            lastCompactSlotStartMin = sm;
            currentTimeRange = tr;
          }
        }

        const weekRaw =
          teacherMatrixMode === "legacy" ? row[2] || row[27] : row[1] ?? row[27];

        const weekStr = String(weekRaw ?? "").trim();
        const weekNum = Number(weekRaw);
        if (weekNum === 1 || weekNum === 2) {
          currentWeekTypes = [weekNum];
        } else if (weekStr === "1" || weekStr === "2") {
          currentWeekTypes = [Number(weekStr)];
        } else if (weekStr) {
          currentWeekTypes = parseWeekTypes(weekRaw, 1);
        }
        if (!currentDayOfWeek || !currentTimeRange?.startTime || !currentTimeRange?.endTime) continue;

        for (const tc of teacherCols) {
          const rawCell = String(formatCell(row[tc.col]) || "").trim();
          if (!rawCell) continue;
          const parsed = splitTeacherMatrixCell(rawCell);
          if (!parsed) {
            errors.push({ row: rowIndex + 1, message: `Не удалось разобрать ячейку (${tc.title})` });
            continue;
          }

          const teacherUserId = tc.teacher?._id || user._id;
          const teacherName = String(tc.teacher?.fullName || tc.title || teacherDisplayName(user)).trim();

          for (const groupName of parsed.groups) {
            const labelTrim = String(groupName || "").trim();
            if (!labelTrim) continue;
            const group = findGroupInCache(groupName);
            for (const weekType of currentWeekTypes) {
              const filter = group
                ? {
                    groupId: group._id,
                    weekType,
                    dayOfWeek: currentDayOfWeek,
                    startTime: currentTimeRange.startTime,
                    endTime: currentTimeRange.endTime,
                    subject: parsed.subject,
                    teacherUserId,
                  }
                : {
                    groupId: null,
                    groupLabel: labelTrim,
                    weekType,
                    dayOfWeek: currentDayOfWeek,
                    startTime: currentTimeRange.startTime,
                    endTime: currentTimeRange.endTime,
                    subject: parsed.subject,
                    teacherUserId,
                  };
              const update = group
                ? {
                    groupId: group._id,
                    groupLabel: "",
                    weekType,
                    dayOfWeek: currentDayOfWeek,
                    startTime: currentTimeRange.startTime,
                    endTime: currentTimeRange.endTime,
                    subject: parsed.subject,
                    teacher: teacherName,
                    teacherUserId,
                    room: parseRoomForWeekType(parsed.room, weekType),
                    lessonType: parsed.lessonType === "lecture" ? "lecture" : "practice",
                    note: "",
                    studyForm: "full-time",
                    subgroup: "all",
                  }
                : {
                    groupId: null,
                    groupLabel: labelTrim,
                    weekType,
                    dayOfWeek: currentDayOfWeek,
                    startTime: currentTimeRange.startTime,
                    endTime: currentTimeRange.endTime,
                    subject: parsed.subject,
                    teacher: teacherName,
                    teacherUserId,
                    room: parseRoomForWeekType(parsed.room, weekType),
                    lessonType: parsed.lessonType === "lecture" ? "lecture" : "practice",
                    note: "",
                    studyForm: "full-time",
                    subgroup: "all",
                  };
              await applyScheduleUpsert(filter, update, rowIndex + 1);
            }
          }
        }
      }

      return res.status(200).json({
        created,
        updated,
        skipped,
        errors,
        imported: created + updated,
        hasImportRows: created + updated > 0,
      });
    }

    // Ожидаем матрицу: в верхних строках — группы, слева — день/время.
    // Алгоритм: ищем строку с максимальным количеством распознанных групп.
    let groupRowIndex = 1;
    let firstGroupCol = 2;
    let bestScore = 0;
    const cellLooksLikeGroupHeader = (cell) => {
      const formatted = String(formatCell(cell) || "").trim();
      if (formatted.length < 2) return false;
      if (parseDayOfWeek(cell)) return false;
      if (parseTimeRange(cell)) return false;
      return true;
    };
    for (let r = 0; r < Math.min(preparedRows.length, 10); r++) {
      const row = preparedRows[r] || [];
      let score = 0;
      let firstCol = -1;
      for (let c = 0; c < row.length; c++) {
        if (findGroupInCache(row[c]) || cellLooksLikeGroupHeader(row[c])) {
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

    const groupRow = preparedRows[groupRowIndex] || [];
    let dataStartRow = groupRowIndex + 1;

    let currentDayOfWeek = 0;
    const timeSeenByDay = new Map();

    for (let rowIndex = dataStartRow; rowIndex < preparedRows.length; rowIndex++) {
      const row = preparedRows[rowIndex] || [];
      // День недели в первых 0..4 колонках.
      let dayCol = -1;
      for (let c = 0; c <= Math.min(firstGroupCol, 4); c++) {
        const dow = parseDayOfWeek(row[c]);
        if (dow) {
          currentDayOfWeek = dow;
          dayCol = c;
          if (!timeSeenByDay.has(currentDayOfWeek)) timeSeenByDay.set(currentDayOfWeek, new Map());
          break;
        }
      }

      // Время пары в первых 0..4 колонках.
      let timeRange = null;
      let timeCol = -1;
      for (let c = 0; c <= Math.min(firstGroupCol, 4); c++) {
        const tr = parseTimeRange(row[c]);
        if (tr) {
          timeRange = tr;
          timeCol = c;
          break;
        }
      }
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
          firstGroupCol,
          new Set([dayCol, timeCol]),
          inferredWeekType
        ) || [inferredWeekType];

      for (let col = firstGroupCol; col < row.length; col++) {
        const rawCell = String(formatCell(row[col]) || "").trim();
        if (!rawCell) continue;

        const rawGroupName = String(formatCell(groupRow[col]) || "").trim();
        if (!rawGroupName) {
          skipped += 1;
          continue;
        }
        const group = findGroupInCache(rawGroupName);

        const lesson = splitLessonCell(rawCell);
        if (!lesson?.subject) {
          errors.push({ row: rowIndex + 1, message: `Не удалось разобрать ячейку (колонка ${col + 1})` });
          continue;
        }
        const roomFinal = String(lesson.room || "").trim() || "—";

        const teacherLabel = String(lesson.teacher || "").trim();
        const teacherNorm = normalizeTeacherKey(teacherLabel);
        const isMine =
          !teacherNorm ||
          keysNorm.some((k) => k && (teacherNorm === k || teacherNorm.includes(k) || k.includes(teacherNorm)));
        if (!isMine) {
          skipped += 1;
          continue;
        }

        for (const weekType of weekTypes) {
          const filter = group
            ? {
                groupId: group._id,
                weekType,
                dayOfWeek: currentDayOfWeek,
                startTime: timeRange.startTime,
                endTime: timeRange.endTime,
                subject: String(lesson.subject || "").trim(),
                teacherUserId: user._id,
              }
            : {
                groupId: null,
                groupLabel: rawGroupName,
                weekType,
                dayOfWeek: currentDayOfWeek,
                startTime: timeRange.startTime,
                endTime: timeRange.endTime,
                subject: String(lesson.subject || "").trim(),
                teacherUserId: user._id,
              };

          const update = group
            ? {
                groupId: group._id,
                groupLabel: "",
                weekType,
                dayOfWeek: currentDayOfWeek,
                startTime: timeRange.startTime,
                endTime: timeRange.endTime,
                subject: String(lesson.subject || "").trim(),
                teacher: teacherLabel || (user.fullName || user.username || "").trim(),
                teacherUserId: user._id,
                room: parseRoomForWeekType(roomFinal, weekType),
                lessonType: lesson.lessonType === "lecture" ? "lecture" : "practice",
                note: "",
                studyForm: "full-time",
                subgroup: "all",
              }
            : {
                groupId: null,
                groupLabel: rawGroupName,
                weekType,
                dayOfWeek: currentDayOfWeek,
                startTime: timeRange.startTime,
                endTime: timeRange.endTime,
                subject: String(lesson.subject || "").trim(),
                teacher: teacherLabel || (user.fullName || user.username || "").trim(),
                teacherUserId: user._id,
                room: parseRoomForWeekType(roomFinal, weekType),
                lessonType: lesson.lessonType === "lecture" ? "lecture" : "practice",
                note: "",
                studyForm: "full-time",
                subgroup: "all",
              };

          await applyScheduleUpsert(filter, update, rowIndex + 1);
        }
      }
    }

    return res.status(200).json({
      created,
      updated,
      skipped,
      errors,
      imported: created + updated,
      hasImportRows: created + updated > 0,
    });
  } catch (error) {
    console.error("Ошибка в POST /academic/me/schedule/upload:", error);
    const isMongoNet =
      error?.name === "MongoServerSelectionError" ||
      error?.name === "MongoNetworkError" ||
      error?.cause?.code === "ENOTFOUND" ||
      error?.code === "ENOTFOUND";
    const status = isMongoNet ? 503 : 500;
    const message = isMongoNet
      ? "Нет связи с базой данных (MongoDB). Проверьте сеть, доступ к Atlas и строку подключения в .env."
      : "Внутренняя ошибка сервера";
    return res.status(status).json({
      message,
      ...(process.env.NODE_ENV !== "production" && error?.message
        ? { detail: error.message }
        : {}),
    });
  }
});

router.delete("/me/schedule", async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select(
      "_id role fullName username email"
    );
    if (!user) return res.status(404).json({ message: "Пользователь не найден" });
    if (user.role !== "teacher") {
      return res.status(403).json({ message: "Доступ только для преподавателя" });
    }

    const q = buildTeacherScheduleItemAccessQuery(user);
    const result = await ScheduleItem.deleteMany(q);
    return res.status(200).json({ deleted: result.deletedCount });
  } catch (error) {
    console.log("Ошибка в DELETE /academic/me/schedule:", error);
    return res.status(500).json({ message: "Внутренняя ошибка сервера" });
  }
});

router.post("/me/schedule/items", async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select("_id role fullName username email");
    if (!user) return res.status(404).json({ message: "Пользователь не найден" });
    if (user.role !== "teacher") {
      return res.status(403).json({ message: "Доступ только для преподавателя" });
    }

    const {
      groupId,
      weekType,
      studyForm,
      subgroup,
      dayOfWeek,
      startTime,
      endTime,
      subject,
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
    const rm = String(room || "").trim();
    const lt = normalizeLessonType(lessonType);
    const nt = String(note || "").trim().slice(0, 500);
    const teach = teacherDisplayName(user);

    if (!gid) return res.status(400).json({ message: "Укажите groupId" });
    if (!(wt === 1 || wt === 2)) return res.status(400).json({ message: "weekType должен быть 1 или 2" });
    if (!(dow >= 1 && dow <= 7)) return res.status(400).json({ message: "dayOfWeek 1..7" });
    if (!isValidClockTime(st) || !isValidClockTime(et)) {
      return res.status(400).json({ message: "Время должно быть в формате HH:MM" });
    }
    if (clockTimeToMinutes(st) >= clockTimeToMinutes(et)) {
      return res.status(400).json({ message: "Начало пары должно быть раньше конца" });
    }
    if (!subj || !rm) {
      return res.status(400).json({ message: "Заполните предмет и аудиторию" });
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
      teacherUserId: user._id,
      room: rm,
      lessonType: lt,
      note: nt,
    });

    return res.status(201).json({ item: doc });
  } catch (error) {
    console.log("Ошибка в POST /academic/me/schedule/items:", error);
    return res.status(500).json({ message: "Внутренняя ошибка сервера" });
  }
});

router.patch("/me/schedule/items/:id", async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select("_id role fullName username email");
    if (!user) return res.status(404).json({ message: "Пользователь не найден" });
    if (user.role !== "teacher") {
      return res.status(403).json({ message: "Доступ только для преподавателя" });
    }

    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ message: "Нет id" });

    const access = buildTeacherScheduleItemAccessQuery(user);
    const item = await ScheduleItem.findOne({ _id: id, ...access });
    if (!item) return res.status(404).json({ message: "Запись не найдена" });

    const body = req.body || {};
    const teach = teacherDisplayName(user);

    if (body.groupId !== undefined) {
      const gid = String(body.groupId || "").trim();
      if (gid) {
        const group = await Group.findById(gid).select("_id");
        if (!group) return res.status(400).json({ message: "Группа не найдена" });
        item.groupId = group._id;
        item.groupLabel = "";
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
    if (body.startTime !== undefined) item.startTime = normalizeClockTime(body.startTime);
    if (body.endTime !== undefined) item.endTime = normalizeClockTime(body.endTime);
    if (body.subject !== undefined) item.subject = String(body.subject || "").trim();
    if (body.room !== undefined) item.room = String(body.room || "").trim();
    if (body.lessonType !== undefined) item.lessonType = normalizeLessonType(body.lessonType);
    if (body.note !== undefined) item.note = String(body.note || "").trim().slice(0, 500);

    item.teacher = teach;
    item.teacherUserId = user._id;

    const st = normalizeClockTime(item.startTime);
    const et = normalizeClockTime(item.endTime);
    item.startTime = st;
    item.endTime = et;
    const subj = String(item.subject || "").trim();
    const rm = String(item.room || "").trim();

    if (!isValidClockTime(st) || !isValidClockTime(et)) {
      return res.status(400).json({ message: "Время должно быть в формате HH:MM" });
    }
    if (clockTimeToMinutes(st) >= clockTimeToMinutes(et)) {
      return res.status(400).json({ message: "Начало пары должно быть раньше конца" });
    }
    if (!subj || !rm || !teach) {
      return res.status(400).json({
        message: "Заполните предмет, аудиторию и преподавателя",
      });
    }
    const hasGroup =
      item.groupId != null || String(item.groupLabel || "").trim().length > 0;
    if (!hasGroup) {
      return res.status(400).json({ message: "Укажите группу из справочника или название группы" });
    }

    await item.save();
    return res.status(200).json({ item });
  } catch (error) {
    console.log("Ошибка в PATCH /academic/me/schedule/items/:id:", error);
    return res.status(500).json({ message: "Внутренняя ошибка сервера" });
  }
});

router.post("/me/schedule/items/delete", async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select("_id role fullName username email");
    if (!user) return res.status(404).json({ message: "Пользователь не найден" });
    if (user.role !== "teacher") {
      return res.status(403).json({ message: "Доступ только для преподавателя" });
    }

    const id = String(req.body?.id || "").trim();
    if (!id) return res.status(400).json({ message: "Нет id" });
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Некорректный идентификатор записи" });
    }

    const access = buildTeacherScheduleItemAccessQuery(user);
    const item = await ScheduleItem.findOne({ _id: id, ...access });
    if (!item) return res.status(404).json({ message: "Запись не найдена" });

    await ScheduleItem.deleteOne({ _id: item._id });
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.log("Ошибка в POST /academic/me/schedule/items/delete:", error);
    return res.status(500).json({ message: "Внутренняя ошибка сервера" });
  }
});

router.get("/me/grades", async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select("_id");
    if (!user) return res.status(404).json({ message: "Пользователь не найден" });

    let grades = await Grade.find({ userId: user._id }).sort({ date: -1, createdAt: -1 });

    // Если у пользователя нет оценок, просто возвращаем пустой массив.

    return res.status(200).json({ grades });
  } catch (error) {
    console.log("Ошибка в /academic/me/grades:", error);
    return res.status(500).json({ message: "Внутренняя ошибка сервера" });
  }
});

router.get("/news", async (_req, res) => {
  try {
    const items = await News.find().sort({ publishedAt: -1 }).select("title text publishedAt").lean();
    const news = items.map((n) => ({
      id: String(n._id),
      title: n.title,
      text: n.text,
      publishedAt: n.publishedAt,
    }));
    return res.status(200).json({ news });
  } catch (error) {
    console.log("Ошибка в /academic/news:", error);
    return res.status(500).json({ message: "Внутренняя ошибка сервера" });
  }
});

router.get("/hierarchy", async (_req, res) => {
  try {
    const groups = await Group.find()
      .populate({
        path: "programId",
        populate: {
          path: "facultyId",
        },
      })
      .sort({ name: 1 });

    return res.status(200).json({ groups });
  } catch (error) {
    console.log("Ошибка в /academic/hierarchy:", error);
    return res.status(500).json({ message: "Внутренняя ошибка сервера" });
  }
});

export default router;
