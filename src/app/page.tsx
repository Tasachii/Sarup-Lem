"use client";

import { useCallback, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";

type Phase = "idle" | "analyzing" | "ready" | "summarizing" | "done";

type Analysis = {
  fileName: string;
  kind: "text" | "pdf-native";
  inputTokens: number;
  costUSD: number;
  costTHB: number;
};

export default function Home() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [summary, setSummary] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setPhase("idle");
    setFile(null);
    setAnalysis(null);
    setSummary("");
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  const analyze = useCallback(async (f: File) => {
    setError(null);
    setFile(f);
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
  }, []);

  const summarize = useCallback(async () => {
    if (!file) return;
    setError(null);
    setSummary("");
    setPhase("summarizing");
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/summarize", { method: "POST", body: form });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "การสรุปล้มเหลว");
      }
      if (!res.body) throw new Error("ไม่ได้รับข้อมูลจากเซิร์ฟเวอร์");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        setSummary((s) => s + decoder.decode(value, { stream: true }));
      }
      setPhase("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "เกิดข้อผิดพลาด");
      setPhase("ready");
    }
  }, [file]);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const f = e.dataTransfer.files?.[0];
      if (f) analyze(f);
    },
    [analyze]
  );

  const copySummary = useCallback(async () => {
    await navigator.clipboard.writeText(summary);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [summary]);

  const downloadSummary = useCallback(() => {
    const blob = new Blob([summary], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `สรุป-${(file?.name ?? "เอกสาร").replace(/\.[^.]+$/, "")}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [summary, file]);

  const busy = phase === "analyzing" || phase === "summarizing";

  return (
    <div className="flex flex-1 flex-col items-center px-5 pb-24">
      {/* ---------- header ---------- */}
      <header className="w-full max-w-3xl pt-16 pb-10 text-center">
        <p
          className="fade-up text-xs tracking-[0.45em] uppercase text-amber"
          style={{ animationDelay: "0.05s" }}
        >
          ── Book Summarizer ──
        </p>
        <h1
          className="fade-up font-display mt-4 text-5xl sm:text-6xl font-semibold text-cream"
          style={{ animationDelay: "0.15s" }}
        >
          สรุปเล่ม
        </h1>
        <p
          className="fade-up mt-4 text-cream-dim leading-relaxed"
          style={{ animationDelay: "0.25s" }}
        >
          โยนหนังสือหรือเอกสารเข้ามา แล้วให้ AI สรุปให้ครบทุกบท ไม่ตกหล่น
          <br />
          <span className="text-xs">รองรับ PDF · DOCX · TXT · MD</span>
        </p>
      </header>

      {/* ---------- error ---------- */}
      {error && (
        <div className="w-full max-w-3xl mb-6 rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-200">
          ⚠️ {error}
        </div>
      )}

      {/* ---------- idle: dropzone ---------- */}
      {(phase === "idle" || phase === "analyzing") && (
        <section
          className="fade-up w-full max-w-3xl"
          style={{ animationDelay: "0.35s" }}
        >
          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={`group w-full cursor-pointer rounded-2xl border-2 border-dashed px-8 py-20 text-center transition-all duration-300
              ${
                dragging
                  ? "border-amber bg-amber/10 scale-[1.01]"
                  : "border-ink-line bg-ink-soft/60 hover:border-amber-deep hover:bg-ink-soft"
              }`}
          >
            {phase === "analyzing" ? (
              <div className="flex flex-col items-center gap-4">
                <div className="spin-slow h-10 w-10 rounded-full border-2 border-ink-line border-t-amber" />
                <p className="text-cream-dim">
                  กำลังอ่านไฟล์และประเมินค่าใช้จ่าย…
                </p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-4">
                <svg
                  width="44"
                  height="44"
                  viewBox="0 0 24 24"
                  fill="none"
                  className="text-amber transition-transform duration-300 group-hover:-translate-y-1"
                >
                  <path
                    d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 19.5A2.5 2.5 0 0 0 6.5 22H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15Z"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M12 7v6m0 0 2.5-2.5M12 13 9.5 10.5"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <div>
                  <p className="font-display text-xl text-cream">
                    ลากไฟล์มาวางตรงนี้
                  </p>
                  <p className="mt-1 text-sm text-cream-dim">
                    หรือคลิกเพื่อเลือกไฟล์จากเครื่อง
                  </p>
                </div>
              </div>
            )}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.docx,.txt,.md"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) analyze(f);
            }}
          />
        </section>
      )}

      {/* ---------- ready: confirm cost ---------- */}
      {phase === "ready" && analysis && (
        <section className="fade-up w-full max-w-3xl rounded-2xl border border-ink-line bg-ink-soft/70 p-8">
          <p className="text-xs tracking-[0.3em] uppercase text-amber">
            พร้อมสรุป
          </p>
          <h2 className="font-display mt-2 text-2xl text-cream break-all">
            {analysis.fileName}
          </h2>
          <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div>
              <p className="text-xs text-cream-dim">ความยาว</p>
              <p className="font-display mt-1 text-xl text-cream">
                {analysis.inputTokens.toLocaleString()}
                <span className="ml-1 text-xs text-cream-dim">token</span>
              </p>
            </div>
            <div>
              <p className="text-xs text-cream-dim">ค่าใช้จ่ายโดยประมาณ</p>
              <p className="font-display mt-1 text-xl text-amber">
                ฿{analysis.costTHB.toLocaleString()}
                <span className="ml-1 text-xs text-cream-dim">
                  (${analysis.costUSD})
                </span>
              </p>
            </div>
            <div>
              <p className="text-xs text-cream-dim">วิธีอ่าน</p>
              <p className="mt-1 text-sm text-cream">
                {analysis.kind === "pdf-native"
                  ? "อ่านจากไฟล์ PDF โดยตรง (ไฟล์สแกน)"
                  : "อ่านจากข้อความที่สกัดได้"}
              </p>
            </div>
          </div>
          <div className="mt-8 flex flex-wrap gap-3">
            <button
              onClick={summarize}
              className="lamp-pulse rounded-full bg-amber px-8 py-3 font-display text-base font-semibold text-ink transition-colors hover:bg-amber-deep"
            >
              เริ่มสรุป →
            </button>
            <button
              onClick={reset}
              className="rounded-full border border-ink-line px-6 py-3 text-sm text-cream-dim transition-colors hover:border-cream-dim hover:text-cream"
            >
              เลือกไฟล์ใหม่
            </button>
          </div>
        </section>
      )}

      {/* ---------- summarizing / done: paper ---------- */}
      {(phase === "summarizing" || phase === "done") && (
        <section className="fade-up w-full max-w-3xl">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-cream-dim">
              {phase === "summarizing" ? (
                <span className="inline-flex items-center gap-2">
                  <span className="spin-slow inline-block h-3.5 w-3.5 rounded-full border border-ink-line border-t-amber" />
                  กำลังสรุป «{file?.name}» …
                </span>
              ) : (
                <>สรุปเสร็จแล้ว · {file?.name}</>
              )}
            </p>
            {phase === "done" && (
              <div className="flex gap-2">
                <button
                  onClick={copySummary}
                  className="rounded-full border border-ink-line px-4 py-1.5 text-xs text-cream-dim transition-colors hover:border-amber hover:text-amber"
                >
                  {copied ? "คัดลอกแล้ว ✓" : "คัดลอก"}
                </button>
                <button
                  onClick={downloadSummary}
                  className="rounded-full border border-ink-line px-4 py-1.5 text-xs text-cream-dim transition-colors hover:border-amber hover:text-amber"
                >
                  ดาวน์โหลด .md
                </button>
                <button
                  onClick={reset}
                  className="rounded-full border border-ink-line px-4 py-1.5 text-xs text-cream-dim transition-colors hover:border-amber hover:text-amber"
                >
                  สรุปเล่มใหม่
                </button>
              </div>
            )}
          </div>
          <article className="paper-card rounded-xl px-7 py-9 sm:px-12 sm:py-12">
            <div
              className={`summary-prose ${phase === "summarizing" ? "stream-caret" : ""}`}
            >
              <ReactMarkdown>{summary}</ReactMarkdown>
            </div>
          </article>
        </section>
      )}

      {/* ---------- footer ---------- */}
      <footer className="mt-16 text-center text-xs text-cream-dim/60">
        ขับเคลื่อนด้วย Claude Sonnet 4.6 · ไฟล์ของคุณถูกส่งไปยัง Anthropic API
        เพื่อประมวลผลเท่านั้น ไม่ถูกเก็บบนเซิร์ฟเวอร์
      </footer>
    </div>
  );
}
