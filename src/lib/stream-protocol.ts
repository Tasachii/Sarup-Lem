export type StreamEvent =
  | { type: "delta"; text: string }
  | { type: "done" }
  | { type: "error"; message: string };

export function encodeStreamEvent(event: StreamEvent): string {
  return `${JSON.stringify(event)}\n`;
}

function parseStreamEvent(line: string): StreamEvent {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new Error("ข้อมูลสตรีมจากเซิร์ฟเวอร์ไม่ถูกต้อง");
  }
  if (!value || typeof value !== "object") {
    throw new Error("ข้อมูลสตรีมจากเซิร์ฟเวอร์ไม่ถูกต้อง");
  }
  const event = value as Record<string, unknown>;
  if (event.type === "done") return { type: "done" };
  if (event.type === "delta" && typeof event.text === "string") {
    return { type: "delta", text: event.text };
  }
  if (event.type === "error" && typeof event.message === "string") {
    return { type: "error", message: event.message };
  }
  throw new Error("ข้อมูลสตรีมจากเซิร์ฟเวอร์ไม่ถูกต้อง");
}

/** Consume NDJSON deltas and require an explicit terminal event before treating output as complete. */
export async function consumeStreamResponse(
  response: Response,
  onDelta: (text: string, accumulated: string) => void,
): Promise<string> {
  if (!response.body) throw new Error("ไม่ได้รับข้อมูลจากเซิร์ฟเวอร์");
  if (!response.headers.get("Content-Type")?.includes("application/x-ndjson")) {
    throw new Error("รูปแบบสตรีมจากเซิร์ฟเวอร์ไม่ถูกต้อง");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let accumulated = "";
  let terminal = false;

  const processLine = (line: string) => {
    if (!line.trim()) return;
    if (terminal) throw new Error("ได้รับข้อมูลหลังสตรีมสิ้นสุด");
    const event = parseStreamEvent(line);
    if (event.type === "delta") {
      accumulated += event.text;
      onDelta(event.text, accumulated);
    } else if (event.type === "error") {
      terminal = true;
      throw new Error(event.message);
    } else {
      terminal = true;
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) processLine(line);
    if (done) break;
  }
  if (buffer.trim()) processLine(buffer);
  if (!terminal) throw new Error("การเชื่อมต่อขาดก่อนสตรีมเสร็จสมบูรณ์");
  return accumulated;
}
