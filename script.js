// script.js — Job Paglu
// Vanilla-JS renderer with:
//  - Clean main page: no ads on page open, just links
//  - Premium search bar at top (HERO — UI/UX priority)
//  - Search → sets #search=BASE64 hash → shortlink service shows ad → redirects back → auto-execute
//  - Sidebar + inline ad banners appear only on search results page
//  - Clean, professional UI — no placeholder/junk text

const DATA_URL = 'data/profile.json';
const ADSENSE_CLIENT = 'ca-pub-3043505043619574';
const LINKS_PER_AD = 3;

// ─── Globals ──────────────────────────────────────────────────────
let allLinks = [];
let currentQuery = '';
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
  pushAd(); // left sidebar
  pushAd(); // right sidebar
  sidebarAdsPushed = true;
}

// ─── Create inline ad banner <li> — AdSense only, no visual chrome ──
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
  li.style.animationDelay = `${Math.min(index * 50, 350)}ms`;

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

// ─── Render links list with interleaved ad banners ────────────────
function renderLinksIntoList(links, listEl) {
  listEl.innerHTML = '';
  links.forEach((link, index) => {
    listEl.appendChild(createLinkLi(link, index));
    if ((index + 1) % LINKS_PER_AD === 0 && index < links.length - 1) {
      listEl.appendChild(createAdBannerLi(index));
    }
  });
}

// ─── Main link rendering (clean — no ads on page open) ───────────
function renderLinks(links = []) {
  const list = document.getElementById('links-list');
  const emptyState = document.getElementById('empty-state');
  if (links.length === 0) {
    emptyState.hidden = false;
    return;
  }
  emptyState.hidden = true;
  // Render links WITHOUT ad banners — main page is clean
  list.innerHTML = '';
  links.forEach((link, index) => {
    list.appendChild(createLinkLi(link, index));
  });
  // Hide sidebars on main page (no ads on page open)
  hideEl('sidebar-left');
  hideEl('sidebar-right');
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

// ─── Search: render results (WITH ads — this is the results page) ─
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
    renderLinksIntoList(results, resultsList);
  }
  resultsContainer.hidden = false;

  // Show sidebars on search results page (ads visible here)
  showEl('sidebar-left');
  showEl('sidebar-right');
  pushSidebarAds();
}

// ─── Search: execute (no interstitial — direct hash-based) ────────
function executeSearch(query) {
  if (!query.trim()) return;
  currentQuery = query.trim();

  // Set the hash so the URL becomes #search=BASE64ENCODEDQUERY
  // This is the URL the user will feed to their shortlink service
  const encoded = btoa(unescape(encodeURIComponent(currentQuery)));
  const targetHash = `#search=${encoded}`;

  // Only update hash if it's different (avoid redundant hashchange)
  if (window.location.hash !== targetHash) {
    window.location.hash = targetHash;
    // hashchange event will trigger executeSearchFromHash
    return;
  }

  // If hash is already set (e.g. from hashchange or page load), render directly
  const results = filterLinks(currentQuery, allLinks);
  hideEl('links');
  renderSearchResults(currentQuery, results);
}

// ─── Search: execute from hash (called by hashchange & checkHashShortlink) ──
function executeSearchFromHash() {
  const query = decodeShortlink(window.location.hash);
  if (query) {
    currentQuery = query;
    const searchInput = document.getElementById('search-input');
    if (searchInput) searchInput.value = query;

    const results = filterLinks(query, allLinks);
    hideEl('links');
    renderSearchResults(query, results);
  }
}

// ─── Search: clear (back to clean main page) ──────────────────────
function clearSearch() {
  currentQuery = '';
  const searchInput = document.getElementById('search-input');
  if (searchInput) searchInput.value = '';
  hideEl('search-results');
  showEl('links');
  // Hide sidebars when returning to main page (no ads)
  hideEl('sidebar-left');
  hideEl('sidebar-right');
  if (window.location.hash.startsWith('#search=')) {
    history.replaceState(null, '', window.location.pathname);
  }
}

// ─── Search: event listeners ──────────────────────────────────────
function initSearch() {
  const searchInput = document.getElementById('search-input');
  const searchBtn = document.getElementById('search-btn');
  const clearBtn = document.getElementById('search-clear-btn');

  if (searchBtn) {
    searchBtn.addEventListener('click', () => {
      const q = searchInput?.value || '';
      if (q.trim()) executeSearch(q);
    });
  }

  if (searchInput) {
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const q = searchInput.value || '';
        if (q.trim()) executeSearch(q);
      }
    });
  }

  if (clearBtn) clearBtn.addEventListener('click', clearSearch);
}

// ─── Last updated ─────────────────────────────────────────────────
function renderLastUpdated(generatedAt) {
  if (!generatedAt) return;
  const date = new Date(generatedAt);
  if (Number.isNaN(date.getTime())) return;
  setText('last-updated', `Last updated ${date.toLocaleString()}`);
}

// ─── Hash shortlink check (on page load) ─────────────────────────
function checkHashShortlink() {
  const query = decodeShortlink(window.location.hash);
  if (query) {
    const searchInput = document.getElementById('search-input');
    if (searchInput) searchInput.value = query;
    // Auto-execute search directly (no interstitial)
    currentQuery = query;
    const results = filterLinks(query, allLinks);
    hideEl('links');
    renderSearchResults(query, results);
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

    // Listen for hash changes (e.g. shortlink redirect back)
    window.addEventListener('hashchange', () => {
      const query = decodeShortlink(window.location.hash);
      if (query) {
        executeSearchFromHash();
      } else {
        clearSearch();
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
