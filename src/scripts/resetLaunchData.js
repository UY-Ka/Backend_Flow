import "dotenv/config";
import mongoose from "mongoose";
import Grade from "../models/Grade.js";
import News from "../models/News.js";

async function main() {
  const mongoUrl = process.env.MONGO_URL;
  if (!mongoUrl) {
    throw new Error("MONGO_URL не задан в окружении");
  }

  await mongoose.connect(mongoUrl);

  const [gradesResult, newsResult] = await Promise.all([
    Grade.deleteMany({}),
    News.deleteMany({}),
  ]);

  console.log("Reset complete");
  console.log({
    deletedGrades: gradesResult.deletedCount || 0,
    deletedNews: newsResult.deletedCount || 0,
  });

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error("Reset failed:", error?.message || error);
  try {
    await mongoose.disconnect();
  } catch {
    // ignore
  }
  process.exit(1);
});

