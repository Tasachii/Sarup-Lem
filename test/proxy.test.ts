import { describe, it, expect, vi, afterEach } from "vitest";
import type { NextRequest } from "next/server";

// โหลด proxy ใหม่ทุกเคส เพื่อรีเซ็ต bucket Map ระดับโมดูล (state แยกกันชัดเจน)
async function loadProxy() {
  vi.resetModules();
  const mod = await import("@/proxy");
  return mod.proxy;
}

// request ปลอมแบบเบา — proxy ใช้แค่ headers.get() และ .ip
function req(xff?: string): NextRequest {
  const headers = new Headers();
  if (xff) headers.set("x-forwarded-for", xff);
  return { headers } as unknown as NextRequest;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("proxy rate limiter — x-forwarded-for trust", () => {
  it("untrusted (default): spoofed X-Forwarded-For all share ONE bucket → 11th is 429", async () => {
    vi.stubEnv("TRUSTED_PROXY", "");
    const proxy = await loadProxy();
    // ยิง 10 ครั้ง แต่ละครั้งปลอม XFF คนละค่า — ทั้งหมดควรตกถังเดียวกัน ("unknown")
    for (let i = 0; i < 10; i++) {
      expect(proxy(req(`1.2.3.${i}`)).status).not.toBe(429);
    }
    // ครั้งที่ 11 (ปลอม XFF ใหม่) ยังโดนจำกัด เพราะ header หนีลิมิตไม่ได้แล้ว
    expect(proxy(req("9.9.9.9")).status).toBe(429);
  });

  it("trusted proxy: distinct X-Forwarded-For get separate buckets", async () => {
    vi.stubEnv("TRUSTED_PROXY", "1");
    const proxy = await loadProxy();
    // 10 client IP ต่างกัน (ผ่าน trusted XFF) → คนละถัง ไม่โดนจำกัดร่วมกัน
    for (let i = 0; i < 10; i++) {
      expect(proxy(req(`10.0.0.${i}`)).status).not.toBe(429);
    }
    // IP ที่ 11 ก็ยังผ่าน เพราะแต่ละ IP มีตัวนับของตัวเอง
    expect(proxy(req("10.0.0.250")).status).not.toBe(429);
  });

  it("trusted proxy: same IP over MAX_REQUESTS → 429 + Retry-After", async () => {
    vi.stubEnv("TRUSTED_PROXY", "1");
    const proxy = await loadProxy();
    for (let i = 0; i < 10; i++) proxy(req("7.7.7.7"));
    const res = proxy(req("7.7.7.7"));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });
});
