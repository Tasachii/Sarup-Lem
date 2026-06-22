import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

/**
 * Polyfills สำหรับ component tests (jsdom) — guard ด้วย typeof window
 * เพราะ environment เริ่มต้นเป็น node (override เป็น jsdom ต่อไฟล์)
 */
if (typeof window !== "undefined") {
  // localStorage — jsdom รุ่นใหม่มีให้ แต่กันพลาดด้วย in-memory shim ถ้าไม่มี
  if (!("localStorage" in window)) {
    const store = new Map<string, string>();
    const localStorageMock: Storage = {
      get length() {
        return store.size;
      },
      clear: () => store.clear(),
      getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
      key: (index: number) => Array.from(store.keys())[index] ?? null,
      removeItem: (key: string) => {
        store.delete(key);
      },
      setItem: (key: string, value: string) => {
        store.set(key, String(value));
      },
    };
    Object.defineProperty(window, "localStorage", {
      value: localStorageMock,
      writable: true,
    });
  }

  // navigator.clipboard.writeText
  if (!navigator.clipboard) {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn(async () => {}) },
      writable: true,
      configurable: true,
    });
  }

  // crypto.randomUUID
  if (!globalThis.crypto) {
    Object.defineProperty(globalThis, "crypto", { value: {}, writable: true });
  }
  if (typeof globalThis.crypto.randomUUID !== "function") {
    let n = 0;
    Object.defineProperty(globalThis.crypto, "randomUUID", {
      value: () =>
        `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}` as `${string}-${string}-${string}-${string}-${string}`,
      writable: true,
      configurable: true,
    });
  }

  // URL.createObjectURL / revokeObjectURL (ไม่มีใน jsdom)
  if (typeof URL.createObjectURL !== "function") {
    URL.createObjectURL = vi.fn(() => "blob:mock");
  }
  if (typeof URL.revokeObjectURL !== "function") {
    URL.revokeObjectURL = vi.fn();
  }

  // Element.prototype.scrollIntoView (ใช้ที่ page.tsx)
  if (typeof Element.prototype.scrollIntoView !== "function") {
    Element.prototype.scrollIntoView = vi.fn();
  }
}
