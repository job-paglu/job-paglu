#!/usr/bin/env node
/**
 * scripts/scrape.js
 *
 * Publicly-scoped scraper: downloads a public Linktree page (no login, no
 * private API) and a public GitHub user profile (public REST API, no token
 * required), merges them into /data/profile.json, and re-generates the
 * SEO block inside index.html plus /robots.txt and /sitemap.xml.
 *
 * Design goals:
 *  - Resilient to minor Linktree markup/schema changes: instead of relying
 *    on fixed CSS selectors, it locates the Next.js `__NEXT_DATA__` JSON
 *    payload embedded in the page and walks it generically, looking for
 *    keys that "look like" the data we want, wherever they live in the tree.
 *  - Never destructive: output is only written after everything succeeds.
 *    If anything fails, the previous data/profile.json (and index.html) are
 *    left untouched, and the error is logged.
 *  - Zero third-party dependencies: only Node.js built-ins.
 */

import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const DATA_PATH = path.join(ROOT, 'data', 'profile.json');
const INDEX_PATH = path.join(ROOT, 'index.html');
const ROBOTS_PATH = path.join(ROOT, 'robots.txt');
const SITEMAP_PATH = path.join(ROOT, 'sitemap.xml');

const LINKTREE_URL =
  process.env.LINKTREE_URL || 'https://linktr.ee/karrarhussainjobs';

// Custom domain configured for GitHub Pages (see /CNAME). Canonical URLs,
// robots.txt and sitemap.xml all point here rather than at *.github.io so
// search engines and AdSense see a single origin for the site.
const SITE_URL = process.env.SITE_URL || 'https://jobpaglu.eu.cc/';

const FETCH_TIMEOUT_MS = 15_000;

// Realistic Chrome-on-Windows header set. Linktree's edge WAF rejects
// (HTTP 406 Not Acceptable) requests that claim to be a browser in the
// User-Agent but send a non-browser-shaped Accept header. Specifically
// `Accept: text/html,application/xhtml+xml` (no quality list, no
// image/webp, no */* fallback) is the fingerprint that trips the 406.
// Sending the full browser set — including Accept-Encoding: gzip and
// the Sec-Fetch-* / Sec-Ch-Ua family — has been verified (Sep 2026)
// to consistently return 200 from local machines.
//
// IMPORTANT (Sep 2026): GitHub Actions egress IPs are flagged by
// Linktree's WAF regardless of the headers sent. The scraper therefore
// retries with backoff and rotates through several UA strings, then
// falls back to r.jina.ai as a last-resort reader-proxy. See
// `fetchWithRetry()` and `fetchText()` below.
const BROWSER_UAS = [
  // Chrome 124 on Windows (primary)
  {
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    platform: '"Windows"',
    chUa: '"Chromium";v="124", "Google Chrome";v="124", "Not.A/Brand";v="99"',
  },
  // Safari 17 on macOS (different browser, different fingerprint)
  {
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 ' +
        '(KHTML, like Gecko) Version/17.0 Safari/605.1.15',
    platform: '"macOS"',
    // Safari doesn't send Sec-Ch-Ua family — omit them entirely
    noChUa: true,
  },
  // Chrome 124 on Linux (what GH Actions runners actually run)
  {
    ua: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    platform: '"Linux"',
    chUa: '"Chromium";v="124", "Google Chrome";v="124", "Not.A/Brand";v="99"',
  },
  // Mobile Safari (drastically different fingerprint, often bypasses WAF rules
  // that target desktop Chrome fingerprints)
  {
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) ' +
        'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    platform: '"iOS"',
    noChUa: true,
  },
];

/** Build a full browser-headers object for the given UA profile. */
function buildBrowserHeaders(uaProfile) {
  const h = {
    'User-Agent': uaProfile.ua,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
  };
  if (!uaProfile.noChUa) {
    h['Sec-Ch-Ua'] = uaProfile.chUa;
    h['Sec-Ch-Ua-Mobile'] = '?0';
    h['Sec-Ch-Ua-Platform'] = uaProfile.platform;
  }
  return h;
}

// Pre-built header sets for each UA in BROWSER_UAS, used in rotation.
const BROWSER_HEADERS_SET = BROWSER_UAS.map(buildBrowserHeaders);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Single fetch attempt with timeout + headers. Returns Response or throws. */
async function singleFetch(url, headers, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers,
      redirect: 'follow',
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch with retry + UA rotation + r.jina.ai fallback.
 *
 * Strategy:
 *  1. Try each of the 4 UA profiles in turn, with a short backoff between.
 *  2. If all direct attempts fail (406/403/5xx/timeout), retry the rotation
 *     once more after a longer backoff — Linktree's WAF uses sliding-window
 *     rate limits, so simply waiting often unblocks the IP.
 *  3. As a last resort, fetch via r.jina.ai (a free public reader-proxy
 *     that returns the page text with bots/JS stripped). The data we need
 *     (__NEXT_DATA__ JSON) is in the HTML source, so we read raw bytes
 *     rather than the reader-formatted Markdown endpoint.
 *
 * The fallback is only triggered if direct fetch fails, so residential
 * IPs (local development, the very first CI runs) won't pay any extra
 * latency.
 */
async function fetchText(url) {
  const directErrors = [];

  // Two passes over the UA rotation, with a longer backoff between passes.
  for (let pass = 0; pass < 2; pass++) {
    if (pass > 0) {
      console.log(`[scrape] Direct fetch pass 1 exhausted, waiting 8s before retry...`);
      await sleep(8_000);
    }
    for (let i = 0; i < BROWSER_HEADERS_SET.length; i++) {
      const headers = BROWSER_HEADERS_SET[i];
      const uaShort = headers['User-Agent'].slice(0, 60);
      try {
        const res = await singleFetch(url, headers);
        if (res.ok) {
          const text = await res.text();
          // A WAF challenge/interstitial page also comes back as HTTP 200,
          // but without the __NEXT_DATA__ payload we parse. Treat that as
          // a failed attempt so we rotate UAs and, if needed, fall back.
          if (!text.includes('__NEXT_DATA__')) {
            directErrors.push(`pass${pass + 1}-ua${i + 1}: HTTP 200 without __NEXT_DATA__ (${text.length} chars)`);
            console.log(`[scrape] Direct fetch UA #${i + 1} (${uaShort}...) returned 200 but no __NEXT_DATA__.`);
            await sleep(1_500);
            continue;
          }
          if (pass > 0 || i > 0) {
            console.log(`[scrape] Direct fetch succeeded on pass ${pass + 1} UA #${i + 1}.`);
          }
          return text;
        }
        // 406 / 403 / 5xx → try next UA. 4xx other than 406/403 likely means
        // the page is genuinely gone, but we still try alternates before
        // giving up.
        const msg = `HTTP ${res.status}`;
        directErrors.push(`pass${pass + 1}-ua${i + 1}: ${msg}`);
        console.log(`[scrape] Direct fetch UA #${i + 1} (${uaShort}...) returned ${msg}.`);
      } catch (err) {
        directErrors.push(`pass${pass + 1}-ua${i + 1}: ${err.name || 'Error'} ${err.message}`);
        console.log(`[scrape] Direct fetch UA #${i + 1} (${uaShort}...) threw: ${err.message}`);
      }
      // Small backoff between UAs in same pass
      await sleep(1_500);
    }
  }

  // All direct attempts failed — fall back to r.jina.ai reader-proxy.
  // r.jina.ai fetches the URL server-side from its own IPs. It returns
  // Markdown by default, whatever Accept header is sent, and Markdown has
  // no __NEXT_DATA__ block (so parsing yields zero links). The
  // `X-Return-Format: html` header makes it return the page's HTML, which
  // does include __NEXT_DATA__ (verified Sep 2026).
  console.log(`[scrape] All direct fetches failed (${directErrors.length} attempts).`);
  console.log(`[scrape] Falling back to r.jina.ai reader-proxy...`);
  const jinaUrl = `https://r.jina.ai/${url}`;
  try {
    const res = await singleFetch(
      jinaUrl,
      {
        // r.jina.ai asks for an API key for anonymous queries from
        // low-reputation IPs, but a normal User-Agent helps.
        'User-Agent': 'Mozilla/5.0 (compatible; linktree-scraper/1.0)',
        'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
        'X-Return-Format': 'html',
      },
      60_000, // r.jina.ai can be slow, and the HTML is several MB
    );
    if (res.ok) {
      const text = await res.text();
      if (text && text.length > 1000) {
        console.log(`[scrape] r.jina.ai returned ${text.length} chars.`);
        if (!text.includes('__NEXT_DATA__')) {
          console.log('[scrape] r.jina.ai response has no __NEXT_DATA__ block; parsing will likely find zero links.');
        }
        return text;
      }
      directErrors.push(`jina: too short (${text.length} chars)`);
    } else {
      directErrors.push(`jina: HTTP ${res.status}`);
      console.log(`[scrape] r.jina.ai returned HTTP ${res.status}.`);
    }
  } catch (err) {
    directErrors.push(`jina: ${err.message}`);
    console.log(`[scrape] r.jina.ai threw: ${err.message}`);
  }

  throw new Error(
    `All fetch attempts failed for ${url}.\n` +
      `  Attempts: ${directErrors.length}\n` +
      `  Errors: ${directErrors.join('; ')}`
  );
}

async function fetchJson(url, headers = {}) {
  // JSON endpoints (api.github.com) don't have Linktree's WAF, so a single
  // attempt with the first browser header set is enough. Auth via
  // GITHUB_TOKEN keeps us off the 60/hour unauthenticated cap.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { ...BROWSER_HEADERS_SET[0], Accept: 'application/json', ...headers },
    });
    if (!res.ok) {
      throw new Error(`Request to ${url} failed with HTTP ${res.status}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

const SEO_START = '<!-- SEO:START -->';
const SEO_END = '<!-- SEO:END -->';

/* --------------------------------------------------------------------- */
/* Generic helpers                                                        */
/* --------------------------------------------------------------------- */

/** Recursively walk an arbitrary JSON value, calling `visit` on every
 * plain object encountered. Used to hunt for data without depending on an
 * exact, brittle schema path. */
function walk(value, visit, seen = new Set()) {
  if (!value || typeof value !== 'object') return;
  if (seen.has(value)) return;
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit, seen);
    return;
  }
  visit(value);
  for (const key of Object.keys(value)) walk(value[key], visit, seen);
}

/** Find the first string value assigned to any of the given key names,
 * scanning the whole object tree breadth-first-ish via `walk`. */
function findFirstString(root, keyNames) {
  let found;
  walk(root, (obj) => {
    if (found) return;
    for (const key of keyNames) {
      const val = obj[key];
      if (typeof val === 'string' && val.trim().length > 0) {
        found = val.trim();
        return;
      }
    }
  });
  return found;
}

/** Collect every array-of-objects in the tree whose items look like
 * "link" entries (have a usable url + a label of some kind). */
function findLinkArrays(root) {
  const collected = [];
  walk(root, (obj) => {
    for (const key of Object.keys(obj)) {
      const val = obj[key];
      if (!Array.isArray(val) || val.length === 0) continue;
      const looksLikeLinks = val.every(
        (item) =>
          item &&
          typeof item === 'object' &&
          typeof (item.url ?? item.link ?? item.href) === 'string'
      );
      if (looksLikeLinks) collected.push(val);
    }
  });
  return collected;
}

function normaliseLinks(rawArrays) {
  const seenUrls = new Set();
  const links = [];
  for (const arr of rawArrays) {
    for (const item of arr) {
      const url = item.url ?? item.link ?? item.href;
      if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url)) continue;
      if (seenUrls.has(url)) continue;
      const title =
        item.title ?? item.text ?? item.label ?? item.name ?? deriveTitleFromUrl(url);
      // Skip Linktree's own internal/tracking style entries with no useful title.
      if (!title) continue;
      seenUrls.add(url);
      links.push({
        id: item.id ? String(item.id) : `link-${links.length + 1}`,
        title: String(title).trim(),
        url,
        type: item.type ? String(item.type) : 'link',
      });
    }
  }
  return links;
}

function deriveTitleFromUrl(url) {
  try {
    const { hostname } = new URL(url);
    return hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

const SOCIAL_DOMAINS = [
  'instagram.com',
  'twitter.com',
  'x.com',
  'facebook.com',
  'youtube.com',
  'tiktok.com',
  'linkedin.com',
  'github.com',
  'snapchat.com',
  'pinterest.com',
  'twitch.tv',
  'discord.gg',
  'discord.com',
  'telegram.me',
  't.me',
  'whatsapp.com',
  'spotify.com',
];

/** Return the first domain in `domains` that the URL's *hostname* is (or is
 * a subdomain of). Matching anywhere in the full URL string would
 * false-positive on links that merely mention e.g. "linkedin.com" inside a
 * tracking query parameter (utm_source=linkedin.com etc). */
function hostnameMatches(url, domains) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    return domains.find((d) => hostname === d || hostname.endsWith(`.${d}`));
  } catch {
    return undefined;
  }
}

function hostnameMatchesSocialDomain(url) {
  return hostnameMatches(url, SOCIAL_DOMAINS);
}

// Destinations that should never be rendered as link cards. This page is a
// job board; Linktree additionally surfaces the profile's own YouTube
// channel as a dedicated tile, which isn't a job posting and takes the top
// slot on the site. Excluded links are still fed to extractSocials(), so
// the channel remains recorded under `socials` in data/profile.json.
const EXCLUDED_DOMAINS = ['youtube.com', 'youtu.be'];

// Linktree tags its embed tiles by type ("YOUTUBE", "YOUTUBE_VIDEO", ...);
// catch those even if the underlying URL is a redirector we don't
// recognise by hostname.
const EXCLUDED_TYPE_PATTERN = /^youtube/i;

/** Hostname-scoped so a genuine job posting whose URL merely contains the
 * word "youtube" — e.g. a Google careers listing for a YouTube team — is
 * kept. */
function isExcludedLink(link) {
  if (EXCLUDED_TYPE_PATTERN.test(link.type || '')) return true;
  return Boolean(hostnameMatches(link.url, EXCLUDED_DOMAINS));
}

function extractSocials(links, root) {
  const fromLinks = links
    .map((l) => ({ domain: hostnameMatchesSocialDomain(l.url), url: l.url }))
    .filter((entry) => entry.domain)
    .map((entry) => ({ platform: entry.domain.split('.')[0], url: entry.url }));

  // Also look for a dedicated "socialLinks" style structure, common on
  // Linktree, in case those aren't rendered as regular link entries.
  const dedicated = [];
  walk(root, (obj) => {
    for (const key of Object.keys(obj)) {
      if (!/social/i.test(key)) continue;
      const val = obj[key];
      if (!Array.isArray(val)) continue;
      for (const item of val) {
        const url = item?.url ?? item?.link;
        if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
          const domain = hostnameMatchesSocialDomain(url);
          dedicated.push({ platform: item?.type ?? domain?.split('.')[0] ?? 'link', url });
        }
      }
    }
  });

  const merged = [...fromLinks, ...dedicated];
  const seen = new Set();
  return merged.filter((s) => {
    if (seen.has(s.url)) return false;
    seen.add(s.url);
    return true;
  });
}

/* --------------------------------------------------------------------- */
/* Linktree extraction                                                    */
/* --------------------------------------------------------------------- */

function extractMetaTag(html, patterns) {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeHtmlEntities(match[1]);
  }
  return undefined;
}

function decodeHtmlEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function parseLinktreeHtml(html, sourceUrl) {
  let nextData;
  const scriptMatch = html.match(
    /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/
  );
  if (scriptMatch) {
    try {
      nextData = JSON.parse(scriptMatch[1]);
    } catch (err) {
      console.warn('[scrape] Could not parse __NEXT_DATA__ JSON:', err.message);
    }
  } else {
    console.warn('[scrape] __NEXT_DATA__ block not found, falling back to meta tags.');
  }

  const usernameFromUrl = new URL(sourceUrl).pathname.replace(/\//g, '') || undefined;

  let name;
  let username = usernameFromUrl;
  let bio;
  let avatar;
  let backgroundImage;
  let links = [];
  let socials = [];

  if (nextData) {
    name = findFirstString(nextData, ['displayName', 'name', 'title']);
    username = findFirstString(nextData, ['username', 'handle']) || usernameFromUrl;
    bio = findFirstString(nextData, ['description', 'bio', 'about']);
    avatar = findFirstString(nextData, [
      'avatarUrl',
      'profilePictureUrl',
      'avatar',
      'imageUrl',
    ]);
    backgroundImage = findFirstString(nextData, [
      'backgroundImageUrl',
      'backgroundUrl',
      'coverImageUrl',
    ]);
    links = normaliseLinks(findLinkArrays(nextData));
    // Socials are derived from the *unfiltered* set so excluded
    // destinations are still discoverable in the output data, then the
    // excluded ones are dropped from the link cards themselves.
    socials = extractSocials(links, nextData);
    links = links.filter((link) => !isExcludedLink(link));
  }

  // Fall back to <meta> tags for anything the JSON walk didn't find. This
  // keeps the scraper working even if Linktree changes its internal data
  // shape entirely, as long as standard OpenGraph tags remain.
  name =
    name ||
    extractMetaTag(html, [
      /<meta property="og:title" content="([^"]+)"/,
      /<title>([^<]+)<\/title>/,
    ]);
  bio =
    bio ||
    extractMetaTag(html, [
      /<meta property="og:description" content="([^"]+)"/,
      /<meta name="description" content="([^"]+)"/,
    ]);
  avatar =
    avatar || extractMetaTag(html, [/<meta property="og:image" content="([^"]+)"/]);

  return {
    name: name || username || 'Linktree Profile',
    username: username || 'unknown',
    bio: bio || '',
    avatar: avatar || null,
    backgroundImage: backgroundImage || null,
    links,
    socials,
  };
}

/* --------------------------------------------------------------------- */
/* GitHub context + public API                                            */
/* --------------------------------------------------------------------- */

/** Determine "<owner>/<repo>" automatically from the GitHub Actions
 * context, falling back to the local git remote for local development. */
function detectRepository() {
  if (process.env.GITHUB_REPOSITORY) {
    const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/');
    return { owner, repo };
  }
  try {
    const remote = execSync('git config --get remote.origin.url', {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
    const match = remote.match(/[:/]([^/]+)\/([^/.]+?)(?:\.git)?$/);
    if (match) return { owner: match[1], repo: match[2] };
  } catch {
    // Not a git repo, or no remote configured yet — that's fine locally.
  }
  return { owner: null, repo: null };
}

async function fetchGithubProfile(owner) {
  if (!owner) return null;
  try {
    // Unauthenticated requests are capped at 60/hour and GitHub-hosted
    // Actions runners share egress IPs with countless other workflows, so
    // that cap gets exhausted almost immediately in CI. Authenticating
    // with the workflow's own GITHUB_TOKEN (raises the cap to 5000/hour)
    // keeps this reliable. No extra secret needs configuring — Actions
    // injects GITHUB_TOKEN automatically.
    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
    const user = await fetchJson(`https://api.github.com/users/${owner}`, {
      Accept: 'application/vnd.github+json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    });
    return {
      username: user.login,
      name: user.name || user.login,
      bio: user.bio || '',
      avatarUrl: user.avatar_url,
      htmlUrl: user.html_url,
    };
  } catch (err) {
    console.warn('[scrape] Could not fetch GitHub profile:', err.message);
    return null;
  }
}

/* --------------------------------------------------------------------- */
/* Output generation                                                      */
/* --------------------------------------------------------------------- */

function buildPagesUrl(owner, repo) {
  if (SITE_URL) return SITE_URL.endsWith('/') ? SITE_URL : `${SITE_URL}/`;
  if (!owner) return null;
  if (repo && repo.toLowerCase() === `${owner.toLowerCase()}.github.io`) {
    return `https://${owner.toLowerCase()}.github.io/`;
  }
  if (repo) return `https://${owner.toLowerCase()}.github.io/${repo}/`;
  return `https://${owner.toLowerCase()}.github.io/`;
}

function escapeHtml(str = '') {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildSeoBlock({ displayName, bio, avatar, pagesUrl, username }) {
  const title = `${displayName} | Links`;
  const description = bio && bio.length > 0 ? bio : `All of ${displayName}'s links in one place.`;
  const image = avatar || '';
  const canonical = pagesUrl || '';

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    name: title,
    description,
    url: canonical || undefined,
    mainEntity: {
      '@type': 'Person',
      name: displayName,
      alternateName: username,
      description,
      image: image || undefined,
      url: canonical || undefined,
    },
  };

  return [
    SEO_START,
    `  <title>${escapeHtml(title)}</title>`,
    `  <meta name="description" content="${escapeHtml(description)}" />`,
    canonical ? `  <link rel="canonical" href="${escapeHtml(canonical)}" />` : '',
    `  <meta property="og:type" content="profile" />`,
    `  <meta property="og:title" content="${escapeHtml(title)}" />`,
    `  <meta property="og:description" content="${escapeHtml(description)}" />`,
    image ? `  <meta property="og:image" content="${escapeHtml(image)}" />` : '',
    canonical ? `  <meta property="og:url" content="${escapeHtml(canonical)}" />` : '',
    `  <meta name="twitter:card" content="summary" />`,
    `  <meta name="twitter:title" content="${escapeHtml(title)}" />`,
    `  <meta name="twitter:description" content="${escapeHtml(description)}" />`,
    image ? `  <meta name="twitter:image" content="${escapeHtml(image)}" />` : '',
    `  <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`,
    SEO_END,
  ]
    .filter(Boolean)
    .join('\n');
}

async function updateIndexHtml(seoContext) {
  const html = await readFile(INDEX_PATH, 'utf8');
  const startIdx = html.indexOf(SEO_START);
  const endIdx = html.indexOf(SEO_END);
  if (startIdx === -1 || endIdx === -1) {
    console.warn('[scrape] SEO markers not found in index.html, skipping SEO injection.');
    return;
  }
  const before = html.slice(0, startIdx);
  const after = html.slice(endIdx + SEO_END.length);
  const block = buildSeoBlock(seoContext);
  const updated = `${before}${block}${after}`;
  if (updated !== html) {
    await writeFile(INDEX_PATH, updated, 'utf8');
  }
}

async function writeRobotsAndSitemap(pagesUrl) {
  const base = pagesUrl || '/';
  const robots = `User-agent: *\nAllow: /\nSitemap: ${base}sitemap.xml\n`;
  const sitemap = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    '  <url>',
    `    <loc>${escapeHtml(base)}</loc>`,
    '    <changefreq>hourly</changefreq>',
    '    <priority>1.0</priority>',
    '  </url>',
    '</urlset>',
    '',
  ].join('\n');

  await writeAtomically(ROBOTS_PATH, robots);
  await writeAtomically(SITEMAP_PATH, sitemap);
}

async function writeAtomically(filePath, contents) {
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  const tmpPath = `${filePath}.tmp-${process.pid}`;
  await writeFile(tmpPath, contents, 'utf8');
  await rename(tmpPath, filePath);
}

async function readExistingProfile() {
  try {
    const raw = await readFile(DATA_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/* --------------------------------------------------------------------- */
/* Main                                                                    */
/* --------------------------------------------------------------------- */

async function main() {
  console.log(`[scrape] Fetching public page: ${LINKTREE_URL}`);
  const html = await fetchText(LINKTREE_URL);
  const linktreeProfile = parseLinktreeHtml(html, LINKTREE_URL);

  const { owner, repo } = detectRepository();
  console.log(`[scrape] Detected repository context: owner=${owner ?? 'n/a'} repo=${repo ?? 'n/a'}`);

  const githubProfile = await fetchGithubProfile(owner);
  const pagesUrl = buildPagesUrl(owner, repo);
  const previous = await readExistingProfile();

  // Only the job links themselves should refresh on every run. The
  // display name/title/bio are set once (preferring the GitHub profile,
  // then whatever Linktree shows on the very first run) and then kept
  // frozen — Linktree's own title/description text on this page changes
  // frequently (it's rotated to whatever job posting is currently
  // featured), and re-deriving it every 3 hours made the site's name and
  // SEO title flip-flop. Hand-edit data/profile.json's `profile.name` /
  // `profile.bio` directly if you ever want to change them.
  const displayName = previous?.profile?.name || githubProfile?.name || linktreeProfile.name;
  const bio = previous?.profile?.bio ?? (githubProfile?.bio || linktreeProfile.bio);
  const avatar = githubProfile?.avatarUrl || linktreeProfile.avatar;

  const profileData = {
    generatedAt: new Date().toISOString(),
    source: LINKTREE_URL,
    profile: {
      name: displayName,
      username: linktreeProfile.username,
      bio,
      avatar,
      backgroundImage: linktreeProfile.backgroundImage,
    },
    github: githubProfile,
    links: linktreeProfile.links,
    socials: linktreeProfile.socials,
  };

  if (profileData.links.length === 0 && previous?.links?.length > 0) {
    throw new Error(
      'Scrape produced zero links (likely a markup/schema change or a blocked request). ' +
        'Keeping previous data/profile.json untouched.'
    );
  }

  // Minified JSON output (no pretty-printing) to keep the payload small.
  await writeAtomically(DATA_PATH, JSON.stringify(profileData));
  console.log(`[scrape] Wrote ${DATA_PATH} (${profileData.links.length} links).`);

  await updateIndexHtml({
    displayName,
    bio,
    avatar,
    pagesUrl,
    username: linktreeProfile.username,
  });
  await writeRobotsAndSitemap(pagesUrl);

  console.log('[scrape] Done.');
}

main().catch((err) => {
  console.error('[scrape] FAILED:', err.message);
  console.error('[scrape] Previous data/profile.json (if any) was left unchanged.');
  // Emit a GitHub Actions error annotation with the failure message.
  // Annotations are visible on the Actions run page without needing
  // to download the log file (which requires sign-in). The annotation
  // is limited to ~4KB; truncate multi-line errors to the first line.
  const firstLine = (err.message || 'unknown error').split('\n')[0].slice(0, 1000);
  console.error(`::error::Scraper failed: ${firstLine}`);
  process.exitCode = 1;
});
