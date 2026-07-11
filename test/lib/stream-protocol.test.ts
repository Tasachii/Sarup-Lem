import { describe, expect, it } from "vitest";
import {
  consumeStreamResponse,
  encodeStreamEvent,
} from "@/lib/stream-protocol";

function responseFrom(body: string, contentType = "application/x-ndjson") {
  return new Response(body, { headers: { "Content-Type": contentType } });
}

describe("consumeStreamResponse", () => {
  it("assembles deltas only after receiving an explicit done event", async () => {
    const body = [
      encodeStreamEvent({ type: "delta", text: "A" }),
      encodeStreamEvent({ type: "delta", text: "B" }),
      encodeStreamEvent({ type: "done" }),
    ].join("");
    expect(await consumeStreamResponse(responseFrom(body), () => {})).toBe("AB");
  });

  it("rejects an EOF without a terminal event", async () => {
    const body = encodeStreamEvent({ type: "delta", text: "partial" });
    await expect(
      consumeStreamResponse(responseFrom(body), () => {})
    ).rejects.toThrow("การเชื่อมต่อขาดก่อนสตรีมเสร็จสมบูรณ์");
  });

  it("rejects malformed events and an unexpected content type", async () => {
    await expect(
      consumeStreamResponse(responseFrom("not-json\n"), () => {})
    ).rejects.toThrow("ข้อมูลสตรีมจากเซิร์ฟเวอร์ไม่ถูกต้อง");
    await expect(
      consumeStreamResponse(responseFrom("", "text/plain"), () => {})
    ).rejects.toThrow("รูปแบบสตรีมจากเซิร์ฟเวอร์ไม่ถูกต้อง");
  });

  it("rejects any data sent after a terminal event", async () => {
    const body = [
      encodeStreamEvent({ type: "done" }),
      encodeStreamEvent({ type: "delta", text: "late" }),
    ].join("");
    await expect(
      consumeStreamResponse(responseFrom(body), () => {})
    ).rejects.toThrow("ได้รับข้อมูลหลังสตรีมสิ้นสุด");
  });
});
