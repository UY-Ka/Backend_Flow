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
