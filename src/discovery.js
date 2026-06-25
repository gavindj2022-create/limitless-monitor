import { normalizeUrl } from "./model.js";

const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4";

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function publicUrl(value) {
  if (!value) {
    return undefined;
  }
  const raw = String(value).trim();
  const prefixed = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return normalizeUrl(prefixed);
}

function projectDisplayName(projectName) {
  return String(projectName || "")
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

async function fetchCloudflare(fetcher, path, apiToken, searchParams = {}) {
  const url = new URL(`${CLOUDFLARE_API_BASE}${path}`);
  for (const [key, value] of Object.entries(searchParams)) {
    url.searchParams.set(key, String(value));
  }

  const response = await fetcher(url.toString(), {
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
  });
  const body = await response.json();

  if (!response.ok || body.success === false) {
    throw new Error(`Cloudflare API request failed for ${path}`);
  }

  return body;
}

function configMatchesSite(config, site) {
  const configSlug = slugify(config.slug);
  const configProjectSlug = slugify(config.projectName);
  const siteSlug = slugify(site.slug);
  const siteProjectSlug = slugify(site.projectName);

  return Boolean(
    (configSlug && configSlug === siteSlug) ||
      (configProjectSlug && configProjectSlug === siteProjectSlug)
  );
}

function siteConfig(site, config = {}) {
  return {
    marker: config.marker,
    form: config.form,
    paused: config.paused,
    preferredDomain: config.preferredDomain,
    productionBranch: site.config?.productionBranch,
    pagesDevUrl: site.config?.pagesDevUrl,
    domains: site.config?.domains || [],
  };
}

function applyConfig(site, config = {}) {
  return {
    slug: config.slug || site.slug,
    displayName: config.displayName || site.displayName,
    url: config.url ? normalizeUrl(config.url) : site.url,
    projectName: site.projectName || config.projectName,
    source: site.source,
    config: siteConfig(site, config),
  };
}

function configuredOnlySite(config) {
  return applyConfig(
    {
      slug: config.slug || slugify(config.projectName || config.displayName || config.url),
      displayName: config.displayName || config.projectName || config.slug,
      url: publicUrl(config.url),
      projectName: config.projectName,
      source: "configured",
      config: {
        productionBranch: undefined,
        pagesDevUrl: undefined,
        domains: [],
      },
    },
    config
  );
}

function sortBySlug(sites) {
  return [...sites].sort((a, b) => a.slug.localeCompare(b.slug));
}

export function mergeConfiguredSites(projectSites, configuredSites = []) {
  const matchedConfigs = new Set();
  const mergedProjectSites = projectSites.map((site) => {
    const configIndex = configuredSites.findIndex((config) => configMatchesSite(config, site));
    if (configIndex === -1) {
      return applyConfig(site);
    }
    matchedConfigs.add(configIndex);
    return applyConfig(site, configuredSites[configIndex]);
  });

  const configuredOnlySites = configuredSites
    .filter((_, index) => !matchedConfigs.has(index))
    .map((config) => configuredOnlySite(config));

  return sortBySlug([...mergedProjectSites, ...configuredOnlySites]);
}

async function discoverProjectDomains({ accountId, apiToken, fetcher, projectName }) {
  const encodedProjectName = encodeURIComponent(projectName);
  const body = await fetchCloudflare(
    fetcher,
    `/accounts/${accountId}/pages/projects/${encodedProjectName}/domains`,
    apiToken
  );

  return (body.result || [])
    .filter((domain) => domain.status === "active" && domain.name)
    .map((domain) => domain.name);
}

function projectSite(project, domains) {
  const projectName = project.name;
  const pagesDevHost = project.subdomain || `${projectName}.pages.dev`;
  const publicHost = domains[0] || pagesDevHost;

  return {
    slug: slugify(projectName),
    displayName: projectDisplayName(projectName),
    url: publicUrl(publicHost),
    projectName,
    source: "cloudflare-pages",
    config: {
      marker: undefined,
      form: undefined,
      paused: undefined,
      preferredDomain: undefined,
      productionBranch: project.production_branch,
      pagesDevUrl: publicUrl(pagesDevHost),
      domains,
    },
  };
}

export async function discoverSites({
  accountId,
  apiToken,
  configuredSites = [],
  fetcher = fetch,
} = {}) {
  if (!accountId) {
    throw new Error("Cloudflare account ID is required to discover Pages sites");
  }
  if (!apiToken) {
    throw new Error("Cloudflare API token is required to discover Pages sites");
  }

  const projects = [];
  let page = 1;
  let totalPages = 1;

  do {
    const body = await fetchCloudflare(
      fetcher,
      `/accounts/${accountId}/pages/projects`,
      apiToken,
      { page, per_page: 50 }
    );
    projects.push(...(body.result || []));
    totalPages = body.result_info?.total_pages || 1;
    page += 1;
  } while (page <= totalPages);

  const projectSites = [];
  for (const project of projects) {
    const domains = await discoverProjectDomains({
      accountId,
      apiToken,
      fetcher,
      projectName: project.name,
    });
    projectSites.push(projectSite(project, domains));
  }

  return mergeConfiguredSites(projectSites, configuredSites);
}
