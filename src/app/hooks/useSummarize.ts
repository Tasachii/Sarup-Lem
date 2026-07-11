"use client";

import { useCallback, useRef, useState } from "react";
import type { DetailLevel } from "@/lib/summarize";
import type { Analysis, HistoryEntry, Phase } from "./types";
import { consumeStreamResponse } from "@/lib/stream-protocol";

type Options = {
  /** เพิ่ม entry ลงประวัติเมื่อสรุปสำเร็จ */
  pushHistory: (entry: HistoryEntry) => void;
  /** ล้างแชทเมื่อเริ่มไฟล์ใหม่/สรุปใหม่/รีเซ็ต/เปิดประวัติ */
  clearChat: () => void;
};

export type UseSummarize = {
  phase: Phase;
  file: File | null;
  analysis: Analysis | null;
  level: DetailLevel;
  summary: string;
  error: string | null;
  viewingHistory: boolean;
  setLevel: (level: DetailLevel) => void;
  analyze: (f: File) => Promise<void>;
  summarize: () => Promise<void>;
  cancelSummarize: () => void;
  reset: () => void;
  /** ตั้งสถานะให้แสดงสรุปจากประวัติ */
  showHistorySummary: (summary: string) => void;
};

export function useSummarize({ pushHistory, clearChat }: Options): UseSummarize {
  const [phase, setPhase] = useState<Phase>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [level, setLevel] = useState<DetailLevel>("standard");
  const [summary, setSummary] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [viewingHistory, setViewingHistory] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    setPhase("idle");
    setFile(null);
    setAnalysis(null);
    setSummary("");
    setError(null);
    setViewingHistory(false);
    clearChat();
  }, [clearChat]);

  const analyze = useCallback(
    async (f: File) => {
      setError(null);
      setFile(f);
      setViewingHistory(false);
      clearChat();
      setPhase("analyzing");
      try {
        const form = new FormData();
        form.append("file", f);
        const res = await fetch("/api/analyze", { method: "POST", body: form });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "วิเคราะห์ไฟล์ไม่สำเร็จ");
        setAnalysis(data);
        setPhase("ready");
      } catch (err) {
        setError(err instanceof Error ? err.message : "เกิดข้อผิดพลาด");
        setPhase("idle");
      }
    },
    [clearChat]
  );

  const summarize = useCallback(async () => {
    if (!file) return;
    setError(null);
    setSummary("");
    clearChat();
    setPhase("summarizing");
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let acc = "";
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("level", level);
      const res = await fetch("/api/summarize", {
        method: "POST",
        body: form,
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "การสรุปล้มเหลว");
      }
      acc = await consumeStreamResponse(res, (_delta, accumulated) => {
        acc = accumulated;
        setSummary(accumulated);
      });
      if (!acc.trim()) {
        throw new Error("ระบบส่งสรุปว่างเปล่า — กรุณาลองใหม่");
      }
      setPhase("done");
      const entry: HistoryEntry = {
        id: crypto.randomUUID(),
        fileName: file.name,
        date: new Date().toISOString(),
        level,
        summary: acc,
      };
      pushHistory(entry);
    } catch (err) {
      if (ctrl.signal.aborted) {
        // ผู้ใช้กดหยุดเอง — เก็บส่วนที่สรุปแล้วไว้ดู แต่ไม่บันทึกลงประวัติ
        if (acc.trim()) {
          setSummary(acc + "\n\n> ⏹ หยุดการสรุปก่อนจบ — เนื้อหาด้านบนคือส่วนที่สรุปได้ก่อนยกเลิก");
          setPhase("done");
        } else {
          setPhase("ready");
        }
        return;
      }
      setError(err instanceof Error ? err.message : "เกิดข้อผิดพลาด");
      setPhase("ready");
    } finally {
      abortRef.current = null;
    }
  }, [file, level, clearChat, pushHistory]);

  const cancelSummarize = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const showHistorySummary = useCallback(
    (entrySummary: string) => {
      setError(null);
      setFile(null);
      setAnalysis(null);
      setSummary(entrySummary);
      clearChat();
      setViewingHistory(true);
      setPhase("done");
    },
    [clearChat]
  );

  return {
    phase,
    file,
    analysis,
    level,
    summary,
    error,
    viewingHistory,
    setLevel,
    analyze,
    summarize,
    cancelSummarize,
    reset,
    showHistorySummary,
  };
}
