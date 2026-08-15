// script.js — Job Paglu
// Vanilla-JS renderer with:
//  - Ad banners after every 3 links (accent-bordered, responsive)
//  - Premium search bar with shortlink bypass interstitial
//  - 3-column layout with sidebar ad slots (desktop)
//  - Clean, professional UI — no placeholder/junk text

const DATA_URL = 'data/profile.json';
const ADSENSE_CLIENT = 'ca-pub-3043505043619574';
const LINKS_PER_AD = 3;
const INTERSTITIAL_COUNTDOWN_SECONDS = 5;

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

// ─── Create inline ad banner <li> ─────────────────────────────────
function createAdBannerLi(index) {
  const li = document.createElement('li');
  li.className = 'ad-banner-item';
  li.style.animationDelay = `${Math.min(index * 50, 350)}ms`;

  const banner = document.createElement('div');
  banner.className = 'ad-banner';

  const label = document.createElement('div');
  label.className = 'ad-banner-label';
  label.textContent = 'AD';
  banner.appendChild(label);

  const content = document.createElement('div');
  content.className = 'ad-banner-content';

  const ins = document.createElement('ins');
  ins.className = 'adsbygoogle';
  ins.style.display = 'block';
  ins.style.width = '100%';
  ins.style.minHeight = '50px';
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

// ─── Main link rendering ──────────────────────────────────────────
function renderLinks(links = []) {
  const list = document.getElementById('links-list');
  const emptyState = document.getElementById('empty-state');
  if (links.length === 0) {
    emptyState.hidden = false;
    return;
  }
  emptyState.hidden = true;
  renderLinksIntoList(links, list);
  // Push sidebar + inline ads after first render
  pushSidebarAds();
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

// ─── Search: render results ───────────────────────────────────────
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
}

// ─── Interstitial ad overlay ──────────────────────────────────────
function showInterstitial(query, onBypassed) {
  const overlay = document.getElementById('interstitial-overlay');
  const shortlinkEl = document.getElementById('interstitial-shortlink');
  const countdownEl = document.getElementById('interstitial-countdown');
  const timerEl = document.getElementById('interstitial-timer');
  const skipBtn = document.getElementById('interstitial-skip-btn');

  const shortlink = generateShortlink(query);
  shortlinkEl.textContent = `Shortlink: ${shortlink}`;

  let remaining = INTERSTITIAL_COUNTDOWN_SECONDS;
  countdownEl.textContent = remaining;
  skipBtn.disabled = true;
  timerEl.style.display = '';
  overlay.hidden = false;

  pushAd(); // push interstitial ad

  const timer = setInterval(() => {
    remaining--;
    countdownEl.textContent = remaining;
    if (remaining <= 0) {
      clearInterval(timer);
      skipBtn.disabled = false;
      timerEl.style.display = 'none';
    }
  }, 1000);

  const handleSkip = () => {
    clearInterval(timer);
    overlay.hidden = true;
    skipBtn.removeEventListener('click', handleSkip);
    if (onBypassed) onBypassed();
  };
  skipBtn.addEventListener('click', handleSkip);
}

// ─── Search: execute ──────────────────────────────────────────────
function executeSearch(query) {
  if (!query.trim()) return;
  currentQuery = query.trim();

  const results = filterLinks(currentQuery, allLinks);

  showInterstitial(currentQuery, () => {
    hideEl('links');
    renderSearchResults(currentQuery, results);
    pushSidebarAds();
  });
}

// ─── Search: clear ────────────────────────────────────────────────
function clearSearch() {
  currentQuery = '';
  const searchInput = document.getElementById('search-input');
  if (searchInput) searchInput.value = '';
  hideEl('search-results');
  showEl('links');
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

// ─── Hash shortlink check ─────────────────────────────────────────
function checkHashShortlink() {
  const query = decodeShortlink(window.location.hash);
  if (query) {
    const searchInput = document.getElementById('search-input');
    if (searchInput) searchInput.value = query;
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

    allLinks = links || [];

    document.title = profile?.name ? `${profile.name} | Links` : 'Links';
    setText('display-name', profile?.name || '');
    setText('bio', profile?.bio || '');

    renderAvatar(profile || {});
    renderLinks(links);
    renderLastUpdated(data.generatedAt);

    initSearch();
    checkHashShortlink();

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
    setText('display-name', '');
    document.getElementById('empty-state').hidden = false;
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
