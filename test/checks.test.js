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

  it("accepts SEO metadata attributes in any order", async () => {
    const fetcher = async (url, options = {}) => {
      if (url === "https://example.com") {
        return htmlResponse(`
          <html>
            <head>
              <title>Example Marketing Site</title>
              <meta content="A useful description for search results." name="description">
              <link href="https://example.com" rel="canonical">
              <meta content="https://example.com/social.png" property="og:image">
            </head>
            <body>
              <p>This page has enough useful visible content for the check.</p>
              <img src=/hero.jpg alt=Hero>
            </body>
          </html>
        `);
      }

      if (url === "https://example.com/hero.jpg") {
        expect(options.method).toBe("HEAD");
        return assetResponse();
      }

      throw new Error(`Unexpected URL ${url}`);
    };

    const { findings, metrics } = await runCoreChecks(
      { url: "https://example.com" },
      { fetcher, nowMs: nowSequence(0, 100) },
    );

    expect(metrics.imageCount).toBe(1);
    expect(findings.map((item) => item.title)).not.toContain("Meta description missing");
    expect(findings.map((item) => item.title)).not.toContain("Canonical link missing");
    expect(findings.map((item) => item.title)).not.toContain("Open Graph image missing");
    expect(findings).toEqual([]);
  });

  it("falls back to GET when an image HEAD request fails or returns non-ok", async () => {
    const calls = [];
    const fetcher = async (url, options = {}) => {
      calls.push({ url: String(url), method: options.method });

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
              <p>This page has enough useful visible content for the check.</p>
              <img src="/head-throws.jpg" alt="First image">
              <img src="/head-404.jpg" alt="Second image">
            </body>
          </html>
        `);
      }

      if (url === "https://example.com/head-throws.jpg" && options.method === "HEAD") {
        throw new Error("HEAD unavailable");
      }

      if (url === "https://example.com/head-throws.jpg" && options.method === "GET") {
        return assetResponse({ headers: { "content-length": "120000" } });
      }

      if (url === "https://example.com/head-404.jpg" && options.method === "HEAD") {
        return assetResponse({ ok: false, status: 405 });
      }

      if (url === "https://example.com/head-404.jpg" && options.method === "GET") {
        return assetResponse({ headers: { "content-length": "130000" } });
      }

      throw new Error(`Unexpected URL ${url}`);
    };

    const { findings } = await runCoreChecks(
      { url: "https://example.com" },
      { fetcher, nowMs: nowSequence(0, 100) },
    );

    expect(findings).toEqual([]);
    expect(calls.map((call) => [call.url, call.method])).toEqual([
      ["https://example.com", undefined],
      ["https://example.com/head-throws.jpg", "HEAD"],
      ["https://example.com/head-throws.jpg", "GET"],
      ["https://example.com/head-404.jpg", "HEAD"],
      ["https://example.com/head-404.jpg", "GET"],
    ]);
  });

  it("deduplicates image probes and caps them at the first 20 unique image URLs", async () => {
    const imageTags = [
      '<img src="/asset-01.jpg" alt="Duplicate">',
      ...Array.from(
        { length: 25 },
        (_, index) => `<img src="/asset-${String(index + 1).padStart(2, "0")}.jpg" alt="Image ${index + 1}">`,
      ),
    ].join("\n");
    const calls = [];
    const fetcher = async (url, options = {}) => {
      calls.push({ url: String(url), method: options.method });

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
              <p>This page has enough useful visible content for the check.</p>
              ${imageTags}
            </body>
          </html>
        `);
      }

      if (url.startsWith("https://example.com/asset-")) {
        expect(options.method).toBe("HEAD");
        return assetResponse();
      }

      throw new Error(`Unexpected URL ${url}`);
    };

    const { metrics } = await runCoreChecks(
      { url: "https://example.com" },
      { fetcher, nowMs: nowSequence(0, 100) },
    );
    const imageProbeCalls = calls.filter((call) => call.method === "HEAD");

    expect(metrics.imageCount).toBe(26);
    expect(imageProbeCalls).toHaveLength(20);
    expect(new Set(imageProbeCalls.map((call) => call.url)).size).toBe(20);
    expect(imageProbeCalls.map((call) => call.url)).toContain("https://example.com/asset-20.jpg");
    expect(imageProbeCalls.map((call) => call.url)).not.toContain("https://example.com/asset-21.jpg");
  });

  it("flags HTTPS to HTTP redirects", async () => {
    const fetcher = async () => htmlResponse(`
      <html>
        <head>
          <title>Example Marketing Site</title>
          <meta name="description" content="A useful description for search results.">
          <link rel="canonical" href="https://example.com">
          <meta property="og:image" content="https://example.com/social.png">
        </head>
        <body><p>This page has enough useful visible content for the check.</p></body>
      </html>
    `, { url: "http://example.com" });

    const { findings } = await runCoreChecks(
      { url: "https://example.com" },
      { fetcher, nowMs: nowSequence(0, 100) },
    );

    expect(findings).toContainEqual(
      expect.objectContaining({
        severity: "error",
        area: "security",
        title: "HTTPS redirected to HTTP",
      }),
    );
  });

  it("flags slow responses", async () => {
    const fetcher = async () => htmlResponse(`
      <html>
        <head>
          <title>Example Marketing Site</title>
          <meta name="description" content="A useful description for search results.">
          <link rel="canonical" href="https://example.com">
          <meta property="og:image" content="https://example.com/social.png">
        </head>
        <body><p>This page has enough useful visible content for the check.</p></body>
      </html>
    `);

    const { findings } = await runCoreChecks(
      { url: "https://example.com" },
      { fetcher, nowMs: nowSequence(0, 2501) },
    );

    expect(findings).toContainEqual(
      expect.objectContaining({
        severity: "warn",
        area: "performance",
        title: "Slow response",
      }),
    );
  });

  it("flags large image assets", async () => {
    const fetcher = async (url, options = {}) => {
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
              <p>This page has enough useful visible content for the check.</p>
              <img src="/hero.jpg" alt="Hero">
            </body>
          </html>
        `);
      }

      if (url === "https://example.com/hero.jpg") {
        if (options.method === "HEAD") {
          return assetResponse({ ok: false, status: 405, headers: { "content-length": "2000001" } });
        }

        expect(options.method).toBe("GET");
        return assetResponse();
      }

      throw new Error(`Unexpected URL ${url}`);
    };

    const { findings } = await runCoreChecks(
      { url: "https://example.com" },
      { fetcher, nowMs: nowSequence(0, 100) },
    );

    expect(findings).toContainEqual(
      expect.objectContaining({
        severity: "warn",
        area: "images",
        title: "Large image asset",
      }),
    );
  });

  it("returns Site did not load when fetching the site throws", async () => {
    const fetcher = async () => {
      throw new Error("network down");
    };

    const { findings } = await runCoreChecks(
      { url: "https://example.com" },
      { fetcher, nowMs: nowSequence(0, 50) },
    );

    expect(findings).toContainEqual(
      expect.objectContaining({
        severity: "error",
        area: "core",
        title: "Site did not load",
      }),
    );
  });
});
