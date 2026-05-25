import "dotenv/config";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import Faculty from "../models/Faculty.js";
import Program from "../models/Program.js";
import Group from "../models/Group.js";
import User from "../models/User.js";

const STUDENT_NAMES = [
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
  "Мягкая Анастасия Анастольевна",
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
  "Якимова Валерия Николаевна",
];

function makeStudentUsername(index) {
  return `student_${String(index + 1).padStart(2, "0")}`;
}

function makeStudentEmail(index) {
  return `student.${String(index + 1).padStart(2, "0")}@demo.local`;
}

async function upsertFaculty() {
  const code = "ECON";
  const name = "Экономический факультет";
  return Faculty.findOneAndUpdate(
    { code },
    { code, name },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

async function upsertProgram(facultyId) {
  const code = "PI";
  const name = "Прикладная информатика";
  return Program.findOneAndUpdate(
    { code, facultyId },
    { code, name, facultyId },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

async function upsertGroup(programId) {
  const name = "ПИ-4-10";
  const course = 4;
  return Group.findOneAndUpdate(
    { name, programId },
    { name, course, programId },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

async function upsertUser({ username, email, password, role, fullName, groupId }) {
  const hashedPassword = await bcrypt.hash(String(password), await bcrypt.genSalt(10));
  return User.findOneAndUpdate(
    { email: String(email).toLowerCase().trim() },
    {
      username: String(username).trim(),
      email: String(email).toLowerCase().trim(),
      password: hashedPassword,
      role,
      fullName: String(fullName).trim(),
      isEmailVerified: true,
      profileImage: "",
      groupId: groupId || null,
      studyForm: role === "student" ? "full-time" : undefined,
      subgroup: role === "student" ? "a" : undefined,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

async function main() {
  const mongoUrl = String(process.env.MONGO_URL || "").trim();
  if (!mongoUrl) {
    throw new Error("MONGO_URL is not configured in .env");
  }

  await mongoose.connect(mongoUrl, {
    serverSelectionTimeoutMS: 5000,
  });

  const faculty = await upsertFaculty();
  const program = await upsertProgram(faculty._id);
  const group = await upsertGroup(program._id);

  const adminPassword = process.env.DEMO_ADMIN_PASSWORD || "Admin123!";
  const admin = await upsertUser({
    username: "dean_admin",
    email: "dean_admin@demo.local",
    password: adminPassword,
    role: "admin",
    fullName: "Деканат Администратор",
  });

  const studentPassword = process.env.DEMO_STUDENT_PASSWORD || "Student123!";
  const createdStudents = [];
  for (let index = 0; index < STUDENT_NAMES.length; index += 1) {
    const username = makeStudentUsername(index);
    const email = makeStudentEmail(index);
    const fullName = STUDENT_NAMES[index];
    const student = await upsertUser({
      username,
      email,
      password: studentPassword,
      role: "student",
      fullName,
      groupId: group._id,
    });
    createdStudents.push({ username, email, fullName });
  }

  console.log("✅ Seed completed: dean admin and student demo accounts created.");
  console.log({
    admin: { email: admin.email, password: adminPassword, role: admin.role },
    studentPassword,
    studentCount: createdStudents.length,
    group: { id: String(group._id), name: group.name },
  });

  await mongoose.disconnect();
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("❌ Seed failed:", error);
  process.exit(1);
});
