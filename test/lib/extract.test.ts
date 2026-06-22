import { describe, it, expect, vi, beforeEach } from "vitest";

// mock unpdf + mammoth เพื่อคุม text layer / docx ในเคส boundary
const extractTextMock = vi.fn();
const getDocumentProxyMock = vi.fn((..._args: unknown[]) => Promise.resolve({}));
vi.mock("unpdf", () => ({
  extractText: (...args: unknown[]) => extractTextMock(...args),
  getDocumentProxy: (...args: unknown[]) => getDocumentProxyMock(...args),
}));

const mammothExtractMock = vi.fn();
vi.mock("mammoth", () => ({
  default: {
    extractRawText: (...args: unknown[]) => mammothExtractMock(...args),
  },
}));

import {
  toUserContent,
  extractFromFile,
  MAX_UPLOAD_BYTES,
  type Extracted,
} from "@/lib/extract";

function textFile(name: string, content: string): File {
  return new File([content], name, { type: "text/plain" });
}

/**
 * สร้าง File ปลอมที่ size ใหญ่ โดย stub arrayBuffer ให้คืน ArrayBuffer
 * ที่มี byteLength ตามต้องการ (ใช้ทดสอบ branch native-pdf > 20MB โดยไม่จองจริงเกินจำเป็น)
 */
function fakeLargeFile(name: string, size: number, bufferByteLength: number): File {
  const f = new File([], name);
  Object.defineProperty(f, "size", { value: size });
  Object.defineProperty(f, "arrayBuffer", {
    value: async () => new ArrayBuffer(bufferByteLength),
  });
  return f;
}

beforeEach(() => {
  extractTextMock.mockReset();
  getDocumentProxyMock.mockReset();
  getDocumentProxyMock.mockResolvedValue({});
  mammothExtractMock.mockReset();
});

describe("toUserContent — cache block placement", () => {
  it("text + cache: doc block carries cache_control, instruction does NOT", () => {
    const blocks = toUserContent({ kind: "text", text: "X" }, "Q", { cache: true });
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({
      type: "text",
      text: "<document>\nX\n</document>",
      cache_control: { type: "ephemeral" },
    });
    expect(blocks[1]).toEqual({ type: "text", text: "Q" });
    expect(blocks[1]).not.toHaveProperty("cache_control");
  });

  it("text + no cache (opts omitted): doc block has no cache_control", () => {
    const blocks = toUserContent({ kind: "text", text: "X" }, "Q");
    expect(blocks[0]).not.toHaveProperty("cache_control");
    expect(blocks[0]).toMatchObject({
      type: "text",
      text: "<document>\nX\n</document>",
    });
  });

  it("pdf-native + cache: document block with base64 source + cache_control", () => {
    const blocks = toUserContent(
      { kind: "pdf-native", base64: "QUJD" },
      "Q",
      { cache: true }
    );
    expect(blocks[0]).toEqual({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: "QUJD" },
      cache_control: { type: "ephemeral" },
    });
  });

  it("pdf-native + no cache: document block without cache_control", () => {
    const blocks = toUserContent({ kind: "pdf-native", base64: "QUJD" }, "Q");
    expect(blocks[0]).not.toHaveProperty("cache_control");
    expect(blocks[0]).toMatchObject({ type: "document" });
  });

  it("wraps the raw text in exactly one <document> envelope", () => {
    const blocks = toUserContent({ kind: "text", text: "hello world" }, "Q");
    const block0 = blocks[0] as { text: string };
    const opens = block0.text.match(/<document>/g) ?? [];
    const closes = block0.text.match(/<\/document>/g) ?? [];
    expect(opens).toHaveLength(1);
    expect(closes).toHaveLength(1);
    expect(block0.text).toBe("<document>\nhello world\n</document>");
  });
});

describe("extractFromFile — text types", () => {
  it(".txt non-empty → {kind:'text'} trimmed", async () => {
    const r = await extractFromFile(textFile("a.txt", "  hello  "));
    expect(r).toEqual({ kind: "text", text: "hello" });
  });

  it(".md non-empty → {kind:'text'}", async () => {
    const r = await extractFromFile(textFile("a.md", "# Title\nbody"));
    expect(r.kind).toBe("text");
  });

  it("empty .txt → throws ไฟล์ว่างเปล่า", async () => {
    await expect(extractFromFile(textFile("a.txt", ""))).rejects.toThrow(
      "ไฟล์ว่างเปล่า"
    );
  });

  it("whitespace-only .txt → throws ไฟล์ว่างเปล่า", async () => {
    await expect(extractFromFile(textFile("a.txt", "   \n  "))).rejects.toThrow(
      "ไฟล์ว่างเปล่า"
    );
  });

  it("uppercase .TXT extension is handled (name.toLowerCase)", async () => {
    const r = await extractFromFile(textFile("DOC.TXT", "content here"));
    expect(r.kind).toBe("text");
  });
});

describe("extractFromFile — docx", () => {
  it(".docx with text → {kind:'text'}", async () => {
    mammothExtractMock.mockResolvedValue({ value: "  เนื้อหา DOCX  " });
    const r = await extractFromFile(textFile("a.docx", "binary"));
    expect(r).toEqual({ kind: "text", text: "เนื้อหา DOCX" });
  });

  it("DOCX that yields empty → throws อ่านข้อความจากไฟล์ DOCX ไม่ได้", async () => {
    mammothExtractMock.mockResolvedValue({ value: "   " });
    await expect(extractFromFile(textFile("a.docx", "binary"))).rejects.toThrow(
      "อ่านข้อความจากไฟล์ DOCX ไม่ได้"
    );
  });
});

describe("extractFromFile — pdf text-layer boundary (>= 500)", () => {
  it("text-layer exactly 500 chars → stays text", async () => {
    extractTextMock.mockResolvedValue({ text: "a".repeat(500) });
    const r = await extractFromFile(textFile("a.pdf", "x"));
    expect(r.kind).toBe("text");
    expect((r as { text: string }).text).toHaveLength(500);
  });

  it("text-layer 499 chars → falls through to scanned (pdf-native)", async () => {
    extractTextMock.mockResolvedValue({ text: "a".repeat(499) });
    const r = await extractFromFile(textFile("a.pdf", "x"));
    expect(r.kind).toBe("pdf-native");
  });

  it("text-layer >= 500 after trim → text (leading/trailing ws ignored)", async () => {
    extractTextMock.mockResolvedValue({ text: "  " + "b".repeat(500) + "  " });
    const r = await extractFromFile(textFile("a.pdf", "x"));
    expect(r.kind).toBe("text");
  });

  it("null/undefined text from unpdf → treated as scanned", async () => {
    extractTextMock.mockResolvedValue({ text: undefined });
    const r = await extractFromFile(textFile("a.pdf", "x"));
    expect(r.kind).toBe("pdf-native");
  });
});

describe("extractFromFile — scanned pdf size cap", () => {
  it("scanned .pdf <= 20MB → {kind:'pdf-native', base64}", async () => {
    extractTextMock.mockResolvedValue({ text: "" });
    const r = await extractFromFile(textFile("scan.pdf", "PDFDATA"));
    expect(r.kind).toBe("pdf-native");
    expect((r as { base64: string }).base64.length).toBeGreaterThan(0);
  });

  it("scanned .pdf > 20MB → throws (สแกนขนาดเกิน 20MB) — under upload cap", async () => {
    extractTextMock.mockResolvedValue({ text: "" });
    // 21MB < 25MB upload cap, > 20MB native pdf cap → ต้องโยน scanned-too-big
    const size = 21 * 1024 * 1024;
    const file = fakeLargeFile("big-scan.pdf", size, size);
    await expect(extractFromFile(file)).rejects.toThrow(/สแกนขนาดเกิน 20MB/);
  });
});

describe("extractFromFile — upload size guard (B1/D1)", () => {
  it("file larger than MAX_UPLOAD_BYTES → throws ไฟล์ใหญ่เกิน, before arrayBuffer", async () => {
    const tooBig = new File(["x"], "huge.txt");
    Object.defineProperty(tooBig, "size", { value: MAX_UPLOAD_BYTES + 1 });
    const abSpy = vi.fn();
    Object.defineProperty(tooBig, "arrayBuffer", { value: abSpy });
    await expect(extractFromFile(tooBig)).rejects.toThrow(/ไฟล์ใหญ่เกิน/);
    // ยืนยันว่าโยนก่อนอ่าน buffer เข้า memory
    expect(abSpy).not.toHaveBeenCalled();
  });

  it("file exactly at MAX_UPLOAD_BYTES is allowed through (boundary)", async () => {
    const atCap = textFile("a.txt", "ok content");
    Object.defineProperty(atCap, "size", { value: MAX_UPLOAD_BYTES });
    const r = await extractFromFile(atCap);
    expect(r.kind).toBe("text");
  });
});

describe("extractFromFile — unsupported / edge filenames", () => {
  it.each(["data.csv", "sheet.xlsx", "noext"])(
    "unsupported extension %s → throws รองรับเฉพาะไฟล์",
    async (name) => {
      await expect(extractFromFile(textFile(name, "x"))).rejects.toThrow(
        "รองรับเฉพาะไฟล์ .pdf .docx .txt และ .md"
      );
    }
  );

  it("filename with multiple dots a.b.pdf → routed by endsWith", async () => {
    extractTextMock.mockResolvedValue({ text: "c".repeat(600) });
    const r = await extractFromFile(textFile("a.b.pdf", "x"));
    expect(r.kind).toBe("text");
  });
});

describe("extractFromFile — migrated qa-extract structural cases", () => {
  it("doc.txt fixture → text containing chapter markers", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const buf = readFileSync(
      join(process.cwd(), "test", "fixtures", "doc.txt")
    );
    const r = await extractFromFile(
      new File([new Uint8Array(buf)], "doc.txt")
    );
    expect(r.kind).toBe("text");
    const text = (r as Extracted & { kind: "text" }).text;
    expect(text).toContain("บทที่ 3");
    expect(text).toContain("50/30/20");
  });

  it("doc.md fixture → text", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const buf = readFileSync(join(process.cwd(), "test", "fixtures", "doc.md"));
    const r = await extractFromFile(new File([new Uint8Array(buf)], "doc.md"));
    expect(r.kind).toBe("text");
  });

  it("data.csv fixture → throws unsupported", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const buf = readFileSync(
      join(process.cwd(), "test", "fixtures", "data.csv")
    );
    await expect(
      extractFromFile(new File([new Uint8Array(buf)], "data.csv"))
    ).rejects.toThrow("รองรับเฉพาะไฟล์");
  });

  it("empty.txt fixture → throws empty", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const buf = readFileSync(
      join(process.cwd(), "test", "fixtures", "empty.txt")
    );
    await expect(
      extractFromFile(new File([new Uint8Array(buf)], "empty.txt"))
    ).rejects.toThrow("ไฟล์ว่างเปล่า");
  });
});
