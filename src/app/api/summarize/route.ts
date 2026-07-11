import Anthropic from "@anthropic-ai/sdk";
import { ExtractError, extractFromFile, toUserContent } from "@/lib/extract";
import {
  MODEL,
  SYSTEM_PROMPT,
  SUMMARY_INSTRUCTIONS,
  LEVELS,
  type DetailLevel,
} from "@/lib/summarize";
import { friendlyError } from "@/lib/errors";
import {
  RouteError,
  requireApiKey,
  requireFile,
  streamToResponse,
  assertWithinContextLimit,
  requireFormData,
} from "@/lib/route-helpers";

export const runtime = "nodejs";
export const maxDuration = 300;

export function isLevel(v: unknown): v is DetailLevel {
  return v === "brief" || v === "standard" || v === "detailed";
}

export async function POST(request: Request) {
  try {
    requireApiKey();

    const form = await requireFormData(request);
    const file = requireFile(form);
    const rawLevel = form.get("level");
    if (rawLevel !== null && !isLevel(rawLevel)) {
      throw new RouteError(400, "ระดับความละเอียดไม่ถูกต้อง — เลือก brief, standard หรือ detailed");
    }
    const level: DetailLevel = rawLevel ?? "standard";

    const extracted = await extractFromFile(file);
    const client = new Anthropic();

    const messages: Anthropic.MessageParam[] = [
      {
        role: "user",
        content: toUserContent(extracted, SUMMARY_INSTRUCTIONS[level]),
      },
    ];
    // กัน paid call ถ้ายิงตรงมาโดยข้าม /api/analyze แล้ว input เกิน context 1M
    await assertWithinContextLimit(client, { messages, system: SYSTEM_PROMPT });

    const msgStream = client.messages.stream({
      model: MODEL,
      max_tokens: LEVELS[level].maxTokens,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      system: SYSTEM_PROMPT,
      messages,
    });

    return streamToResponse(msgStream, "การสรุปล้มเหลวกลางทาง");
  } catch (err) {
    if (err instanceof RouteError || err instanceof ExtractError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    return Response.json(
      { error: friendlyError(err, "เกิดข้อผิดพลาด") },
      { status: 500 }
    );
  }
}
