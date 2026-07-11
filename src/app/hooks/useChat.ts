"use client";

import { useCallback, useState } from "react";
import type { ChatTurn } from "./types";
import { consumeStreamResponse } from "@/lib/stream-protocol";

/**
 * เตรียมประวัติก่อนส่งเข้า /api/chat — ตัด "เทิร์นที่ error" ออก
 * (คำตอบที่ล้มเหลว + คำถามที่จับคู่กัน) กันไม่ให้ error ปนเป็น context รอบถัดไป
 * และส่งเฉพาะ role/content (ตัด flag error ที่ใช้แค่ในจอออก)
 */
export function sanitizeChatHistory(
  turns: ChatTurn[]
): Array<{ role: "user" | "assistant"; content: string }> {
  const out: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const turn of turns) {
    if (turn.role === "assistant" && turn.error) {
      // ทิ้ง user turn ที่จับคู่กับคำตอบที่ล้มเหลวออกด้วย
      if (out.length > 0 && out[out.length - 1].role === "user") out.pop();
      continue;
    }
    out.push({ role: turn.role, content: turn.content });
  }
  return out;
}

export type UseChat = {
  chat: ChatTurn[];
  chatInput: string;
  chatBusy: boolean;
  setChatInput: (value: string) => void;
  clearChat: () => void;
  ask: () => Promise<void>;
};

export function useChat(file: File | null): UseChat {
  const [chat, setChat] = useState<ChatTurn[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);

  const clearChat = useCallback(() => {
    setChat([]);
    setChatInput("");
  }, []);

  const ask = useCallback(async () => {
    const q = chatInput.trim();
    if (!q || !file || chatBusy) return;
    setChatInput("");
    setChatBusy(true);
    const prior = chat;
    setChat([...prior, { role: "user", content: q }, { role: "assistant", content: "" }]);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append(
        "payload",
        JSON.stringify({ history: sanitizeChatHistory(prior), question: q })
      );
      const res = await fetch("/api/chat", { method: "POST", body: form });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "การตอบล้มเหลว");
      }
      await consumeStreamResponse(res, (_delta, answer) => {
        setChat((c) => [
          ...c.slice(0, -1),
          { role: "assistant", content: answer },
        ]);
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "เกิดข้อผิดพลาด";
      setChat((c) => [
        ...c.slice(0, -1),
        { role: "assistant", content: `> ⚠️ ${message}`, error: true },
      ]);
    } finally {
      setChatBusy(false);
    }
  }, [chat, chatInput, chatBusy, file]);

  return { chat, chatInput, chatBusy, setChatInput, clearChat, ask };
}
