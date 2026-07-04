import { describe, it, expect } from "vitest";
import { sanitizeChatHistory } from "@/app/hooks/useChat";
import type { ChatTurn } from "@/app/hooks/types";

describe("sanitizeChatHistory", () => {
  it("keeps a clean exchange and strips only role/content", () => {
    const turns: ChatTurn[] = [
      { role: "user", content: "Q1" },
      { role: "assistant", content: "A1" },
    ];
    expect(sanitizeChatHistory(turns)).toEqual([
      { role: "user", content: "Q1" },
      { role: "assistant", content: "A1" },
    ]);
    // ไม่หลุด flag error ออกไป (แม้ input ไม่มีก็ตาม ยืนยัน shape)
    expect(sanitizeChatHistory(turns)[0]).not.toHaveProperty("error");
  });

  it("drops a failed assistant turn AND its preceding user turn", () => {
    const turns: ChatTurn[] = [
      { role: "user", content: "Q1" },
      { role: "assistant", content: "A1" },
      { role: "user", content: "Q2" },
      { role: "assistant", content: "> ⚠️ การตอบล้มเหลว", error: true },
    ];
    // เหลือเฉพาะคู่ที่สำเร็จ — คู่ที่ error หายไปทั้งคำถามและคำตอบ
    expect(sanitizeChatHistory(turns)).toEqual([
      { role: "user", content: "Q1" },
      { role: "assistant", content: "A1" },
    ]);
  });

  it("strips the error flag from the payload it produces", () => {
    const turns: ChatTurn[] = [
      { role: "user", content: "Q1" },
      { role: "assistant", content: "A1" },
    ];
    const out = sanitizeChatHistory(turns);
    for (const t of out) expect(t).not.toHaveProperty("error");
  });

  it("keeps good exchanges around a failed one in the middle", () => {
    const turns: ChatTurn[] = [
      { role: "user", content: "Q1" },
      { role: "assistant", content: "A1" },
      { role: "user", content: "Qbad" },
      { role: "assistant", content: "> ⚠️ err", error: true },
      { role: "user", content: "Q3" },
      { role: "assistant", content: "A3" },
    ];
    expect(sanitizeChatHistory(turns)).toEqual([
      { role: "user", content: "Q1" },
      { role: "assistant", content: "A1" },
      { role: "user", content: "Q3" },
      { role: "assistant", content: "A3" },
    ]);
  });

  it("drops a lone failed assistant turn even with no preceding user", () => {
    const turns: ChatTurn[] = [
      { role: "assistant", content: "> ⚠️ err", error: true },
    ];
    expect(sanitizeChatHistory(turns)).toEqual([]);
  });

  it("empty history → empty array", () => {
    expect(sanitizeChatHistory([])).toEqual([]);
  });
});
