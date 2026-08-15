// script.js — Job Paglu
// Simple search bar that filters links in-place (case-insensitive)

const DATA_URL = 'data/profile.json';
const ADSENSE_CLIENT = 'ca-pub-3043505043619574';
const LINKS_PER_AD = 3;

// ─── Globals ──────────────────────────────────────────────────────
let allLinks = [];
let sidebarAdsPushed = false;

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
function showEl(id) { const el = document.getElementById(id); if (el) el.hidden = false; }
function hideEl(id) { const el = document.getElementById(id); if (el) el.hidden = true; }

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
  } catch { return null; }
}

// ─── AdSense push helper ──────────────────────────────────────────
function pushAd() {
  try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch {}
}

// ─── Sidebar ads ──────────────────────────────────────────────────
function pushSidebarAds() {
  if (sidebarAdsPushed) return;
  pushAd(); // left
  pushAd(); // right
  sidebarAdsPushed = true;
}

// ─── Create inline ad banner <li> ─────────────────────────────────
function createAdBannerLi(index) {
  const li = document.createElement('li');
  li.className = 'ad-banner-item';
  li.style.animationDelay = `${Math.min(index * 40, 250)}ms`;

  const banner = document.createElement('div');
  banner.className = 'ad-banner';

  const content = document.createElement('div');
  content.className = 'ad-banner-content';

  const ins = document.createElement('ins');
  ins.className = 'adsbygoogle';
  ins.style.display = 'block';
  ins.style.width = '100%';
  ins.setAttribute('data-ad-client', ADSENSE_CLIENT);
  ins.setAttribute('data-ad-slot', '');
  ins.setAttribute('data-ad-format', 'auto');
  ins.setAttribute('data-full-width-responsive', 'true');
  content.appendChild(ins);

  banner.appendChild(content);
  li.appendChild(banner);
  return li;
}

// ─── Create a link <li> ───────────────────────────────────────────
function createLinkLi(link, index) {
  const li = document.createElement('li');
  li.className = 'link-item';
  li.style.animationDelay = `${Math.min(index * 40, 300)}ms`;

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
  return li;
}

// ─── Render links with interleaved ad banners ────────────────────
function renderLinksIntoList(links, listEl, withAds) {
  listEl.innerHTML = '';
  links.forEach((link, index) => {
    listEl.appendChild(createLinkLi(link, index));
    if (withAds && (index + 1) % LINKS_PER_AD === 0 && index < links.length - 1) {
      listEl.appendChild(createAdBannerLi(index));
    }
  });
}

// ─── Main link rendering (no ads) ────────────────────────────────
function renderLinks(links = []) {
  const list = document.getElementById('links-list');
  const emptyState = document.getElementById('empty-state');
  if (links.length === 0) {
    emptyState.hidden = false;
    return;
  }
  emptyState.hidden = true;
  renderLinksIntoList(links, list, false);
  hideEl('sidebar-left');
  hideEl('sidebar-right');
}

// ─── Search: case-insensitive filter ─────────────────────────────
function filterLinks(query, links) {
  if (!query.trim()) return links;
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return links.filter(link => {
    const hay = `${link.title} ${link.url}`.toLowerCase();
    return terms.every(term => hay.includes(term));
  });
}

// ─── Search: execute filter in-place ─────────────────────────────
function executeSearch(query) {
  const list = document.getElementById('links-list');
  const emptyState = document.getElementById('empty-state');
  const resultsCount = document.getElementById('results-count');

  if (!query.trim()) {
    // Empty query — show all links (no ads)
    renderLinksIntoList(allLinks, list, false);
    emptyState.hidden = true;
    hideEl('sidebar-left');
    hideEl('sidebar-right');
    if (resultsCount) resultsCount.hidden = true;
    return;
  }

  const results = filterLinks(query, allLinks);

  if (results.length === 0) {
    list.innerHTML = '';
    emptyState.hidden = false;
  } else {
    emptyState.hidden = true;
    renderLinksIntoList(results, list, true);
    // Show sidebars when filtering (with ads)
    showEl('sidebar-left');
    showEl('sidebar-right');
    pushSidebarAds();
  }

  // Show results count
  if (resultsCount) {
    resultsCount.textContent = `${results.length} result${results.length !== 1 ? 's' : ''} for "${query}"`;
    resultsCount.hidden = false;
  }
}

// ─── Search: event listeners ──────────────────────────────────────
function initSearch() {
  const searchInput = document.getElementById('search-input');
  const searchBtn = document.getElementById('search-btn');

  function doSearch() {
    const q = searchInput ? searchInput.value : '';
    executeSearch(q);
  }

  if (searchBtn) searchBtn.addEventListener('click', doSearch);

  if (searchInput) {
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doSearch();
    });
    // Live filter as user types
    searchInput.addEventListener('input', doSearch);
  }
}

// ─── Last updated ─────────────────────────────────────────────────
function renderLastUpdated(generatedAt) {
  if (!generatedAt) return;
  const date = new Date(generatedAt);
  if (Number.isNaN(date.getTime())) return;
  setText('last-updated', `Last updated ${date.toLocaleString()}`);
}

// ─── Shortlink hash support (for external shortlink services) ─────
function generateShortlink(query) {
  const encoded = btoa(unescape(encodeURIComponent(query)));
  const base = window.location.origin + window.location.pathname;
  return `${base}#search=${encoded}`;
}

function decodeShortlink(hash) {
  try {
    const match = hash.match(/#search=([A-Za-z0-9+/=_-]+)/);
    if (match && match[1]) return decodeURIComponent(escape(atob(match[1])));
  } catch {}
  return null;
}

function checkHashShortlink() {
  const query = decodeShortlink(window.location.hash);
  if (query) {
    const searchInput = document.getElementById('search-input');
    if (searchInput) searchInput.value = query;
    executeSearch(query);
    return true;
  }
  return false;
}

// ─── Init ─────────────────────────────────────────────────────────
async function init() {
  try {
    const data = await loadProfile();
    const { profile, links } = data;

    allLinks = links || [];

    document.title = profile?.name ? `${profile.name} | Links` : 'Links';
    setText('display-name', profile?.name || '');
    setText('bio', profile?.bio || '');

    renderAvatar(profile || {});
    renderLinks(links);
    renderLastUpdated(data.generatedAt);

    initSearch();
    checkHashShortlink();

    // Hash change listener (for shortlink service redirects)
    window.addEventListener('hashchange', () => {
      const query = decodeShortlink(window.location.hash);
      if (query) {
        const searchInput = document.getElementById('search-input');
        if (searchInput) searchInput.value = query;
        executeSearch(query);
      } else {
        const searchInput = document.getElementById('search-input');
        if (searchInput) searchInput.value = '';
        executeSearch('');
      }
    });

  } catch (err) {
    console.error('[app] Failed to render profile:', err);
    setText('display-name', '');
    document.getElementById('empty-state').hidden = false;
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
