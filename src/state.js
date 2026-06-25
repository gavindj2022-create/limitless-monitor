export async function upsertDiscoveredSite(db, site, nowIso) {
  await db
    .prepare(
      `INSERT INTO sites (
        slug, display_name, url, project_name, source, first_seen_at, last_seen_at, config_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(slug) DO UPDATE SET
        display_name = excluded.display_name,
        url = excluded.url,
        project_name = excluded.project_name,
        source = excluded.source,
        last_seen_at = excluded.last_seen_at,
        config_json = excluded.config_json`
    )
    .bind(
      site.slug,
      site.displayName,
      site.url,
      site.projectName || "",
      site.source,
      nowIso,
      nowIso,
      JSON.stringify(site.config || {})
    )
    .run();
}

export async function listSites(db) {
  const result = await db.prepare("SELECT * FROM sites ORDER BY slug").all();
  return result.results || [];
}

export async function recordDailyReview(db, review) {
  const reviewStatement = db
    .prepare(
      `INSERT INTO daily_reviews (
        site_slug, review_date, status, summary, metrics_json, screenshots_json
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(site_slug, review_date) DO UPDATE SET
        status = excluded.status,
        summary = excluded.summary,
        metrics_json = excluded.metrics_json,
        screenshots_json = excluded.screenshots_json,
        created_at = CURRENT_TIMESTAMP`
    )
    .bind(
      review.siteSlug,
      review.reviewDate,
      review.status,
      review.summary,
      JSON.stringify(review.metrics || {}),
      JSON.stringify(review.screenshots || {})
    );

  const findingStatements = (review.findings || []).map((item) =>
    db
      .prepare(
        `INSERT INTO site_findings (
          site_slug, review_date, severity, area, title, detail, emoji
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        review.siteSlug,
        review.reviewDate,
        item.severity,
        item.area,
        item.title,
        item.detail,
        item.emoji
      )
  );

  await db.batch([reviewStatement, ...findingStatements]);
}
