import type { DetailLevel } from "@/lib/summarize";

export type Phase = "idle" | "analyzing" | "ready" | "summarizing" | "done";

export type Analysis = {
  fileName: string;
  kind: "text" | "pdf-native";
  inputTokens: number;
};

export type ChatTurn = {
  role: "user" | "assistant";
  content: string;
  /** true = คำตอบนี้ล้มเหลว (โชว์ในจอได้ แต่ห้ามส่งกลับเป็น context รอบถัดไป) */
  error?: boolean;
};

export type HistoryEntry = {
  id: string;
  fileName: string;
  date: string;
  level: DetailLevel;
  summary: string;
};
