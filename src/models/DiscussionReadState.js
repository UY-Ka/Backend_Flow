import mongoose from "mongoose";

const discussionReadStateSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    groupId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Group",
      required: true,
    },
    lastReadAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

discussionReadStateSchema.index({ userId: 1, groupId: 1 }, { unique: true });

const DiscussionReadState = mongoose.model(
  "DiscussionReadState",
  discussionReadStateSchema
);

export default DiscussionReadState;

