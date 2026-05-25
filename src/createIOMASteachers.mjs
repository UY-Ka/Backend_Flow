import mongoose from "mongoose";
import User from "./models/User.js";
import bcrypt from "bcryptjs";
import "dotenv/config";

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

async function createIomasTeachers() {
  if (!process.env.MONGO_URL) {
    throw new Error("MONGO_URL не найдена в переменных окружения");
  }

  await mongoose.connect(process.env.MONGO_URL);
  const password = String(process.env.DEMO_TEACHER_PASSWORD || "teacher123");
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