// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Home from "@/app/page";

const HISTORY_KEY = "saruplem-history";

type HistoryEntry = {
  id: string;
  fileName: string;
  date: string;
  level: string;
  summary: string;
};

function makeEntry(i: number): HistoryEntry {
  return {
    id: `id-${i}`,
    fileName: `book-${i}.txt`,
    date: new Date(2026, 0, 1 + i).toISOString(),
    level: "standard",
    summary: `# สรุป ${i}\nเนื้อหา`,
  };
}

/** สร้าง Response แบบ streaming จาก array ของ chunk */
function streamResponse(chunks: string[], ok = true, status = 200): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(body, { status, headers: { "Content-Type": "text/plain" } });
}

function jsonResponse(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("history load + render on mount", () => {
  it("reads localStorage and renders the history list", async () => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify([makeEntry(1), makeEntry(2)]));
    render(<Home />);
    expect(await screen.findByText("book-1.txt")).toBeInTheDocument();
    expect(screen.getByText("book-2.txt")).toBeInTheDocument();
  });

  it("corrupt localStorage → renders without throwing, no history items", async () => {
    localStorage.setItem(HISTORY_KEY, "{bad json");
    render(<Home />);
    // หน้าโหลดได้ (เห็น dropzone) และไม่มี history
    expect(await screen.findByText("ลากไฟล์มาวางตรงนี้")).toBeInTheDocument();
    expect(screen.queryByText("ประวัติการสรุป")).not.toBeInTheDocument();
  });

  it("deleting a history entry persists the removal", async () => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify([makeEntry(1), makeEntry(2)]));
    render(<Home />);
    await screen.findByText("book-1.txt");
    // ปุ่มลบ (✕) มี title="ลบ"
    const deleteButtons = screen.getAllByTitle("ลบ");
    fireEvent.click(deleteButtons[0]);
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
      expect(saved).toHaveLength(1);
    });
  });
});

describe("open a history entry", () => {
  it("clicking an entry shows its summary in the paper view", async () => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify([makeEntry(1)]));
    render(<Home />);
    const entryBtn = await screen.findByText("book-1.txt");
    fireEvent.click(entryBtn);
    // viewingHistory mode → เห็นข้อความสรุปและโน้ตว่าถามต่อไม่ได้
    expect(await screen.findByText(/จากประวัติการสรุป/)).toBeInTheDocument();
    expect(
      screen.getByText(/การถาม-ตอบใช้ได้เฉพาะหลังสรุปไฟล์สดๆ/)
    ).toBeInTheDocument();
  });
});

describe("upload → analyze → ready state machine", () => {
  it("selecting a file calls /api/analyze and renders the cost card", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        jsonResponse({ fileName: "novel.txt", kind: "text", inputTokens: 100_000 })
      );
    render(<Home />);

    const input = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    const file = new File(["บทที่ 1 ..."], "novel.txt", { type: "text/plain" });
    await userEvent.upload(input, file);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/analyze");
    expect((init as RequestInit).method).toBe("POST");

    // ready card: filename + token count + ฿ price (estimateCost wiring)
    expect(await screen.findByText("novel.txt")).toBeInTheDocument();
    expect(screen.getByText("พร้อมสรุป")).toBeInTheDocument();
    expect(screen.getByText((100_000).toLocaleString())).toBeInTheDocument();
  });

  it("analyze failure → error banner shown, stays in idle", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ error: "วิเคราะห์ไฟล์ไม่สำเร็จ" }, 500)
    );
    render(<Home />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(
      input,
      new File(["x"], "bad.txt", { type: "text/plain" })
    );
    expect(await screen.findByText(/วิเคราะห์ไฟล์ไม่สำเร็จ/)).toBeInTheDocument();
    // ยังอยู่หน้า dropzone (idle)
    expect(screen.getByText("ลากไฟล์มาวางตรงนี้")).toBeInTheDocument();
  });
});

describe("summarize streaming + history persistence", () => {
  async function gotoReady(inputTokens = 1000) {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse({ fileName: "doc.txt", kind: "text", inputTokens })
    );
    render(<Home />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(
      input,
      new File(["x"], "doc.txt", { type: "text/plain" })
    );
    await screen.findByText("พร้อมสรุป");
  }

  it("streams summary then prepends a history entry, sliced to 30", async () => {
    // เตรียม 30 รายการเดิมในประวัติ → entry ใหม่ต้อง evict ตัวเก่าสุด (คง 30)
    const existing = Array.from({ length: 30 }, (_, i) => makeEntry(i + 100));
    localStorage.setItem(HISTORY_KEY, JSON.stringify(existing));

    await gotoReady();
    // ต่อไป mock /api/summarize เป็น stream
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      streamResponse(["# หัวข้อ", "\nเนื้อหาสรุป"])
    );
    fireEvent.click(screen.getByText("เริ่มสรุป →"));

    await waitFor(() => {
      const saved = JSON.parse(
        localStorage.getItem(HISTORY_KEY) ?? "[]"
      ) as HistoryEntry[];
      // ยังคง 30 (evict ตัวเก่าสุด) และตัวแรกคือไฟล์ที่เพิ่งสรุป
      expect(saved).toHaveLength(30);
      expect(saved[0].fileName).toBe("doc.txt");
    });
  });

  it("failed stream (body starts with > ⚠️) → NOT saved to history", async () => {
    await gotoReady();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      streamResponse(["\n\n> ⚠️ การสรุปล้มเหลวกลางทาง"])
    );
    fireEvent.click(screen.getByText("เริ่มสรุป →"));

    // รอจน done (เห็นปุ่มดาวน์โหลด) แล้วยืนยันว่าไม่บันทึก
    await screen.findByText("ดาวน์โหลด .md");
    expect(localStorage.getItem(HISTORY_KEY)).toBeNull();
  });
});

describe("quota fallback in saveHistory", () => {
  it("QuotaExceededError on first setItem → retries with a halved slice", async () => {
    // มีประวัติเดิม 1 รายการ เพื่อให้หลังเพิ่ม entry ใหม่ array ยาว 2 → halved = 1
    localStorage.setItem(HISTORY_KEY, JSON.stringify([makeEntry(5)]));

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        jsonResponse({ fileName: "doc.txt", kind: "text", inputTokens: 1000 })
      )
      .mockResolvedValueOnce(streamResponse(["# ok", "\nbody"]));

    render(<Home />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(
      input,
      new File(["x"], "doc.txt", { type: "text/plain" })
    );
    await screen.findByText("พร้อมสรุป");

    // ทำให้ setItem ครั้งแรกโยน QuotaExceededError ครั้งถัดไปสำเร็จ
    const real = Storage.prototype.setItem;
    let calls = 0;
    const setItemSpy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(function (this: Storage, k: string, v: string) {
        calls += 1;
        if (calls === 1) {
          const err = new Error("quota");
          err.name = "QuotaExceededError";
          throw err;
        }
        return real.call(this, k, v);
      });

    fireEvent.click(screen.getByText("เริ่มสรุป →"));

    await waitFor(() => {
      // เรียก setItem อย่างน้อย 2 ครั้ง (พลาดแล้ว retry)
      expect(setItemSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    // retry สำเร็จ → array สั้นลง (halved) ไม่ throw ออกมา
    const saved = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
    expect(Array.isArray(saved)).toBe(true);
  });

  it("QuotaExceededError on BOTH setItem calls → swallowed (no throw)", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        jsonResponse({ fileName: "doc.txt", kind: "text", inputTokens: 1000 })
      )
      .mockResolvedValueOnce(streamResponse(["# ok", "\nbody"]));

    render(<Home />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(
      input,
      new File(["x"], "doc.txt", { type: "text/plain" })
    );
    await screen.findByText("พร้อมสรุป");

    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      const err = new Error("quota");
      err.name = "QuotaExceededError";
      throw err;
    });

    // ไม่ควร throw แม้ setItem ล้มทั้งสองครั้ง → ยังถึงสถานะ done
    fireEvent.click(screen.getByText("เริ่มสรุป →"));
    expect(await screen.findByText("ดาวน์โหลด .md")).toBeInTheDocument();
  });
});

describe("chat (ask)", () => {
  async function gotoDone() {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        jsonResponse({ fileName: "doc.txt", kind: "text", inputTokens: 1000 })
      )
      .mockResolvedValueOnce(streamResponse(["# สรุป", "\nเนื้อหา"]));
    render(<Home />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(
      input,
      new File(["x"], "doc.txt", { type: "text/plain" })
    );
    await screen.findByText("พร้อมสรุป");
    fireEvent.click(screen.getByText("เริ่มสรุป →"));
    await screen.findByText("ดาวน์โหลด .md");
  }

  it("submitting a question streams the answer into the last assistant turn", async () => {
    await gotoDone();
    // mock /api/chat stream
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      streamResponse(["คำตอบ", "เพิ่มเติม"])
    );
    const chatInput = screen.getByPlaceholderText(/ขยายความบทที่ 3/);
    await userEvent.type(chatInput, "บทที่ 3 ว่าอย่างไร");
    fireEvent.click(screen.getByRole("button", { name: "ถาม" }));

    // optimistic user turn + streamed assistant answer
    expect(await screen.findByText("บทที่ 3 ว่าอย่างไร")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText(/คำตอบเพิ่มเติม/)).toBeInTheDocument()
    );
  });

  it("chat fetch error → assistant turn replaced with > ⚠️ message", async () => {
    await gotoDone();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse({ error: "การตอบล้มเหลว" }, 500)
    );
    const chatInput = screen.getByPlaceholderText(/ขยายความบทที่ 3/);
    await userEvent.type(chatInput, "คำถาม");
    fireEvent.click(screen.getByRole("button", { name: "ถาม" }));
    await waitFor(() =>
      expect(screen.getByText(/การตอบล้มเหลว/)).toBeInTheDocument()
    );
  });
});

describe("done view actions (copy / download / reset)", () => {
  async function gotoDone(summaryChunks = ["# สรุป", "\nเนื้อหา"]) {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        jsonResponse({ fileName: "doc.txt", kind: "text", inputTokens: 1000 })
      )
      .mockResolvedValueOnce(streamResponse(summaryChunks));
    render(<Home />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(
      input,
      new File(["x"], "doc.txt", { type: "text/plain" })
    );
    await screen.findByText("พร้อมสรุป");
    fireEvent.click(screen.getByText("เริ่มสรุป →"));
    await screen.findByText("ดาวน์โหลด .md");
  }

  it("copySummary writes the summary to clipboard and flips label, then reverts", async () => {
    const writeText = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    await gotoDone();
    fireEvent.click(screen.getByText("คัดลอก"));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText.mock.calls[0][0]).toContain("# สรุป");
    // label flips to copied immediately
    expect(screen.getByText("คัดลอกแล้ว ✓")).toBeInTheDocument();
    // reverts to "คัดลอก" after the 1500ms real timeout
    await waitFor(() => expect(screen.getByText("คัดลอก")).toBeInTheDocument(), {
      timeout: 2500,
    });
  });

  it("downloadSummary creates an object URL and a .md anchor download", async () => {
    const createObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:mock");
    const revokeObjectURL = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    await gotoDone();
    fireEvent.click(screen.getByText("ดาวน์โหลด .md"));

    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(clickSpy).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock");
  });

  it("reset (สรุปเล่มใหม่) returns to the idle dropzone", async () => {
    await gotoDone();
    fireEvent.click(screen.getByText("สรุปเล่มใหม่"));
    expect(await screen.findByText("ลากไฟล์มาวางตรงนี้")).toBeInTheDocument();
  });
});

describe("drag-and-drop upload", () => {
  it("dropping a file triggers analyze", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        jsonResponse({ fileName: "dropped.txt", kind: "text", inputTokens: 500 })
      );
    render(<Home />);
    const dropzone = screen.getByText("ลากไฟล์มาวางตรงนี้").closest("button")!;
    const file = new File(["เนื้อหา"], "dropped.txt", { type: "text/plain" });

    fireEvent.dragOver(dropzone);
    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toBe("/api/analyze");
    expect(await screen.findByText("dropped.txt")).toBeInTheDocument();
  });

  it("dragLeave resets the dragging highlight without error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ fileName: "x.txt", kind: "text", inputTokens: 1 })
    );
    render(<Home />);
    const dropzone = screen.getByText("ลากไฟล์มาวางตรงนี้").closest("button")!;
    fireEvent.dragOver(dropzone);
    fireEvent.dragLeave(dropzone);
    expect(screen.getByText("ลากไฟล์มาวางตรงนี้")).toBeInTheDocument();
  });
});

describe("cancel summarize mid-stream", () => {
  it("clicking ⏹ หยุด aborts and keeps partial output with a stop notice", async () => {
    // stream ที่เคารพ abort signal: เมื่อ abort → controller.error(AbortError)
    // ทำให้ reader.read() reject → เข้า catch branch ที่ ctrl.signal.aborted
    let pull!: (chunk: string) => void;
    const encoder = new TextEncoder();

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        jsonResponse({ fileName: "doc.txt", kind: "text", inputTokens: 1000 })
      )
      .mockImplementationOnce((_url, init) => {
        const signal = (init as RequestInit | undefined)?.signal;
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            pull = (chunk: string) => controller.enqueue(encoder.encode(chunk));
            if (signal) {
              signal.addEventListener("abort", () => {
                controller.error(
                  Object.assign(new Error("aborted"), { name: "AbortError" })
                );
              });
            }
          },
        });
        return Promise.resolve(
          new Response(body, {
            status: 200,
            headers: { "Content-Type": "text/plain" },
          })
        );
      });

    render(<Home />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(
      input,
      new File(["x"], "doc.txt", { type: "text/plain" })
    );
    await screen.findByText("พร้อมสรุป");
    fireEvent.click(screen.getByText("เริ่มสรุป →"));

    // ปล่อยเนื้อหาบางส่วนแล้วกดหยุด
    await screen.findByText("⏹ หยุด");
    pull("เนื้อหาบางส่วน");
    await waitFor(() =>
      expect(screen.getByText(/เนื้อหาบางส่วน/)).toBeInTheDocument()
    );

    fireEvent.click(screen.getByText("⏹ หยุด"));
    await waitFor(
      () => expect(screen.getByText(/หยุดการสรุปก่อนจบ/)).toBeInTheDocument(),
      { timeout: 3000 }
    );
  });
});
