import { describe, it, expect, vi, beforeEach } from "vitest";

// SDK mock ต้องอยู่ใน vi.hoisted (รันก่อน import) และห้ามอ้าง import ภายนอก
const mock = vi.hoisted(() => {
  const stream = vi.fn();
  const countTokens = vi.fn();
  // function ปกติ (ไม่ใช่ arrow) เพื่อให้ `new Anthropic()` construct ได้
  const ctor = vi.fn(function (this: unknown) {
    return { messages: { stream, countTokens } };
  });
  return { stream, countTokens, ctor };
});
vi.mock("@anthropic-ai/sdk", () => ({ default: mock.ctor }));

import { POST } from "@/app/api/analyze/route";

function formWithFile(content = "เนื้อหาเอกสารทดสอบ", name = "doc.txt"): FormData {
  const form = new FormData();
  form.append("file", new File([content], name, { type: "text/plain" }));
  return form;
}

function postReq(form: FormData): Request {
  return new Request("http://localhost/api/analyze", {
    method: "POST",
    body: form,
  });
}

beforeEach(() => {
  mock.ctor.mockClear();
  mock.stream.mockReset();
  mock.countTokens.mockReset();
  mock.countTokens.mockResolvedValue({ input_tokens: 1234 });
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
});

describe("/api/analyze", () => {
  it("200 happy path → {fileName, kind, inputTokens}", async () => {
    mock.countTokens.mockResolvedValue({ input_tokens: 1234 });
    const res = await POST(postReq(formWithFile()));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      fileName: "doc.txt",
      kind: "text",
      inputTokens: 1234,
    });
    // cost ไม่อยู่ใน response (คำนวณฝั่ง client)
    expect(body).not.toHaveProperty("cost");
    expect(body).not.toHaveProperty("usd");
  });

  it("413 when inputTokens exceeds MAX_INPUT_TOKENS, error contains the count", async () => {
    mock.countTokens.mockResolvedValue({ input_tokens: 1_000_000 });
    const res = await POST(postReq(formWithFile()));
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error).toContain((1_000_000).toLocaleString());
  });

  it("boundary: exactly 950_000 → 200 (strict >)", async () => {
    mock.countTokens.mockResolvedValue({ input_tokens: 950_000 });
    const res = await POST(postReq(formWithFile()));
    expect(res.status).toBe(200);
  });

  it("boundary: 950_001 → 413", async () => {
    mock.countTokens.mockResolvedValue({ input_tokens: 950_001 });
    const res = await POST(postReq(formWithFile()));
    expect(res.status).toBe(413);
  });

  it("400 when no file field", async () => {
    const res = await POST(postReq(new FormData()));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("ไม่พบไฟล์");
  });

  it("400 when file field is a string, not a File", async () => {
    const form = new FormData();
    form.append("file", "i am a string");
    const res = await POST(postReq(form));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("ไม่พบไฟล์");
  });

  it("500 when ANTHROPIC_API_KEY missing — SDK never constructed", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const res = await POST(postReq(formWithFile()));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain("ANTHROPIC_API_KEY");
    expect(mock.ctor).not.toHaveBeenCalled();
  });

  it("500 when extraction throws (unsupported file)", async () => {
    const form = new FormData();
    form.append("file", new File(["x"], "data.csv"));
    const res = await POST(postReq(form));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain("รองรับเฉพาะไฟล์");
  });

  it("uses MODEL when counting tokens", async () => {
    mock.countTokens.mockResolvedValue({ input_tokens: 10 });
    await POST(postReq(formWithFile()));
    expect(mock.countTokens).toHaveBeenCalledOnce();
    const arg = mock.countTokens.mock.calls[0][0] as { model: string };
    expect(arg.model).toBe("claude-sonnet-4-6");
  });
});
