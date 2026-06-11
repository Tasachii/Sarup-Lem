export const MODEL = "claude-sonnet-4-6";

// ราคา Sonnet 4.6: input $3 / output $15 ต่อ 1M token
export const INPUT_USD_PER_MTOK = 3;
export const OUTPUT_USD_PER_MTOK = 15;
export const USD_TO_THB = 36;
export const MAX_INPUT_TOKENS = 950_000; // กันชนก่อนเต็ม context 1M

export type DetailLevel = "brief" | "standard" | "detailed";

export const LEVELS: Record<
  DetailLevel,
  {
    label: string;
    description: string;
    estOutputTokens: number;
    maxTokens: number;
  }
> = {
  brief: {
    label: "สั้นกระชับ",
    description: "ภาพรวม + ประเด็นสำคัญ อ่านจบใน 5 นาที",
    estOutputTokens: 3_000,
    maxTokens: 8_000,
  },
  standard: {
    label: "มาตรฐาน",
    description: "สรุปรายบทครบทุกส่วน",
    estOutputTokens: 10_000,
    maxTokens: 32_000,
  },
  detailed: {
    label: "ละเอียดมาก",
    description: "เจาะลึกทุกบท เก็บรายละเอียดและตัวอย่าง",
    estOutputTokens: 20_000,
    maxTokens: 56_000,
  },
};

export function estimateCost(inputTokens: number, level: DetailLevel) {
  const usd =
    (inputTokens * INPUT_USD_PER_MTOK +
      LEVELS[level].estOutputTokens * OUTPUT_USD_PER_MTOK) /
    1_000_000;
  return {
    usd: Number(usd.toFixed(3)),
    thb: Number((usd * USD_TO_THB).toFixed(2)),
  };
}

export const SYSTEM_PROMPT = `คุณคือบรรณาธิการมืออาชีพที่เชี่ยวชาญการสรุปหนังสือและเอกสารภาษาไทย
หน้าที่ของคุณคือสรุปเอกสารให้ "ครบถ้วน ไม่ตกหล่น" — ผู้อ่านสรุปของคุณต้องไม่พลาดสาระสำคัญใดๆ จากต้นฉบับ

กฎเหล็ก:
- ครอบคลุมทุกบท ทุกหัวข้อ ทุกส่วนของเอกสาร ห้ามข้ามส่วนใดเด็ดขาด
- เก็บตัวเลข สถิติ ชื่อบุคคล ชื่อสถานที่ คำนิยาม และข้อโต้แย้งสำคัญไว้เสมอ
- สรุปตามลำดับโครงสร้างของต้นฉบับ
- ใช้ภาษาไทยที่อ่านลื่น กระชับแต่ไม่ทิ้งสาระ (ศัพท์เทคนิคให้คงคำเดิมพร้อมคำแปลกำกับ)
- ตอบเป็น Markdown เท่านั้น`;

const STRUCTURE_STANDARD = `# ภาพรวม
ย่อหน้าสั้นๆ 1–2 ย่อหน้า: เอกสารนี้เกี่ยวกับอะไร ใจความหลักคืออะไร เหมาะกับใคร

# สรุปรายส่วน
ไล่ตามโครงสร้างต้นฉบับ (บท/หัวข้อ) **ครบทุกส่วน** — แต่ละส่วนใช้หัวข้อย่อย (##) ตามชื่อบทหรือหัวข้อจริง สรุปละเอียดพอที่คนไม่ได้อ่านต้นฉบับจะเข้าใจเนื้อหาทั้งหมด

# ประเด็นสำคัญและข้อคิด
bullet สรุป insight หลักที่ควรจดจำ

# ข้อมูลอ้างอิงสำคัญ
ตารางรวม ชื่อบุคคล/องค์กร, ตัวเลข/สถิติ, คำศัพท์สำคัญ พร้อมคำอธิบายสั้นๆ (ถ้าเอกสารไม่มีข้อมูลประเภทนี้ ให้ละหัวข้อนี้ได้)`;

export const SUMMARY_INSTRUCTIONS: Record<DetailLevel, string> = {
  brief: `สรุปเอกสารข้างต้นแบบสั้นกระชับ อ่านจบใน 5 นาที ตามโครงสร้างนี้:

# ภาพรวม
1–2 ย่อหน้า: เอกสารนี้เกี่ยวกับอะไร ใจความหลักคืออะไร

# ประเด็นสำคัญ
bullet 10–15 ข้อ ครอบคลุมสาระหลักจากทุกส่วนของเอกสาร (ห้ามเทน้ำหนักไปที่บทแรกๆ แล้วทิ้งบทท้าย)

# สิ่งที่ควรจดจำ
ตัวเลข ชื่อ หรือข้อสรุปสำคัญที่สุด 3–5 อย่าง`,
  standard: `สรุปเอกสารข้างต้นตามโครงสร้างนี้:

${STRUCTURE_STANDARD}`,
  detailed: `สรุปเอกสารข้างต้นแบบละเอียดที่สุด ตามโครงสร้างนี้:

${STRUCTURE_STANDARD}

ข้อกำหนดเพิ่มเติมสำหรับโหมดละเอียด:
- แต่ละบท/หัวข้อ สรุปอย่างน้อย 2–4 ย่อหน้า เก็บข้อโต้แย้ง ตัวอย่าง กรณีศึกษา และเหตุผลประกอบ
- ถ้ามีลำดับขั้นตอน วิธีการ หรือ framework ให้ถอดออกมาครบทุกขั้น
- เก็บ quote หรือประโยคสำคัญจากต้นฉบับ (ใส่ blockquote) เมื่อมีน้ำหนัก`,
};

// ใช้ตอนสรุปครั้งแรก (รวมเป็นข้อความเดียวกับ instruction ของระดับที่เลือก)
export const SUMMARY_INSTRUCTION = SUMMARY_INSTRUCTIONS.standard;

export const QA_SYSTEM_PROMPT = `คุณคือผู้ช่วยตอบคำถามจากเอกสารที่แนบมา
กฎ:
- ตอบจากเนื้อหาในเอกสารเป็นหลัก ถ้าข้อมูลไม่มีในเอกสารให้บอกตรงๆ ว่า "ไม่มีระบุในเอกสาร" (เสริมความรู้ทั่วไปได้แต่ต้องแยกให้ชัดว่าส่วนไหนมาจากเอกสาร)
- อ้างอิงบท/หัวข้อ/ตำแหน่งในเอกสารเมื่อระบุได้
- ตอบภาษาไทย กระชับ ตรงคำถาม เป็น Markdown`;
