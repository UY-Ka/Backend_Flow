import mongoose from "mongoose";
import User from "./models/User.js";
import bcrypt from "bcryptjs";
import "dotenv/config";

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

async function createIomasTeachers() {
  if (!process.env.MONGO_URL) {
    throw new Error("MONGO_URL не найдена в переменных окружения");
  }

  await mongoose.connect(process.env.MONGO_URL);
  const password = String(process.env.DEMO_TEACHER_PASSWORD || "123456");
  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(password, salt);

  const result = [];
  for (const teacherData of IOMAS_TEACHERS) {
    const email = String(teacherData.email || "").toLowerCase().trim();
    const username = String(teacherData.username || "").trim();
    const fullName = String(teacherData.fullName || "").trim();
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
      result.push({ fullName, username, email, password, status: "updated" });
      continue;
    }

    await User.create({
      email,
      username,
      password: passwordHash,
      role: "teacher",
      fullName,
      department: "ИОМАС",
      isEmailVerified: true,
      profileImage: "",
      groupId: null,
    });
    result.push({ fullName, username, email, password, status: "created" });
  }

  await User.deleteMany({ email: { $regex: /@demo\.local$/i }, role: "teacher" });

  return result;
}

async function main() {
  try {
    const result = await createIomasTeachers();
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ teachers: result }, null, 2));
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Ошибка:", error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

main();
