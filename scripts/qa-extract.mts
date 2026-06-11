/**
 * QA: ทดสอบ extractFromFile กับไฟล์ทุกประเภท (รันได้โดยไม่ต้องมี API key)
 * วิธีรัน: npx tsx scripts/qa-extract.mts <fixtures-dir>
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extractFromFile } from "../src/lib/extract";

const dir = process.argv[2] ?? "/tmp/booksum-qa";
let pass = 0;
let fail = 0;

function check(name: string, ok: boolean, detail: string) {
  if (ok) {
    pass++;
    console.log(`  ✓ ${name} — ${detail}`);
  } else {
    fail++;
    console.error(`  ✗ ${name} — ${detail}`);
  }
}

function load(name: string): File {
  const buf = readFileSync(join(dir, name));
  return new File([new Uint8Array(buf)], name);
}

async function expectError(name: string, needle: string) {
  try {
    await extractFromFile(load(name));
    check(name, false, `ควร throw แต่ผ่านไปได้`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    check(name, msg.includes(needle), `error: "${msg}"`);
  }
}

console.log(`fixtures: ${dir}\n`);

// 1) txt / md — ต้องได้ kind=text และมีเนื้อหาครบ
for (const f of ["doc.txt", "doc.md"]) {
  const r = await extractFromFile(load(f));
  check(
    f,
    r.kind === "text" && r.text.includes("บทที่ 3") && r.text.includes("50/30/20"),
    r.kind === "text" ? `text ${r.text.length} chars` : r.kind
  );
}

// 2) docx — mammoth ต้องสกัดข้อความไทยได้
{
  const r = await extractFromFile(load("doc.docx"));
  check(
    "doc.docx",
    r.kind === "text" && r.text.includes("การออมเงิน") && r.text.includes("บทที่ 3"),
    r.kind === "text" ? `text ${r.text.length} chars` : r.kind
  );
}

// 3) pdf ที่มี text layer — ต้องสกัดเป็น text ได้ (ถ้า cupsfilter ฝัง text)
{
  const r = await extractFromFile(load("doc.pdf"));
  if (r.kind === "text") {
    check("doc.pdf", r.text.length > 100, `text ${r.text.length} chars`);
  } else {
    // cupsfilter บางเครื่อง rasterize — fallback เป็น pdf-native ถือว่าถูกต้องตามดีไซน์
    check("doc.pdf", true, "ไม่มี text layer → fallback pdf-native (ตามดีไซน์)");
  }
}

// 4) pdf ภาพล้วน (สแกน) — ต้อง fallback เป็น pdf-native
{
  const r = await extractFromFile(load("scan.pdf"));
  check(
    "scan.pdf",
    r.kind === "pdf-native" && r.base64.length > 100,
    r.kind === "pdf-native" ? `pdf-native base64 ${r.base64.length} chars` : r.kind
  );
}

// 5) ไฟล์ผิดประเภท / ไฟล์ว่าง — ต้อง throw ข้อความไทยที่ถูกต้อง
await expectError("data.csv", "รองรับเฉพาะไฟล์");
await expectError("empty.txt", "ไฟล์ว่างเปล่า");

console.log(`\nผล: ผ่าน ${pass} / ตก ${fail}`);
process.exit(fail > 0 ? 1 : 0);
