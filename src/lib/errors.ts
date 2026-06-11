/** แปลง error จาก Anthropic API เป็นข้อความไทยที่ผู้ใช้เข้าใจได้ */
export function friendlyError(err: unknown, fallback: string): string {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  if (msg.includes("authentication_error") || msg.includes("invalid x-api-key")) {
    return "API key ไม่ถูกต้อง — ตรวจสอบ ANTHROPIC_API_KEY ในไฟล์ .env.local";
  }
  if (msg.includes("credit balance")) {
    return "เครดิต Anthropic หมด — เติมเงินได้ที่ platform.claude.com";
  }
  if (msg.includes("rate_limit_error")) {
    return "เรียกใช้งานถี่เกินไป — รอสักครู่แล้วลองใหม่";
  }
  if (msg.includes("overloaded_error")) {
    return "ระบบ AI กำลังหนาแน่น — ลองใหม่อีกครั้ง";
  }
  if (msg.includes("request_too_large")) {
    return "เอกสารใหญ่เกินไปสำหรับคำขอเดียว — ลองแบ่งไฟล์เป็นส่วนย่อย";
  }
  return msg || fallback;
}
