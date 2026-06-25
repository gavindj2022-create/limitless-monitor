import { describe, expect, it } from "vitest";
import {
  listSites,
  recordDailyReview,
  upsertDiscoveredSite,
} from "../src/state.js";

function createFakeDb() {
  const store = {
    sites: new Map(),
    reviews: [],
    findings: [],
  };
  return {
    store,
    prepare(sql) {
      return {
        values: [],
        bind(...values) {
          this.values = values;
          return this;
        },
        async run() {
          if (sql.startsWith("INSERT INTO sites")) {
            const [slug, displayName, url, projectName, source, firstSeen, lastSeen, configJson] = this.values;
            const existing = store.sites.get(slug) || {};
            store.sites.set(slug, {
              ...existing,
              slug,
              display_name: displayName,
              url,
              project_name: projectName,
              source,
              first_seen_at: existing.first_seen_at || firstSeen,
              last_seen_at: lastSeen,
              config_json: configJson,
              paused: existing.paused || 0,
            });
          }
          if (sql.startsWith("INSERT INTO daily_reviews")) {
            store.reviews.push(this.values);
          }
          if (sql.startsWith("INSERT INTO site_findings")) {
            store.findings.push(this.values);
          }
          return { success: true };
        },
        async all() {
          if (sql.startsWith("SELECT * FROM sites")) {
            return { results: [...store.sites.values()].sort((a, b) => a.slug.localeCompare(b.slug)) };
          }
          return { results: [] };
        },
      };
    },
    async batch(statements) {
      const results = [];
      for (const statement of statements) {
        results.push(await statement.run());
      }
      return results;
    },
  };
}

describe("state", () => {
  it("upserts discovered sites and preserves first seen", async () => {
    const db = createFakeDb();
    const site = {
      slug: "je-ward",
      displayName: "J.E. Ward",
      url: "https://jewardllc.com",
      projectName: "je-ward",
      source: "cloudflare-pages",
      config: { marker: "J.E. Ward" },
    };

    await upsertDiscoveredSite(db, site, "2026-06-24T10:00:00Z");
    await upsertDiscoveredSite(db, site, "2026-06-25T10:00:00Z");

    const sites = await listSites(db);
    expect(sites).toHaveLength(1);
    expect(sites[0].first_seen_at).toBe("2026-06-24T10:00:00Z");
    expect(sites[0].last_seen_at).toBe("2026-06-25T10:00:00Z");
  });

  it("records daily review rows and finding rows", async () => {
    const db = createFakeDb();
    await recordDailyReview(db, {
      siteSlug: "je-ward",
      reviewDate: "2026-06-24",
      status: "review",
      summary: "Needs mobile polish",
      metrics: { responseMs: 900 },
      screenshots: { mobile: "posted" },
      findings: [
        { severity: "warn", area: "mobile", title: "CTA wraps", detail: "CTA wraps tightly", emoji: "📱" },
      ],
    });

    expect(db.store.reviews).toHaveLength(1);
    expect(db.store.findings).toHaveLength(1);
  });
});
