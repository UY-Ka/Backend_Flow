import mongoose from "mongoose";

/** Чат преподавателей одной кафедры (departmentKey — нормализованная строка кафедры). */
const departmentChatMessageSchema = new mongoose.Schema(
  {
    departmentKey: {
      type: String,
      required: true,
      trim: true,
      maxLength: 200,
    },
    authorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    body: {
      type: String,
      required: true,
      trim: true,
      maxLength: 4000,
    },
    replyToId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DepartmentChatMessage",
      default: null,
    },
    reactions: [
      {
        emoji: {
          type: String,
          required: true,
        },
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        _id: false,
      },
    ],
  },
  { timestamps: true }
);

departmentChatMessageSchema.index({ departmentKey: 1, createdAt: 1 });

const DepartmentChatMessage = mongoose.model(
  "DepartmentChatMessage",
  departmentChatMessageSchema
);

export default DepartmentChatMessage;
