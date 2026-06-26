import { finding } from "./model.js";

const VIEWPORTS = [
  { key: "mobile", width: 390, height: 844, emoji: "📱" },
  { key: "desktop", width: 1440, height: 1000, emoji: "🖥️" },
];

export async function runBrowserQa(site, options = {}) {
  if (!options.launchBrowser) {
    return {
      skipped: true,
      findings: [
        finding(
          "warn",
          "browser",
          "Browser QA skipped",
          "No Browser Run launcher was provided",
          "⚪",
        ),
      ],
      metrics: {},
      screenshots: {},
    };
  }

  const findings = [];
  const screenshots = {};
  const metrics = {
    consoleErrors: 0,
    renderedImages: 0,
    failedRenderedImages: 0,
    failedRequestUrls: [],
  };
  const browser = await options.launchBrowser();

  try {
    for (const viewport of VIEWPORTS) {
      await inspectViewport(browser, site, viewport, options, findings, metrics, screenshots);
    }
  } finally {
    await browser.close();
  }

  return {
    skipped: false,
    findings,
    metrics,
    screenshots,
  };
}

async function inspectViewport(browser, site, viewport, options, findings, metrics, screenshots) {
  const consoleErrors = [];
  const failedRequests = [];
  const page = await browser.newPage();

  try {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });
    page.on("requestfailed", (request) => {
      failedRequests.push(request.url());
    });

    await page.goto(site.url, { waitUntil: "networkidle", timeout: 30000 });
    const snapshot = await page.evaluate(inspectDom);
    addViewportFindings(viewport, snapshot, consoleErrors, findings, metrics);
    metrics.failedRequests = (metrics.failedRequests || 0) + failedRequests.length;
    metrics.failedRequestUrls.push(...failedRequests);

    if (options.captureScreenshots) {
      await page.screenshot({ fullPage: true });
      screenshots[viewport.key] = "captured";
    }
  } finally {
    await page.close();
  }
}

function addViewportFindings(viewport, snapshot, consoleErrors, findings, metrics) {
  if (viewport.key === "mobile" && snapshot.horizontalOverflow) {
    findings.push(finding(
      "warn",
      "mobile",
      "Mobile horizontal overflow",
      "The rendered page is wider than the mobile viewport.",
      "📱",
    ));
  }

  if (!snapshot.visibleHeading) {
    findings.push(finding(
      "warn",
      "content",
      "Main heading not visible",
      "No visible h1 was found in the rendered page.",
      viewport.emoji,
    ));
  }

  if (!snapshot.visibleCta) {
    findings.push(finding(
      "warn",
      "content",
      "Primary CTA not visible",
      "No visible button or call-to-action link was found in the rendered page.",
      viewport.emoji,
    ));
  }

  for (const message of consoleErrors) {
    metrics.consoleErrors += 1;
    findings.push(finding("warn", "browser", "Console error", message, "🧪"));
  }

  for (const image of snapshot.images || []) {
    metrics.renderedImages += 1;

    if (!image.loaded) {
      metrics.failedRenderedImages += 1;
      findings.push(finding(
        "warn",
        "images",
        "Rendered image failed",
        image.src || "An image did not finish loading.",
        "🖼️",
      ));
    }

    if (image.distorted) {
      findings.push(finding(
        "warn",
        "images",
        "Image may be distorted",
        image.src || "An image rendered with a distorted aspect ratio.",
        "🖼️",
      ));
    }
  }
}

function inspectDom() {
  const isVisible = (element) => {
    if (!element) {
      return false;
    }
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none"
      && style.visibility !== "hidden"
      && Number.parseFloat(style.opacity || "1") > 0
      && rect.width > 0
      && rect.height > 0;
  };
  const hasCtaText = (element) => /\b(book|buy|call|contact|get|join|learn|schedule|shop|sign|start|try)\b/i
    .test(element.textContent || "");

  return {
    horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth
      || document.body.scrollWidth > window.innerWidth,
    visibleHeading: Array.from(document.querySelectorAll("h1")).some(isVisible),
    visibleCta: Array.from(document.querySelectorAll("button, a, [role='button']"))
      .some((element) => isVisible(element) && (element.tagName === "BUTTON" || hasCtaText(element))),
    images: Array.from(document.images).map((image) => {
      const naturalRatio = image.naturalWidth && image.naturalHeight
        ? image.naturalWidth / image.naturalHeight
        : 0;
      const renderedRatio = image.clientWidth && image.clientHeight
        ? image.clientWidth / image.clientHeight
        : 0;

      return {
        src: image.currentSrc || image.src,
        loaded: image.complete && image.naturalWidth > 0,
        alt: image.getAttribute("alt") || "",
        distorted: naturalRatio > 0 && renderedRatio > 0 && Math.abs(naturalRatio - renderedRatio) > 0.2,
      };
    }),
  };
}
