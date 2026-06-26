export async function postDiscordWebhook(webhookUrl, payload, options = {}) {
  if (!webhookUrl) {
    throw new Error("Discord webhook URL is required");
  }

  const fetcher = options.fetcher || fetch;
  const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const response = await postJson(fetcher, webhookUrl, payload);

  if (response.status === 429) {
    const retryAfter = await readRetryAfter(response);
    await sleep(retryAfter * 1000);
    return handleResponse(await postJson(fetcher, webhookUrl, payload));
  }

  return handleResponse(response);
}

async function postJson(fetcher, webhookUrl, payload) {
  return fetcher(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function handleResponse(response) {
  if (response.ok) {
    return true;
  }

  const text = await response.text();
  throw new Error(`Discord webhook failed with HTTP ${response.status}: ${shortText(text)}`);
}

async function readRetryAfter(response) {
  try {
    const body = await response.json();
    return Number(body.retry_after || 0);
  } catch {
    return 0;
  }
}

function shortText(text) {
  return (text || "").replace(/\s+/g, " ").trim().slice(0, 160);
}
