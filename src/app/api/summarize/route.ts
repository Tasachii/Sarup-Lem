import Anthropic from "@anthropic-ai/sdk";
import { extractFromFile, toUserContent } from "@/lib/extract";
import { MODEL, SYSTEM_PROMPT, SUMMARY_INSTRUCTION } from "@/lib/summarize";

export const runtime = "nodejs";
export const maxDuration = 600;

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

    const msgStream = client.messages.stream({
      model: MODEL,
      max_tokens: 32_000,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      system: SYSTEM_PROMPT,
      messages: [
        { role: "user", content: toUserContent(extracted, SUMMARY_INSTRUCTION) },
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
          const message =
            err instanceof Error ? err.message : "การสรุปล้มเหลวกลางทาง";
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
    const message = err instanceof Error ? err.message : "เกิดข้อผิดพลาด";
    return Response.json({ error: message }, { status: 500 });
  }
}
