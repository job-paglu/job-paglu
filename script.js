// script.js
// Vanilla-JS renderer: fetches the pre-scraped data/profile.json and paints
// the page. No frameworks, no build step — this file runs as-is in the
// browser via <script type="module">.

const DATA_URL = 'data/profile.json';

/** Minimal, dependency-free inline icon set keyed by platform. Falls back
 * to a generic "link" glyph for anything unrecognised. */
const SOCIAL_ICONS = {
  instagram: '📷',
  twitter: '🐦',
  x: '✕',
  facebook: '📘',
  youtube: '▶️',
  tiktok: '🎵',
  linkedin: '💼',
  github: '🐙',
  snapchat: '👻',
  pinterest: '📌',
  twitch: '🎮',
  discord: '💬',
  telegram: '✈️',
  whatsapp: '📞',
  spotify: '🎧',
  link: '🔗',
};

async function loadProfile() {
  // Cache-bust so visitors always see the latest scrape, not a stale
  // service-worker-free browser cache of the JSON file.
  const res = await fetch(`${DATA_URL}?v=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to load profile data (HTTP ${res.status})`);
  return res.json();
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value ?? '';
}

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

function renderSocials(socials = []) {
  const list = document.getElementById('socials');
  list.innerHTML = '';
  for (const social of socials) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = social.url;
    a.className = 'social-link';
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.setAttribute('aria-label', `${social.platform} profile`);
    a.textContent = SOCIAL_ICONS[social.platform] || SOCIAL_ICONS.link;
    li.appendChild(a);
    list.appendChild(li);
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
    const li = document.createElement('li');
    li.className = 'link-item';
    // Stagger the fade-in so the list feels alive without being gimmicky.
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
  });
}

function renderGithubButton(github) {
  const wrap = document.getElementById('github-link-wrap');
  if (!github?.htmlUrl) return;
  wrap.innerHTML = '';
  const a = document.createElement('a');
  a.href = github.htmlUrl;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.textContent = `@${github.username} on GitHub`;
  wrap.appendChild(a);
}

function renderLastUpdated(generatedAt) {
  if (!generatedAt) return;
  const date = new Date(generatedAt);
  if (Number.isNaN(date.getTime())) return;
  setText('last-updated', `Last updated ${date.toLocaleString()}`);
}

async function init() {
  try {
    const data = await loadProfile();
    const { profile, links, socials, github } = data;

    document.title = profile?.name ? `${profile.name} | Links` : 'Links';
    setText('display-name', profile?.name || 'Unknown');
    setText('bio', profile?.bio || '');

    renderAvatar(profile || {});
    renderSocials(socials);
    renderLinks(links);
    renderGithubButton(github);
    renderLastUpdated(data.generatedAt);
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
