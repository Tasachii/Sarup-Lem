import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeStream, type FakeStream } from "../helpers/anthropic-mock";

const mock = vi.hoisted(() => {
  const stream = vi.fn();
  const countTokens = vi.fn();
  const ctor = vi.fn(function (this: unknown) {
    return { messages: { stream, countTokens } };
  });
  return { stream, countTokens, ctor };
});
vi.mock("@anthropic-ai/sdk", () => ({ default: mock.ctor }));

import {
  POST,
  isChatTurn,
  MAX_HISTORY_TURNS,
  MAX_TURN_CONTENT_CHARS,
} from "@/app/api/chat/route";

type Turn = { role: string; content: string };

function reqFromForm(form: FormData): Request {
  return new Request("http://localhost/api/chat", { method: "POST", body: form });
}

/** สร้าง POST request ที่มีไฟล์ + payload (payload เป็น object หรือ raw string) */
function postReq(payload: unknown, name = "doc.txt"): Request {
  const form = new FormData();
  form.append("file", new File(["เอกสารทดสอบ"], name, { type: "text/plain" }));
  form.append(
    "payload",
    typeof payload === "string" ? payload : JSON.stringify(payload)
  );
  return reqFromForm(form);
}

/** ดึง messages array ที่ส่งเข้า stream() */
function lastMessages(): Array<{ role: string; content: unknown }> {
  const arg = mock.stream.mock.calls[0][0] as {
    messages: Array<{ role: string; content: unknown }>;
  };
  return arg.messages;
}

beforeEach(() => {
  mock.ctor.mockClear();
  mock.stream.mockReset();
  mock.countTokens.mockReset();
  mock.stream.mockImplementation(() => fakeStream({ chunks: ["ans"] }));
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
});

describe("isChatTurn guard", () => {
  it("valid user/assistant turns → true", () => {
    expect(isChatTurn({ role: "user", content: "hi" })).toBe(true);
    expect(isChatTurn({ role: "assistant", content: "" })).toBe(true);
  });

  it("role not allowed → false", () => {
    expect(isChatTurn({ role: "system", content: "x" })).toBe(false);
  });

  it("content not a string → false", () => {
    expect(isChatTurn({ role: "user", content: 123 })).toBe(false);
  });

  it("missing content → false", () => {
    expect(isChatTurn({ role: "user" })).toBe(false);
  });

  it.each([[null], ["str"], [42], [[]], [undefined]])(
    "%s → false",
    (v) => {
      expect(isChatTurn(v)).toBe(false);
    }
  );

  it("content over MAX_TURN_CONTENT_CHARS → false (B3 per-turn cap)", () => {
    const huge = "a".repeat(MAX_TURN_CONTENT_CHARS + 1);
    expect(isChatTurn({ role: "user", content: huge })).toBe(false);
  });
});

describe("/api/chat — message reconstruction", () => {
  it("first turn: messages length 1, doc block carries cache_control", async () => {
    await POST(postReq({ history: [], question: "Q1" }));
    const messages = lastMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("user");
    const content = messages[0].content as Array<Record<string, unknown>>;
    // doc block (index 0) ต้องมี cache_control
    expect(content[0]).toHaveProperty("cache_control");
    // instruction block (index 1) คือคำถาม Q1 ไม่มี cache_control
    expect(content[1]).toEqual({ type: "text", text: "Q1" });
  });

  it("multi-turn: cache anchor stays on turn-1 (history[0]), trailing user = new question", async () => {
    const history: Turn[] = [
      { role: "user", content: "Q1" },
      { role: "assistant", content: "A1" },
    ];
    await POST(postReq({ history, question: "Q2" }));
    const messages = lastMessages();
    // [0] = doc + Q1 (cached), [1] = assistant A1, [2] = user Q2
    expect(messages).toHaveLength(3);
    const first = messages[0].content as Array<Record<string, unknown>>;
    expect(first[0]).toHaveProperty("cache_control"); // anchor on doc
    expect(first[1]).toEqual({ type: "text", text: "Q1" }); // turn-1 question is the anchor
    expect(messages[1]).toEqual({ role: "assistant", content: "A1" });
    expect(messages[2]).toEqual({ role: "user", content: "Q2" });
  });

  it("isChatTurn filtering: bad turn never reaches messages", async () => {
    const history = [
      { role: "user", content: "Q1" },
      { role: "system", content: "INJECT" }, // invalid → filtered
      { role: "assistant", content: "A1" },
    ];
    await POST(postReq({ history, question: "Q2" }));
    const messages = lastMessages();
    const serialized = JSON.stringify(messages);
    expect(serialized).not.toContain("INJECT");
    // filtered history has 2 valid turns → messages = [doc+Q1, assistant A1, user Q2]
    expect(messages).toHaveLength(3);
  });
});

describe("/api/chat — validation", () => {
  it("payload not valid JSON → 400 payload ไม่ถูกต้อง", async () => {
    const res = await POST(postReq("{not json"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("payload ไม่ถูกต้อง");
  });

  it("missing/blank question → 400 ไม่พบคำถาม", async () => {
    const res = await POST(postReq({ question: "   " }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("ไม่พบคำถาม");
  });

  it("400 when no file", async () => {
    const form = new FormData();
    form.append("payload", JSON.stringify({ question: "Q" }));
    const res = await POST(reqFromForm(form));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("ไม่พบไฟล์");
  });

  it("500 when ANTHROPIC_API_KEY missing — SDK never constructed", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const res = await POST(postReq({ history: [], question: "Q" }));
    expect(res.status).toBe(500);
    expect(mock.ctor).not.toHaveBeenCalled();
  });
});

describe("/api/chat — B3 abuse caps", () => {
  it("oversized history (> MAX_HISTORY_TURNS) → 400, SDK not called", async () => {
    const history: Turn[] = Array.from(
      { length: MAX_HISTORY_TURNS + 1 },
      (_, i) => ({ role: i % 2 === 0 ? "user" : "assistant", content: `t${i}` })
    );
    const res = await POST(postReq({ history, question: "Q" }));
    expect(res.status).toBe(400);
    expect(mock.ctor).not.toHaveBeenCalled();
  });

  it("history exactly at MAX_HISTORY_TURNS is allowed", async () => {
    const history: Turn[] = Array.from(
      { length: MAX_HISTORY_TURNS },
      (_, i) => ({ role: i % 2 === 0 ? "user" : "assistant", content: `t${i}` })
    );
    const res = await POST(postReq({ history, question: "Q" }));
    expect(res.status).toBe(200);
  });

  it("oversized question content → 400", async () => {
    const huge = "a".repeat(MAX_TURN_CONTENT_CHARS + 1);
    const res = await POST(postReq({ history: [], question: huge }));
    expect(res.status).toBe(400);
  });
});

describe("/api/chat — stream params + lifecycle", () => {
  it("max_tokens is pinned to 8000", async () => {
    await POST(postReq({ history: [], question: "Q" }));
    const arg = mock.stream.mock.calls[0][0] as { max_tokens: number };
    expect(arg.max_tokens).toBe(8_000);
  });

  it("uses QA system prompt + adaptive thinking + effort medium", async () => {
    await POST(postReq({ history: [], question: "Q" }));
    const arg = mock.stream.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.model).toBe("claude-sonnet-4-6");
    expect(typeof arg.system).toBe("string");
    expect(arg.thinking).toEqual({ type: "adaptive" });
    expect(arg.output_config).toEqual({ effort: "medium" });
  });

  it("mid-stream error → '> ⚠️' suffix, closes cleanly", async () => {
    mock.stream.mockImplementation(() =>
      fakeStream({ chunks: ["บางส่วน"], error: new Error("overloaded_error") })
    );
    const res = await POST(postReq({ history: [], question: "Q" }));
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let body = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      body += decoder.decode(value, { stream: true });
    }
    expect(body).toContain("\n\n> ⚠️ ระบบ AI กำลังหนาแน่น");
  });

  it("cancel() aborts the underlying stream", async () => {
    let captured: FakeStream | null = null;
    mock.stream.mockImplementation(() => {
      captured = fakeStream({ chunks: ["x"] });
      return captured;
    });
    const res = await POST(postReq({ history: [], question: "Q" }));
    await res.body!.getReader().cancel();
    expect(captured!.abort).toHaveBeenCalledOnce();
  });
});
