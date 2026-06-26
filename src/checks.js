import { finding } from "./model.js";

const DEFAULT_SLOW_MS = 2500;
const BLANK_TEXT_LENGTH = 20;
const LARGE_IMAGE_BYTES = 2_000_000;
const MAX_IMAGE_PROBES = 20;
const DEFAULT_IMAGE_PROBE_TIMEOUT_MS = 5000;

export async function runCoreChecks(site, options = {}) {
  const fetcher = options.fetcher || fetch;
  const nowMs = options.nowMs || Date.now;
  const slowMs = options.slowMs || DEFAULT_SLOW_MS;
  const imageProbeTimeoutMs = options.imageProbeTimeoutMs || DEFAULT_IMAGE_PROBE_TIMEOUT_MS;
  const findings = [];
  const metrics = {
    responseMs: 0,
    imageCount: 0,
    formPresent: false,
    httpStatus: undefined,
  };

  let response;
  let html = "";
  const startedAt = nowMs();

  try {
    response = await fetcher(site.url, { redirect: "follow" });
    metrics.responseMs = nowMs() - startedAt;
    metrics.httpStatus = response.status;
    html = await response.text();
  } catch (error) {
    metrics.responseMs = nowMs() - startedAt;
    findings.push(
      finding(
        "error",
        "core",
        "Site did not load",
        error instanceof Error ? error.message : String(error),
        "🔴",
      ),
    );
    return { findings, metrics, html };
  }

  if (site.url.startsWith("https://") && response.url?.startsWith("http://")) {
    findings.push(
      finding(
        "error",
        "security",
        "HTTPS redirected to HTTP",
        `${site.url} redirected to ${response.url}`,
        "🔒",
      ),
    );
  }

  if (!response.ok) {
    findings.push(
      finding(
        "error",
        "core",
        "Site returned an error",
        `HTTP ${response.status}`,
        "🔴",
      ),
    );
    return { findings, metrics, html };
  }

  if (metrics.responseMs > slowMs) {
    findings.push(
      finding(
        "warn",
        "performance",
        "Slow response",
        `Response took ${metrics.responseMs}ms`,
        "⚡",
      ),
    );
  }

  metrics.formPresent = /<form\b/i.test(html);

  const textContent = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (html.trim().length < 80 || textContent.length < BLANK_TEXT_LENGTH) {
    findings.push(
      finding("warn", "content", "Page may be blank", "HTML content is very small.", "🧾"),
    );
  }

  const marker = site.config?.marker;
  if (marker && !html.includes(marker)) {
    findings.push(
      finding(
        "warn",
        "content",
        "Content marker missing",
        `Expected marker not found: ${marker}`,
        "🧾",
      ),
    );
  }

  addSeoFindings(html, findings);

  const images = parseImages(html, site.url);
  metrics.imageCount = images.length;
  await probeImages(images, fetcher, findings, imageProbeTimeoutMs);
  await probeFormEndpoint(site, fetcher, findings);

  return { findings, metrics, html };
}

function addSeoFindings(html, findings) {
  const title = firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i).trim();
  if (title.length < 10) {
    findings.push(
      finding(
        "warn",
        "seo",
        "Title missing or too short",
        "The page title is missing or very short.",
        "🔎",
      ),
    );
  }

  if (
    !hasTag(
      html,
      "meta",
      (tag) => readAttribute(tag, "name").toLowerCase() === "description"
        && Boolean(readAttribute(tag, "content").trim()),
    )
  ) {
    findings.push(
      finding("warn", "seo", "Meta description missing", "No meta description was found.", "🔎"),
    );
  }

  if (
    !hasTag(
      html,
      "link",
      (tag) => readAttribute(tag, "rel").toLowerCase().split(/\s+/).includes("canonical")
        && Boolean(readAttribute(tag, "href").trim()),
    )
  ) {
    findings.push(
      finding("warn", "seo", "Canonical link missing", "No canonical link was found.", "🔎"),
    );
  }

  if (
    !hasTag(
      html,
      "meta",
      (tag) => readAttribute(tag, "property").toLowerCase() === "og:image"
        && Boolean(readAttribute(tag, "content").trim()),
    )
  ) {
    findings.push(
      finding("warn", "seo", "Open Graph image missing", "No og:image meta tag was found.", "🔎"),
    );
  }
}

function parseImages(html, baseUrl) {
  const images = [];
  const imagePattern = /<img\b[^>]*>/gi;
  let match;

  while ((match = imagePattern.exec(html)) !== null) {
    const tag = match[0];
    const src = readAttribute(tag, "src");
    if (!src) {
      continue;
    }

    let url;
    try {
      url = new URL(src, baseUrl).toString();
    } catch {
      continue;
    }

    images.push({
      url,
      alt: readAttribute(tag, "alt"),
    });
  }

  return images;
}

async function probeImages(images, fetcher, findings, timeoutMs) {
  const imagesToProbe = firstUniqueImages(images, MAX_IMAGE_PROBES);
  const reportedMissingAlt = new Set();

  for (const image of images) {
    if (!image.alt?.trim() && !reportedMissingAlt.has(image.url)) {
      reportedMissingAlt.add(image.url);
      findings.push(
        finding(
          "warn",
          "images",
          "Image alt text missing",
          `Image is missing alt text: ${image.url}`,
          "🖼️",
        ),
      );
    }

  }

  for (const image of imagesToProbe) {
    const response = await fetchImageWithFallback(image.url, fetcher, timeoutMs);
    if (!response.ok) {
      findings.push(
        finding("warn", "images", "Image failed to load", `${image.url}: ${response.error || `HTTP ${response.status}`}`, "🖼️"),
      );
      continue;
    }

    const contentLength = Number(getHeader(response.response.headers, "content-length") || 0);
    if (contentLength > LARGE_IMAGE_BYTES) {
      findings.push(
        finding(
          "warn",
          "images",
          "Large image asset",
          `${image.url} is ${contentLength} bytes.`,
          "🖼️",
        ),
      );
    }
  }
}

async function fetchImageWithFallback(url, fetcher, timeoutMs) {
  let headResponse;

  try {
    headResponse = await fetchWithTimeout(fetcher, url, { method: "HEAD", redirect: "follow" }, timeoutMs);
    if (headResponse.ok) {
      return { ok: true, response: headResponse };
    }
  } catch {
    // Some hosts block HEAD even when the image is available via GET.
  }

  try {
    const getResponse = await fetchWithTimeout(fetcher, url, { method: "GET", redirect: "follow" }, timeoutMs);
    if (getResponse.ok) {
      return { ok: true, response: getResponse };
    }

    return { ok: false, status: getResponse.status };
  } catch (error) {
    return {
      ok: false,
      status: headResponse?.status,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function fetchWithTimeout(fetcher, url, options, timeoutMs) {
  const controller = typeof AbortController === "function" ? new AbortController() : undefined;
  let timeoutId;
  let timedOut = false;

  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      controller?.abort();
      reject(new Error("Image probe timed out"));
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      fetcher(url, {
        ...options,
        ...(controller ? { signal: controller.signal } : {}),
      }),
      timeout,
    ]);
  } catch (error) {
    if (timedOut) {
      throw new Error("Image probe timed out");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function firstUniqueImages(images, limit) {
  const uniqueImages = [];
  const seen = new Set();

  for (const image of images) {
    if (seen.has(image.url)) {
      continue;
    }

    seen.add(image.url);
    uniqueImages.push(image);

    if (uniqueImages.length >= limit) {
      break;
    }
  }

  return uniqueImages;
}

async function probeFormEndpoint(site, fetcher, findings) {
  const endpoint = site.config?.form?.endpoint || site.config?.formEndpoint || site.form?.endpoint;
  if (!endpoint) {
    return;
  }

  let url;
  try {
    url = new URL(endpoint, site.url).toString();
  } catch {
    findings.push(
      finding("warn", "forms", "Form endpoint returned an error", `Invalid form endpoint: ${endpoint}`, "🧾"),
    );
    return;
  }

  try {
    const response = await fetcher(url, { method: "GET", redirect: "follow" });
    if (response.status >= 500) {
      findings.push(
        finding("warn", "forms", "Form endpoint returned an error", `${url}: HTTP ${response.status}`, "🧾"),
      );
    }
  } catch (error) {
    findings.push(
      finding(
        "warn",
        "forms",
        "Form endpoint returned an error",
        `${url}: ${error instanceof Error ? error.message : String(error)}`,
        "🧾",
      ),
    );
  }
}

function readAttribute(tag, name) {
  return firstMatch(
    tag,
    new RegExp("\\b" + name + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s\"'=<>`]+))", "i"),
  );
}

function firstMatch(value, pattern) {
  const match = value.match(pattern);
  return match?.slice(1).find((group) => group !== undefined) || "";
}

function hasTag(html, tagName, predicate) {
  const pattern = new RegExp(`<${tagName}\\b[^>]*>`, "gi");
  let match;

  while ((match = pattern.exec(html)) !== null) {
    if (predicate(match[0])) {
      return true;
    }
  }

  return false;
}

function getHeader(headers, name) {
  if (!headers) {
    return undefined;
  }
  if (typeof headers.get === "function") {
    return headers.get(name);
  }
  return headers[name] || headers[name.toLowerCase()];
}
