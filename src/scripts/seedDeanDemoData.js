import "dotenv/config";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import Faculty from "../models/Faculty.js";
import Program from "../models/Program.js";
import Group from "../models/Group.js";
import User from "../models/User.js";

const STUDENTS = [
  { fullName: "Grigory Alekseev", username: "alekseev" },
  { fullName: "Ogulshen Baymuratliev", username: "baymuratliev" },
  { fullName: "Sergey Belokolodskikh", username: "belokolodskikh" },
  { fullName: "Roman Buronov", username: "buronov" },
  { fullName: "Maket Golovin", username: "golovin" },
  { fullName: "Maxim Goncharov", username: "goncharov" },
  { fullName: "Maken Dolikha", username: "dolikha" },
  { fullName: "Daria Katasonova", username: "katasonova" },
  { fullName: "Varvara Kryukova", username: "kryukova" },
  { fullName: "Alena Maslennikova", username: "maslennikova" },
  { fullName: "Maria Matyushina", username: "matyushina" },
  { fullName: "Marina Mashina", username: "mashina" },
  { fullName: "Anastasia Myagkaya", username: "myagkaya" },
  { fullName: "Nikita Nazarako", username: "nazarako" },
  { fullName: "Lev Ostatenko", username: "ostatenko" },
  { fullName: "Ilya Pupnov", username: "pupnov" },
  { fullName: "Dmitry Popovich", username: "popovich" },
  { fullName: "Kirill Plyusko", username: "plyusko" },
  { fullName: "Denis Rogozhin", username: "rogozhin" },
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

function makeStudentUsername(index) {
  return STUDENTS[index]?.username || `student${String(index + 1).padStart(2, "0")}`;
}

function makeStudentEmail(index) {
  return makeStudentUsername(index);
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

  const adminPassword = process.env.DEMO_ADMIN_PASSWORD || "123456";
  const admin = await upsertUser({
    username: "dean",
    email: "dean",
    password: adminPassword,
    role: "admin",
    fullName: "Dean Admin",
  });

  const studentPassword = process.env.DEMO_STUDENT_PASSWORD || "123456";
  const createdStudents = [];
  for (let index = 0; index < STUDENTS.length; index += 1) {
    const username = makeStudentUsername(index);
    const email = makeStudentEmail(index);
    const fullName = STUDENTS[index].fullName;
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

  await User.deleteMany({ email: { $regex: /@demo\.local$/i } });

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
