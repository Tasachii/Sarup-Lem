import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Rate limiter แบบ in-memory ต่อ IP สำหรับ route ที่เสียเงินจริง (เรียก Anthropic API)
 *
 * ⚠️ ใช้ได้กับ instance เดียวเท่านั้น — state เก็บใน memory ของ process
 * ถ้า deploy แบบ serverless/หลาย instance (เช่น Vercel) ตัวนับนี้จะไม่ครอบคลุมทุก instance
 * โปรดดู README หัวข้อ "Rate limiting" ก่อน deploy แบบ public
 *
 * Next.js 16: ไฟล์นี้คือ proxy (เดิมชื่อ middleware) รันบน Node.js runtime
 */

const WINDOW_MS = 60_000; // หน้าต่างเวลา 1 นาที
const MAX_REQUESTS = 10; // จำนวนคำขอสูงสุดต่อ IP ต่อหน้าต่าง

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

function clientIp(request: NextRequest): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

function isRateLimited(ip: string, now: number): { limited: boolean; retryAfter: number } {
  const bucket = buckets.get(ip);

  if (!bucket || now >= bucket.resetAt) {
    buckets.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return { limited: false, retryAfter: 0 };
  }

  bucket.count += 1;
  if (bucket.count > MAX_REQUESTS) {
    return { limited: true, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  return { limited: false, retryAfter: 0 };
}

// เก็บกวาด bucket ที่หมดอายุเป็นระยะ กัน memory โต (ต่อ instance)
function sweep(now: number): void {
  if (buckets.size < 1000) return;
  for (const [ip, bucket] of buckets) {
    if (now >= bucket.resetAt) buckets.delete(ip);
  }
}

export function proxy(request: NextRequest) {
  const now = Date.now();
  sweep(now);

  const ip = clientIp(request);
  const { limited, retryAfter } = isRateLimited(ip, now);

  if (limited) {
    return NextResponse.json(
      { error: "เรียกใช้งานถี่เกินไป — รอสักครู่แล้วลองใหม่" },
      {
        status: 429,
        headers: { "Retry-After": String(retryAfter) },
      }
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/analyze", "/api/summarize", "/api/chat"],
};
