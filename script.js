// script.js — Job Paglu
//
// Renders the scraped job list and filters it in-place from the search box.
//
// The feed regularly runs to several hundred listings, so rendering is
// batched behind an IntersectionObserver: only the first BATCH_SIZE cards
// are built up front and more are appended as the reader approaches the
// bottom. Building all of them eagerly meant hundreds of DOM nodes and
// hundreds of favicon requests before the page became interactive.

const DATA_URL = 'data/profile.json';

/* ─── AdSense configuration ────────────────────────────────────────
 *
 * Slot IDs come from AdSense → Ads → By ad unit. Create the unit, then
 * paste the numeric `data-ad-slot` from its snippet here.
 *
 *  inFeed   — create as an "In-feed ad". Also copy its data-ad-layout-key
 *             into AD_INFEED_LAYOUT_KEY below; in-feed units need both.
 *  sidebar  — create as a responsive "Display ad" (vertical suits the rail).
 *
 * Leave a value empty to disable that placement entirely. An <ins> with no
 * slot ID can never be filled, so rendering one just puts dead markup on
 * the page — the code skips the placement instead.
 */
const ADSENSE_CLIENT = 'ca-pub-3043505043619574';
const AD_SLOTS = {
  inFeed: '',
  sidebar: '',
};
const AD_INFEED_LAYOUT_KEY = '';

/* ══════════════════════════════════════════════════════════════════════
 * ADSTERRA:START — third-party ad network (Adsterra).
 *
 * ⚠  HOW TO REMOVE — see ADS.md for the full checklist. Short version:
 *    set `enabled: false` below and every Adsterra unit stops loading. To
 *    rip it out for good, delete each marked block in this file and in
 *    style.css. Nothing outside those blocks references Adsterra.
 *
 * ⚠  POLICY RISK: `social` below is a Social Bar / popunder-style unit.
 *    Google AdSense forbids running its ads on pages with pop-unders.
 *    Keeping both networks live risks the AdSense account. Setting
 *    `social.src` to '' disables just that unit and keeps the rest.
 * ════════════════════════════════════════════════════════════════════ */
const ADSTERRA = {
  enabled: true,

  // 468x60 iframe banner. Repeated in the feed; each copy is rendered in
  // its own srcdoc iframe because invoke.js reads a single global
  // `atOptions`, so two on one page would overwrite each other.
  banner: {
    key: 'bfeae19c05d8dd0aaaa4cff4593bef81',
    width: 468,
    height: 60,
  },

  // Native banner. Single instance only — it binds to one container id.
  native: {
    id: 'ca963b927ae7e74c2b98cf0bbd70cfa3',
    src: 'https://pl30920895.effectivecpmnetwork.com/ca963b927ae7e74c2b98cf0bbd70cfa3/invoke.js',
  },

  // Social Bar / popunder — DISABLED ON PURPOSE, do not set `src` back
  // without reading ADS.md first.
  //
  // Google AdSense forbids serving its ads on pages that also run
  // pop-unders. Leaving this on put the AdSense account
  // (ca-pub-3043505043619574) at risk of termination, which earns far
  // more than this unit ever would. The URL is kept here rather than
  // deleted so it can be restored deliberately: move `disabledSrc` back
  // into `src` — and if you do, drop the AdSense script tag from
  // index.html in the same change.
  social: {
    src: '',
    disabledSrc:
      'https://pl30920896.effectivecpmnetwork.com/fc/ab/20/fcab20b85cd46c9e3f89a3a6cd0626da.js',
  },
};
/* ADSTERRA:END */

// Ads previously appeared only in search results, which meant most
// visitors — who never search — saw none at all. Flip to false to go back
// to search-results-only.
const ADS_IN_MAIN_FEED = true;

const LINKS_PER_AD = 6;      // inline ad cadence within the list
const BATCH_SIZE = 24;       // cards appended per render pass
const SEARCH_DEBOUNCE_MS = 120;
const BACK_TO_TOP_AT = 700;  // px scrolled before the button appears

// ─── State ────────────────────────────────────────────────────────
let allLinks = [];
let currentResults = [];
let currentTerms = [];
let renderedCount = 0;
let adsInResults = false;
let sidebarAdsPushed = false;
let scrollObserver = null;

// ─── Element cache ────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const els = {};

// ─── Data loading ─────────────────────────────────────────────────
async function loadProfile() {
  const res = await fetch(`${DATA_URL}?v=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to load profile data (HTTP ${res.status})`);
  return res.json();
}

// ─── DOM helpers ──────────────────────────────────────────────────
function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = value ?? '';
}
function setHidden(el, hidden) {
  if (el) el.hidden = hidden;
}

// ─── Profile rendering ────────────────────────────────────────────
function renderAvatar(profile) {
  const avatarEl = els.avatar;
  if (!avatarEl) return;
  if (profile.avatar) {
    avatarEl.src = profile.avatar;
    avatarEl.alt = `${profile.name || 'Profile'} avatar`;
    if (els.favicon) els.favicon.href = profile.avatar;
    if (els.appleTouchIcon) els.appleTouchIcon.href = profile.avatar;
  } else {
    avatarEl.alt = '';
  }
}

function hostnameOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function faviconForLink(url) {
  const hostname = hostnameOf(url);
  return hostname
    ? `https://www.google.com/s2/favicons?sz=64&domain=${hostname}`
    : null;
}

// ─── AdSense ──────────────────────────────────────────────────────
function pushAd() {
  try {
    (window.adsbygoogle = window.adsbygoogle || []).push({});
  } catch {
    /* AdSense blocked or not yet loaded — the slot just stays empty. */
  }
}

/** Stamps the configured slot onto the two static rail units, then fills
 * them. Without a slot ID the rails stay empty and hidden. */
function pushSidebarAds() {
  if (sidebarAdsPushed || !AD_SLOTS.sidebar) return;
  for (const rail of [els.sidebarLeft, els.sidebarRight]) {
    const ins = rail?.querySelector('ins.adsbygoogle');
    if (!ins) continue;
    ins.setAttribute('data-ad-slot', AD_SLOTS.sidebar);
    pushAd();
  }
  sidebarAdsPushed = true;
}

/** Returns null when no in-feed slot is configured, so the caller skips the
 * placement rather than inserting an <ins> that can never be filled. */
function createAdSenseInFeedLi() {
  if (!AD_SLOTS.inFeed) return null;

  const li = document.createElement('li');
  li.className = 'ad-banner-item';

  const banner = document.createElement('div');
  banner.className = 'ad-banner';

  const content = document.createElement('div');
  content.className = 'ad-banner-content';

  const ins = document.createElement('ins');
  ins.className = 'adsbygoogle';
  ins.style.display = 'block';
  ins.style.width = '100%';
  ins.setAttribute('data-ad-client', ADSENSE_CLIENT);
  ins.setAttribute('data-ad-slot', AD_SLOTS.inFeed);

  if (AD_INFEED_LAYOUT_KEY) {
    // In-feed unit: renders card-shaped to sit inside the list. It sizes
    // itself from the layout key, so no full-width-responsive flag.
    ins.setAttribute('data-ad-format', 'fluid');
    ins.setAttribute('data-ad-layout-key', AD_INFEED_LAYOUT_KEY);
  } else {
    // Plain responsive display unit.
    ins.setAttribute('data-ad-format', 'auto');
    ins.setAttribute('data-full-width-responsive', 'true');
  }

  content.appendChild(ins);
  banner.appendChild(content);
  li.appendChild(banner);
  return li;
}

/* ══════════════════════════════════════════════════════════════════════
 * ADSTERRA:START — rendering. Delete this whole block to remove Adsterra.
 * ════════════════════════════════════════════════════════════════════ */

// Live banner wrappers, so a viewport change can rescale them all.
let adsterraWraps = [];
let adsterraSocialMounted = false;
let adsterraNativeMounted = false;

/** Each banner runs in its own srcdoc document. invoke.js reads one global
 * `atOptions`, so two banners sharing a document would clobber each
 * other's config — an iframe gives every copy its own global scope. */
function adsterraBannerSrcdoc() {
  const { key, width, height } = ADSTERRA.banner;
  const opts = JSON.stringify({ key, format: 'iframe', height, width, params: {} });
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    '<style>html,body{margin:0;padding:0;overflow:hidden;background:transparent}</style>' +
    '</head><body>' +
    `<script>window.atOptions=${opts};<\/script>` +
    `<script src="https://www.highperformanceformat.com/${key}/invoke.js"><\/script>` +
    '</body></html>'
  );
}

/** The unit is a fixed 468x60, which is wider than a phone. Rather than
 * clipping it (useless to the advertiser and to us) it is scaled down to
 * whatever width is actually available. */
function fitAdsterraBanner(wrap) {
  const { width, height } = ADSTERRA.banner;
  const avail = wrap.clientWidth || wrap.parentElement?.clientWidth || width;
  const scale = Math.min(1, avail / width);
  const frame = wrap.querySelector('iframe');
  if (frame) frame.style.transform = `scale(${scale})`;
  wrap.style.height = `${Math.round(height * scale)}px`;
}

function refitAdsterraBanners() {
  adsterraWraps = adsterraWraps.filter((w) => w.isConnected);
  adsterraWraps.forEach(fitAdsterraBanner);
}

function createAdsterraBannerLi() {
  if (!ADSTERRA.enabled || !ADSTERRA.banner.key) return null;

  const li = document.createElement('li');
  li.className = 'ad-banner-item';

  const wrap = document.createElement('div');
  wrap.className = 'adsterra-banner';
  // Reserve the unscaled height so the row does not jump when it fits.
  wrap.style.height = `${ADSTERRA.banner.height}px`;

  const frame = document.createElement('iframe');
  frame.className = 'adsterra-banner-frame';
  frame.width = ADSTERRA.banner.width;
  frame.height = ADSTERRA.banner.height;
  frame.title = 'Advertisement';
  frame.loading = 'lazy';
  frame.scrolling = 'no';
  frame.setAttribute('frameborder', '0');
  frame.srcdoc = adsterraBannerSrcdoc();

  wrap.appendChild(frame);
  li.appendChild(wrap);
  adsterraWraps.push(wrap);
  return li;
}

/** Native banner — one per page; it binds to a single container id. */
function mountAdsterraNative() {
  if (!ADSTERRA.enabled || !ADSTERRA.native.id || adsterraNativeMounted) return;
  if (!els.links) return;
  adsterraNativeMounted = true;

  const host = document.createElement('div');
  host.id = 'adsterra-native';
  host.setAttribute('aria-label', 'Advertisement');

  // The container must exist before invoke.js runs or it has nothing to
  // fill, so it is appended first and the script after.
  const container = document.createElement('div');
  container.id = `container-${ADSTERRA.native.id}`;
  host.appendChild(container);

  const script = document.createElement('script');
  script.async = true;
  script.setAttribute('data-cfasync', 'false');
  script.src = ADSTERRA.native.src;
  host.appendChild(script);

  els.links.insertAdjacentElement('afterend', host);
}

/** Social Bar / popunder — see the policy warning on ADSTERRA above. */
function mountAdsterraSocial() {
  if (!ADSTERRA.enabled || !ADSTERRA.social.src || adsterraSocialMounted) return;
  adsterraSocialMounted = true;
  const script = document.createElement('script');
  script.async = true;
  script.src = ADSTERRA.social.src;
  document.body.appendChild(script);
}
/* ADSTERRA:END */

/** One in-feed placement, as `{ li, onInserted }`. AdSense wins when a slot
 * is configured, otherwise the next network in line fills the position;
 * null means neither is set and the caller leaves the row out entirely.
 *
 * `onInserted` runs once the node is in the document — every network needs
 * something to happen at that point (AdSense measures the slot, a scaled
 * banner needs a real clientWidth), and returning it as a callback keeps
 * the render loop from knowing which network it is dealing with. */
function createInFeedAdLi() {
  const adsense = createAdSenseInFeedLi();
  if (adsense) return { li: adsense, onInserted: pushAd };

  /* ADSTERRA:START */
  const banner = createAdsterraBannerLi();
  if (banner) {
    return {
      li: banner,
      onInserted: () => fitAdsterraBanner(banner.querySelector('.adsterra-banner')),
    };
  }
  /* ADSTERRA:END */

  return null;
}

// ─── Search-term highlighting ─────────────────────────────────────
// Built from text nodes and <mark> elements rather than innerHTML, so a
// job title containing markup characters can never inject anything.
function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function fillHighlighted(el, text, terms) {
  if (!terms.length) {
    el.textContent = text;
    return;
  }
  const pattern = terms
    .slice()
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join('|');

  // Capturing split: even indices are plain text, odd indices are matches.
  const parts = text.split(new RegExp(`(${pattern})`, 'gi'));
  for (let i = 0; i < parts.length; i += 1) {
    if (!parts[i]) continue;
    if (i % 2 === 1) {
      const mark = document.createElement('mark');
      mark.textContent = parts[i];
      el.appendChild(mark);
    } else {
      el.appendChild(document.createTextNode(parts[i]));
    }
  }
}

// ─── Card construction ────────────────────────────────────────────
function createLinkLi(link, index) {
  const li = document.createElement('li');
  li.className = 'link-item';
  // Stagger only within a batch, so later batches don't ramp to seconds.
  li.style.animationDelay = `${(index % BATCH_SIZE) * 18}ms`;

  const a = document.createElement('a');
  a.className = 'link-button';
  a.href = link.url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';

  const iconSrc = faviconForLink(link.url);
  if (iconSrc) {
    const img = document.createElement('img');
    img.className = 'link-icon';
    img.src = iconSrc;
    img.alt = '';
    img.width = 26;
    img.height = 26;
    img.loading = 'lazy';
    img.decoding = 'async';
    // A broken favicon should leave a clean card, not a torn-image glyph.
    img.addEventListener('error', () => img.remove(), { once: true });
    a.appendChild(img);
  }

  const text = document.createElement('span');
  text.className = 'link-text';

  const title = document.createElement('span');
  title.className = 'link-title';
  fillHighlighted(title, link.title, currentTerms);
  text.appendChild(title);

  const host = hostnameOf(link.url);
  if (host) {
    const source = document.createElement('span');
    source.className = 'link-source';
    // Highlighted too: the filter matches on title *and* URL, so a query
    // like "naukri" often matches only the host. Without this the reader
    // gets a screen of results with nothing showing why they matched.
    fillHighlighted(source, host, currentTerms);
    text.appendChild(source);
  }

  a.appendChild(text);
  a.setAttribute('aria-label', host ? `${link.title} — opens ${host} in a new tab` : link.title);

  const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  arrow.setAttribute('class', 'link-arrow');
  arrow.setAttribute('width', '16');
  arrow.setAttribute('height', '16');
  arrow.setAttribute('viewBox', '0 0 24 24');
  arrow.setAttribute('fill', 'none');
  arrow.setAttribute('stroke', 'currentColor');
  arrow.setAttribute('stroke-width', '2.5');
  arrow.setAttribute('stroke-linecap', 'round');
  arrow.setAttribute('stroke-linejoin', 'round');
  arrow.setAttribute('aria-hidden', 'true');
  const arrowPath = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  arrowPath.setAttribute('points', '9 18 15 12 9 6');
  arrow.appendChild(arrowPath);
  a.appendChild(arrow);

  li.appendChild(a);
  return li;
}

// ─── Batched rendering ────────────────────────────────────────────
function renderNextBatch() {
  const list = els.linksList;
  if (!list) return;

  const slice = currentResults.slice(renderedCount, renderedCount + BATCH_SIZE);
  if (slice.length === 0) return;

  const frag = document.createDocumentFragment();
  const pendingAds = [];

  slice.forEach((link, i) => {
    const index = renderedCount + i;
    frag.appendChild(createLinkLi(link, index));

    const isLastOverall = index === currentResults.length - 1;
    if (adsInResults && (index + 1) % LINKS_PER_AD === 0 && !isLastOverall) {
      const ad = createInFeedAdLi();
      if (ad) {
        frag.appendChild(ad.li);
        pendingAds.push(ad.onInserted);
      }
    }
  });

  list.appendChild(frag);
  renderedCount += slice.length;

  // Deferred until the nodes are actually in the document: a detached slot
  // measures as zero-width, which every ad network handles badly.
  pendingAds.forEach((run) => run());

  updateLoadMore();
  rearmSentinel();
}

/** IntersectionObserver only fires when an element *crosses* a threshold.
 * After appending a batch the sentinel simply moves further down while
 * staying intersecting, which produces no new callback and stalls the
 * feed. Re-observing forces a fresh initial observation at the new
 * position, so batches keep flowing until the sentinel leaves the margin
 * (or everything has been rendered). */
function rearmSentinel() {
  if (!scrollObserver || !els.sentinel) return;
  if (renderedCount >= currentResults.length) return;
  scrollObserver.unobserve(els.sentinel);
  scrollObserver.observe(els.sentinel);
}

function updateLoadMore() {
  const hasMore = renderedCount < currentResults.length;
  setHidden(els.loadMore, !hasMore);
  if (els.loadMore && hasMore) {
    const remaining = currentResults.length - renderedCount;
    els.loadMore.textContent = `Show ${Math.min(BATCH_SIZE, remaining)} more of ${remaining}`;
  }
}

function resetList(results, { withAds }) {
  currentResults = results;
  adsInResults = withAds;
  renderedCount = 0;
  if (els.linksList) els.linksList.replaceChildren();
  renderNextBatch();
}

/** After the result set changes, someone scrolled deep into the previous
 * list would otherwise be left staring at the tail end of a much shorter
 * one. Pull them back to the first result — but only if they had actually
 * scrolled past it, so typing never yanks the page around. */
function scrollResultsIntoView() {
  if (!els.links) return;
  const top = els.links.getBoundingClientRect().top + window.scrollY - 90;
  if (window.scrollY > top) window.scrollTo({ top: Math.max(top, 0), behavior: 'auto' });
}

// ─── Infinite scroll ──────────────────────────────────────────────
function initScrollObserver() {
  if (!els.sentinel || typeof IntersectionObserver === 'undefined') return;
  scrollObserver = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) renderNextBatch();
    },
    { rootMargin: '600px 0px' }
  );
  scrollObserver.observe(els.sentinel);
}

// ─── Filtering ────────────────────────────────────────────────────
function parseTerms(query) {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

function filterLinks(terms, links) {
  if (terms.length === 0) return links;
  return links.filter((link) => {
    const hay = `${link.title} ${link.url}`.toLowerCase();
    return terms.every((term) => hay.includes(term));
  });
}

function executeSearch(query) {
  const terms = parseTerms(query || '');
  currentTerms = terms;

  setHidden(els.searchClear, !(query && query.length));

  if (terms.length === 0) {
    resetList(allLinks, { withAds: ADS_IN_MAIN_FEED });
    setHidden(els.emptyState, true);
    setHidden(els.sidebarLeft, true);
    setHidden(els.sidebarRight, true);
    renderCountMessage(null);
    return;
  }

  const results = filterLinks(terms, allLinks);

  if (results.length === 0) {
    currentResults = [];
    renderedCount = 0;
    if (els.linksList) els.linksList.replaceChildren();
    setHidden(els.loadMore, true);
    setHidden(els.emptyState, false);
    setHidden(els.sidebarLeft, true);
    setHidden(els.sidebarRight, true);
  } else {
    setHidden(els.emptyState, true);
    resetList(results, { withAds: true });
    // Rails only appear once a slot is configured — an empty 170px column
    // either side would otherwise just squeeze the list for nothing.
    if (AD_SLOTS.sidebar) {
      setHidden(els.sidebarLeft, false);
      setHidden(els.sidebarRight, false);
      pushSidebarAds();
    }
  }

  renderCountMessage({ count: results.length, query });
  scrollResultsIntoView();
}

function renderCountMessage(info) {
  const el = els.resultsCount;
  if (!el) return;
  el.replaceChildren();

  if (!info) {
    setHidden(el, true);
    return;
  }
  const strong = document.createElement('strong');
  strong.textContent = String(info.count);
  el.appendChild(strong);
  el.appendChild(
    document.createTextNode(
      `${info.count === 1 ? ' job matches ' : ' jobs match '}“${info.query}”`
    )
  );
  setHidden(el, false);
}

// ─── Search wiring ────────────────────────────────────────────────
function initSearch() {
  const input = els.searchInput;
  let timer = null;

  const run = () => executeSearch(input ? input.value : '');

  const runDebounced = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, SEARCH_DEBOUNCE_MS);
  };

  const runNow = () => {
    if (timer) clearTimeout(timer);
    run();
  };

  if (els.searchBtn) els.searchBtn.addEventListener('click', runNow);

  if (input) {
    input.addEventListener('input', runDebounced);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        runNow();
        input.blur(); // dismisses the on-screen keyboard on mobile
      } else if (e.key === 'Escape') {
        input.value = '';
        runNow();
      }
    });
  }

  const clear = () => {
    if (input) {
      input.value = '';
      input.focus();
    }
    runNow();
  };

  if (els.searchClear) els.searchClear.addEventListener('click', clear);
  if (els.emptyReset) els.emptyReset.addEventListener('click', clear);
  if (els.loadMore) els.loadMore.addEventListener('click', renderNextBatch);

  // "/" focuses search from anywhere, the way most search-first sites do.
  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
    e.preventDefault();
    input?.focus();
    input?.select();
  });
}

// ─── Back to top ──────────────────────────────────────────────────
function initBackToTop() {
  const btn = els.backToTop;
  if (!btn) return;

  let ticking = false;
  const update = () => {
    setHidden(btn, window.scrollY < BACK_TO_TOP_AT);
    ticking = false;
  };

  window.addEventListener(
    'scroll',
    () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    },
    { passive: true }
  );

  // Deliberately does not focus the search field: on mobile that would
  // pop the on-screen keyboard open every time someone jumps to the top.
  btn.addEventListener('click', () => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
  });
}

// ─── Last updated ─────────────────────────────────────────────────
function renderLastUpdated(generatedAt) {
  if (!generatedAt) return;
  const date = new Date(generatedAt);
  if (Number.isNaN(date.getTime())) return;
  setText(
    'last-updated',
    `Updated ${date.toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    })}`
  );
}

// ─── Shortlink hash support (for external shortlink services) ─────
function decodeShortlink(hash) {
  try {
    const match = hash.match(/#search=([A-Za-z0-9+/=_-]+)/);
    if (match && match[1]) return decodeURIComponent(escape(atob(match[1])));
  } catch {
    /* Malformed hash — fall through to "no query". */
  }
  return null;
}

function applyHashQuery() {
  const query = decodeShortlink(window.location.hash) || '';
  if (els.searchInput) els.searchInput.value = query;
  executeSearch(query);
}

// ─── Init ─────────────────────────────────────────────────────────
function cacheElements() {
  Object.assign(els, {
    avatar: $('avatar'),
    favicon: $('favicon'),
    appleTouchIcon: $('apple-touch-icon'),
    statPill: $('stat-pill'),
    statText: $('stat-text'),
    searchInput: $('search-input'),
    searchBtn: $('search-btn'),
    searchClear: $('search-clear'),
    links: $('links'),
    linksList: $('links-list'),
    skeleton: $('skeleton'),
    sentinel: $('scroll-sentinel'),
    loadMore: $('load-more'),
    emptyState: $('empty-state'),
    emptyReset: $('empty-reset'),
    resultsCount: $('results-count'),
    sidebarLeft: $('sidebar-left'),
    sidebarRight: $('sidebar-right'),
    backToTop: $('back-to-top'),
  });
}

async function init() {
  cacheElements();
  initSearch();
  initBackToTop();

  try {
    const data = await loadProfile();
    const { profile, links } = data;

    allLinks = Array.isArray(links) ? links : [];

    document.title = profile?.name ? `${profile.name} | Links` : 'Links';
    setText('display-name', profile?.name || '');
    setText('bio', profile?.bio || '');
    renderAvatar(profile || {});

    if (allLinks.length > 0 && els.statPill) {
      setText('stat-text', `${allLinks.length.toLocaleString()} live openings`);
      els.statPill.hidden = false;
    }

    setHidden(els.skeleton, true);
    els.links?.setAttribute('aria-busy', 'false');

    applyHashQuery();
    if (allLinks.length === 0) setHidden(els.emptyState, false);

    initScrollObserver();
    renderLastUpdated(data.generatedAt);

    /* ADSTERRA:START */
    mountAdsterraNative();
    mountAdsterraSocial();
    let refitPending = false;
    window.addEventListener(
      'resize',
      () => {
        if (refitPending) return;
        refitPending = true;
        requestAnimationFrame(() => {
          refitPending = false;
          refitAdsterraBanners();
        });
      },
      { passive: true }
    );
    /* ADSTERRA:END */

    window.addEventListener('hashchange', applyHashQuery);
  } catch (err) {
    console.error('[app] Failed to render profile:', err);
    setHidden(els.skeleton, true);
    els.links?.setAttribute('aria-busy', 'false');
    setHidden(els.emptyState, false);
    const title = els.emptyState?.querySelector('.empty-title');
    const hint = els.emptyState?.querySelector('.empty-hint');
    if (title) title.textContent = "Couldn't load jobs";
    if (hint) hint.textContent = 'Check your connection and reload the page.';
    if (els.emptyReset) els.emptyReset.hidden = true;
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
