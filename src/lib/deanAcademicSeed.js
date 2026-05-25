import bcrypt from "bcryptjs";
import Faculty from "../models/Faculty.js";
import Program from "../models/Program.js";
import Group from "../models/Group.js";
import ScheduleItem from "../models/ScheduleItem.js";
import User from "../models/User.js";

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
  "Алексеев Григорий Дмитриевич",
  "Баймуратлиев Огулшен",
  "Белоколодских Сергей Юрьевич",
  "Буронов Роман Витальевич",
  "Головин Макет Дмитриевич",
  "Гончаров Максим Евгеньевич",
  "Долиха Макен Андреевич",
  "Катасонова Дарья Сергеевна",
  "Крюкова Варвара Федоровна",
  "Масленникова Алена Александровна",
  "Матюшина Мария Сергеевна",
  "Машина Марина Геннадьевна",
  "Мягкая Анастасия Николаевна",
  "Назарако Никита Владиславович",
  "Остатенко Лев Олегович",
  "Пупнов Илья Антонович",
  "Попович Дмитрий Сергеевич",
  "Плюско Кирилл Александрович",
  "Рогожин Денис Александрович",
  "Рахимов Максим Юрьевич",
  "Семенова Анастасия Анатольевна",
  "Сердюк Артем Алексеевич",
  "Сушко Дарья Дмитриевна",
  "Тихох Данил Евгеньевич",
  "Умников Иван Олегович",
  "Фалеева Кристина Дмитриевна",
  "Флейшман Александр Евгеньевич",
  "Ширинет Лилия Викторовна",
  "Шубин Егор Викторович",
  "Якимов Дмитрий Андреевич",
  "Якимова Валерия Владимировна",
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
  await removeProgramDuplicates();
}

const CATALOG_TEACHERS = [
  {
    username: "yasakov_as",
    email: "yasakov.catalog@demo.local",
    fullName: "Ясаков Александр Сергеевич",
  },
  {
    username: "kononova_nn",
    email: "kononova.catalog@demo.local",
    fullName: "Кононова Наталья Николаевна",
  },
];

const IOMAS_TEACHERS = [
  { fullName: "Подколзин Роман Вячеславович", username: "podkolzin_rv", email: "podkolzin.rv@demo.local" },
  { fullName: "Черных Александр Николаевич", username: "chernykh_an", email: "chernykh.an@demo.local" },
  { fullName: "Кусмагамбетов Серик Магометович", username: "kusmagambetov_sm", email: "kusmagambetov.sm@demo.local" },
  { fullName: "Рябов Владимир Петрович", username: "ryabov_vp", email: "ryabov.vp@demo.local" },
  { fullName: "Горюхина Елена Юрьевна", username: "goryukhina_ey", email: "goryukhina.ey@demo.local" },
  { fullName: "Поддубный Сергей Сергеевич", username: "poddubnyy_ss", email: "poddubnyy.ss@demo.local" },
  { fullName: "Кателиков Александр Николаевич", username: "katelikov_an", email: "katelikov.an@demo.local" },
  { fullName: "Тютюников Александр Александрович", username: "tyutyunikov_aa", email: "tyutyunikov.aa@demo.local" },
  { fullName: "Кузнецова Елена Дмитриевна", username: "kuznetsova_ed", email: "kuznetsova.ed@demo.local" },
  { fullName: "Мистюкова Светлана Васильевна", username: "mistyukova_sv", email: "mistyukova.sv@demo.local" },
  { fullName: "Ясаков Александр Сергеевич", username: "yasakov_as", email: "yasakov.as@demo.local" },
  { fullName: "Семенова Инна Михайловна", username: "semenova_im", email: "semenova.im@demo.local" },
  { fullName: "Ряполов Константин Яковлевич", username: "ryapolov_ky", email: "ryapolov.ky@demo.local" },
  { fullName: "Рябова Евгения Петровна", username: "ryabova_ep", email: "ryabova.ep@demo.local" },
  { fullName: "Кононова Наталья Николаевна", username: "kononova_nn", email: "kononova.nn@demo.local" },
  { fullName: "Демидов Павел Валерьевич", username: "demidov_pv", email: "demidov.pv@demo.local" },
  { fullName: "Трунов Максим Сергеевич", username: "trunov_ms", email: "trunov.ms@demo.local" },
  { fullName: "Литвинова Людмила Ивановна", username: "litvinova_li", email: "litvinova.li@demo.local" },
  { fullName: "Подлесный Артем Николаевич", username: "podlesnyy_an", email: "podlesnyy.an@demo.local" },
  { fullName: "Хмелев Дмитрий Валерьевич", username: "khmelev_dv", email: "khmelev.dv@demo.local" },
];

/**
 * Два преподавателя для выпадающего списка в админке; пароль задаётся только при создании записи.
 */
async function ensureCatalogTeachers() {
  const defaultPassword = String(process.env.DEMO_TEACHER_PASSWORD || "teacher123");
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
  const defaultPassword = String(process.env.DEMO_TEACHER_PASSWORD || "teacher123");
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

async function removeProgramDuplicates() {
  const typoRegex = /^прикладная\s+информатикая$/i;
  const typoPrograms = await Program.find({ name: typoRegex }).select("_id");
  if (typoPrograms.length === 0) return;
  const typoIds = typoPrograms.map((p) => p._id);
  await Group.deleteMany({ programId: { $in: typoIds } });
  await Program.deleteMany({ _id: { $in: typoIds } });
}

async function ensurePi410Students(groupId) {
  const defaultPassword = String(process.env.DEMO_STUDENT_PASSWORD || "Student123!");
  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(defaultPassword, salt);

  for (let i = 0; i < PI_4_10_STUDENTS.length; i += 1) {
    const fullName = PI_4_10_STUDENTS[i];
    const num = String(i + 1).padStart(2, "0");
    const username = `pi410_${num}`;
    const email = `pi410.${num}@demo.local`;
    const existing =
      (await User.findOne({ role: "student", fullName }).select("_id")) ||
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
