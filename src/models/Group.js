import mongoose from "mongoose";

const groupSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    course: {
      type: Number,
      required: true,
      min: 1,
      max: 6,
    },
    programId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Program",
      required: true,
    },
  },
  { timestamps: true }
);

groupSchema.index({ name: 1, programId: 1 }, { unique: true });

const Group = mongoose.model("Group", groupSchema);

export default Group;

