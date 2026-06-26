import { STATUS, STATUS_EMOJI } from "./model.js";

const FIELD_NAME_LIMIT = 256;
const FIELD_VALUE_LIMIT = 1024;

const STATUS_COLOR = Object.freeze({
  [STATUS.HEALTHY]: 0x2ecc71,
  [STATUS.REVIEW]: 0xf1c40f,
  [STATUS.BROKEN]: 0xe74c3c,
  [STATUS.SKIPPED]: 0x95a5a6,
});

const STATUS_RANK = Object.freeze({
  [STATUS.HEALTHY]: 0,
  [STATUS.SKIPPED]: 1,
  [STATUS.REVIEW]: 2,
  [STATUS.BROKEN]: 3,
});

export function buildDailyDigest({ reviewDate, dailyTimeLabel, reviews }) {
  const reviewList = reviews || [];
  const worstStatus = reviewList.length > 0
    ? reviewList.reduce(
      (worst, review) => (STATUS_RANK[review.status] > STATUS_RANK[worst] ? review.status : worst),
      reviewList[0].status,
    )
    : STATUS.SKIPPED;

  return {
    embeds: [
      {
        title: `🩺 Site Sentinel Daily Review · ${reviewDate}`,
        description: `daily website maintenance check for the scheduled ${dailyTimeLabel} review.`,
        color: STATUS_COLOR[worstStatus],
        footer: { text: "Limitless · Site Sentinel" },
        timestamp: new Date().toISOString(),
        fields: reviewList.map(formatReviewField),
      },
    ],
  };
}

function formatReviewField(review) {
  return {
    name: trim(`${STATUS_EMOJI[review.status] || "⚪"} ${review.displayName || "Site"}`, FIELD_NAME_LIMIT),
    value: trim(formatReviewValue(review), FIELD_VALUE_LIMIT),
    inline: false,
  };
}

function formatReviewValue(review) {
  const findings = review.findings || [];
  const metrics = review.metrics || {};
  const lines = [];

  if (review.isNew) {
    lines.push("📡 Newly monitoring");
  }

  lines.push(`📱 Mobile: ${hasFinding(findings, "mobile") ? "Needs review" : "Good"}`);
  lines.push(`🖥️ Desktop: ${hasFinding(findings, "browser") ? "Needs review" : "Good"}`);
  lines.push(`🖼️ Images: ${metrics.imageCount || 0} checked, ${failedImageCount(metrics, findings)} failed`);
  lines.push(`🧾 Forms: ${metrics.formPresent ? "Present" : "Not detected"}`);
  lines.push(`⚡ Speed: ${metrics.responseMs ?? 0}ms`);

  for (const finding of findings.slice(0, 4)) {
    lines.push(`${finding.emoji || "🛠️"} ${finding.title}: ${finding.detail}`);
  }

  lines.push(`🛠️ Action: ${findings[0]?.detail || "None"}`);

  return lines.join("\n");
}

function hasFinding(findings, area) {
  return findings.some((finding) => finding.area === area);
}

function failedImageCount(metrics, findings) {
  return metrics.failedRenderedImages
    ?? metrics.failedImages
    ?? findings.filter((finding) => finding.area === "images" || finding.title?.toLowerCase().includes("image")).length;
}

function trim(value, limit) {
  if (value.length <= limit) {
    return value;
  }
  return value.slice(0, limit - 1).trimEnd() + "…";
}
