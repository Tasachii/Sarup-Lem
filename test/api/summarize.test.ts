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

import { POST, isLevel } from "@/app/api/summarize/route";

function buildForm(opts: { content?: string; level?: string; name?: string } = {}): FormData {
  const form = new FormData();
  form.append(
    "file",
    new File([opts.content ?? "เอกสารทดสอบ"], opts.name ?? "doc.txt", {
      type: "text/plain",
    })
  );
  if (opts.level !== undefined) form.append("level", opts.level);
  return form;
}

function postReq(form: FormData): Request {
  return new Request("http://localhost/api/summarize", {
    method: "POST",
    body: form,
  });
}

async function readAll(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

beforeEach(() => {
  mock.ctor.mockClear();
  mock.stream.mockReset();
  mock.countTokens.mockReset();
  mock.stream.mockImplementation(() => fakeStream({ chunks: ["x"] }));
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
});

describe("isLevel guard", () => {
  it.each(["brief", "standard", "detailed"])("%s → true", (v) => {
    expect(isLevel(v)).toBe(true);
  });

  it.each([["Brief"], ["long"], [""], [null], [undefined], [42], [{}]])(
    "%s → false",
    (v) => {
      expect(isLevel(v)).toBe(false);
    }
  );
});

describe("/api/summarize", () => {
  it("streams assembled body ABC with correct headers", async () => {
    mock.stream.mockImplementation(() => fakeStream({ chunks: ["A", "B", "C"] }));
    const res = await POST(postReq(buildForm()));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(res.headers.get("Cache-Control")).toBe("no-cache");
    expect(res.headers.get("X-Accel-Buffering")).toBe("no");
    expect(await readAll(res)).toBe("ABC");
  });

  it("mid-stream error → body ends with '> ⚠️ <overloaded friendly>' and closes (no 500)", async () => {
    mock.stream.mockImplementation(() =>
      fakeStream({ chunks: ["บางส่วน"], error: new Error("overloaded_error") })
    );
    const res = await POST(postReq(buildForm()));
    expect(res.status).toBe(200);
    const body = await readAll(res);
    expect(body).toContain("บางส่วน");
    expect(body).toContain("\n\n> ⚠️ ระบบ AI กำลังหนาแน่น");
  });

  it("cancel() invokes the stream's abort()", async () => {
    let captured: FakeStream | null = null;
    mock.stream.mockImplementation(() => {
      captured = fakeStream({ chunks: ["x"] });
      return captured;
    });
    const res = await POST(postReq(buildForm()));
    const reader = res.body!.getReader();
    await reader.cancel();
    expect(captured!.abort).toHaveBeenCalledOnce();
  });

  it("400 when no file", async () => {
    const res = await POST(postReq(new FormData()));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("ไม่พบไฟล์");
  });

  it("500 when ANTHROPIC_API_KEY missing — SDK never constructed", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const res = await POST(postReq(buildForm()));
    expect(res.status).toBe(500);
    expect(mock.ctor).not.toHaveBeenCalled();
  });

  describe("level fallback (isLevel) controls max_tokens", () => {
    it("bogus level → standard (max_tokens 32000)", async () => {
      await POST(postReq(buildForm({ level: "bogus" })));
      const arg = mock.stream.mock.calls[0][0] as { max_tokens: number };
      expect(arg.max_tokens).toBe(32_000);
    });

    it("detailed → max_tokens 56000", async () => {
      await POST(postReq(buildForm({ level: "detailed" })));
      const arg = mock.stream.mock.calls[0][0] as { max_tokens: number };
      expect(arg.max_tokens).toBe(56_000);
    });

    it("brief → max_tokens 8000", async () => {
      await POST(postReq(buildForm({ level: "brief" })));
      const arg = mock.stream.mock.calls[0][0] as { max_tokens: number };
      expect(arg.max_tokens).toBe(8_000);
    });

    it("level absent → standard (32000)", async () => {
      await POST(postReq(buildForm()));
      const arg = mock.stream.mock.calls[0][0] as { max_tokens: number };
      expect(arg.max_tokens).toBe(32_000);
    });
  });

  it("stream params: model, system, thinking adaptive, effort medium", async () => {
    await POST(postReq(buildForm()));
    const arg = mock.stream.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.model).toBe("claude-sonnet-4-6");
    expect(typeof arg.system).toBe("string");
    expect((arg.system as string).length).toBeGreaterThan(0);
    expect(arg.thinking).toEqual({ type: "adaptive" });
    expect(arg.output_config).toEqual({ effort: "medium" });
  });
});
