import type Anthropic from "@anthropic-ai/sdk";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from "@/lib/extract";
import { friendlyError } from "@/lib/errors";
import { MODEL, MAX_INPUT_TOKENS } from "@/lib/summarize";
import { encodeStreamEvent } from "@/lib/stream-protocol";

/**
 * ส่วนของ MessageStream ที่ streamToResponse ใช้จริง — แยกเป็น interface
 * เพื่อไม่ผูกกับ type ลึกของ SDK และให้ test mock ได้ตรงรูป
 */
export interface StreamLike {
  on(event: "text", listener: (delta: string) => void): unknown;
  finalMessage(): Promise<unknown>;
  abort(): void;
}

/**
 * ข้อผิดพลาดที่รู้สถานะ HTTP ที่จะตอบกลับ — ใช้ในตัว guard ของ route
 * เพื่อให้ catch กลางส่งสถานะที่ถูกต้อง (400/413/500) แทน 500 เสมอ
 */
export class RouteError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "RouteError";
    this.status = status;
  }
}

/** ตรวจว่ามี ANTHROPIC_API_KEY — ไม่งั้นโยน RouteError 500 ก่อนสร้าง client */
export function requireApiKey(): void {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new RouteError(
      500,
      "ยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY ในไฟล์ .env.local"
    );
  }
}

/** Parse multipart form data without leaking runtime/parser messages to clients. */
export async function requireFormData(request: Request): Promise<FormData> {
  try {
    return await request.formData();
  } catch {
    throw new RouteError(400, "รูปแบบคำขอไม่ถูกต้อง");
  }
}

/**
 * เช็คว่า input (เอกสาร + ประวัติ + system) ไม่เกิน context 1M ของโมเดล *ก่อน* เรียกจริง
 * — count_tokens ฟรี จึงกันไว้ที่ทุก paid route ได้ ไม่ใช่แค่ /api/analyze
 * (กันคนยิงตรงมา /summarize หรือ /chat โดยข้ามขั้นประเมินราคา)
 * เกินขีดจำกัด → โยน RouteError 413 (รูปแบบ error เดียวกับที่ /api/analyze ใช้)
 * คืนค่า input_tokens ให้ผู้เรียกใช้ต่อได้ (เช่น /api/analyze ส่งกลับไปโชว์ราคา)
 */
export async function assertWithinContextLimit(
  client: Anthropic,
  params: { messages: Anthropic.MessageParam[]; system?: string }
): Promise<number> {
  const { input_tokens } = await client.messages.countTokens({
    model: MODEL,
    ...params,
  });
  if (input_tokens > MAX_INPUT_TOKENS) {
    throw new RouteError(
      413,
      `เอกสารนี้ยาว ${input_tokens.toLocaleString()} token เกินขีดจำกัด 1M token ของโมเดล — กรุณาแบ่งไฟล์เป็นส่วนย่อยก่อน`
    );
  }
  return input_tokens;
}

/**
 * ดึงไฟล์จาก form พร้อมเช็คชนิดและขนาด (กัน unbounded upload → memory DoS)
 * - ไม่มีไฟล์ / ไม่ใช่ File → 400
 * - ไฟล์ใหญ่เกิน MAX_UPLOAD_BYTES → 413 (เช็คจาก file.size ก่อน buffer)
 */
export function requireFile(form: FormData): File {
  const file = form.get("file");
  if (!(file instanceof File)) {
    throw new RouteError(400, "ไม่พบไฟล์");
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new RouteError(
      413,
      `ไฟล์ใหญ่เกิน ${MAX_UPLOAD_MB}MB — กรุณาแบ่งไฟล์เป็นส่วนย่อยก่อน`
    );
  }
  return file;
}

/**
 * ห่อ MessageStream เป็น streaming Response — รวม logic ที่ซ้ำกันใน
 * /api/summarize และ /api/chat: subscribe on("text"), await finalMessage,
 * ส่ง NDJSON delta + terminal done/error เพื่อให้ client ไม่ตีความ EOF/error เป็นความสำเร็จ
 */
export function streamToResponse(
  msgStream: StreamLike,
  fallbackMsg: string
): Response {
  const encoder = new TextEncoder();
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        msgStream.on("text", (delta) => {
          controller.enqueue(encoder.encode(encodeStreamEvent({ type: "delta", text: delta })));
        });
        await msgStream.finalMessage();
        controller.enqueue(encoder.encode(encodeStreamEvent({ type: "done" })));
        controller.close();
      } catch (err) {
        const message = friendlyError(err, fallbackMsg);
        controller.enqueue(encoder.encode(encodeStreamEvent({ type: "error", message })));
        controller.close();
      }
    },
    cancel() {
      msgStream.abort();
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}
