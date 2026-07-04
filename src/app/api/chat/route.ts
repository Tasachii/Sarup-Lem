import Anthropic from "@anthropic-ai/sdk";
import { extractFromFile, toUserContent } from "@/lib/extract";
import { MODEL, QA_SYSTEM_PROMPT } from "@/lib/summarize";
import { friendlyError } from "@/lib/errors";
import {
  RouteError,
  requireApiKey,
  requireFile,
  streamToResponse,
  assertWithinContextLimit,
} from "@/lib/route-helpers";

export const runtime = "nodejs";
export const maxDuration = 300;

// กันประวัติแชตที่ client ส่งมาบวมเกินจริง → กัน credit-drain จาก context ที่ผู้ใช้คุมเอง
export const MAX_HISTORY_TURNS = 50;
export const MAX_TURN_CONTENT_CHARS = 20_000;

type ChatTurn = { role: "user" | "assistant"; content: string };

export function isChatTurn(v: unknown): v is ChatTurn {
  if (typeof v !== "object" || v === null) return false;
  const t = v as Record<string, unknown>;
  return (
    (t.role === "user" || t.role === "assistant") &&
    typeof t.content === "string" &&
    t.content.length <= MAX_TURN_CONTENT_CHARS
  );
}

export async function POST(request: Request) {
  try {
    requireApiKey();

    const form = await request.formData();
    const file = requireFile(form);

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
    if (history.length > MAX_HISTORY_TURNS) {
      return Response.json(
        { error: "ประวัติการสนทนายาวเกินไป — กรุณาเริ่มแชตใหม่" },
        { status: 400 }
      );
    }
    if (question.length > MAX_TURN_CONTENT_CHARS) {
      return Response.json(
        { error: "คำถามยาวเกินไป" },
        { status: 400 }
      );
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

    // กัน paid call ถ้ายิงตรงมาแล้ว เอกสาร + ประวัติ เกิน context 1M
    await assertWithinContextLimit(client, {
      messages,
      system: QA_SYSTEM_PROMPT,
    });

    const msgStream = client.messages.stream({
      model: MODEL,
      max_tokens: 8_000,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      system: QA_SYSTEM_PROMPT,
      messages,
    });

    return streamToResponse(msgStream, "การตอบล้มเหลวกลางทาง");
  } catch (err) {
    if (err instanceof RouteError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    return Response.json(
      { error: friendlyError(err, "เกิดข้อผิดพลาด") },
      { status: 500 }
    );
  }
}
