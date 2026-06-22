import Anthropic from "@anthropic-ai/sdk";
import { extractFromFile, toUserContent } from "@/lib/extract";
import { MODEL, MAX_INPUT_TOKENS, SUMMARY_INSTRUCTION } from "@/lib/summarize";
import { friendlyError } from "@/lib/errors";
import { RouteError, requireApiKey, requireFile } from "@/lib/route-helpers";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    requireApiKey();

    const form = await request.formData();
    const file = requireFile(form);

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
    if (err instanceof RouteError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    return Response.json(
      { error: friendlyError(err, "เกิดข้อผิดพลาดในการอ่านไฟล์") },
      { status: 500 }
    );
  }
}
