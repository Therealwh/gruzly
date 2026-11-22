import { describe, expect, it } from "vitest";
import { formatBytes, formatDuration, formatEta, formatPercent, formatSpeed } from "./format";

describe("formatBytes", () => {
  it("formats binary units", () => {
    expect(formatBytes(0, "en")).toBe("0 KB");
    expect(formatBytes(1024, "en")).toBe("1 KB");
    expect(formatBytes(1536, "en")).toBe("1.5 KB");
    expect(formatBytes(1024 * 1024 * 1024, "en")).toBe("1 GB");
  });

  it("uses Russian unit names", () => {
    expect(formatBytes(1024, "ru")).toBe("1 КБ");
    expect(formatBytes(1024 * 1024, "ru")).toBe("1 МБ");
  });
});

describe("formatSpeed", () => {
  it("appends per-second suffix", () => {
    expect(formatSpeed(1024, "en")).toBe("1 KB/s");
    expect(formatSpeed(0, "en")).toBe("0 KB/s");
    expect(formatSpeed(1024 * 100, "ru")).toBe("100 КБ/с");
  });
});

describe("formatDuration", () => {
  it("renders mm:ss and h:mm:ss", () => {
    expect(formatDuration(83)).toBe("1:23");
    expect(formatDuration(3745)).toBe("1:02:25");
    expect(formatDuration(NaN)).toBe("–:––");
  });
});

describe("formatEta", () => {
  it("is empty for zero/unknown", () => {
    expect(formatEta(0)).toBe("");
    expect(formatEta(NaN)).toBe("");
  });
  it("renders minutes without leading minus", () => {
    const eta = formatEta(180, "en");
    expect(eta).not.toMatch(/^-/);
    expect(eta.toLowerCase()).toContain("3");
  });
});

describe("formatPercent", () => {
  it("clamps and formats", () => {
    expect(formatPercent(50, 100)).toBe("50%");
    expect(formatPercent(150, 100)).toBe("100%");
    expect(formatPercent(1, 0)).toBe("0%");
  });
});
