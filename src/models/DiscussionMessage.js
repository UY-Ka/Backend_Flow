import mongoose from "mongoose";

const discussionMessageSchema = new mongoose.Schema(
  {
    groupId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Group",
      required: true,
    },
    teacherId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxLength: 200,
    },
    body: {
      type: String,
      default: "",
      trim: true,
      maxLength: 2000,
    },
    attachmentUrl: {
      type: String,
      default: "",
      trim: true,
    },
    attachmentName: {
      type: String,
      default: "",
      trim: true,
    },
    replyToId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DiscussionMessage",
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

discussionMessageSchema.index({ groupId: 1, createdAt: -1 });

const DiscussionMessage = mongoose.model(
  "DiscussionMessage",
  discussionMessageSchema
);

export default DiscussionMessage;

