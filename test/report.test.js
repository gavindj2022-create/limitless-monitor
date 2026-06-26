import { describe, expect, it } from "vitest";
import { STATUS } from "../src/model.js";
import { buildDailyDigest } from "../src/report.js";

function review(overrides = {}) {
  return {
    displayName: "J.E. Ward",
    status: STATUS.HEALTHY,
    isNew: false,
    metrics: {
      responseMs: 320,
      imageCount: 3,
      failedRenderedImages: 0,
      formPresent: true,
    },
    findings: [],
    ...overrides,
  };
}

function digest(reviews) {
  return buildDailyDigest({
    reviewDate: "2026-06-26",
    dailyTimeLabel: "8:00 AM CT",
    reviews,
  }).embeds[0];
}

describe("daily Discord maintenance digest", () => {
  it("includes the stethoscope title, date, maintenance description, footer, and timestamp", () => {
    const embed = digest([review()]);

    expect(embed.title).toBe("🩺 Site Sentinel Daily Review · 2026-06-26");
    expect(embed.description).toContain("daily website maintenance check");
    expect(embed.description).toContain("8:00 AM CT");
    expect(embed.footer.text).toBe("Limitless · Site Sentinel");
    expect(new Date(embed.timestamp).toISOString()).toBe(embed.timestamp);
  });

  it("uses healthy and review status emoji in site field names", () => {
    const embed = digest([
      review({ displayName: "Healthy Site", status: STATUS.HEALTHY }),
      review({ displayName: "Review Site", status: STATUS.REVIEW }),
    ]);

    expect(embed.fields[0]).toMatchObject({
      name: "✅ Healthy Site",
      inline: false,
    });
    expect(embed.fields[1]).toMatchObject({
      name: "🟡 Review Site",
      inline: false,
    });
  });

  it("adds a newly monitoring line for new sites", () => {
    const embed = digest([review({ isNew: true })]);

    expect(embed.fields[0].value).toContain("📡 Newly monitoring");
  });

  it("includes visual status lines, finding lines, and a first action", () => {
    const embed = digest([
      review({
        status: STATUS.REVIEW,
        findings: [
          {
            severity: "warn",
            area: "mobile",
            title: "Mobile horizontal overflow",
            detail: "The rendered page is wider than the mobile viewport.",
            emoji: "📱",
          },
        ],
      }),
    ]);

    expect(embed.fields[0].value).toContain("📱 Mobile: Needs review");
    expect(embed.fields[0].value).toContain("🖥️ Desktop: Good");
    expect(embed.fields[0].value).toContain("🖼️ Images: 3 checked, 0 failed");
    expect(embed.fields[0].value).toContain("🧾 Forms: Present");
    expect(embed.fields[0].value).toContain("⚡ Speed: 320ms");
    expect(embed.fields[0].value).toContain("📱 Mobile horizontal overflow: The rendered page is wider than the mobile viewport.");
    expect(embed.fields[0].value).toContain("🛠️ Action: The rendered page is wider than the mobile viewport.");
  });

  it("sets the color from the worst review status", () => {
    expect(digest([review({ status: STATUS.HEALTHY })]).color).toBe(0x2ecc71);
    expect(digest([review({ status: STATUS.HEALTHY }), review({ status: STATUS.SKIPPED })]).color).toBe(0x95a5a6);
    expect(digest([review({ status: STATUS.HEALTHY }), review({ status: STATUS.REVIEW })]).color).toBe(0xf1c40f);
    expect(digest([review({ status: STATUS.REVIEW }), review({ status: STATUS.BROKEN })]).color).toBe(0xe74c3c);
  });

  it("trims long field names and values to Discord limits", () => {
    const embed = digest([
      review({
        displayName: "Very Long Site ".repeat(30),
        findings: Array.from({ length: 8 }, (_, index) => ({
          severity: "warn",
          area: "browser",
          title: `Finding ${index + 1}`,
          detail: "Long detail ".repeat(60),
          emoji: "🧪",
        })),
      }),
    ]);

    expect(embed.fields[0].name.length).toBeLessThanOrEqual(256);
    expect(embed.fields[0].value.length).toBeLessThanOrEqual(1024);
  });
});
