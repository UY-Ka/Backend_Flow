import bcrypt from "bcryptjs";
import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
    username:{
        type: String,
        required: true,
        unique: true
    },
    email:{
        type: String,
        required: true,
        unique: true
    },
    password:{
        type: String,
        required: true,
        minLength: 6
    },
    profileImage:{
        type: String,
        default: ""
    },
    /** Последняя активность в приложении (для индикатора «онлайн» в чате кафедры). */
    lastActiveAt: {
        type: Date,
        default: null,
    },
    department: {
        type: String,
        default: "",
        trim: true,
        maxLength: 200,
    },
    /** ФИО (для отображения и сопоставления с полем «преподаватель» в расписании) */
    fullName: {
        type: String,
        default: "",
        trim: true,
        maxLength: 200,
    },
    isEmailVerified: {
        type: Boolean,
        default: false,
    },
    emailVerificationCodeHash: {
        type: String,
        default: null,
    },
    emailVerificationCodeExpiresAt: {
        type: Date,
        default: null,
    },
    passwordResetCodeHash: {
        type: String,
        default: null,
    },
    passwordResetCodeExpiresAt: {
        type: Date,
        default: null,
    },
    role: {
        type: String,
        enum: ["student", "teacher", "admin"],
        default: "student",
    },
    groupId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Group",
        default: null,
    },
    /** Для студента: форма обучения (фильтр расписания) */
    studyForm: {
        type: String,
        enum: ["full-time", "part-time", "distance"],
        default: "full-time",
    },
    /** Для студента: подгруппа внутри группы (A/B) */
    subgroup: {
        type: String,
        enum: ["a", "b"],
        default: "a",
    },
}, 
{timestamps: true}
);

userSchema.methods.comparePassword = async function (userPassword) {
    return await bcrypt.compare(userPassword, this.password);
}

const User = mongoose.model("User", userSchema);


export default User;