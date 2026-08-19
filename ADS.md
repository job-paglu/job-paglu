# Ads — what is on the page and how to remove it

Two ad networks run on this site. Everything for each one is confined to
clearly marked blocks so it can be pulled out cleanly.

---

## Adsterra

Added as a trial. **Three units**, all configured from a single object at
the top of `script.js`:

| Unit | Type | Status | Where it appears |
|---|---|---|---|
| `banner` | 468×60 iframe banner | **live** | Every 6th row of the job list |
| `native` | Native banner | **live** | Once, directly below the list |
| `social` | Social Bar / popunder | **disabled** | — see below |

### `social` is deliberately off

`ADSTERRA.social.src` is set to `''`. Google AdSense forbids serving its
ads on pages that also run pop-unders, so leaving this unit on risked
termination of the AdSense account (`ca-pub-3043505043619574`) — which
earns considerably more than this unit would.

The URL was **not deleted**; it is parked next to it as `disabledSrc`:

```js
social: {
  src: '',
  disabledSrc: 'https://pl30920896.effectivecpmnetwork.com/fc/ab/20/fcab20b85cd46c9e3f89a3a6cd0626da.js',
},
```

To turn it back on, move `disabledSrc` into `src`. If you do, remove the
AdSense script tag from `index.html` in the same change — running both is
the thing that carries the risk, not either one alone.

### Turn it off (keep the code)

In `script.js`:

```js
const ADSTERRA = {
  enabled: false,   // ← was true
```

That stops all three units immediately. To disable just one, blank its
key/src instead: `social: { src: '' }`.

### Remove it completely

Delete the blocks between these markers. That is the **whole** job — no
other line in the codebase mentions Adsterra:

| File | Marker block | What it holds |
|---|---|---|
| `script.js` | `ADSTERRA:START` … `ADSTERRA:END` (1st) | the config object |
| `script.js` | `ADSTERRA:START` … `ADSTERRA:END` (2nd) | render + mount functions |
| `script.js` | `ADSTERRA:START` … `ADSTERRA:END` (3rd, in `createInFeedAdLi`) | the in-feed hand-off |
| `script.js` | `ADSTERRA:START` … `ADSTERRA:END` (4th, in `init`) | mount calls + resize refit |
| `style.css` | `ADSTERRA:START` … `ADSTERRA:END` | banner/native styling |

The render loop itself is network-agnostic: `createInFeedAdLi()` returns
`{ li, onInserted }` and `renderNextBatch()` just calls `onInserted()`
once the node is in the document. So removing the blocks above leaves the
in-feed machinery working for AdSense with nothing to clean up after.

Confirm nothing is left with:

```sh
grep -rin "adsterra\|highperformanceformat\|effectivecpmnetwork" --exclude-dir=.git .
```

### ⚠ Why you may well have to remove it

The `social` unit is a Social Bar / popunder. **Google AdSense program
policies prohibit showing AdSense ads on pages that also run pop-unders.**
Running both networks together risks the AdSense account
(`ca-pub-3043505043619574`), which is the bigger long-term earner. If you
want to keep Adsterra's banner and native units but drop the risky one:

```js
social: { src: '' },
```

Adsterra's own network is also lower quality than AdSense — expect some
creatives you would not want next to job listings. Check what actually
renders before leaving it up.

---

## Google AdSense

Loaded from the script tag in `index.html` (`ca-pub-3043505043619574`).
That tag alone only enables **Auto ads**. The manual placements — in-feed
and the two sidebar rails — need real ad unit IDs from
**AdSense → Ads → By ad unit**:

```js
const AD_SLOTS = {
  inFeed:  '',   // create an "In-feed ad" unit, paste its data-ad-slot
  sidebar: '',   // create a responsive "Display ad" unit
};
const AD_INFEED_LAYOUT_KEY = '';   // in-feed unit's data-ad-layout-key
```

While these are empty, no AdSense `<ins>` is rendered at all and the
sidebar rails stay hidden — an `<ins>` with an empty `data-ad-slot` can
never fill, so emitting one just puts dead markup on the page.

Once `inFeed` is set, **AdSense takes the every-6th-row position and
Adsterra's banner stops rendering there** (see `createInFeedAdLi()`). Only
one network occupies that slot.

---

## Ad density

```js
const LINKS_PER_AD = 6;       // one ad every 6 job rows
const ADS_IN_MAIN_FEED = true; // false = ads only in search results
```

`ADS_IN_MAIN_FEED` was previously effectively `false`: ads appeared only
after a search, so the majority of visitors — who never search — saw none.
