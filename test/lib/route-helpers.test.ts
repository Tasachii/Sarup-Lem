import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  RouteError,
  requireApiKey,
  requireFile,
  streamToResponse,
} from "@/lib/route-helpers";
import { MAX_UPLOAD_BYTES } from "@/lib/extract";
import { consumeStreamResponse } from "@/lib/stream-protocol";
import { fakeStream } from "../helpers/anthropic-mock";

describe("RouteError", () => {
  it("carries status and message", () => {
    const e = new RouteError(418, "teapot");
    expect(e).toBeInstanceOf(Error);
    expect(e.status).toBe(418);
    expect(e.message).toBe("teapot");
    expect(e.name).toBe("RouteError");
  });
});

describe("requireApiKey", () => {
  beforeEach(() => vi.unstubAllEnvs());

  it("throws RouteError 500 when key missing", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(() => requireApiKey()).toThrowError(RouteError);
    try {
      requireApiKey();
    } catch (e) {
      expect((e as RouteError).status).toBe(500);
      expect((e as RouteError).message).toContain("ANTHROPIC_API_KEY");
    }
  });

  it("does not throw when key present", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-x");
    expect(() => requireApiKey()).not.toThrow();
  });
});

describe("requireFile", () => {
  it("returns the File when valid", () => {
    const form = new FormData();
    const f = new File(["hi"], "a.txt");
    form.append("file", f);
    expect(requireFile(form)).toBe(f);
  });

  it("throws RouteError 400 when missing", () => {
    try {
      requireFile(new FormData());
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(RouteError);
      expect((e as RouteError).status).toBe(400);
    }
  });

  it("throws RouteError 400 when not a File", () => {
    const form = new FormData();
    form.append("file", "string-not-file");
    try {
      requireFile(form);
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as RouteError).status).toBe(400);
    }
  });

  it("throws RouteError 413 when file exceeds MAX_UPLOAD_BYTES", () => {
    const big = new File(["x"], "huge.txt");
    Object.defineProperty(big, "size", { value: MAX_UPLOAD_BYTES + 1 });
    const form = new FormData();
    form.append("file", big);
    try {
      requireFile(form);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(RouteError);
      expect((e as RouteError).status).toBe(413);
      expect((e as RouteError).message).toMatch(/ไฟล์ใหญ่เกิน/);
    }
  });

  it("allows file exactly at MAX_UPLOAD_BYTES (boundary)", () => {
    const atCap = new File(["x"], "ok.txt");
    Object.defineProperty(atCap, "size", { value: MAX_UPLOAD_BYTES });
    const form = new FormData();
    form.append("file", atCap);
    expect(requireFile(form)).toBe(atCap);
  });
});

describe("streamToResponse", () => {
  it("assembles streamed chunks and sets streaming headers", async () => {
    const stream = fakeStream({ chunks: ["A", "B", "C"] });
    const res = streamToResponse(stream, "fallback");
    expect(res.headers.get("Content-Type")).toBe("application/x-ndjson; charset=utf-8");
    expect(res.headers.get("Cache-Control")).toBe("no-cache");
    expect(res.headers.get("X-Accel-Buffering")).toBe("no");
    expect(await consumeStreamResponse(res, () => {})).toBe("ABC");
  });

  it("reports a typed terminal error after partial output", async () => {
    const stream = fakeStream({
      chunks: ["partial"],
      error: new Error("overloaded_error"),
    });
    const res = streamToResponse(stream, "การสรุปล้มเหลวกลางทาง");
    let partial = "";
    await expect(
      consumeStreamResponse(res, (_delta, accumulated) => { partial = accumulated; })
    ).rejects.toThrow("ระบบ AI กำลังหนาแน่น");
    expect(partial).toBe("partial");
  });

  it("falls back to fallbackMsg when error is unrecognized", async () => {
    const stream = fakeStream({ error: new Error("") });
    const res = streamToResponse(stream, "MY_FALLBACK");
    await expect(consumeStreamResponse(res, () => {})).rejects.toThrow("MY_FALLBACK");
  });

  it("cancel() aborts the underlying stream", async () => {
    const stream = fakeStream({ chunks: ["x"] });
    const res = streamToResponse(stream, "fallback");
    const reader = res.body!.getReader();
    await reader.cancel();
    expect(stream.abort).toHaveBeenCalledOnce();
  });
});
