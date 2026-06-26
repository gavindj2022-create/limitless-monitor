import { describe, expect, it } from "vitest";
import { postDiscordWebhook } from "../src/discord.js";

function response({ ok = true, status = 204, body = "" } = {}) {
  return {
    ok,
    status,
    async json() {
      return JSON.parse(body || "{}");
    },
    async text() {
      return body;
    },
  };
}

describe("Discord webhook posting", () => {
  it("posts embeds to the webhook as a JSON body", async () => {
    const calls = [];
    const fetcher = async (url, options) => {
      calls.push({ url, options });
      return response();
    };
    const payload = { embeds: [{ title: "Daily report" }] };

    await expect(postDiscordWebhook("https://discord.test/webhook", payload, { fetcher })).resolves.toBe(true);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://discord.test/webhook");
    expect(calls[0].options.method).toBe("POST");
    expect(calls[0].options.headers).toEqual({ "content-type": "application/json" });
    expect(calls[0].options.body).toBe(JSON.stringify(payload));
  });

  it("throws when webhook URL is missing", async () => {
    await expect(postDiscordWebhook("", { embeds: [] })).rejects.toThrow("Discord webhook URL is required");
  });

  it("retries once on rate limit using retry_after seconds before succeeding", async () => {
    const sleeps = [];
    const fetcher = async () => (
      sleeps.length === 0
        ? response({ ok: false, status: 429, body: JSON.stringify({ retry_after: 0.25 }) })
        : response()
    );
    const sleep = async (ms) => {
      sleeps.push(ms);
    };

    await expect(postDiscordWebhook("https://discord.test/webhook", { embeds: [] }, { fetcher, sleep }))
      .resolves.toBe(true);

    expect(sleeps).toEqual([250]);
  });

  it("throws instead of retrying forever when the retry also gets rate limited", async () => {
    const calls = [];
    const fetcher = async () => {
      calls.push("post");
      return response({ ok: false, status: 429, body: JSON.stringify({ retry_after: 0.1 }) });
    };
    const sleep = async () => {};

    await expect(postDiscordWebhook("https://discord.test/webhook", { embeds: [] }, { fetcher, sleep }))
      .rejects.toThrow(/Discord webhook failed with HTTP 429/);

    expect(calls).toHaveLength(2);
  });

  it("throws a useful error with HTTP status and short response text on non-ok response", async () => {
    const fetcher = async () => response({
      ok: false,
      status: 500,
      body: "Internal Server Error ".repeat(20),
    });

    await expect(postDiscordWebhook("https://discord.test/webhook", { embeds: [] }, { fetcher }))
      .rejects.toThrow(/Discord webhook failed with HTTP 500: Internal Server Error/);
  });
});
