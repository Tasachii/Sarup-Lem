import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";
import type Anthropic from "@anthropic-ai/sdk";

const MAX_NATIVE_PDF_BYTES = 20 * 1024 * 1024; // ส่ง PDF สแกนให้โมเดลอ่านตรงได้ไม่เกิน 20MB

export type Extracted =
  | { kind: "text"; text: string }
  | { kind: "pdf-native"; base64: string };

export async function extractFromFile(file: File): Promise<Extracted> {
  const name = file.name.toLowerCase();
  const buf = Buffer.from(await file.arrayBuffer());

  if (name.endsWith(".pdf")) {
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await extractText(pdf, { mergePages: true });
    const cleaned = (text ?? "").trim();
    if (cleaned.length >= 500) return { kind: "text", text: cleaned };
    // แทบไม่มี text layer = น่าจะเป็นไฟล์สแกน → ให้โมเดลอ่านภาพจาก PDF ตรงๆ
    if (buf.length <= MAX_NATIVE_PDF_BYTES) {
      return { kind: "pdf-native", base64: buf.toString("base64") };
    }
    throw new Error(
      "PDF นี้เป็นไฟล์สแกนขนาดเกิน 20MB — กรุณาแปลงเป็น text ก่อน หรือแบ่งไฟล์เป็นส่วนย่อย"
    );
  }

  if (name.endsWith(".docx")) {
    const { value } = await mammoth.extractRawText({ buffer: buf });
    const cleaned = value.trim();
    if (!cleaned) throw new Error("อ่านข้อความจากไฟล์ DOCX ไม่ได้");
    return { kind: "text", text: cleaned };
  }

  if (name.endsWith(".txt") || name.endsWith(".md")) {
    const cleaned = buf.toString("utf-8").trim();
    if (!cleaned) throw new Error("ไฟล์ว่างเปล่า");
    return { kind: "text", text: cleaned };
  }

  throw new Error("รองรับเฉพาะไฟล์ .pdf .docx .txt และ .md");
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
