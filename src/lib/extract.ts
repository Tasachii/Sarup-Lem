import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";
import type Anthropic from "@anthropic-ai/sdk";

const MAX_NATIVE_PDF_BYTES = 20 * 1024 * 1024; // ส่ง PDF สแกนให้โมเดลอ่านตรงได้ไม่เกิน 20MB

// เพดานขนาดไฟล์อัปโหลด — เช็คจาก file.size ก่อนอ่านเข้า memory กัน DoS
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25MB
export const MAX_UPLOAD_MB = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024));

export type Extracted =
  | { kind: "text"; text: string }
  | { kind: "pdf-native"; base64: string };

export class ExtractError extends Error {
  constructor(
    public readonly status: 413 | 415 | 422,
    message: string
  ) {
    super(message);
    this.name = "ExtractError";
  }
}

export async function extractFromFile(file: File): Promise<Extracted> {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new ExtractError(413, `ไฟล์ใหญ่เกิน ${MAX_UPLOAD_MB}MB — กรุณาแบ่งไฟล์เป็นส่วนย่อยก่อน`);
  }

  const name = file.name.toLowerCase();
  const buf = Buffer.from(await file.arrayBuffer());

  if (name.endsWith(".pdf")) {
    try {
      const pdf = await getDocumentProxy(new Uint8Array(buf));
      const { text } = await extractText(pdf, { mergePages: true });
      const cleaned = (text ?? "").trim();
      if (cleaned.length >= 500) return { kind: "text", text: cleaned };
      // แทบไม่มี text layer = น่าจะเป็นไฟล์สแกน → ให้โมเดลอ่านภาพจาก PDF ตรงๆ
      if (buf.length <= MAX_NATIVE_PDF_BYTES) {
        return { kind: "pdf-native", base64: buf.toString("base64") };
      }
      throw new ExtractError(
        413,
        "PDF นี้เป็นไฟล์สแกนขนาดเกิน 20MB — กรุณาแปลงเป็น text ก่อน หรือแบ่งไฟล์เป็นส่วนย่อย"
      );
    } catch (err) {
      if (err instanceof ExtractError) throw err;
      throw new ExtractError(422, "อ่านไฟล์ PDF ไม่ได้ — ไฟล์อาจเสียหายหรือไม่ใช่ PDF ที่ถูกต้อง");
    }
  }

  if (name.endsWith(".docx")) {
    try {
      const { value } = await mammoth.extractRawText({ buffer: buf });
      const cleaned = value.trim();
      if (!cleaned) throw new ExtractError(422, "อ่านข้อความจากไฟล์ DOCX ไม่ได้");
      return { kind: "text", text: cleaned };
    } catch (err) {
      if (err instanceof ExtractError) throw err;
      throw new ExtractError(422, "อ่านไฟล์ DOCX ไม่ได้ — ไฟล์อาจเสียหายหรือไม่ถูกต้อง");
    }
  }

  if (name.endsWith(".txt") || name.endsWith(".md")) {
    const cleaned = buf.toString("utf-8").trim();
    if (!cleaned) throw new ExtractError(422, "ไฟล์ว่างเปล่า");
    return { kind: "text", text: cleaned };
  }

  throw new ExtractError(415, "รองรับเฉพาะไฟล์ .pdf .docx .txt และ .md");
}

/**
 * สร้าง content บล็อกสำหรับส่งเข้า API — แยกบล็อกเอกสารกับบล็อกคำสั่ง/คำถาม
 * เพื่อให้ติด cache_control ที่ตัวเอกสารได้ (คำถามเปลี่ยนได้โดย cache ไม่หลุด)
 */
export function toUserContent(
  ex: Extracted,
  instruction: string,
  opts?: { cache?: boolean }
): Anthropic.ContentBlockParam[] {
  const cacheControl = opts?.cache
    ? { cache_control: { type: "ephemeral" as const } }
    : {};

  const docBlock: Anthropic.ContentBlockParam =
    ex.kind === "pdf-native"
      ? {
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: ex.base64 },
          ...cacheControl,
        }
      : {
          type: "text",
          text: `<document>\n${ex.text}\n</document>`,
          ...cacheControl,
        };

  return [docBlock, { type: "text", text: instruction }];
}
