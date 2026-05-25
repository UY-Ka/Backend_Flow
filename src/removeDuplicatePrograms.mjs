import mongoose from 'mongoose';
import Program from './models/Program.js';
import 'dotenv/config';

async function removeDuplicatePrograms() {
  try {
    if (!process.env.MONGO_URL) {
      throw new Error('MONGO_URL не найдена в переменных окружения');
    }

    await mongoose.connect(process.env.MONGO_URL);

    const programs = await Program.find({ name: 'Прикладная информатика' });

    if (programs.length <= 1) {
      console.log('Дубликатов "Прикладная информатика" не найдено.');
      return;
    }

    console.log(`Найдено ${programs.length} записей "Прикладная информатика". Удаляем дубликаты.`);

    // Оставляем первую, удаляем остальные
    for (let i = 1; i < programs.length; i++) {
      await Program.deleteOne({ _id: programs[i]._id });
      console.log(`Удалена запись с ID: ${programs[i]._id}`);
    }

    console.log('Дубликаты удалены.');

  } catch (error) {
    console.error('Ошибка:', error);
  } finally {
    await mongoose.disconnect();
  }
}

removeDuplicatePrograms();