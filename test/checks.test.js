import { describe, expect, it } from "vitest";
import { runCoreChecks } from "../src/checks.js";

function htmlResponse(html, init = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    url: init.url,
    headers: new Map(Object.entries(init.headers || {})),
    async text() {
      return html;
    },
  };
}

function assetResponse(init = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    url: init.url,
    headers: new Map(Object.entries(init.headers || {})),
    async text() {
      return "";
    },
  };
}

function nowSequence(...values) {
  let index = 0;
  return () => values[index++] ?? values[values.length - 1];
}

describe("core website maintenance checks", () => {
  it("returns no findings and useful metrics for healthy HTML", async () => {
    const calls = [];
    const fetcher = async (url, options = {}) => {
      calls.push({ url: String(url), options });

      if (url === "https://example.com") {
        return htmlResponse(`
          <!doctype html>
          <html>
            <head>
              <title>Example Marketing Site</title>
              <meta name="description" content="A useful description for search results.">
              <link rel="canonical" href="https://example.com">
              <meta property="og:image" content="https://example.com/social.png">
            </head>
            <body>
              <main>
                <p>Welcome marker</p>
                <img src="https://example.com/hero.jpg" alt="Product screenshot">
                <form action="/contact"></form>
              </main>
            </body>
          </html>
        `);
      }

      if (url === "https://example.com/hero.jpg") {
        expect(options.method).toBe("HEAD");
        return assetResponse({ headers: { "content-length": "120000" } });
      }

      if (url === "https://formspree.io/f/abc123") {
        expect(options.method).toBe("GET");
        return assetResponse();
      }

      throw new Error(`Unexpected URL ${url}`);
    };

    const result = await runCoreChecks(
      {
        url: "https://example.com",
        config: {
          marker: "Welcome marker",
          form: { endpoint: "https://formspree.io/f/abc123" },
        },
      },
      { fetcher, nowMs: nowSequence(1000, 1300) },
    );

    expect(result.findings).toEqual([]);
    expect(result.metrics).toEqual({
      responseMs: 300,
      imageCount: 1,
      formPresent: true,
      httpStatus: 200,
    });
    expect(result.html).toContain("Welcome marker");
    expect(calls.map((call) => [call.url, call.options.method])).toEqual([
      ["https://example.com", undefined],
      ["https://example.com/hero.jpg", "HEAD"],
      ["https://formspree.io/f/abc123", "GET"],
    ]);
  });

  it("flags a missing marker, missing image alt text, and unhealthy form endpoint", async () => {
    const fetcher = async (url) => {
      if (url === "https://example.com") {
        return htmlResponse(`
          <html>
            <head>
              <title>Example Marketing Site</title>
              <meta name="description" content="A useful description for search results.">
              <link rel="canonical" href="https://example.com">
              <meta property="og:image" content="https://example.com/social.png">
            </head>
            <body>
              <img src="https://example.com/hero.jpg">
              <form></form>
            </body>
          </html>
        `);
      }

      if (url === "https://example.com/hero.jpg") {
        return assetResponse();
      }

      if (url === "https://formspree.io/f/broken") {
        return assetResponse({ ok: false, status: 500 });
      }

      throw new Error(`Unexpected URL ${url}`);
    };

    const { findings } = await runCoreChecks(
      {
        url: "https://example.com",
        config: {
          marker: "Expected launch copy",
          form: { endpoint: "https://formspree.io/f/broken" },
        },
      },
      { fetcher, nowMs: nowSequence(0, 100) },
    );

    expect(findings.map((item) => item.title)).toEqual([
      "Content marker missing",
      "Image alt text missing",
      "Form endpoint returned an error",
    ]);
  });

  it("flags a non-ok site response", async () => {
    const fetcher = async () => htmlResponse("Service unavailable", { ok: false, status: 503 });

    const { findings, metrics } = await runCoreChecks(
      { url: "https://example.com" },
      { fetcher, nowMs: nowSequence(0, 75) },
    );

    expect(metrics.httpStatus).toBe(503);
    expect(findings).toContainEqual(
      expect.objectContaining({
        severity: "error",
        area: "core",
        title: "Site returned an error",
        emoji: "🔴",
      }),
    );
  });

  it("flags a blank or tiny page", async () => {
    const fetcher = async () => htmlResponse("<html></html>");

    const { findings } = await runCoreChecks(
      { url: "https://example.com" },
      { fetcher, nowMs: nowSequence(0, 50) },
    );

    expect(findings).toContainEqual(
      expect.objectContaining({
        severity: "warn",
        area: "content",
        title: "Page may be blank",
        emoji: "🧾",
      }),
    );
  });

  it("resolves and probes relative image URLs", async () => {
    const calls = [];
    const fetcher = async (url, options = {}) => {
      calls.push({ url: String(url), options });

      if (url === "https://example.com/products/widget") {
        return htmlResponse(`
          <html>
            <head>
              <title>Example Marketing Site</title>
              <meta name="description" content="A useful description for search results.">
              <link rel="canonical" href="https://example.com/products/widget">
              <meta property="og:image" content="/social.png">
            </head>
            <body>
              <img src="../assets/widget.jpg" alt="Widget">
            </body>
          </html>
        `);
      }

      if (url === "https://example.com/assets/widget.jpg") {
        expect(options.method).toBe("HEAD");
        return assetResponse();
      }

      throw new Error(`Unexpected URL ${url}`);
    };

    const { metrics } = await runCoreChecks(
      { url: "https://example.com/products/widget" },
      { fetcher, nowMs: nowSequence(0, 100) },
    );

    expect(metrics.imageCount).toBe(1);
    expect(calls.map((call) => [call.url, call.options.method])).toContainEqual([
      "https://example.com/assets/widget.jpg",
      "HEAD",
    ]);
  });
});
