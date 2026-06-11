import Anthropic from "@anthropic-ai/sdk";
import { extractFromFile, toUserContent } from "@/lib/extract";
import { MODEL, MAX_INPUT_TOKENS, SUMMARY_INSTRUCTION } from "@/lib/summarize";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return Response.json(
        { error: "ยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY ในไฟล์ .env.local" },
        { status: 500 }
      );
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return Response.json({ error: "ไม่พบไฟล์" }, { status: 400 });
    }

    const extracted = await extractFromFile(file);
    const client = new Anthropic();

    const count = await client.messages.countTokens({
      model: MODEL,
      messages: [{ role: "user", content: toUserContent(extracted, SUMMARY_INSTRUCTION) }],
    });

    const inputTokens = count.input_tokens;
    if (inputTokens > MAX_INPUT_TOKENS) {
      return Response.json(
        {
          error: `เอกสารนี้ยาว ${inputTokens.toLocaleString()} token เกินขีดจำกัด 1M token ของโมเดล — กรุณาแบ่งไฟล์เป็นส่วนย่อยก่อน`,
        },
        { status: 413 }
      );
    }

    // ค่าใช้จ่ายคำนวณฝั่ง client ตามระดับความละเอียดที่เลือก (estimateCost ใน lib/summarize)
    return Response.json({
      fileName: file.name,
      kind: extracted.kind,
      inputTokens,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "เกิดข้อผิดพลาดในการอ่านไฟล์";
    return Response.json({ error: message }, { status: 500 });
  }
}
