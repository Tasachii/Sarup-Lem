import { describe, it, expect } from "vitest";
import { friendlyError } from "@/lib/errors";

const FALLBACK = "เกิดข้อผิดพลาด";

describe("friendlyError", () => {
  it("maps authentication_error → API key string", () => {
    expect(friendlyError(new Error("authentication_error: bad"), FALLBACK)).toContain(
      "API key ไม่ถูกต้อง"
    );
  });

  it("maps 'invalid x-api-key' → API key string (second OR clause)", () => {
    expect(friendlyError(new Error("invalid x-api-key"), FALLBACK)).toContain(
      "API key ไม่ถูกต้อง"
    );
  });

  it("maps 'credit balance' → credit-exhausted string", () => {
    expect(
      friendlyError(new Error("Your credit balance is too low"), FALLBACK)
    ).toContain("เครดิต Anthropic หมด");
  });

  it("maps rate_limit_error → rate-limit string", () => {
    expect(friendlyError(new Error("rate_limit_error"), FALLBACK)).toContain(
      "เรียกใช้งานถี่เกินไป"
    );
  });

  it("maps overloaded_error → overloaded string", () => {
    expect(friendlyError(new Error("overloaded_error"), FALLBACK)).toContain(
      "ระบบ AI กำลังหนาแน่น"
    );
  });

  it("maps request_too_large → too-large string", () => {
    expect(friendlyError(new Error("request_too_large"), FALLBACK)).toContain(
      "เอกสารใหญ่เกินไป"
    );
  });

  it("unknown Error → returns err.message (truthy branch)", () => {
    expect(friendlyError(new Error("some weird failure"), FALLBACK)).toBe(
      "some weird failure"
    );
  });

  it("Error with empty message → returns fallback (falsy branch)", () => {
    expect(friendlyError(new Error(""), FALLBACK)).toBe(FALLBACK);
  });

  describe("non-Error throws → String(err ?? '')", () => {
    it("string value is returned", () => {
      expect(friendlyError("plain string error", FALLBACK)).toBe(
        "plain string error"
      );
    });

    it("number value is stringified", () => {
      expect(friendlyError(42, FALLBACK)).toBe("42");
    });

    // ทั้ง 4 ตัวที่ทำให้ msg ว่าง → คืน fallback (ครอบ || short-circuit)
    it("null → fallback", () => {
      expect(friendlyError(null, FALLBACK)).toBe(FALLBACK);
    });

    it("undefined → fallback", () => {
      expect(friendlyError(undefined, FALLBACK)).toBe(FALLBACK);
    });

    it("empty string → fallback", () => {
      expect(friendlyError("", FALLBACK)).toBe(FALLBACK);
    });

    it("number 0 → fallback (String(0 ?? '') is '0' — but 0 is not nullish)", () => {
      // 0 ?? "" === 0 → String(0) === "0" → truthy → returns "0"
      expect(friendlyError(0, FALLBACK)).toBe("0");
    });
  });

  it("plain object {} → '[object Object]' (documents current behavior)", () => {
    expect(friendlyError({}, FALLBACK)).toBe("[object Object]");
  });
});
