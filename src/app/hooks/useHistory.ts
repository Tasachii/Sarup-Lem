"use client";

import { useCallback, useEffect, useState } from "react";
import type { HistoryEntry } from "./types";

const HISTORY_KEY = "saruplem-history";
const HISTORY_MAX = 30;

function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? (JSON.parse(raw) as HistoryEntry[]) : [];
  } catch {
    return [];
  }
}

function saveHistory(entries: HistoryEntry[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, HISTORY_MAX)));
  } catch {
    // localStorage เต็ม — ตัดรายการเก่าสุดออกแล้วลองใหม่
    try {
      localStorage.setItem(
        HISTORY_KEY,
        JSON.stringify(entries.slice(0, Math.max(1, Math.floor(entries.length / 2))))
      );
    } catch {
      /* ปล่อยผ่าน */
    }
  }
}

export type UseHistory = {
  history: HistoryEntry[];
  /** เพิ่ม entry ใหม่ไว้บนสุด ตัดให้เหลือ HISTORY_MAX แล้ว persist */
  pushHistory: (entry: HistoryEntry) => void;
  deleteHistory: (id: string) => void;
  /** เปิดดูสรุปจากประวัติ — ส่ง summary ไปให้ผู้ใช้ผ่าน onOpen */
  openHistory: (entry: HistoryEntry, onOpen: (summary: string) => void) => void;
};

export function useHistory(): UseHistory {
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  const pushHistory = useCallback((entry: HistoryEntry) => {
    setHistory((h) => {
      const next = [entry, ...h].slice(0, HISTORY_MAX);
      saveHistory(next);
      return next;
    });
  }, []);

  const deleteHistory = useCallback((id: string) => {
    setHistory((h) => {
      const next = h.filter((e) => e.id !== id);
      saveHistory(next);
      return next;
    });
  }, []);

  const openHistory = useCallback(
    (entry: HistoryEntry, onOpen: (summary: string) => void) => {
      onOpen(entry.summary);
    },
    []
  );

  return { history, pushHistory, deleteHistory, openHistory };
}
