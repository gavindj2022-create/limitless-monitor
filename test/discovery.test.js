import { describe, expect, it } from "vitest";
import { discoverSites, mergeConfiguredSites } from "../src/discovery.js";

function jsonResponse(body, ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
    async json() {
      return body;
    },
  };
}

describe("Cloudflare Pages discovery", () => {
  it("discovers Pages projects, prefers active custom domains, ignores inactive domains, and merges config metadata", async () => {
    const calls = [];
    const fetcher = async (url, options = {}) => {
      const parsed = new URL(url);
      calls.push({ parsed, options });

      if (parsed.pathname === "/client/v4/accounts/acct-123/pages/projects") {
        return jsonResponse({
          success: true,
          result: [
            {
              name: "marketing-site",
              subdomain: "marketing-site.pages.dev",
              production_branch: "main",
            },
          ],
        });
      }

      if (parsed.pathname === "/client/v4/accounts/acct-123/pages/projects/marketing-site/domains") {
        return jsonResponse({
          success: true,
          result: [
            { name: "pending.example.com", status: "pending" },
            { name: "site.example.com", status: "active" },
            { name: "broken.example.com", status: "error" },
          ],
        });
      }

      throw new Error(`Unexpected URL ${url}`);
    };

    const sites = await discoverSites({
      accountId: "acct-123",
      apiToken: "token-abc",
      fetcher,
      configuredSites: [
        {
          slug: "marketing",
          projectName: "marketing-site",
          displayName: "Marketing",
          marker: "Hero copy",
          form: { selector: "#lead" },
          paused: true,
          preferredDomain: "site.example.com",
        },
      ],
    });

    expect(calls.map((call) => call.parsed.pathname)).toEqual([
      "/client/v4/accounts/acct-123/pages/projects",
      "/client/v4/accounts/acct-123/pages/projects/marketing-site/domains",
    ]);
    expect(calls[0].parsed.searchParams.get("page")).toBe("1");
    expect(calls[0].parsed.searchParams.get("per_page")).toBe("50");
    expect(calls.every((call) => call.options.headers.Authorization === "Bearer token-abc")).toBe(true);
    expect(sites).toEqual([
      {
        slug: "marketing",
        displayName: "Marketing",
        url: "https://site.example.com",
        projectName: "marketing-site",
        source: "cloudflare-pages",
        config: {
          marker: "Hero copy",
          form: { selector: "#lead" },
          paused: true,
          preferredDomain: "site.example.com",
          productionBranch: "main",
          pagesDevUrl: "https://marketing-site.pages.dev",
          domains: ["site.example.com"],
        },
      },
    ]);
  });

  it("paginates across Cloudflare Pages project pages", async () => {
    const projectPages = [];
    const fetcher = async (url) => {
      const parsed = new URL(url);

      if (parsed.pathname === "/client/v4/accounts/acct-123/pages/projects") {
        const page = parsed.searchParams.get("page");
        projectPages.push(page);
        return jsonResponse({
          success: true,
          result_info: { page: Number(page), total_pages: 2 },
          result: [
            {
              name: `project-${page}`,
              subdomain: `project-${page}.pages.dev`,
              production_branch: "main",
            },
          ],
        });
      }

      if (parsed.pathname.endsWith("/domains")) {
        return jsonResponse({ success: true, result: [] });
      }

      throw new Error(`Unexpected URL ${url}`);
    };

    const sites = await discoverSites({
      accountId: "acct-123",
      apiToken: "token-abc",
      fetcher,
    });

    expect(projectPages).toEqual(["1", "2"]);
    expect(sites.map((site) => site.slug)).toEqual(["project-1", "project-2"]);
    expect(sites.map((site) => site.url)).toEqual([
      "https://project-1.pages.dev",
      "https://project-2.pages.dev",
    ]);
  });

  it("includes external configured public sites with configured source", () => {
    const sites = mergeConfiguredSites([], [
      {
        slug: "external-site",
        displayName: "External Site",
        url: "https://external.example.com/",
        marker: "Welcome",
        form: { selector: "form" },
        paused: false,
      },
    ]);

    expect(sites).toEqual([
      {
        slug: "external-site",
        displayName: "External Site",
        url: "https://external.example.com",
        projectName: undefined,
        source: "configured",
        config: {
          marker: "Welcome",
          form: { selector: "form" },
          paused: false,
          preferredDomain: undefined,
          productionBranch: undefined,
          pagesDevUrl: undefined,
          domains: [],
        },
      },
    ]);
  });

  it("throws a clear credential error when account ID or API token is missing", async () => {
    await expect(discoverSites({ apiToken: "token-abc" })).rejects.toThrow(/cloudflare account id/i);
    await expect(discoverSites({ accountId: "acct-123" })).rejects.toThrow(/cloudflare api token/i);
  });
});
