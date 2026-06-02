import "dotenv/config";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";

import User from "../models/User.js";
import Faculty from "../models/Faculty.js";
import Program from "../models/Program.js";
import Group from "../models/Group.js";
import ScheduleItem from "../models/ScheduleItem.js";

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

async function upsertFaculty() {
  // Совпадает с deanAcademicSeed (ECON + «Экономический факультет»)
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

async function upsertTeacher({ username, email, password }) {
  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(password, salt);

  return User.findOneAndUpdate(
    { email: String(email).toLowerCase().trim() },
    {
      username: String(username).trim(),
      email: String(email).toLowerCase().trim(),
      password: passwordHash,
      role: "teacher",
      fullName: "Demo Teacher",
      isEmailVerified: true,
      profileImage: "",
      groupId: null,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

async function upsertStudent({ username, email, password, groupId }) {
  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(password, salt);

  return User.findOneAndUpdate(
    { email: String(email).toLowerCase().trim() },
    {
      username: String(username).trim(),
      email: String(email).toLowerCase().trim(),
      password: passwordHash,
      role: "student",
      fullName: "Demo Student",
      isEmailVerified: true,
      profileImage: "",
      groupId,
      subgroup: "a",
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

async function replaceScheduleForTeacher({ teacherKey, groupId }) {
  // Пересоздаём только "тестовое" расписание этого преподавателя.
  await ScheduleItem.deleteMany({ teacher: teacherKey, groupId });

  const base = {
    teacher: teacherKey,
    groupId,
    room: "Ауд. 312",
  };

  const items = [
    // week 1
    {
      ...base,
      weekType: 1,
      dayOfWeek: 1,
      startTime: "09:00",
      endTime: "10:30",
      subject: "Алгоритмы и структуры данных",
      lessonType: "lecture",
    },
    {
      ...base,
      weekType: 1,
      dayOfWeek: 3,
      startTime: "11:00",
      endTime: "12:30",
      subject: "Базы данных",
      lessonType: "practice",
      room: "Ауд. 214",
    },
    {
      ...base,
      weekType: 1,
      dayOfWeek: 5,
      startTime: "13:00",
      endTime: "14:30",
      subject: "Операционные системы",
      lessonType: "lecture",
      room: "Ауд. 105",
    },
    // week 2
    {
      ...base,
      weekType: 2,
      dayOfWeek: 2,
      startTime: "09:00",
      endTime: "10:30",
      subject: "Алгоритмы и структуры данных",
      lessonType: "practice",
      room: "Ауд. 312",
    },
    {
      ...base,
      weekType: 2,
      dayOfWeek: 4,
      startTime: "11:00",
      endTime: "12:30",
      subject: "Базы данных",
      lessonType: "lecture",
      room: "Ауд. 214",
    },
  ];

  await ScheduleItem.insertMany(items);
  return items.length;
}

async function main() {
  const mongoUrl = mustEnv("MONGO_URL");
  await mongoose.connect(mongoUrl);

  const teacherUsername = "teacher1";
  const teacherEmail = "teacher1";
  const teacherPassword = "123456";

  const faculty = await upsertFaculty();
  const program = await upsertProgram(faculty._id);
  const group = await upsertGroup(program._id);
  const teacher = await upsertTeacher({
    username: teacherUsername,
    email: teacherEmail,
    password: teacherPassword,
  });

  const studentUsername = "student1";
  const studentEmail = "student1";
  const studentPassword = "123456";
  const student = await upsertStudent({
    username: studentUsername,
    email: studentEmail,
    password: studentPassword,
    groupId: group._id,
  });

  const adminUsername = "dean";
  const adminEmail = "dean";
  const adminPassword = "123456";
  const salt = await bcrypt.genSalt(10);
  const adminHash = await bcrypt.hash(adminPassword, salt);
  const admin = await User.findOneAndUpdate(
    { email: String(adminEmail).toLowerCase().trim() },
    {
      username: adminUsername,
      email: String(adminEmail).toLowerCase().trim(),
      password: adminHash,
      role: "admin",
      isEmailVerified: true,
      profileImage: "",
      groupId: null,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  const created = await replaceScheduleForTeacher({
    teacherKey: teacherUsername,
    groupId: group._id,
  });

  // Выводим учетные данные и подсказки.
  // eslint-disable-next-line no-console
  console.log("✅ Test teacher + student seeded");
  // eslint-disable-next-line no-console
  console.log({
    login: { email: teacherEmail, password: teacherPassword, role: teacher.role },
    teacherMatchKey: teacherUsername,
    group: { id: String(group._id), name: group.name },
    scheduleItemsCreated: created,
    studentLogin: {
      email: studentEmail,
      password: studentPassword,
      role: student.role,
    },
    adminLogin: {
      email: adminEmail,
      password: adminPassword,
      role: admin.role,
    },
  });

  await mongoose.disconnect();
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error("❌ seed failed:", e);
  process.exit(1);
});
