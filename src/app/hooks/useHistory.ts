"use client";

import { useCallback, useEffect, useState } from "react";
import type { HistoryEntry } from "./types";
import type { DetailLevel } from "@/lib/summarize";

const HISTORY_KEY = "saruplem-history";
const HISTORY_MAX = 30;

const LEVELS = new Set<DetailLevel>(["brief", "standard", "detailed"]);

function isCanonicalIsoDate(value: string): boolean {
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

export function parseHistory(value: unknown): HistoryEntry[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.filter((entry): entry is HistoryEntry => {
    if (!entry || typeof entry !== "object") return false;
    const e = entry as Record<string, unknown>;
    if (
      typeof e.id !== "string" || !e.id.trim() || seen.has(e.id) ||
      typeof e.fileName !== "string" || !e.fileName.trim() ||
      typeof e.date !== "string" || !isCanonicalIsoDate(e.date) ||
      typeof e.level !== "string" || !LEVELS.has(e.level as DetailLevel) ||
      typeof e.summary !== "string" || !e.summary.trim()
    ) return false;
    seen.add(e.id);
    return true;
  }).slice(0, HISTORY_MAX);
}

function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? parseHistory(JSON.parse(raw)) : [];
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
    // hydrate จาก localStorage หลัง mount เท่านั้น — เริ่มด้วย [] ทั้งฝั่ง server และ
    // client render แรก เพื่อเลี่ยง hydration mismatch (localStorage ไม่มีบน server)
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
