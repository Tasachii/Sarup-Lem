"use client";

import { useCallback, useState } from "react";
import type { ChatTurn } from "./types";

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
      form.append("payload", JSON.stringify({ history: prior, question: q }));
      const res = await fetch("/api/chat", { method: "POST", body: form });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "การตอบล้มเหลว");
      }
      if (!res.body) throw new Error("ไม่ได้รับข้อมูลจากเซิร์ฟเวอร์");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        const answer = acc;
        setChat((c) => [
          ...c.slice(0, -1),
          { role: "assistant", content: answer },
        ]);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "เกิดข้อผิดพลาด";
      setChat((c) => [
        ...c.slice(0, -1),
        { role: "assistant", content: `> ⚠️ ${message}` },
      ]);
    } finally {
      setChatBusy(false);
    }
  }, [chat, chatInput, chatBusy, file]);

  return { chat, chatInput, chatBusy, setChatInput, clearChat, ask };
}
