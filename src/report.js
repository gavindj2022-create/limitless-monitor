import { STATUS, STATUS_EMOJI } from "./model.js";

const FIELD_NAME_LIMIT = 256;
const FIELD_VALUE_LIMIT = 700;
const EMBED_FIELD_LIMIT = 25;
const EMBED_CHARACTER_BUDGET = 5200;
const PAYLOAD_CHARACTER_BUDGET = 5200;
const PAYLOAD_EMBED_LIMIT = 10;

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
  return buildDailyDigestPayloads({ reviewDate, dailyTimeLabel, reviews })[0];
}

export function buildDailyDigestPayloads({ reviewDate, dailyTimeLabel, reviews }) {
  const reviewList = reviews || [];
  const worstStatus = reviewList.length > 0
    ? reviewList.reduce(
      (worst, review) => (STATUS_RANK[review.status] > STATUS_RANK[worst] ? review.status : worst),
      reviewList[0].status,
    )
    : STATUS.SKIPPED;
  const fields = reviewList.map(formatReviewField);
  const fieldChunks = chunkFields(fields, reviewDate, dailyTimeLabel);
  const timestamp = new Date().toISOString();
  const embeds = fieldChunks.map((chunkFields, index) => ({
    title: formatTitle(reviewDate, index, fieldChunks.length),
    description: `daily website maintenance check for the scheduled ${dailyTimeLabel} review.`,
    color: STATUS_COLOR[worstStatus],
    footer: { text: "Limitless · Site Sentinel" },
    timestamp,
    fields: chunkFields,
  }));

  return chunkPayloads(embeds).map((payloadEmbeds) => ({ embeds: payloadEmbeds }));
}

function formatTitle(reviewDate, index, total) {
  const title = `🩺 Site Sentinel Daily Review · ${reviewDate}`;
  return total > 1 ? `${title} · Part ${index + 1}` : title;
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

function chunkFields(fields, reviewDate, dailyTimeLabel) {
  if (fields.length === 0) {
    return [[]];
  }

  const chunks = [];
  let current = [];
  let currentCharacters = embedBaseCharacters(reviewDate, dailyTimeLabel);

  for (const field of fields) {
    const fieldCharacters = field.name.length + field.value.length;
    const wouldExceedFieldLimit = current.length >= EMBED_FIELD_LIMIT;
    const wouldExceedCharacterBudget = current.length > 0
      && currentCharacters + fieldCharacters > EMBED_CHARACTER_BUDGET;

    if (wouldExceedFieldLimit || wouldExceedCharacterBudget) {
      chunks.push(current);
      current = [];
      currentCharacters = embedBaseCharacters(reviewDate, dailyTimeLabel);
    }

    current.push(field);
    currentCharacters += fieldCharacters;
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks;
}

function embedBaseCharacters(reviewDate, dailyTimeLabel) {
  return [
    formatTitle(reviewDate, 98, 99),
    `daily website maintenance check for the scheduled ${dailyTimeLabel} review.`,
    "Limitless · Site Sentinel",
  ].reduce((total, value) => total + value.length, 0);
}

function chunkPayloads(embeds) {
  const payloads = [];
  let current = [];
  let currentCharacters = 0;

  for (const embed of embeds) {
    const embedCharacters = embedCharacterCount(embed);
    const wouldExceedEmbedLimit = current.length >= PAYLOAD_EMBED_LIMIT;
    const wouldExceedCharacterBudget = current.length > 0
      && currentCharacters + embedCharacters > PAYLOAD_CHARACTER_BUDGET;

    if (wouldExceedEmbedLimit || wouldExceedCharacterBudget) {
      payloads.push(current);
      current = [];
      currentCharacters = 0;
    }

    current.push(embed);
    currentCharacters += embedCharacters;
  }

  if (current.length > 0) {
    payloads.push(current);
  }

  return payloads;
}

function embedCharacterCount(embed) {
  return [
    embed.title,
    embed.description,
    embed.footer?.text,
    ...embed.fields.flatMap((field) => [field.name, field.value]),
  ].reduce((total, value) => total + (value || "").length, 0);
}
