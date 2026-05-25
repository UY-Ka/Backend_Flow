import mongoose from "mongoose";

const scheduleItemSchema = new mongoose.Schema(
  {
    groupId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Group",
      default: null,
    },
    /** Если группы нет в справочнике — показываем это название (импорт из Excel). */
    groupLabel: {
      type: String,
      trim: true,
      default: "",
      maxLength: 160,
    },
    dayOfWeek: {
      type: Number,
      required: true,
      min: 1,
      max: 7,
    },
    startTime: {
      type: String,
      required: true,
      trim: true,
    },
    endTime: {
      type: String,
      required: true,
      trim: true,
    },
    subject: {
      type: String,
      required: true,
      trim: true,
    },
    teacher: {
      type: String,
      required: true,
      trim: true,
    },
    teacherUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    room: {
      type: String,
      required: true,
      trim: true,
    },
    weekType: {
      type: Number,
      required: true,
      enum: [1, 2],
      default: 1,
    },
    lessonType: {
      type: String,
      enum: ["lecture", "practice"],
      default: "practice",
    },
    note: {
      type: String,
      default: "",
      trim: true,
      maxLength: 500,
    },
    /** Форма обучения: очная / очно-заочная / заочная */
    studyForm: {
      type: String,
      enum: ["full-time", "part-time", "distance"],
      default: "full-time",
    },
    /** Подгруппа: all (общая), a, b */
    subgroup: {
      type: String,
      enum: ["all", "a", "b"],
      default: "all",
    },
  },
  { timestamps: true }
);

/** Mongoose 9+: pre-хуки без callback next() — только синхронный код или async/Promise. */
scheduleItemSchema.pre("validate", function scheduleGroupGuard() {
  const hasId = this.groupId != null;
  const label = String(this.groupLabel || "").trim();
  if (!hasId && !label) {
    this.invalidate("groupId", "Укажите группу из справочника или текстовое название группы");
  }
});

scheduleItemSchema.index({
  groupId: 1,
  weekType: 1,
  studyForm: 1,
  subgroup: 1,
  dayOfWeek: 1,
  startTime: 1,
});

const ScheduleItem = mongoose.model("ScheduleItem", scheduleItemSchema);

export default ScheduleItem;
