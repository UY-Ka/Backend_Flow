import express from "express";
import fs from "fs";
import path from "path";
import multer from "multer";

import DiscussionMessage from "../models/DiscussionMessage.js";
import DiscussionReadState from "../models/DiscussionReadState.js";
import DepartmentChatMessage from "../models/DepartmentChatMessage.js";
import DepartmentChatReadState from "../models/DepartmentChatReadState.js";
import User from "../models/User.js";
import Group from "../models/Group.js";
import { requireAuth } from "../middleware/authMiddleware.js";

const router = express.Router();

function normalizeDepartmentKey(raw) {
  return String(raw ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

const ONLINE_WINDOW_MS = 2 * 60 * 1000;

function publicBaseUrl(req) {
  const proto = req.headers["x-forwarded-proto"]
    ? String(req.headers["x-forwarded-proto"])
    : req.protocol;
  const host = req.headers["x-forwarded-host"]
    ? String(req.headers["x-forwarded-host"])
    : req.get("host");
  return `${proto}://${host}`;
}

function resolveProfileImageUrl(req, raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  const base = publicBaseUrl(req);
  if (s.startsWith("/")) return `${base}${s}`;
  return `${base}/${s.replace(/^\//, "")}`;
}

function isRecentlyActive(lastActiveAt) {
  if (!lastActiveAt) return false;
  const t = new Date(lastActiveAt).getTime();
  return Number.isFinite(t) && Date.now() - t < ONLINE_WINDOW_MS;
}

function authorPayload(req, author) {
  if (!author) {
    return {
      authorId: null,
      authorName: "Преподаватель",
      authorProfileImageUrl: "",
      authorOnline: false,
    };
  }
  const name =
    (author.fullName && String(author.fullName).trim()) ||
    author.username ||
    author.email ||
    "Преподаватель";
  return {
    authorId: author._id,
    authorName: name,
    authorProfileImageUrl: resolveProfileImageUrl(req, author.profileImage),
    authorOnline: isRecentlyActive(author.lastActiveAt),
  };
}

function discussionAuthorName(author) {
  if (!author) return "Пользователь";
  return (
    (author.fullName && String(author.fullName).trim()) ||
    author.username ||
    author.email ||
    "Пользователь"
  );
}

function discussionMessagePayload(m, group = null) {
  const author = m.teacherId;
  const reply = m.replyToId && typeof m.replyToId === "object" ? m.replyToId : null;
  const replyAuthor = reply?.teacherId;
  return {
    id: m._id,
    groupId: group?._id || m.groupId?._id || m.groupId,
    groupName: group?.name || m.groupId?.name || null,
    teacherId: author?._id || m.teacherId,
    teacherName: discussionAuthorName(author),
    authorName: discussionAuthorName(author),
    authorRole: author?.role || "teacher",
    title: m.title,
    body: m.body,
    attachmentUrl: m.attachmentUrl || "",
    attachmentName: m.attachmentName || "",
    reactions: m.reactions || [],
    replyToId: reply?._id || m.replyToId || null,
    replyTo: reply?._id
      ? {
          id: reply._id,
          title: reply.title || "",
          body: reply.body || "",
          authorName: discussionAuthorName(replyAuthor),
          authorRole: replyAuthor?.role || "teacher",
          createdAt: reply.createdAt,
        }
      : null,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  };
}

function departmentChatMessagePayload(req, m) {
  const a = authorPayload(req, m.authorId);
  const reply = m.replyToId && typeof m.replyToId === "object" ? m.replyToId : null;
  const replyAuthor = reply ? authorPayload(req, reply.authorId) : null;
  return {
    id: m._id,
    body: m.body,
    createdAt: m.createdAt,
    authorId: a.authorId,
    authorName: a.authorName,
    authorProfileImageUrl: a.authorProfileImageUrl,
    authorOnline: a.authorOnline,
    reactions: m.reactions || [],
    replyToId: reply?._id || m.replyToId || null,
    replyTo: reply?._id
      ? {
          id: reply._id,
          body: reply.body,
          createdAt: reply.createdAt,
          authorId: replyAuthor?.authorId || null,
          authorName: replyAuthor?.authorName || "",
        }
      : null,
  };
}

router.use(requireAuth);

const uploadsDir = path.join(process.cwd(), "uploads", "discussions");
fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const safeExt = ext ? ext : ".bin";
    const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    cb(null, `disc-${unique}${safeExt}`);
  },
});

const upload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    // Разрешаем основные учебные форматы.
    const allowedMime = new Set([
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "image/png",
      "image/jpeg",
      "image/webp",
      "text/plain",
    ]);
    const ext = path.extname(file.originalname || "").toLowerCase();
    const allowedExt = new Set([
      ".pdf",
      ".doc",
      ".docx",
      ".xls",
      ".xlsx",
      ".ppt",
      ".pptx",
      ".png",
      ".jpg",
      ".jpeg",
      ".webp",
      ".txt",
    ]);

    if (
      (file.mimetype && allowedMime.has(file.mimetype)) ||
      (ext && allowedExt.has(ext))
    ) {
      cb(null, true);
      return;
    }
    cb(new Error("Недопустимый формат файла"), false);
  },
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
});

router.get("/my-group/messages", async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select("groupId role");
    if (!user) return res.status(404).json({ message: "Пользователь не найден" });

    if (!user.groupId) {
      return res.status(200).json({ messages: [] });
    }

    const messages = await DiscussionMessage.find({ groupId: user.groupId })
      .sort({ createdAt: -1 })
      .populate("teacherId", "fullName username email role")
      .populate("groupId", "name")
      .populate({
        path: "replyToId",
        select: "title body teacherId createdAt",
        populate: { path: "teacherId", select: "fullName username email role" },
      })
      .lean();

    let normalized = messages.map((m) => ({
      id: m._id,
      groupId: m.groupId?._id,
      groupName: m.groupId?.name || null,
      teacherId: m.teacherId?._id,
      teacherName: m.teacherId?.username || m.teacherId?.email || "Преподаватель",
      title: m.title,
      body: m.body,
      attachmentUrl: m.attachmentUrl || "",
      attachmentName: m.attachmentName || "",
      reactions: m.reactions || [],
      replyToId: m.replyToId || null,
      createdAt: m.createdAt,
    }));

    normalized = messages.map((m) => discussionMessagePayload(m));

    return res.status(200).json({ messages: normalized });
  } catch (error) {
    console.log("Ошибка в GET /discussions/my-group/messages:", error);
    return res.status(500).json({ message: "Внутренняя ошибка сервера" });
  }
});

router.get("/my-group/unread-count", async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select("groupId role");
    if (!user) return res.status(404).json({ message: "Пользователь не найден" });

    if (!user.groupId) return res.status(200).json({ unreadCount: 0 });

    const readState = await DiscussionReadState.findOne({
      userId: user._id,
      groupId: user.groupId,
    }).select("lastReadAt");

    const lastReadAt = readState?.lastReadAt || new Date(0);

    const unreadCount = await DiscussionMessage.countDocuments({
      groupId: user.groupId,
      createdAt: { $gt: lastReadAt },
    });

    return res.status(200).json({ unreadCount });
  } catch (error) {
    console.log("Ошибка в GET /discussions/my-group/unread-count:", error);
    return res.status(500).json({ message: "Внутренняя ошибка сервера" });
  }
});

router.post("/my-group/read", async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select("groupId role");
    if (!user) return res.status(404).json({ message: "Пользователь не найден" });

    if (!user.groupId) return res.status(200).json({ ok: true });

    const lastReadAt = new Date();

    await DiscussionReadState.findOneAndUpdate(
      { userId: user._id, groupId: user.groupId },
      { lastReadAt },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return res.status(200).json({ ok: true, lastReadAt });
  } catch (error) {
    console.log("Ошибка в POST /discussions/my-group/read:", error);
    return res.status(500).json({ message: "Внутренняя ошибка сервера" });
  }
});

router.post("/my-group/messages", async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select(
      "groupId role fullName username email"
    );
    if (!user) return res.status(404).json({ message: "Пользователь не найден" });
    if (!user.groupId) return res.status(400).json({ message: "Группа не назначена" });

    const body = String(req.body?.body || "").trim();
    const replyToId = req.body?.replyToId ? String(req.body.replyToId) : "";
    if (!body) return res.status(400).json({ message: "Введите сообщение" });

    let replyTo = null;
    if (replyToId) {
      replyTo = await DiscussionMessage.findOne({
        _id: replyToId,
        groupId: user.groupId,
      }).select("_id");
      if (!replyTo) {
        return res.status(404).json({ message: "Сообщение для ответа не найдено" });
      }
    }

    const msg = await DiscussionMessage.create({
      groupId: user.groupId,
      teacherId: user._id,
      title: "Ответ",
      body,
      replyToId: replyTo?._id || null,
    });

    const populated = await DiscussionMessage.findById(msg._id)
      .populate("teacherId", "fullName username email role")
      .populate("groupId", "name")
      .populate({
        path: "replyToId",
        select: "title body teacherId createdAt",
        populate: { path: "teacherId", select: "fullName username email role" },
      })
      .lean();

    return res.status(201).json({ message: discussionMessagePayload(populated) });
  } catch (error) {
    console.log("Ошибка в POST /discussions/my-group/messages:", error);
    return res.status(500).json({ message: "Внутренняя ошибка сервера" });
  }
});

router.get("/groups/:groupId/messages", async (req, res) => {
  try {
    const { groupId } = req.params;
    const group = await Group.findById(groupId).select("_id name");
    if (!group) return res.status(404).json({ message: "Группа не найдена" });

    const messages = await DiscussionMessage.find({ groupId: group._id })
      .sort({ createdAt: -1 })
      .populate("teacherId", "fullName username email role")
      .populate({
        path: "replyToId",
        select: "title body teacherId createdAt",
        populate: { path: "teacherId", select: "fullName username email role" },
      })
      .lean();

    let normalized = messages.map((m) => ({
      id: m._id,
      groupId: group._id,
      groupName: group.name,
      teacherId: m.teacherId?._id,
      teacherName: m.teacherId?.username || m.teacherId?.email || "Преподаватель",
      title: m.title,
      body: m.body,
      attachmentUrl: m.attachmentUrl || "",
      attachmentName: m.attachmentName || "",
      reactions: m.reactions || [],
      replyToId: m.replyToId || null,
      createdAt: m.createdAt,
    }));

    normalized = messages.map((m) => discussionMessagePayload(m, group));

    return res.status(200).json({ group: { id: group._id, name: group.name }, messages: normalized });
  } catch (error) {
    console.log("Ошибка в GET /discussions/groups/:groupId/messages:", error);
    return res.status(500).json({ message: "Внутренняя ошибка сервера" });
  }
});

router.post(
  "/groups/:groupId/messages",
  upload.single("file"),
  async (req, res) => {
  try {
    const { groupId } = req.params;
    const { title, body } = req.body || {};

    const user = await User.findById(req.user.userId).select("role");
    if (!user) return res.status(404).json({ message: "Пользователь не найден" });
    if (user.role !== "teacher" && user.role !== "admin") {
      return res.status(403).json({ message: "Только преподаватель может отправлять сообщения группе" });
    }

    const group = await Group.findById(groupId).select("_id");
    if (!group) return res.status(404).json({ message: "Группа не найдена" });

    if (!title || String(title).trim().length === 0) {
      return res.status(400).json({ message: "Заголовок обязателен" });
    }

    const proto = req.headers["x-forwarded-proto"] ? String(req.headers["x-forwarded-proto"]) : req.protocol;
    const host = req.headers["x-forwarded-host"] ? String(req.headers["x-forwarded-host"]) : req.get("host");
    const fileUrl = req.file
      ? `${proto}://${host}/uploads/discussions/${req.file.filename}`
      : "";

    const msg = await DiscussionMessage.create({
      groupId: group._id,
      teacherId: user._id,
      title: String(title).trim(),
      body: String(body || "").trim(),
      attachmentUrl: fileUrl,
      attachmentName: req.file?.originalname ? String(req.file.originalname) : "",
    });

    return res.status(201).json({ id: msg._id });
  } catch (error) {
    console.log("Ошибка в POST /discussions/groups/:groupId/messages:", error);
    return res.status(500).json({ message: "Внутренняя ошибка сервера" });
  }
  }
);

router.get("/department/chat/messages", async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select(
      "role department fullName username"
    );
    if (!user) return res.status(404).json({ message: "Пользователь не найден" });
    if (user.role !== "teacher") {
      return res.status(403).json({ message: "Доступ только для преподавателя" });
    }
    const departmentKey = normalizeDepartmentKey(user.department);
    if (!departmentKey) {
      return res.status(400).json({
        message: "В профиле не указана кафедра. Обратитесь к администратору.",
      });
    }

    const rows = await DepartmentChatMessage.find({ departmentKey })
      .sort({ createdAt: -1 })
      .limit(400)
      .populate("authorId", "fullName username email profileImage lastActiveAt")
      .populate({
        path: "replyToId",
        select: "body authorId createdAt",
        populate: {
          path: "authorId",
          select: "fullName username email profileImage lastActiveAt",
        },
      })
      .lean();

    rows.reverse();

    const messages = rows.map((m) => departmentChatMessagePayload(req, m));

    return res.status(200).json({
      department: String(user.department || "").trim(),
      departmentKey,
      messages,
    });
  } catch (error) {
    console.log("Ошибка в GET /discussions/department/chat/messages:", error);
    return res.status(500).json({ message: "Внутренняя ошибка сервера" });
  }
});

router.post("/department/chat/messages", async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select("role department");
    if (!user) return res.status(404).json({ message: "Пользователь не найден" });
    if (user.role !== "teacher") {
      return res.status(403).json({ message: "Доступ только для преподавателя" });
    }
    const departmentKey = normalizeDepartmentKey(user.department);
    if (!departmentKey) {
      return res.status(400).json({
        message: "В профиле не указана кафедра. Обратитесь к администратору.",
      });
    }

    const raw = req.body?.text ?? req.body?.body ?? "";
    const body = String(raw).trim();
    if (!body) {
      return res.status(400).json({ message: "Введите текст сообщения" });
    }
    if (body.length > 4000) {
      return res.status(400).json({ message: "Сообщение слишком длинное" });
    }

    const replyToId = req.body?.replyToId ? String(req.body.replyToId) : "";
    let replyTo = null;
    if (replyToId) {
      replyTo = await DepartmentChatMessage.findOne({
        _id: replyToId,
        departmentKey,
      });
      if (!replyTo) {
        return res.status(400).json({ message: "Reply message not found" });
      }
    }

    const msg = await DepartmentChatMessage.create({
      departmentKey,
      authorId: user._id,
      body,
      replyToId: replyTo?._id || null,
    });

    const populated = await DepartmentChatMessage.findById(msg._id)
      .populate("authorId", "fullName username email profileImage lastActiveAt")
      .populate({
        path: "replyToId",
        select: "body authorId createdAt",
        populate: {
          path: "authorId",
          select: "fullName username email profileImage lastActiveAt",
        },
      })
      .lean();

    const a = authorPayload(req, populated.authorId);
    const payload = departmentChatMessagePayload(req, populated);

    return res.status(201).json({
      id: populated._id,
      body: populated.body,
      createdAt: populated.createdAt,
      authorId: a.authorId,
      authorName: a.authorName,
      authorProfileImageUrl: a.authorProfileImageUrl,
      authorOnline: a.authorOnline,
      reactions: payload.reactions,
      replyToId: payload.replyToId,
      replyTo: payload.replyTo,
    });
  } catch (error) {
    console.log("Ошибка в POST /discussions/department/chat/messages:", error);
    return res.status(500).json({ message: "Внутренняя ошибка сервера" });
  }
});

router.get("/department/chat/members", async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select("role department");
    if (!user) return res.status(404).json({ message: "Пользователь не найден" });
    if (user.role !== "teacher") {
      return res.status(403).json({ message: "Доступ только для преподавателя" });
    }
    const departmentKey = normalizeDepartmentKey(user.department);
    if (!departmentKey) {
      return res.status(400).json({
        message: "В профиле не указана кафедра. Обратитесь к администратору.",
      });
    }

    const teachers = await User.find({ role: "teacher" })
      .select("fullName username email department profileImage lastActiveAt")
      .sort({ fullName: 1, username: 1 })
      .lean();

    const members = teachers
      .filter((t) => normalizeDepartmentKey(t.department) === departmentKey)
      .map((t) => ({
        id: t._id,
        fullName: String(t.fullName || "").trim(),
        username: t.username,
        email: t.email,
        profileImageUrl: resolveProfileImageUrl(req, t.profileImage),
        isOnline: isRecentlyActive(t.lastActiveAt),
      }));

    return res.status(200).json({
      department: String(user.department || "").trim(),
      members,
    });
  } catch (error) {
    console.log("Ошибка в GET /discussions/department/chat/members:", error);
    return res.status(500).json({ message: "Внутренняя ошибка сервера" });
  }
});

router.post("/department/chat/read", async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select("role department");
    if (!user) return res.status(404).json({ message: "Пользователь не найден" });
    if (user.role !== "teacher") {
      return res.status(403).json({ message: "Доступ только для преподавателя" });
    }
    const departmentKey = normalizeDepartmentKey(user.department);
    if (!departmentKey) {
      return res.status(400).json({
        message: "В профиле не указана кафедра. Обратитесь к администратору.",
      });
    }

    const lastReadAt = new Date();
    await DepartmentChatReadState.findOneAndUpdate(
      { userId: user._id, departmentKey },
      { lastReadAt },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return res.status(200).json({ ok: true, lastReadAt });
  } catch (error) {
    console.log("Ошибка в POST /discussions/department/chat/read:", error);
    return res.status(500).json({ message: "Внутренняя ошибка сервера" });
  }
});

router.get("/department/chat/unread-count", async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select("role department _id");
    if (!user) return res.status(404).json({ message: "Пользователь не найден" });
    if (user.role !== "teacher") {
      return res.status(403).json({ message: "Доступ только для преподавателя" });
    }
    const departmentKey = normalizeDepartmentKey(user.department);
    if (!departmentKey) {
      return res.status(200).json({ unreadCount: 0 });
    }

    const readState = await DepartmentChatReadState.findOne({
      userId: user._id,
      departmentKey,
    }).select("lastReadAt");

    const lastReadAt = readState?.lastReadAt || new Date(0);

    const unreadCount = await DepartmentChatMessage.countDocuments({
      departmentKey,
      authorId: { $ne: user._id },
      createdAt: { $gt: lastReadAt },
    });

    return res.status(200).json({ unreadCount });
  } catch (error) {
    console.log("Ошибка в GET /discussions/department/chat/unread-count:", error);
    return res.status(500).json({ message: "Внутренняя ошибка сервера" });
  }
});

router.post("/department/chat/presence", async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select("role");
    if (!user) return res.status(404).json({ message: "Пользователь не найден" });
    if (user.role !== "teacher") {
      return res.status(403).json({ message: "Доступ только для преподавателя" });
    }

    await User.updateOne({ _id: user._id }, { $set: { lastActiveAt: new Date() } });

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.log("Ошибка в POST /discussions/department/chat/presence:", error);
    return res.status(500).json({ message: "Внутренняя ошибка сервера" });
  }
});

// Добавить реакцию на сообщение
router.post("/messages/:messageId/reactions", async (req, res) => {
  try {
    const { messageId } = req.params;
    const { emoji } = req.body || {};
    const userId = req.user.userId;

    if (!emoji || String(emoji).trim().length === 0) {
      return res.status(400).json({ message: "Эмодзи обязателен" });
    }

    const message = await DiscussionMessage.findById(messageId);
    if (!message) {
      return res.status(404).json({ message: "Сообщение не найдено" });
    }

    // Проверить, нет ли уже такой реакции от этого пользователя
    const existingReaction = message.reactions.find(
      (r) => r.emoji === emoji && String(r.userId) === String(userId)
    );

    if (!existingReaction) {
      message.reactions.push({
        emoji: String(emoji).trim(),
        userId,
      });
      await message.save();
    }

    return res.status(200).json({ ok: true, reactions: message.reactions });
  } catch (error) {
    console.log("Ошибка в POST /messages/:messageId/reactions:", error);
    return res.status(500).json({ message: "Внутренняя ошибка сервера" });
  }
});

// Удалить реакцию на сообщение
router.delete("/messages/:messageId/reactions/:emoji", async (req, res) => {
  try {
    const { messageId, emoji } = req.params;
    const userId = req.user.userId;

    const message = await DiscussionMessage.findById(messageId);
    if (!message) {
      return res.status(404).json({ message: "Сообщение не найдено" });
    }

    message.reactions = message.reactions.filter(
      (r) => !(r.emoji === emoji && String(r.userId) === String(userId))
    );
    await message.save();

    return res.status(200).json({ ok: true, reactions: message.reactions });
  } catch (error) {
    console.log("Ошибка в DELETE /messages/:messageId/reactions/:emoji:", error);
    return res.status(500).json({ message: "Внутренняя ошибка сервера" });
  }
});

export default router;
