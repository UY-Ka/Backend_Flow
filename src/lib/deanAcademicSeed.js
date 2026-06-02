import bcrypt from "bcryptjs";
import Faculty from "../models/Faculty.js";
import Program from "../models/Program.js";
import Group from "../models/Group.js";
import ScheduleItem from "../models/ScheduleItem.js";
import User from "../models/User.js";
import { EF_DEMO_GROUPS } from "../data/demoEfStudents.js";

/** Значения формы обучения в БД (совпадают с клиентом) */
export const STUDY_FORMS = ["full-time", "part-time", "distance"];

const FACULTIES = [
  { name: "Экономический факультет", code: "ECON" },
  { name: "Агроинженерный", code: "AGRO_ENG" },
  { name: "Гуманитарно правовой", code: "HUM_LAW" },
  { name: "Факультет землеустройства и кадастров", code: "LAND_CAD" },
  {
    name: "Факультет агрономии, агрохимии и экологии",
    code: "AGRO_CHEM",
  },
  {
    name: "Факультет ветеринарной медицины и технологий животноводства",
    code: "VET",
  },
  { name: "СПО", code: "SPO" },
];

const PI_4_10_STUDENTS = [
  { fullName: "Grigory Alekseev", username: "alekseev" },
  { fullName: "Sergey Belokolodskikh", username: "belokolodskikh" },
  { fullName: "Roman Buronov", username: "buronov" },
  { fullName: "Maxim Golovin", username: "golovin" },
  { fullName: "Maxim Goncharov", username: "goncharov" },
  { fullName: "Daria Katasonova", username: "katasonova" },
  { fullName: "Varvara Kryukova", username: "kryukova" },
  { fullName: "Alena Maslennikova", username: "maslennikova" },
  { fullName: "Maria Matyushina", username: "matyushina" },
  { fullName: "Marina Mashina", username: "mashina" },
  { fullName: "Anastasia Myagkaya", username: "myagkaya" },
  { fullName: "Nikita Nazarenko", username: "nazarenko" },
  { fullName: "Denis Ostatenko", username: "ostatenko" },
  { fullName: "Ilya Podunov", username: "podunov" },
  { fullName: "Dmitry Popovich", username: "popovich" },
  { fullName: "Kirill Pshenko", username: "pshenko" },
  { fullName: "Maxim Rozhkin", username: "rozhkin" },
  { fullName: "Maxim Rakhimov", username: "rakhimov" },
  { fullName: "Anastasia Semenova", username: "semenova" },
  { fullName: "Artem Serdyuk", username: "serdyuk" },
  { fullName: "Daria Sushko", username: "sushko" },
  { fullName: "Danil Tikhokh", username: "tikhokh" },
  { fullName: "Ivan Umnikov", username: "umnikov" },
  { fullName: "Kristina Faleeva", username: "faleeva" },
  { fullName: "Alexander Fleishman", username: "fleishman" },
  { fullName: "Lilia Shirinet", username: "shirinet" },
  { fullName: "Egor Shubin", username: "shubin" },
  { fullName: "Dmitry Yakimov", username: "yakimov" },
  { fullName: "Valeria Yakimova", username: "yakimova" },
];

/**
 * Создаёт факультеты и минимальную демо-структуру для экономического факультета:
 * направление «Прикладная информатика», группа «ПИ-4-10».
 * Безопасно вызывать многократно (upsert по code / уникальным индексам).
 */
export async function ensureDeanAcademicHierarchy() {
  // Нельзя upsert только по code: в БД может уже быть запись с тем же name и другим code — E11000 на уникальном name.
  for (const f of FACULTIES) {
    let doc = await Faculty.findOne({ code: f.code });
    if (!doc) doc = await Faculty.findOne({ name: f.name });
    if (doc) {
      await Faculty.updateOne(
        { _id: doc._id },
        { $set: { name: f.name, code: f.code } }
      );
    } else {
      await Faculty.create({ name: f.name, code: f.code });
    }
  }

  // Удаляем Факультет ИТ и связанные с ним программы/группы (по запросу текущего MVP).
  const itFac = await Faculty.findOne({
    name: { $regex: /информац.*технолог/i },
  }).select("_id");
  if (itFac?._id) {
    const itPrograms = await Program.find({ facultyId: itFac._id }).select("_id");
    const itProgramIds = itPrograms.map((p) => p._id);
    if (itProgramIds.length > 0) {
      await Group.deleteMany({ programId: { $in: itProgramIds } });
      await Program.deleteMany({ _id: { $in: itProgramIds } });
    }
    await Faculty.deleteOne({ _id: itFac._id });
  }

  const econ =
    (await Faculty.findOne({ code: "ECON" }).select("_id")) ||
    (await Faculty.findOne({ name: "Экономический факультет" }).select("_id"));
  if (econ?._id) {
    let prog = await Program.findOne({ code: "PI", facultyId: econ._id }).select("_id");
    if (prog) {
      await Program.updateOne(
        { _id: prog._id },
        {
          $set: {
            name: "Прикладная информатика",
            code: "PI",
            facultyId: econ._id,
          },
        }
      );
    } else {
      prog = await Program.create({
        name: "Прикладная информатика",
        code: "PI",
        facultyId: econ._id,
      });
    }

    const progId = prog._id || prog;
    let grp = await Group.findOne({
      programId: progId,
      $or: [{ name: "ПИ-4-10" }, { name: "ПИ 4-10" }],
    }).select("_id name");
    if (grp) {
      await Group.updateOne(
        { _id: grp._id },
        { $set: { name: "ПИ-4-10", course: 4, programId: progId } }
      );
    } else {
      await Group.create({
        name: "ПИ-4-10",
        course: 4,
        programId: progId,
      });
    }

    // Демо-студент из старого сида мог сидеть на другой группе («ПИ 4-10» / другой programId) —
    // привязываем к канонической «ПИ-4-10» этого направления, чтобы видеть пары из админки.
    const canonGroup = await Group.findOne({
      programId: progId,
      name: "ПИ-4-10",
    }).select("_id");
    if (canonGroup?._id) {
      const duplicatePiGroups = await Group.find({
        programId: progId,
        _id: { $ne: canonGroup._id },
        name: { $regex: /^ПИ[\s-]/i },
      }).select("_id");
      const duplicateGroupIds = duplicatePiGroups.map((g) => g._id);
      if (duplicateGroupIds.length > 0) {
        await User.updateMany(
          { role: "student", groupId: { $in: duplicateGroupIds } },
          { $set: { groupId: canonGroup._id, studyForm: "full-time", subgroup: "a" } }
        );
        await ScheduleItem.updateMany(
          { groupId: { $in: duplicateGroupIds } },
          { $set: { groupId: canonGroup._id } }
        );
        await Group.deleteMany({ _id: { $in: duplicateGroupIds } });
      }

      await ensurePi410Students(canonGroup._id);
    }

    await ensureEfGroupsAndStudents(econ._id);
  }

  try {
    await ScheduleItem.updateMany(
      { studyForm: { $exists: false } },
      { $set: { studyForm: "full-time" } }
    );
    await ScheduleItem.updateMany(
      { subgroup: { $exists: false } },
      { $set: { subgroup: "all" } }
    );
  } catch {
    // игнорируем, если поле уже везде задано или коллекция пуста
  }

  // Удаляем группы ИВТ из выдачи и БД (для текущего сценария).
  await Group.deleteMany({ name: { $regex: /^ИВТ/i } });

  await ensureCatalogTeachers();
  await ensureIomasTeachers();
  await ensureDeanAdmin();
  await removeProgramDuplicates();
  await cleanupLegacyDemoLocalUsers();
}

const CATALOG_TEACHERS = [
  {
    username: "yasakov",
    email: "yasakov",
    fullName: "Alexander Yasakov",
  },
  {
    username: "kononova",
    email: "kononova",
    fullName: "Natalia Kononova",
  },
];

const IOMAS_TEACHERS = [
  { fullName: "Roman Podkolzin", username: "podkolzin", email: "podkolzin" },
  { fullName: "Alexander Chernykh", username: "chernykh", email: "chernykh" },
  { fullName: "Serik Kusmagambetov", username: "kusmagambetov", email: "kusmagambetov" },
  { fullName: "Vladimir Ryabov", username: "ryabov", email: "ryabov" },
  { fullName: "Elena Goryukhina", username: "goryukhina", email: "goryukhina" },
  { fullName: "Sergey Poddubnyy", username: "poddubnyy", email: "poddubnyy" },
  { fullName: "Alexander Katelikov", username: "katelikov", email: "katelikov" },
  { fullName: "Alexander Tyutyunikov", username: "tyutyunikov", email: "tyutyunikov" },
  { fullName: "Elena Kuznetsova", username: "kuznetsova", email: "kuznetsova" },
  { fullName: "Svetlana Mistyukova", username: "mistyukova", email: "mistyukova" },
  { fullName: "Alexander Yasakov", username: "yasakov", email: "yasakov" },
  { fullName: "Inna Semenova", username: "semenova_teacher", email: "semenova_teacher" },
  { fullName: "Konstantin Ryapolov", username: "ryapolov", email: "ryapolov" },
  { fullName: "Evgenia Ryabova", username: "ryabova", email: "ryabova" },
  { fullName: "Natalia Kononova", username: "kononova", email: "kononova" },
  { fullName: "Pavel Demidov", username: "demidov", email: "demidov" },
  { fullName: "Maxim Trunov", username: "trunov", email: "trunov" },
  { fullName: "Lyudmila Litvinova", username: "litvinova", email: "litvinova" },
  { fullName: "Artem Podlesnyy", username: "podlesnyy", email: "podlesnyy" },
  { fullName: "Dmitry Khmelev", username: "khmelev", email: "khmelev" },
];

/**
 * Два преподавателя для выпадающего списка в админке; пароль задаётся при каждом seed.
 */
async function ensureCatalogTeachers() {
  const defaultPassword = String(process.env.DEMO_TEACHER_PASSWORD || "123456");
  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(defaultPassword, salt);

  for (const t of CATALOG_TEACHERS) {
    const email = t.email.toLowerCase().trim();
    const uname = t.username.trim();
    let existing =
      (await User.findOne({ email }).select("_id")) ||
      (await User.findOne({ username: uname }).select("_id"));

    if (existing) {
      await User.updateOne(
        { _id: existing._id },
        {
          $set: {
            email,
            username: uname,
            password: passwordHash,
            role: "teacher",
            fullName: t.fullName,
            isEmailVerified: true,
            groupId: null,
          },
        }
      );
      continue;
    }

    await User.create({
      username: uname,
      email,
      password: passwordHash,
      role: "teacher",
      fullName: t.fullName,
      isEmailVerified: true,
      profileImage: "",
      groupId: null,
    });
  }
}

async function ensureIomasTeachers() {
  const defaultPassword = String(process.env.DEMO_TEACHER_PASSWORD || "123456");
  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(defaultPassword, salt);

  for (const teacher of IOMAS_TEACHERS) {
    const email = String(teacher.email || "").toLowerCase().trim();
    const username = String(teacher.username || "").trim();
    const fullName = String(teacher.fullName || "").trim();
    if (!email || !username || !fullName) continue;

    const existing =
      (await User.findOne({ email }).select("_id")) ||
      (await User.findOne({ username }).select("_id")) ||
      (await User.findOne({ fullName, role: "teacher" }).select("_id"));

    if (existing) {
      await User.updateOne(
        { _id: existing._id },
        {
          $set: {
            email,
            username,
            password: passwordHash,
            role: "teacher",
            fullName,
            department: "ИОМАС",
            isEmailVerified: true,
            groupId: null,
          },
        }
      );
      continue;
    }

    await User.create({
      username,
      email,
      password: passwordHash,
      role: "teacher",
      fullName,
      department: "ИОМАС",
      isEmailVerified: true,
      profileImage: "",
      groupId: null,
    });
  }
}

async function cleanupLegacyDemoLocalUsers() {
  await User.deleteMany({ email: { $regex: /@demo\.local$/i } });
}

async function ensureDeanAdmin() {
  const password = String(process.env.DEMO_ADMIN_PASSWORD || "123456");
  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(password, salt);
  const payload = {
    username: "dean",
    email: "dean",
    password: passwordHash,
    role: "admin",
    fullName: "Dean Admin",
    isEmailVerified: true,
    profileImage: "",
    groupId: null,
  };

  const existing =
    (await User.findOne({ username: "dean" }).select("_id")) ||
    (await User.findOne({ email: "dean" }).select("_id")) ||
    (await User.findOne({ username: "dean_admin" }).select("_id")) ||
    (await User.findOne({ email: "dean_admin@demo.local" }).select("_id"));

  if (existing?._id) {
    await User.updateOne({ _id: existing._id }, { $set: payload });
  } else {
    await User.create(payload);
  }
}

async function removeProgramDuplicates() {
  const typoRegex = /^прикладная\s+информатикая$/i;
  const typoPrograms = await Program.find({ name: typoRegex }).select("_id");
  if (typoPrograms.length === 0) return;
  const typoIds = typoPrograms.map((p) => p._id);
  await Group.deleteMany({ programId: { $in: typoIds } });
  await Program.deleteMany({ _id: { $in: typoIds } });
}

async function ensurePi410Students(groupId) {
  const defaultPassword = String(process.env.DEMO_STUDENT_PASSWORD || "123456");
  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(defaultPassword, salt);

  for (let i = 0; i < PI_4_10_STUDENTS.length; i += 1) {
    const student = PI_4_10_STUDENTS[i];
    const num = String(i + 1).padStart(2, "0");
    const username = String(student.username || `student${num}`).trim();
    const email = username;
    const fullName = String(student.fullName || username).trim();
    const legacyUsername = `pi410_${num}`;
    const legacyEmail = `pi410.${num}@demo.local`;
    const existing =
      (await User.findOne({ role: "student", fullName }).select("_id")) ||
      (await User.findOne({ username: legacyUsername }).select("_id")) ||
      (await User.findOne({ email: legacyEmail }).select("_id")) ||
      (await User.findOne({ email }).select("_id")) ||
      (await User.findOne({ username }).select("_id"));

    if (existing?._id) {
      await User.updateOne(
        { _id: existing._id },
        {
          $set: {
            username,
            email,
            password: passwordHash,
            role: "student",
            isEmailVerified: true,
            groupId,
            studyForm: "full-time",
            subgroup: "a",
            fullName,
          },
        }
      );
      continue;
    }

    await User.create({
      username,
      email,
      password: passwordHash,
      role: "student",
      isEmailVerified: true,
      groupId,
      studyForm: "full-time",
      subgroup: "a",
      fullName,
      profileImage: "",
    });
  }
}

async function ensureEfGroupsAndStudents(facultyId) {
  let program =
    (await Program.findOne({ code: "ECONOMICS", facultyId }).select("_id")) ||
    (await Program.findOne({ name: "Экономика", facultyId }).select("_id"));

  if (program?._id) {
    await Program.updateOne(
      { _id: program._id },
      { $set: { name: "Экономика", code: "ECONOMICS", facultyId } }
    );
  } else {
    program = await Program.create({
      name: "Экономика",
      code: "ECONOMICS",
      facultyId,
    });
  }

  const programId = program._id || program;
  const defaultPassword = String(process.env.DEMO_STUDENT_PASSWORD || "123456");
  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(defaultPassword, salt);

  for (const groupConfig of EF_DEMO_GROUPS) {
    const groupName = String(groupConfig.name || "").trim();
    if (!groupName) continue;

    let group = await Group.findOne({ name: groupName, programId }).select("_id");
    if (group?._id) {
      await Group.updateOne(
        { _id: group._id },
        {
          $set: {
            name: groupName,
            course: Number(groupConfig.course) || 4,
            programId,
          },
        }
      );
    } else {
      group = await Group.create({
        name: groupName,
        course: Number(groupConfig.course) || 4,
        programId,
      });
    }

    const groupId = group._id || group;
    for (const [index, student] of (groupConfig.students || []).entries()) {
      const username = String(student.username || "").trim();
      const email = String(student.email || "").toLowerCase().trim();
      const fullName = String(student.fullName || "").trim();
      const subgroup = ["a", "b"].includes(String(student.subgroup || "").toLowerCase())
        ? String(student.subgroup).toLowerCase()
        : "a";
      if (!username || !email || !fullName) continue;

      const existing =
        (await User.findOne({ email }).select("_id")) ||
        (await User.findOne({ username }).select("_id")) ||
        (await User.findOne({ username: groupName === "ЭФ-4-10" ? `ef410_0${index + 1}` : `ef49_0${index + 1}` }).select("_id")) ||
        (await User.findOne({ email: groupName === "ЭФ-4-10" ? `ef410.0${index + 1}@demo.local` : `ef49.0${index + 1}@demo.local` }).select("_id")) ||
        (await User.findOne({ role: "student", fullName }).select("_id"));

      const payload = {
        username,
        email,
        password: passwordHash,
        role: "student",
        isEmailVerified: true,
        groupId,
        studyForm: "full-time",
        subgroup,
        fullName,
        profileImage: "",
      };

      if (existing?._id) {
        await User.updateOne({ _id: existing._id }, { $set: payload });
      } else {
        await User.create(payload);
      }
    }
  }
}
