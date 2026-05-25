/**
 * Конвертирует Excel расписания из корня репозитория в JSON (для отладки структуры).
 * Запуск из папки backend: npm run xlsx:json
 * Или: node scripts/xlsx-to-json.mjs "../рас.xlsx"
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import xlsx from "xlsx";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(backendRoot, "..");

const argPath = process.argv[2];
let filePath = argPath ? path.resolve(process.cwd(), argPath) : null;

if (!filePath || !fs.existsSync(filePath)) {
  const candidates = fs.readdirSync(repoRoot).filter((x) => /\.xlsx$/i.test(x));
  if (!candidates.length) {
    console.error("Не найден .xlsx в корне проекта и не передан путь.");
    process.exit(1);
  }
  filePath = path.join(repoRoot, candidates[0]);
  console.log("Использую файл:", filePath);
}

const buf = fs.readFileSync(filePath);
const wb = xlsx.read(buf, { type: "buffer", cellDates: true });
const out = {
  sourceFile: path.basename(filePath),
  sheetNames: wb.SheetNames,
};
for (const sn of wb.SheetNames) {
  const sheet = wb.Sheets[sn];
  out[sn] = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
}

const outDir = path.join(backendRoot, "fixtures");
fs.mkdirSync(outDir, { recursive: true });
const baseName = path.basename(filePath, path.extname(filePath));
const outName = `${baseName || "sheet"}-sheet.json`;
const outPath = path.join(outDir, outName);
fs.writeFileSync(outPath, JSON.stringify(out, null, 2), "utf8");
console.log("Записано:", outPath, "строк на первом листе:", out[out.sheetNames[0]]?.length ?? 0);
