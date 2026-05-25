import mongoose from "mongoose";

export const connectDB = async () => {
  const uri = String(process.env.MONGO_URL || "").trim();
  if (!uri) {
    console.log("MONGO_URL не задан. Сервер запущен без подключения к БД.");
    return { ok: false, skipped: true };
  }

  const maxAttempts = 3;
  const baseDelayMs = 2000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const conn = await mongoose.connect(uri, {
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
      });
      console.log(`✓ База данных подключена к ${conn.connection.host}`);
      return { ok: true };
    } catch (error) {
      const msg = error?.message ? String(error.message) : String(error);
      console.log(
        `✗ Ошибка подключения к базе данных (попытка ${attempt}/${maxAttempts}): ${msg}`
      );
      if (attempt === maxAttempts) {
        console.warn(
          "\n⚠️  ВАЖНО: Не удалось подключиться к MongoDB Atlas.\n" +
          "Причины:\n" +
          "  1. Ваш IP адрес не добавлен в Network Access на MongoDB Atlas\n" +
          "  2. Кластер неактивен или удален\n" +
          "  3. Неверные учетные данные в MONGO_URL\n" +
          "  4. Нет интернета\n\n" +
          "Решение: Добавьте ваш IP в MongoDB Atlas → Security → Network Access\n" +
          "или используйте IP 0.0.0.0/0 (для разработки)\n"
        );
        return { ok: false, error };
      }
      const delay = baseDelayMs * attempt;
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  return { ok: false };
};