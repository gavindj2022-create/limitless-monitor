export const STATUS = Object.freeze({
  HEALTHY: "healthy",
  REVIEW: "review",
  BROKEN: "broken",
  SKIPPED: "skipped",
});

export const STATUS_EMOJI = Object.freeze({
  [STATUS.HEALTHY]: "✅",
  [STATUS.REVIEW]: "🟡",
  [STATUS.BROKEN]: "🔴",
  [STATUS.SKIPPED]: "⚪",
});

export function isoDate(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

export function normalizeUrl(value) {
  const parsed = new URL(value);
  parsed.hash = "";
  if (parsed.pathname !== "/" && parsed.pathname.endsWith("/")) {
    parsed.pathname = parsed.pathname.slice(0, -1);
  }
  let normalized = parsed.toString();
  if (parsed.pathname === "/" && !parsed.search) {
    normalized = `${parsed.origin}`;
  }
  return normalized;
}

export function finding(severity, area, title, detail, emoji = "🛠️") {
  return {
    severity,
    area,
    title,
    detail,
    emoji,
  };
}

export function scoreStatus(findings = []) {
  if (findings.some((item) => item.severity === "error")) {
    return STATUS.BROKEN;
  }
  if (findings.some((item) => item.severity === "warn")) {
    return STATUS.REVIEW;
  }
  return STATUS.HEALTHY;
}

export function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value || "");
  } catch {
    return fallback;
  }
}
