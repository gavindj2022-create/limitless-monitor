import { describe, expect, it } from "vitest";
import {
  STATUS,
  finding,
  isoDate,
  normalizeUrl,
  scoreStatus,
} from "../src/model.js";

describe("model helpers", () => {
  it("normalizes URLs without fragments or trailing slash", () => {
    expect(normalizeUrl("https://jewardllc.com/#top")).toBe("https://jewardllc.com");
    expect(normalizeUrl("https://example.com/path/?a=1#x")).toBe("https://example.com/path?a=1");
  });

  it("scores status by highest severity", () => {
    expect(scoreStatus([])).toBe(STATUS.HEALTHY);
    expect(scoreStatus([finding("warn", "mobile", "CTA wraps", "Small screen issue")])).toBe(STATUS.REVIEW);
    expect(scoreStatus([finding("error", "core", "Down", "HTTP 500")])).toBe(STATUS.BROKEN);
  });

  it("formats an ISO date in UTC", () => {
    expect(isoDate(new Date("2026-06-24T15:10:00Z"))).toBe("2026-06-24");
  });
});
