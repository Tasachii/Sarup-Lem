import Anthropic from "@anthropic-ai/sdk";
import { extractFromFile, toUserContent } from "@/lib/extract";
import { MODEL, QA_SYSTEM_PROMPT } from "@/lib/summarize";

export const runtime = "nodejs";
export const maxDuration = 300;

type ChatTurn = { role: "user" | "assistant"; content: string };

function isChatTurn(v: unknown): v is ChatTurn {
  if (typeof v !== "object" || v === null) return false;
  const t = v as Record<string, unknown>;
  return (
    (t.role === "user" || t.role === "assistant") &&
    typeof t.content === "string"
  );
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

    let history: ChatTurn[] = [];
    let question = "";
    try {
      const payload = JSON.parse(String(form.get("payload") ?? "{}"));
      if (Array.isArray(payload.history)) {
        history = payload.history.filter(isChatTurn);
      }
      question = String(payload.question ?? "").trim();
    } catch {
      return Response.json({ error: "payload ไม่ถูกต้อง" }, { status: 400 });
    }
    if (!question) {
      return Response.json({ error: "ไม่พบคำถาม" }, { status: 400 });
    }

    const extracted = await extractFromFile(file);
    const client = new Anthropic();

    // เทิร์นแรกฝังเอกสารพร้อม cache_control — คำถามถัดๆ ไปอ่านเอกสารจาก cache (ถูกลง ~90%)
    const firstQuestion = history.length > 0 ? history[0].content : question;
    const messages: Anthropic.MessageParam[] = [
      {
        role: "user",
        content: toUserContent(extracted, firstQuestion, { cache: true }),
      },
    ];
    for (let i = 1; i < history.length; i++) {
      messages.push({ role: history[i].role, content: history[i].content });
    }
    if (history.length > 0) {
      messages.push({ role: "user", content: question });
    }

    const msgStream = client.messages.stream({
      model: MODEL,
      max_tokens: 8_000,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      system: QA_SYSTEM_PROMPT,
      messages,
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
            err instanceof Error ? err.message : "การตอบล้มเหลวกลางทาง";
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
