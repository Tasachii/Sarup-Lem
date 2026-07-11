import Anthropic from "@anthropic-ai/sdk";
import { ExtractError, extractFromFile, toUserContent } from "@/lib/extract";
import { SUMMARY_INSTRUCTION, SYSTEM_PROMPT } from "@/lib/summarize";
import { friendlyError } from "@/lib/errors";
import {
  RouteError,
  requireApiKey,
  requireFile,
  assertWithinContextLimit,
  requireFormData,
} from "@/lib/route-helpers";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    requireApiKey();

    const form = await requireFormData(request);
    const file = requireFile(form);

    const extracted = await extractFromFile(file);
    const client = new Anthropic();

    // นับ input จริงที่จะส่งตอนสรุป: เอกสาร + คำสั่ง + system prompt (กันประเมินราคาต่ำไป)
    const inputTokens = await assertWithinContextLimit(client, {
      messages: [{ role: "user", content: toUserContent(extracted, SUMMARY_INSTRUCTION) }],
      system: SYSTEM_PROMPT,
    });

    // ค่าใช้จ่ายคำนวณฝั่ง client ตามระดับความละเอียดที่เลือก (estimateCost ใน lib/summarize)
    return Response.json({
      fileName: file.name,
      kind: extracted.kind,
      inputTokens,
    });
  } catch (err) {
    if (err instanceof RouteError || err instanceof ExtractError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    return Response.json(
      { error: friendlyError(err, "เกิดข้อผิดพลาดในการอ่านไฟล์") },
      { status: 500 }
    );
  }
}
