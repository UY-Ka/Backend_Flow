import bcrypt from "bcryptjs";
import Faculty from "../models/Faculty.js";
import Program from "../models/Program.js";
import Group from "../models/Group.js";
import ScheduleItem from "../models/ScheduleItem.js";
import User from "../models/User.js";
import Grade from "../models/Grade.js";
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
  { fullName: "Григорий Алексеев", username: "alekseev" },
  { fullName: "Сергей Белоколодских", username: "belokolodskikh" },
  { fullName: "Роман Буронов", username: "buronov" },
  { fullName: "Максим Головин", username: "golovin" },
  { fullName: "Максим Гончаров", username: "goncharov" },
  { fullName: "Дарья Катасонова", username: "katasonova" },
  { fullName: "Варвара Крюкова", username: "kryukova" },
  { fullName: "Алена Масленникова", username: "maslennikova" },
  { fullName: "Мария Матюшина", username: "matyushina" },
  { fullName: "Марина Машина", username: "mashina" },
  { fullName: "Анастасия Мягкая", username: "myagkaya" },
  { fullName: "Никита Назаренко", username: "nazarenko" },
  { fullName: "Денис Остатенко", username: "ostatenko" },
  { fullName: "Илья Подунов", username: "podunov" },
  { fullName: "Дмитрий Попович", username: "popovich" },
  { fullName: "Кирилл Пшенко", username: "pshenko" },
  { fullName: "Максим Рожкин", username: "rozhkin" },
  { fullName: "Максим Рахимов", username: "rakhimov" },
  { fullName: "Анастасия Семенова", username: "semenova" },
  { fullName: "Артем Сердюк", username: "serdyuk" },
  { fullName: "Дарья Сушко", username: "sushko" },
  { fullName: "Данил Тихох", username: "tikhokh" },
  { fullName: "Иван Умников", username: "umnikov" },
  { fullName: "Кристина Фалеева", username: "faleeva" },
  { fullName: "Александр Флейшман", username: "fleishman" },
  { fullName: "Лилия Ширинет", username: "shirinet" },
  { fullName: "Егор Шубин", username: "shubin" },
  { fullName: "Дмитрий Якимов", username: "yakimov" },
  { fullName: "Валерия Якимова", username: "yakimova" },
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
      await ensurePresentationStudent(canonGroup._id);
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
    fullName: "Александр Ясаков",
  },
  {
    username: "kononova",
    email: "kononova",
    fullName: "Наталья Кононова",
  },
];

const IOMAS_TEACHERS = [
  { fullName: "Роман Подколзин", username: "podkolzin", email: "podkolzin" },
  { fullName: "Александр Черных", username: "chernykh", email: "chernykh" },
  { fullName: "Серик Кусмагамбетов", username: "kusmagambetov", email: "kusmagambetov" },
  { fullName: "Владимир Рябов", username: "ryabov", email: "ryabov" },
  { fullName: "Елена Горюхина", username: "goryukhina", email: "goryukhina" },
  { fullName: "Сергей Поддубный", username: "poddubnyy", email: "poddubnyy" },
  { fullName: "Александр Кателиков", username: "katelikov", email: "katelikov" },
  { fullName: "Александр Тютюников", username: "tyutyunikov", email: "tyutyunikov" },
  { fullName: "Елена Кузнецова", username: "kuznetsova", email: "kuznetsova" },
  { fullName: "Светлана Мистюкова", username: "mistyukova", email: "mistyukova" },
  { fullName: "Александр Ясаков", username: "yasakov", email: "yasakov" },
  { fullName: "Инна Семенова", username: "semenova_teacher", email: "semenova_teacher" },
  { fullName: "Константин Ряполов", username: "ryapolov", email: "ryapolov" },
  { fullName: "Евгения Рябова", username: "ryabova", email: "ryabova" },
  { fullName: "Наталья Кононова", username: "kononova", email: "kononova" },
  { fullName: "Павел Демидов", username: "demidov", email: "demidov" },
  { fullName: "Максим Трунов", username: "trunov", email: "trunov" },
  { fullName: "Людмила Литвинова", username: "litvinova", email: "litvinova" },
  { fullName: "Артем Подлесный", username: "podlesnyy", email: "podlesnyy" },
  { fullName: "Дмитрий Хмелев", username: "khmelev", email: "khmelev" },
  { fullName: "Сергей Иванов", username: "teacher2", email: "teacher2" },
  { fullName: "Марина Петрова", username: "teacher3", email: "teacher3" },
  { fullName: "Алексей Смирнов", username: "teacher4", email: "teacher4" },
];

/**
 * Два преподавателя для выпадающего списка в админке; пароль задаётся при каждом seed.
 */
async function ensureCatalogTeachers() {
  const defaultPassword = String(process.env.DEMO_TEACHER_PASSWORD || "12345678");
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
  const defaultPassword = String(process.env.DEMO_TEACHER_PASSWORD || "12345678");
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
    fullName: "Администратор деканата",
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

async function ensurePresentationStudent(groupId) {
  const passwordHash = await bcrypt.hash("12345678", await bcrypt.genSalt(10));
  const payload = {
    username: "demo_student",
    email: "demo_student",
    password: passwordHash,
    role: "student",
    fullName: "Артем Иванов",
    isEmailVerified: true,
    groupId,
    studyForm: "full-time",
    subgroup: "a",
    profileImage: "",
  };

  const existing =
    (await User.findOne({ username: payload.username }).select("_id")) ||
    (await User.findOne({ email: payload.email }).select("_id"));

  const student = existing?._id
    ? await User.findOneAndUpdate(
        { _id: existing._id },
        { $set: payload },
        { returnDocument: "after" }
      )
    : await User.create(payload);

  const grades = [
    {
      subject: "Базы данных",
      value: 5,
      controlType: "exam",
      semester: "7 семестр",
      comment: "Отличная работа на практических занятиях",
    },
    {
      subject: "Web-разработка",
      value: 4,
      controlType: "exam",
      semester: "7 семестр",
      comment: "Уверенно выполнен итоговый проект",
    },
    {
      subject: "Информационные системы",
      value: "зачет",
      controlType: "credit",
      semester: "7 семестр",
      comment: "Зачтено",
    },
  ];

  for (const grade of grades) {
    await Grade.findOneAndUpdate(
      {
        userId: student._id,
        subject: grade.subject,
        semester: grade.semester,
        controlType: grade.controlType,
      },
      {
        $set: {
          ...grade,
          userId: student._id,
          date: new Date(),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
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
