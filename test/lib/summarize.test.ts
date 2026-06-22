import { describe, it, expect } from "vitest";
import {
  estimateCost,
  LEVELS,
  MODEL,
  MAX_INPUT_TOKENS,
  PRICING,
  USD_TO_THB,
  INPUT_USD_PER_MTOK,
  OUTPUT_USD_PER_MTOK,
  type DetailLevel,
} from "@/lib/summarize";

describe("estimateCost — exact values", () => {
  it("estimateCost(0, 'brief') = {usd:0.045, thb:1.62}", () => {
    expect(estimateCost(0, "brief")).toEqual({ usd: 0.045, thb: 1.62 });
  });

  it("estimateCost(1_000_000, 'standard') = {usd:3.15, thb:113.4}", () => {
    expect(estimateCost(1_000_000, "standard")).toEqual({ usd: 3.15, thb: 113.4 });
  });

  it("estimateCost(500_000, 'detailed') = {usd:1.8, thb:64.8}", () => {
    expect(estimateCost(500_000, "detailed")).toEqual({ usd: 1.8, thb: 64.8 });
  });

  it("rounds usd to 3 decimals and thb to 2 decimals", () => {
    // 333_333 input tokens, brief: (333333*3 + 3000*15)/1e6 = (999999 + 45000)/1e6 = 1.044999
    // toFixed(3) → 1.045 ; thb = 1.045*36 = 37.62
    const r = estimateCost(333_333, "brief");
    expect(r.usd).toBe(1.045);
    expect(r.thb).toBe(37.62);
    // ยืนยันสัญญาการปัดเศษ: usd สูงสุด 3 ตำแหน่ง, thb สูงสุด 2 ตำแหน่ง
    expect(r.usd).toBe(Number(r.usd.toFixed(3)));
    expect(r.thb).toBe(Number(r.thb.toFixed(2)));
  });

  it("negative input returns a negative usd (documents potential bug, not clamped)", () => {
    const r = estimateCost(-1_000_000, "brief");
    expect(r.usd).toBeLessThan(0);
  });
});

describe("estimateCost — all LEVELS", () => {
  const estOut: Record<DetailLevel, number> = {
    brief: 3_000,
    standard: 10_000,
    detailed: 20_000,
  };

  it.each(Object.keys(LEVELS) as DetailLevel[])(
    "%s: usd>0, thb≈usd*36, estOutputTokens matches table",
    (level) => {
      const inputTokens = 100_000;
      const r = estimateCost(inputTokens, level);
      expect(r.usd).toBeGreaterThan(0);
      // thb ควรเท่ากับ usd*36 (ภายในความคลาดเคลื่อนปัดเศษ)
      expect(r.thb).toBeCloseTo(r.usd * USD_TO_THB, 1);
      expect(LEVELS[level].estOutputTokens).toBe(estOut[level]);
      // ตรวจสูตรตรงๆ
      const expectedUsd =
        (inputTokens * INPUT_USD_PER_MTOK +
          LEVELS[level].estOutputTokens * OUTPUT_USD_PER_MTOK) /
        1_000_000;
      expect(r.usd).toBeCloseTo(expectedUsd, 3);
    }
  );
});

describe("LEVELS shape", () => {
  it("has exactly brief/standard/detailed", () => {
    expect(Object.keys(LEVELS).sort()).toEqual(["brief", "detailed", "standard"]);
  });

  it.each(Object.keys(LEVELS) as DetailLevel[])(
    "%s has label/description/estOutputTokens/maxTokens with maxTokens > estOutputTokens",
    (level) => {
      const l = LEVELS[level];
      expect(typeof l.label).toBe("string");
      expect(l.label.length).toBeGreaterThan(0);
      expect(typeof l.description).toBe("string");
      expect(l.description.length).toBeGreaterThan(0);
      expect(typeof l.estOutputTokens).toBe("number");
      expect(typeof l.maxTokens).toBe("number");
      expect(l.maxTokens).toBeGreaterThan(l.estOutputTokens);
    }
  );

  it("maxTokens table: brief 8000 / standard 32000 / detailed 56000", () => {
    expect(LEVELS.brief.maxTokens).toBe(8_000);
    expect(LEVELS.standard.maxTokens).toBe(32_000);
    expect(LEVELS.detailed.maxTokens).toBe(56_000);
  });
});

describe("pricing constants", () => {
  it("MODEL is claude-sonnet-4-6", () => {
    expect(MODEL).toBe("claude-sonnet-4-6");
  });

  it("MAX_INPUT_TOKENS is 950_000", () => {
    expect(MAX_INPUT_TOKENS).toBe(950_000);
  });

  it("pricing/FX constants hold their documented values", () => {
    expect(INPUT_USD_PER_MTOK).toBe(3);
    expect(OUTPUT_USD_PER_MTOK).toBe(15);
    expect(USD_TO_THB).toBe(36);
  });
});

describe("PRICING object (source of truth)", () => {
  it("has the expected shape", () => {
    expect(PRICING).toMatchObject({
      model: "claude-sonnet-4-6",
      inputUsdPerMTok: 3,
      outputUsdPerMTok: 15,
      usdToThb: expect.any(Number),
      asOf: expect.any(String),
    });
  });

  it("named exports are derived from PRICING", () => {
    expect(INPUT_USD_PER_MTOK).toBe(PRICING.inputUsdPerMTok);
    expect(OUTPUT_USD_PER_MTOK).toBe(PRICING.outputUsdPerMTok);
    expect(USD_TO_THB).toBe(PRICING.usdToThb);
  });

  it("asOf is an ISO-ish YYYY-MM string", () => {
    expect(PRICING.asOf).toMatch(/^\d{4}-\d{2}$/);
  });
});
