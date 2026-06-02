const mongoose = require('mongoose');
const User = require('./models/User');
const bcrypt = require('bcryptjs');

async function createTeacher() {
  try {
    // Подключаемся к базе данных
    await mongoose.connect('mongodb://localhost:27017/yourdb', {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    
    // Проверяем, существует ли уже преподаватель с таким email
    const existingTeacher = await User.findOne({ username: 'teacher' });
    if (existingTeacher) {
      console.log('Преподаватель с таким email уже существует:', existingTeacher);
      await mongoose.disconnect();
      return;
    }
    
    // Хешируем пароль
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash('123456', salt);
    
    // Создаем нового преподавателя
    const teacher = new User({
      email: 'teacher',
      username: 'teacher',
      password: hashedPassword,
      role: 'teacher',
      fullName: 'Demo Teacher',
      isEmailVerified: true
    });
    
    // Сохраняем в базу данных
    await teacher.save();
    console.log('Преподаватель успешно создан:', teacher);
    
  } catch (error) {
    console.error('Ошибка при создании преподавателя:', error);
  } finally {
    // Отключаемся от базы данных
    await mongoose.disconnect();
  }
}

// Запускаем функцию создания преподавателя
createTeacher();
