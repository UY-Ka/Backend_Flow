import mongoose from "mongoose";

const departmentChatReadStateSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    departmentKey: {
      type: String,
      required: true,
      trim: true,
      maxLength: 200,
    },
    lastReadAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

departmentChatReadStateSchema.index({ userId: 1, departmentKey: 1 }, { unique: true });

const DepartmentChatReadState = mongoose.model(
  "DepartmentChatReadState",
  departmentChatReadStateSchema
);

export default DepartmentChatReadState;
