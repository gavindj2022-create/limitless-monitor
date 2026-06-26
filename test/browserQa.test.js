import { describe, expect, it } from "vitest";
import { finding } from "../src/model.js";
import { runBrowserQa } from "../src/browserQa.js";

function domSnapshot(overrides = {}) {
  return {
    horizontalOverflow: false,
    visibleHeading: true,
    visibleCta: true,
    images: [],
    ...overrides,
  };
}

function makePage(snapshotsByViewport, options = {}) {
  const handlers = {};
  const page = {
    screenshots: 0,
    closed: false,
    viewportKey: undefined,
    async setViewportSize(size) {
      page.viewportKey = size.width === 390 ? "mobile" : "desktop";
    },
    on(event, handler) {
      handlers[event] = handler;
    },
    async goto(url, gotoOptions) {
      if (options.throwOnGoto) {
        throw new Error("navigation failed");
      }
      expect(url).toBe("https://example.com");
      expect(gotoOptions).toEqual({ waitUntil: "networkidle", timeout: 30000 });
      handlers.console?.({
        type: () => "error",
        text: () => `${page.viewportKey} console failed`,
      });
      handlers.requestfailed?.({
        url: () => `https://example.com/${page.viewportKey}-asset.js`,
      });
    },
    async evaluate() {
      if (options.throwOnEvaluate) {
        throw new Error("evaluate failed");
      }
      return snapshotsByViewport[page.viewportKey] ?? domSnapshot();
    },
    async screenshot(options) {
      expect(options).toEqual({ fullPage: true });
      page.screenshots += 1;
      return Buffer.from("fake screenshot");
    },
    async close() {
      page.closed = true;
    },
  };
  return page;
}

function makeBrowser(pageFactory) {
  const browser = {
    pages: [],
    closed: false,
    async newPage() {
      const page = pageFactory();
      browser.pages.push(page);
      return page;
    },
    async close() {
      browser.closed = true;
    },
  };
  return browser;
}

describe("browser QA checks", () => {
  it("flags mobile overflow, console error, missing CTA, rendered image failure, and captures mobile screenshot", async () => {
    const browser = makeBrowser(() => makePage({
      mobile: domSnapshot({
        horizontalOverflow: true,
        visibleCta: false,
        images: [{ src: "https://example.com/hero.jpg", loaded: false, alt: "Hero", distorted: false }],
      }),
      desktop: domSnapshot(),
    }));

    const result = await runBrowserQa(
      { url: "https://example.com" },
      { launchBrowser: async () => browser, captureScreenshots: true },
    );

    expect(result.skipped).toBe(false);
    expect(result.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: "warn",
        area: "mobile",
        title: "Mobile horizontal overflow",
        emoji: "\u{1f4f1}",
      }),
      expect.objectContaining({
        severity: "warn",
        area: "content",
        title: "Primary CTA not visible",
        emoji: "\u{1f4f1}",
      }),
      expect.objectContaining({
        severity: "warn",
        area: "browser",
        title: "Console error",
        emoji: "\u{1f9ea}",
      }),
      expect.objectContaining({
        severity: "warn",
        area: "images",
        title: "Rendered image failed",
        emoji: "\u{1f5bc}\ufe0f",
      }),
    ]));
    expect(result.screenshots.mobile).toBe("captured");
    expect(browser.pages[0].screenshots).toBe(1);
    expect(result.metrics.failedRequestUrls).toContain("https://example.com/mobile-asset.js");
  });

  it("returns skipped result when no browser launcher is provided", async () => {
    await expect(runBrowserQa({ url: "https://example.com" })).resolves.toEqual({
      skipped: true,
      findings: [
        finding(
          "warn",
          "browser",
          "Browser QA skipped",
          "No Browser Run launcher was provided",
          "\u26aa",
        ),
      ],
      metrics: {},
      screenshots: {},
    });
  });

  it("closes the browser even if navigation throws", async () => {
    const browser = makeBrowser(() => makePage({}, { throwOnGoto: true }));

    await expect(runBrowserQa(
      { url: "https://example.com" },
      { launchBrowser: async () => browser },
    )).rejects.toThrow("navigation failed");

    expect(browser.closed).toBe(true);
  });

  it("counts rendered images and failed rendered images in metrics", async () => {
    const browser = makeBrowser(() => makePage({
      mobile: domSnapshot({
        images: [
          { src: "https://example.com/one.jpg", loaded: true, alt: "One", distorted: false },
          { src: "https://example.com/two.jpg", loaded: false, alt: "Two", distorted: false },
        ],
      }),
      desktop: domSnapshot({
        images: [
          { src: "https://example.com/three.jpg", loaded: true, alt: "Three", distorted: false },
        ],
      }),
    }));

    const result = await runBrowserQa(
      { url: "https://example.com" },
      { launchBrowser: async () => browser },
    );

    expect(result.metrics).toMatchObject({
      renderedImages: 3,
      failedRenderedImages: 1,
    });
  });

  it("uses the desktop emoji when the desktop main heading is missing", async () => {
    const browser = makeBrowser(() => makePage({
      mobile: domSnapshot(),
      desktop: domSnapshot({ visibleHeading: false }),
    }));

    const result = await runBrowserQa(
      { url: "https://example.com" },
      { launchBrowser: async () => browser },
    );

    expect(result.findings).toContainEqual(expect.objectContaining({
      severity: "warn",
      area: "content",
      title: "Main heading not visible",
      emoji: "\u{1f5a5}\ufe0f",
    }));
  });
});
