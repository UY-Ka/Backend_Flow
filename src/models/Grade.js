import mongoose from "mongoose";

const gradeSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    subject: {
      type: String,
      required: true,
      trim: true,
    },
    value: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    controlType: {
      type: String,
      enum: ["exam", "credit"],
      default: "exam",
    },
    semester: {
      type: String,
      default: "Текущий семестр",
      trim: true,
    },
    date: {
      type: Date,
      default: Date.now,
    },
    comment: {
      type: String,
      default: "",
      trim: true,
    },
  },
  { timestamps: true }
);

gradeSchema.index({ userId: 1, semester: 1, subject: 1, date: -1 });

const Grade = mongoose.model("Grade", gradeSchema);

export default Grade;

