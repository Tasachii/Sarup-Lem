import Anthropic from "@anthropic-ai/sdk";
import { extractFromFile, toUserContent } from "@/lib/extract";
import {
  MODEL,
  SYSTEM_PROMPT,
  SUMMARY_INSTRUCTIONS,
  LEVELS,
  type DetailLevel,
} from "@/lib/summarize";
import { friendlyError } from "@/lib/errors";

export const runtime = "nodejs";
export const maxDuration = 600;

function isLevel(v: unknown): v is DetailLevel {
  return v === "brief" || v === "standard" || v === "detailed";
}

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
    const rawLevel = form.get("level");
    const level: DetailLevel = isLevel(rawLevel) ? rawLevel : "standard";

    const extracted = await extractFromFile(file);
    const client = new Anthropic();

    const msgStream = client.messages.stream({
      model: MODEL,
      max_tokens: LEVELS[level].maxTokens,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: toUserContent(extracted, SUMMARY_INSTRUCTIONS[level]),
        },
      ],
    });

    const encoder = new TextEncoder();
    const readable = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          msgStream.on("text", (delta) => {
            controller.enqueue(encoder.encode(delta));
          });
          await msgStream.finalMessage();
          controller.close();
        } catch (err) {
          const message = friendlyError(err, "การสรุปล้มเหลวกลางทาง");
          controller.enqueue(encoder.encode(`\n\n> ⚠️ ${message}`));
          controller.close();
        }
      },
      cancel() {
        msgStream.abort();
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    return Response.json(
      { error: friendlyError(err, "เกิดข้อผิดพลาด") },
      { status: 500 }
    );
  }
}
