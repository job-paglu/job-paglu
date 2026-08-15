// script.js
// Vanilla-JS renderer: fetches the pre-scraped data/profile.json and paints
// the page. No frameworks, no build step — this file runs as-is in the
// browser via <script type="module">.
//
// Features:
//  - Ad banners with accent border after every 3 links (mobile-optimized)
//  - Search bar with shortlink bypass: search → interstitial ad → results

const DATA_URL = 'data/profile.json';
const ADSENSE_CLIENT = 'ca-pub-3043505043619574';
const LINKS_PER_AD = 3; // Insert an ad banner after every N links
const INTERSTITIAL_COUNTDOWN_SECONDS = 5;

// ─── Globals ──────────────────────────────────────────────────────
let allLinks = [];
let currentQuery = '';

// ─── Data loading ─────────────────────────────────────────────────
async function loadProfile() {
  const res = await fetch(`${DATA_URL}?v=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to load profile data (HTTP ${res.status})`);
  return res.json();
}

// ─── DOM helpers ──────────────────────────────────────────────────
function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value ?? '';
}

function showEl(id) {
  const el = document.getElementById(id);
  if (el) el.hidden = false;
}

function hideEl(id) {
  const el = document.getElementById(id);
  if (el) el.hidden = true;
}

// ─── Profile rendering ────────────────────────────────────────────
function renderAvatar(profile) {
  const avatarEl = document.getElementById('avatar');
  const faviconEl = document.getElementById('favicon');
  const appleTouchIconEl = document.getElementById('apple-touch-icon');

  if (profile.avatar) {
    avatarEl.src = profile.avatar;
    avatarEl.alt = `${profile.name || 'Profile'} avatar`;
    faviconEl.href = profile.avatar;
    appleTouchIconEl.href = profile.avatar;
  } else {
    avatarEl.alt = '';
  }
}

function faviconForLink(url) {
  try {
    const { hostname } = new URL(url);
    return `https://www.google.com/s2/favicons?sz=64&domain=${hostname}`;
  } catch {
    return null;
  }
}

// ─── Ad banner creation ───────────────────────────────────────────
function createAdBannerLi(index) {
  const li = document.createElement('li');
  li.className = 'ad-banner-item';
  li.style.animationDelay = `${Math.min(index * 60, 400)}ms`;

  const banner = document.createElement('div');
  banner.className = 'ad-banner';

  const label = document.createElement('div');
  label.className = 'ad-banner-label';
  label.textContent = 'AD';
  banner.appendChild(label);

  const content = document.createElement('div');
  content.className = 'ad-banner-content';

  // Insert an AdSense ins element; Google will fill it automatically.
  const ins = document.createElement('ins');
  ins.className = 'adsbygoogle';
  ins.style.display = 'block';
  ins.style.width = '100%';
  ins.style.minHeight = '60px';
  ins.setAttribute('data-ad-client', ADSENSE_CLIENT);
  ins.setAttribute('data-ad-slot', '');
  ins.setAttribute('data-ad-format', 'auto');
  ins.setAttribute('data-full-width-responsive', 'true');
  content.appendChild(ins);

  // Push the ad to AdSense
  try {
    (window.adsbygoogle = window.adsbygoogle || []).push({});
  } catch { /* AdSense not loaded yet — that's fine */ }

  banner.appendChild(content);
  li.appendChild(banner);
  return li;
}

// ─── Link rendering (with interleaved ad banners) ─────────────────
function renderLinks(links = []) {
  const list = document.getElementById('links-list');
  const emptyState = document.getElementById('empty-state');
  list.innerHTML = '';

  if (links.length === 0) {
    emptyState.hidden = false;
    return;
  }
  emptyState.hidden = true;

  links.forEach((link, index) => {
    // Create the link item
    const li = document.createElement('li');
    li.className = 'link-item';
    li.style.animationDelay = `${Math.min(index * 60, 400)}ms`;

    const a = document.createElement('a');
    a.className = 'link-button';
    a.href = link.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.setAttribute('aria-label', link.title);

    const icon = faviconForLink(link.url);
    if (icon) {
      const img = document.createElement('img');
      img.className = 'link-icon';
      img.src = icon;
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      a.appendChild(img);
    }

    const span = document.createElement('span');
    span.className = 'link-title';
    span.textContent = link.title;
    a.appendChild(span);

    li.appendChild(a);
    list.appendChild(li);

    // Insert ad banner after every LINKS_PER_AD links
    if ((index + 1) % LINKS_PER_AD === 0 && index < links.length - 1) {
      list.appendChild(createAdBannerLi(index));
    }
  });
}

// ─── Search: filtering ────────────────────────────────────────────
function filterLinks(query, links) {
  if (!query.trim()) return links;
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return links.filter(link => {
    const hay = `${link.title} ${link.url}`.toLowerCase();
    return terms.every(term => hay.includes(term));
  });
}

// ─── Search: shortlink generation ─────────────────────────────────
// Generates a client-side "shortlink" URL. The shortlink encodes the
// search query in a base64 URL-safe hash so it can be shared/bookmarked.
function generateShortlink(query) {
  const encoded = btoa(unescape(encodeURIComponent(query)));
  const base = window.location.origin + window.location.pathname;
  return `${base}#search=${encoded}`;
}

function decodeShortlink(hash) {
  try {
    const match = hash.match(/#search=([A-Za-z0-9+/_-]+)/);
    if (match && match[1]) {
      return decodeURIComponent(escape(atob(match[1])));
    }
  } catch { /* invalid hash — ignore */ }
  return null;
}

// ─── Search: render results into search-results panel ─────────────
function renderSearchResults(query, results) {
  const resultsContainer = document.getElementById('search-results');
  const resultsList = document.getElementById('search-results-list');
  const resultsTitle = document.getElementById('search-results-title');
  const searchEmpty = document.getElementById('search-empty-state');

  resultsTitle.textContent = `${results.length} result${results.length !== 1 ? 's' : ''} for "${query}"`;
  resultsList.innerHTML = '';

  if (results.length === 0) {
    searchEmpty.hidden = false;
  } else {
    searchEmpty.hidden = true;
    results.forEach((link, index) => {
      const li = document.createElement('li');
      li.className = 'link-item';
      li.style.animationDelay = `${Math.min(index * 60, 400)}ms`;

      const a = document.createElement('a');
      a.className = 'link-button';
      a.href = link.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.setAttribute('aria-label', link.title);

      const icon = faviconForLink(link.url);
      if (icon) {
        const img = document.createElement('img');
        img.className = 'link-icon';
        img.src = icon;
        img.alt = '';
        img.loading = 'lazy';
        img.decoding = 'async';
        a.appendChild(img);
      }

      const span = document.createElement('span');
      span.className = 'link-title';
      span.textContent = link.title;
      a.appendChild(span);

      li.appendChild(a);
      resultsList.appendChild(li);

      // Ad banners in search results too (after every 3)
      if ((index + 1) % LINKS_PER_AD === 0 && index < results.length - 1) {
        resultsList.appendChild(createAdBannerLi(index));
      }
    });
  }

  resultsContainer.hidden = false;
}

// ─── Interstitial ad overlay ──────────────────────────────────────
function showInterstitial(query, onBypassed) {
  const overlay = document.getElementById('interstitial-overlay');
  const shortlinkEl = document.getElementById('interstitial-shortlink');
  const countdownEl = document.getElementById('interstitial-countdown');
  const waitEl = document.getElementById('interstitial-wait');
  const skipBtn = document.getElementById('interstitial-skip-btn');

  // Generate and display the shortlink
  const shortlink = generateShortlink(query);
  shortlinkEl.textContent = `Shortlink: ${shortlink}`;

  // Reset state
  let remaining = INTERSTITIAL_COUNTDOWN_SECONDS;
  countdownEl.textContent = remaining;
  skipBtn.disabled = true;
  waitEl.hidden = false;
  overlay.hidden = false;

  // Try to push an AdSense ad into the interstitial slot
  try {
    (window.adsbygoogle = window.adsbygoogle || []).push({});
  } catch { /* AdSense not loaded yet */ }

  // Countdown timer
  const timer = setInterval(() => {
    remaining--;
    countdownEl.textContent = remaining;
    if (remaining <= 0) {
      clearInterval(timer);
      skipBtn.disabled = false;
      waitEl.hidden = true;
    }
  }, 1000);

  // Skip button handler
  const handleSkip = () => {
    clearInterval(timer);
    overlay.hidden = true;
    skipBtn.removeEventListener('click', handleSkip);
    if (onBypassed) onBypassed();
  };

  skipBtn.addEventListener('click', handleSkip);
}

// ─── Search: execute (with interstitial) ──────────────────────────
function executeSearch(query) {
  if (!query.trim()) return;
  currentQuery = query.trim();

  // Filter links
  const results = filterLinks(currentQuery, allLinks);

  // Show interstitial ad; after bypass, show results
  showInterstitial(currentQuery, () => {
    // Hide main links, show search results
    hideEl('links');
    renderSearchResults(currentQuery, results);
  });
}

// ─── Search: clear and restore main list ──────────────────────────
function clearSearch() {
  currentQuery = '';
  const searchInput = document.getElementById('search-input');
  if (searchInput) searchInput.value = '';

  hideEl('search-results');
  showEl('links');

  // Clear the hash
  if (window.location.hash.startsWith('#search=')) {
    history.replaceState(null, '', window.location.pathname);
  }
}

// ─── Search: wire up event listeners ──────────────────────────────
function initSearch() {
  const searchInput = document.getElementById('search-input');
  const searchBtn = document.getElementById('search-btn');
  const clearBtn = document.getElementById('search-clear-btn');

  if (searchBtn) {
    searchBtn.addEventListener('click', () => {
      const query = searchInput?.value || '';
      if (query.trim()) executeSearch(query);
    });
  }

  if (searchInput) {
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const query = searchInput.value || '';
        if (query.trim()) executeSearch(query);
      }
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', clearSearch);
  }
}

// ─── Last updated timestamp ───────────────────────────────────────
function renderLastUpdated(generatedAt) {
  if (!generatedAt) return;
  const date = new Date(generatedAt);
  if (Number.isNaN(date.getTime())) return;
  setText('last-updated', `Last updated ${date.toLocaleString()}`);
}

// ─── Check URL hash for shared shortlink ──────────────────────────
function checkHashShortlink() {
  const query = decodeShortlink(window.location.hash);
  if (query) {
    const searchInput = document.getElementById('search-input');
    if (searchInput) searchInput.value = query;
    // Small delay so page finishes rendering first
    setTimeout(() => executeSearch(query), 300);
    return true;
  }
  return false;
}

// ─── Init ─────────────────────────────────────────────────────────
async function init() {
  try {
    const data = await loadProfile();
    const { profile, links } = data;

    // Store links globally for search
    allLinks = links || [];

    document.title = profile?.name ? `${profile.name} | Links` : 'Links';
    setText('display-name', profile?.name || 'Unknown');
    setText('bio', profile?.bio || '');

    renderAvatar(profile || {});
    renderLinks(links);
    renderLastUpdated(data.generatedAt);

    // Wire up search bar
    initSearch();

    // Check if someone opened a shared shortlink URL
    checkHashShortlink();

    // Listen for hash changes (back/forward nav with shortlinks)
    window.addEventListener('hashchange', () => {
      const query = decodeShortlink(window.location.hash);
      if (query) {
        const searchInput = document.getElementById('search-input');
        if (searchInput) searchInput.value = query;
        executeSearch(query);
      } else {
        clearSearch();
      }
    });

  } catch (err) {
    console.error('[app] Failed to render profile:', err);
    setText('display-name', 'Unable to load profile');
    document.getElementById('empty-state').hidden = false;
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
