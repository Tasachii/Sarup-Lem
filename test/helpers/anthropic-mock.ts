import { EventEmitter } from "node:events";
import { vi } from "vitest";

/**
 * Fake MessageStream — EventEmitter ที่มี .on("text"), .finalMessage(), .abort()
 * เลียนแบบพฤติกรรมจริง: SDK ปล่อย event "text" *ระหว่าง* finalMessage()
 * fake นี้ปล่อย chunk ภายใน finalMessage เพื่อให้ลำดับ controller.enqueue
 * ตรงกับ production (route subscribe on("text") ก่อน แล้วค่อย await finalMessage)
 */
export type FakeStreamOpts = {
  chunks?: string[];
  error?: Error;
};

// abort/finalMessage เป็นทั้ง spy และ callable ตรงตาม signature ที่ StreamLike ต้องการ
export type FakeStream = EventEmitter & {
  abort: ReturnType<typeof vi.fn> & (() => void);
  finalMessage: ReturnType<typeof vi.fn> & (() => Promise<unknown>);
};

export function fakeStream(opts: FakeStreamOpts = {}): FakeStream {
  const ee = new EventEmitter();
  const abort = vi.fn();
  const finalMessage = vi.fn(async () => {
    for (const c of opts.chunks ?? []) ee.emit("text", c);
    if (opts.error) throw opts.error; // exercises mid-stream catch
    return { content: [] };
  });
  return Object.assign(ee, { abort, finalMessage }) as FakeStream;
}

/*
 * วิธี mock `new Anthropic()` ในไฟล์ route test (self-contained, เลี่ยงปัญหา hoisting):
 *
 *   const mock = vi.hoisted(() => {
 *     const stream = vi.fn();
 *     const countTokens = vi.fn();
 *     // ต้องเป็น function ปกติ (ไม่ใช่ arrow) ให้ `new Anthropic()` construct ได้
 *     const ctor = vi.fn(function (this: unknown) {
 *       return { messages: { stream, countTokens } };
 *     });
 *     return { stream, countTokens, ctor };
 *   });
 *   vi.mock("@anthropic-ai/sdk", () => ({ default: mock.ctor }));
 *
 * แล้วตั้ง mock.stream.mockImplementation(() => fakeStream({ chunks: [...] }))
 * และ assert ด้วย mock.ctor / mock.stream / mock.countTokens ใน test body
 */
