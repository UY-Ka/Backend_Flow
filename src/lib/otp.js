import crypto from "crypto";

const OTP_LENGTH = 6;
const OTP_TTL_MS = 10 * 60 * 1000;

export function generateOtpCode() {
  // Гарантированно 6 цифр (000000-999999)
  const num = crypto.randomInt(0, 1000000);
  return String(num).padStart(OTP_LENGTH, "0");
}

export function hashOtp(code) {
  return crypto.createHash("sha256").update(code).digest("hex");
}

export function getOtpExpirationDate() {
  return new Date(Date.now() + OTP_TTL_MS);
}

export function isOtpExpired(expiresAt) {
  if (!expiresAt) return true;
  return new Date(expiresAt).getTime() < Date.now();
}

