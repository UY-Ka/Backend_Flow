import express from "express";
import "dotenv/config";
import cors from "cors";
import path from "path";
import authRoutes from "./routes/authRoutes.js";
import academicRoutes from "./routes/academicRoutes.js";
import discussionRoutes from "./routes/discussionRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import { connectDB } from "./lib/db.js";

const app = express();
const PORT = process.env.PORT || 3000;

// Для web-запросов с другого origin (например, Expo web / браузер)
app.use(cors());
app.use(express.json()); 
app.use("/api/auth", authRoutes);
app.use("/api/academic", academicRoutes);
app.use("/api/discussions", discussionRoutes);
app.use("/api/admin", adminRoutes);
app.use(
  "/uploads",
  express.static(path.join(process.cwd(), "uploads"))
);

app.listen(PORT, () => {
    console.log(`Сервер работает на порту ${PORT}`);
    connectDB();
});