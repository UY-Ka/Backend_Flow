import express from "express";
import User from "../models/User.js";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import {
  generateOtpCode,
  getOtpExpirationDate,
  hashOtp,
  isOtpExpired,
} from "../lib/otp.js";
import {
  sendPasswordResetCodeEmail,
  sendVerificationCodeEmail,
} from "../lib/mailer.js";
import { ensureDefaultAcademicData } from "../lib/academicSeed.js";

const router = express.Router();

const generateToken = (userId) => {
    return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: "15d" });
}

const toPublicUser = (user) => ({
    _id: user._id,
    username: user.username,
    email: user.email,
    fullName: user.fullName || "",
    profileImage: user.profileImage,
    department: user.department,
    isEmailVerified: user.isEmailVerified,
    role: user.role,
    groupId: user.groupId,
    studyForm: user.studyForm,
    subgroup: user.subgroup,
});

const normalizeIdentifier = (value) => String(value || "").trim();

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const findUserByEmailOrUsername = (value) => {
    const raw = normalizeIdentifier(value);
    const lower = raw.toLowerCase();

    if (!raw) return null;

    const exact = new RegExp(`^${escapeRegex(raw)}$`, "i");

    return User.findOne({
        $or: [
            { email: lower },
            { email: exact },
            { username: raw },
            { username: exact },
            { fullName: exact },
        ],
    });
};

const generateAndStoreVerificationCode = async (user) => {
    const code = generateOtpCode();
    user.emailVerificationCodeHash = hashOtp(code);
    user.emailVerificationCodeExpiresAt = getOtpExpirationDate();
    await user.save();
    await sendVerificationCodeEmail({ to: user.email, code });
};

const generateAndStorePasswordResetCode = async (user) => {
    const code = generateOtpCode();
    user.passwordResetCodeHash = hashOtp(code);
    user.passwordResetCodeExpiresAt = getOtpExpirationDate();
    await user.save();
    await sendPasswordResetCodeEmail({ to: user.email, code });
};

router.post("/register", async (req, res) => {
    try {
        const { email, username, password, role, department, studyForm, subgroup } = req.body;
        
        if (!username || !email || !password) {
            return res.status(400).json({ message: "Поля должны быть заполнены" });
        }
        
        const normalizedEmail = String(email).toLowerCase().trim();
        const normalizedUsername = String(username).trim();

        if (password.length < 6) {
            return res.status(400).json({ message: "Пароль должен составлять больше 6 символов" });
        }

        if (normalizedUsername.length < 3) {
            return res.status(400).json({ message: "Имя пользователя должно составлять больше 3 символов" });
        }

        const existingEmail = await User.findOne({ email: normalizedEmail });
        if (existingEmail) {
            return res.status(400).json({ message: "Почта уже используется" });
        }

        const existingUsername = await User.findOne({ username: normalizedUsername });
        if (existingUsername) {
            return res.status(400).json({ message: "Логин уже используется" });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const user = new User({
            email: normalizedEmail,
            username: normalizedUsername,
            password: hashedPassword,
            profileImage: "",
            department: typeof department === "string" ? department.trim() : "",
            isEmailVerified: true,
        });

        if (role && ['student', 'teacher', 'admin'].includes(role)) {
            user.role = role;
        } else {
            user.role = "student";
        }

        const sf = String(studyForm || "full-time").trim();
        if (["full-time", "part-time", "distance"].includes(sf)) {
            user.studyForm = sf;
        }
        const sg = String(subgroup || "a").trim().toLowerCase();
        if (["a", "b"].includes(sg)) {
            user.subgroup = sg;
        }
        
        if (user.role === "student" && !user.groupId) {
            try {
                const academicData = await ensureDefaultAcademicData();
                if (academicData && academicData.group) {
                    user.groupId = academicData.group._id;
                }
            } catch (groupError) {
                console.log("Ошибка при получении данных группы:", groupError);
            }
        } else if (user.role !== "student") {
            user.subgroup = "a";
        }

        await user.save();

        res.status(201).json({
            message: "Вы успешно зарегистрировались",
            user: toPublicUser(user),
        });

    } catch (error) {
        console.log("Ошибка в маршруте регистрации:", error);
        res.status(500).json({ 
            message: "Внутренняя ошибка сервера",
            error: error.message 
        });
    }
});

router.post("/verify-email", async (req, res) => {
    try {
        const { email, code } = req.body;

        if (!email || !code) {
            return res.status(400).json({ message: "Email и код обязательны" });
        }

        const normalizedEmail = String(email).toLowerCase().trim();
        const user = await User.findOne({ email: normalizedEmail });

        if (!user) {
            return res.status(400).json({ message: "Пользователь не найден" });
        }

        if (user.isEmailVerified) {
            const token = generateToken(user._id);
            return res.status(200).json({
                message: "Email уже подтвержден",
                token,
                user: toPublicUser(user),
            });
        }

        if (!user.emailVerificationCodeHash || !user.emailVerificationCodeExpiresAt) {
            return res.status(400).json({ message: "Код подтверждения не найден. Запросите новый код" });
        }

        if (isOtpExpired(user.emailVerificationCodeExpiresAt)) {
            return res.status(400).json({ message: "Срок действия кода истек. Запросите новый код" });
        }

        if (hashOtp(String(code).trim()) !== user.emailVerificationCodeHash) {
            return res.status(400).json({ message: "Неверный код подтверждения" });
        }

        user.isEmailVerified = true;
        user.emailVerificationCodeHash = null;
        user.emailVerificationCodeExpiresAt = null;
        await user.save();

        const token = generateToken(user._id);
        return res.status(200).json({
            message: "Email успешно подтвержден",
            token,
            user: toPublicUser(user),
        });
    } catch (error) {
        console.log("Ошибка подтверждения email:", error);
        res.status(500).json({ message: "Внутренняя ошибка сервера" });
    }
});

router.post("/resend-verification-code", async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ message: "Email обязателен" });
        }

        const normalizedEmail = String(email).toLowerCase().trim();
        const user = await User.findOne({ email: normalizedEmail });
        if (!user) {
            return res.status(400).json({ message: "Пользователь не найден" });
        }
        if (user.isEmailVerified) {
            return res.status(400).json({ message: "Email уже подтвержден" });
        }

        await generateAndStoreVerificationCode(user);
        res.status(200).json({ message: "Новый код подтверждения отправлен" });
    } catch (error) {
        console.log("Ошибка повторной отправки кода:", error);
        res.status(500).json({ message: "Внутренняя ошибка сервера" });
    }
});

router.post("/login", async (req, res) => {
    try {
        const { email, password } = req.body;

        const user = await findUserByEmailOrUsername(email);
        
        if (!user) {
            return res.status(400).json({ message: "Неверные учетные данные" });
        }

        const isPasswordCorrect = await user.comparePassword(String(password || ""));
        if (!isPasswordCorrect) {
            return res.status(400).json({ message: "Неверные учетные данные" });
        }

        const token = generateToken(user._id);

        res.status(200).json({
            token,
            user: toPublicUser(user)
        });
    } catch (error) {
        console.log("Ошибка в маршруте входа в систему", error);
        res.status(500).json({ message: "Внутренняя ошибка сервера" });
    }
});

router.post("/forgot-password", async (req, res) => {
    try {
        const identifier = normalizeIdentifier(req.body?.identifier || req.body?.email);
        if (!identifier) {
            return res.status(400).json({ message: "Email или логин обязателен" });
        }

        const user = await findUserByEmailOrUsername(identifier);
        if (!user) {
            return res.status(200).json({ message: "Если аккаунт существует, код отправлен на почту" });
        }

        await generateAndStorePasswordResetCode(user);
        return res.status(200).json({ message: "Код для сброса пароля отправлен" });
    } catch (error) {
        console.log("Ошибка в forgot-password:", error);
        res.status(500).json({ message: "Внутренняя ошибка сервера" });
    }
});

router.post("/reset-password", async (req, res) => {
    try {
        const identifier = normalizeIdentifier(req.body?.identifier || req.body?.email);
        const { code, newPassword } = req.body;

        if (!identifier || !code || !newPassword) {
            return res.status(400).json({ message: "Email или логин, код и новый пароль обязательны" });
        }
        if (String(newPassword).length < 6) {
            return res.status(400).json({ message: "Пароль должен составлять больше 6 символов" });
        }

        const user = await findUserByEmailOrUsername(identifier);
        if (!user) {
            return res.status(400).json({ message: "Пользователь не найден" });
        }

        if (!user.passwordResetCodeHash || !user.passwordResetCodeExpiresAt) {
            return res.status(400).json({ message: "Код сброса не найден. Запросите новый код" });
        }
        if (isOtpExpired(user.passwordResetCodeExpiresAt)) {
            return res.status(400).json({ message: "Срок действия кода истек. Запросите новый код" });
        }
        if (hashOtp(String(code).trim()) !== user.passwordResetCodeHash) {
            return res.status(400).json({ message: "Неверный код сброса" });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(String(newPassword), salt);

        user.password = hashedPassword;
        user.passwordResetCodeHash = null;
        user.passwordResetCodeExpiresAt = null;
        await user.save();

        return res.status(200).json({ message: "Пароль успешно изменен" });
    } catch (error) {
        console.log("Ошибка в reset-password:", error);
        res.status(500).json({ message: "Внутренняя ошибка сервера" });
    }
});

export default router;
