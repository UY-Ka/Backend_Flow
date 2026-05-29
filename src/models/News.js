import mongoose from "mongoose";

const newsSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxLength: 300,
    },
    text: {
      type: String,
      required: true,
      trim: true,
      maxLength: 8000,
    },
    imageUrl: {
      type: String,
      trim: true,
      default: "",
    },
    likedBy: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    comments: [
      {
        authorId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        authorName: {
          type: String,
          trim: true,
          default: "",
        },
        body: {
          type: String,
          trim: true,
          required: true,
          maxLength: 1200,
        },
        createdAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    publishedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

newsSchema.index({ publishedAt: -1 });

const News = mongoose.model("News", newsSchema);

export default News;
