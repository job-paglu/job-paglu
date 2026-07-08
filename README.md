# Linktree Clone (Static, Self-Updating, GitHub Pages)

A zero-backend clone of a public [Linktree](https://linktr.ee/) page. A
Node.js scraper reads **only publicly visible** page content (no Linktree
API, no login, no private data) and writes it to `data/profile.json`. A
GitHub Actions workflow runs the scraper on a schedule and redeploys the
site to GitHub Pages automatically.

Currently configured to mirror: `https://linktr.ee/karrarhussainjobs`

## How it works

```
┌────────────────────┐      ┌──────────────────────┐      ┌───────────────────┐
│ scripts/scrape.js   │ ---> │ data/profile.json     │ ---> │ index.html/script.js│
│ (public HTML + the  │      │ (minified, committed)  │      │ (renders in browser)│
│  public GitHub API) │      └──────────────────────┘      └───────────────────┘
└────────────────────┘
```

- `scripts/scrape.js` downloads the Linktree page's HTML and extracts the
  embedded `__NEXT_DATA__` JSON (Linktree is a Next.js app). Rather than
  depending on fixed CSS selectors or exact object paths, it recursively
  scans the JSON tree for keys that look like the data we need (avatar,
  bio, links, socials). If Linktree's markup changes moderately, this
  keeps working; if the whole page structure changes, it falls back to
  standard `<meta>` OpenGraph tags.
- It also calls the **public** `https://api.github.com/users/<username>`
  endpoint (no token required) to source the display name, bio, avatar,
  and profile link from the GitHub account that owns the repository.
  GitHub values take precedence for `name`/`bio`/`avatar` when present;
  Linktree remains the source of truth for the actual links list.
- The script then regenerates the SEO block inside `index.html` (title,
  meta description, canonical URL, OpenGraph, Twitter Card, JSON-LD) plus
  `robots.txt` and `sitemap.xml`, using the repository's own GitHub Pages
  URL (auto-detected from `GITHUB_REPOSITORY`).
- `index.html` + `style.css` + `script.js` are a plain HTML/CSS/vanilla-JS
  front end. No React, no build step. `script.js` fetches
  `data/profile.json` at runtime and renders the avatar, bio, socials, and
  link buttons, with lazy-loaded icons and staggered fade-in animations.

If the scrape fails for any reason (network issue, Linktree returning zero
links, GitHub API rate limiting, etc.), the script **throws before writing
anything**, so the previous `data/profile.json` is left completely
untouched and the error is logged in the workflow run.

## Repository structure

```
/
├── index.html              Page shell + SEO block (auto-updated)
├── style.css               All styling (dark/light aware, responsive)
├── script.js                Renders data/profile.json into the DOM
├── data/
│   └── profile.json         Generated data (do not hand-edit; will be overwritten)
├── assets/                  Static SVG icons (favicon, placeholder avatar)
├── scripts/
│   └── scrape.js             The scraper (Node.js, ES modules, no deps)
├── robots.txt / sitemap.xml  Auto-generated, using the repo's real Pages URL
├── .github/workflows/update.yml   Scheduled scrape + deploy pipeline
└── package.json
```

## Local development

Requirements: Node.js 20+.

```bash
# Run the scraper once, locally
npm run scrape

# Serve the site locally (any static file server works)
npm start
# then open http://localhost:8080
```

Running `npm run scrape` locally will also detect your git remote to infer
the GitHub owner/repo (falls back gracefully if you're not in a git repo
yet, or have no remote configured).

To point the scraper at a different public Linktree page without editing
code:

```bash
LINKTREE_URL="https://linktr.ee/someoneelse" npm run scrape
```

## GitHub Pages setup

1. Push this repository to GitHub.
2. In **Settings → Pages**, set **Source** to **GitHub Actions** (one-time,
   manual step — GitHub does not allow this to be configured purely from
   workflow YAML for security reasons).
3. That's it. The `update.yml` workflow builds and deploys automatically;
   no manual `npm run build` step exists or is needed, since this is a
   static site.

Your site will be live at:

```
https://<your-username>.github.io/<repo-name>/
```

(or `https://<your-username>.github.io/` if the repo is named
`<your-username>.github.io`).

## GitHub Actions

`.github/workflows/update.yml` runs:

- Every 3 hours (`cron: '0 */3 * * *'`)
- On demand (`workflow_dispatch` — use the "Run workflow" button in the
  Actions tab)
- On every push to `main`

Steps: checkout → set up Node 20 → `npm install` → `npm run scrape` →
commit `data/profile.json`/`index.html`/`robots.txt`/`sitemap.xml` **only
if they actually changed** → deploy the repository as a Pages artifact.

The commit step uses `git status --porcelain` to detect real changes and
skips committing entirely when nothing changed, so you won't get empty
commits every 3 hours.

## Manual run

Go to the **Actions** tab → **Update Linktree data and deploy** → **Run
workflow**. Useful right after editing the scraper or if you want to force
a refresh outside the 3-hour schedule.

## Repository secrets

**None required.** The workflow only uses the automatically-provided
`GITHUB_TOKEN` (for committing data changes and deploying to Pages) and
unauthenticated public HTTP requests (Linktree page, GitHub public REST
API). There is nothing to configure in **Settings → Secrets**.

## Customization

- **Target a different Linktree page:** edit the `LINKTREE_URL` constant at
  the top of `scripts/scrape.js`, or set a `LINKTREE_URL` repository
  variable/secret and reference it via `env:` in `update.yml`.
- **Styling:** all visual styling lives in `style.css`, using CSS custom
  properties (`:root { --accent: ...; }`) for quick re-theming, plus a
  `prefers-color-scheme` media query for automatic dark/light adaptation.
- **Social icons:** `script.js`'s `SOCIAL_ICONS` map controls the emoji
  glyph shown per platform; swap in your own SVGs if you prefer.
- **Schedule frequency:** change the `cron` expression in
  `.github/workflows/update.yml`.

## Notes on scope and limits

- This project scrapes only what is publicly rendered on the target
  Linktree page — the same data any visitor's browser receives. It does
  not use Linktree's private/authenticated API and requires no Linktree
  credentials.
- Images (avatar, link icons) are hot-linked from their original CDNs
  (GitHub's avatar CDN, Linktree's asset CDN, and Google's public favicon
  service for individual link icons) rather than being re-downloaded and
  stored in this repository. Those CDNs already serve compressed,
  cache-friendly images, which avoids duplicate downloads and keeps this
  repository's `data/profile.json` payload minified and small.
- Because there is no server, OpenGraph/Twitter meta tags are refreshed at
  **scrape time** (baked into the static `index.html`), not at request
  time — so link-preview crawlers (which typically don't execute
  JavaScript) still see accurate, up-to-date `<meta>` tags rather than a
  generic placeholder.
