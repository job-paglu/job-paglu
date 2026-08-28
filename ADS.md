# Ads — what is on the page

**One** ad network runs on this site: Google AdSense. Adsterra was trialled
and has been removed — see the history note at the bottom.

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

While these are empty **no ads render at all** beyond Auto ads: no
AdSense `<ins>` is emitted and the sidebar rails stay hidden. An `<ins>`
with an empty `data-ad-slot` can never fill, so emitting one would just
put dead markup on the page and reserve 170px rails showing nothing.

### Which unit type to create

| Placement | Create as | Why |
|---|---|---|
| Every 6th row (`inFeed`) | **In-feed ad** | Built for lists. Renders card-shaped to match the job rows and reflows across viewports on its own (`data-ad-format="fluid"`). A fixed-size display banner would fight the 1/2/3-column grid. |
| Left/right rails (`sidebar`) | **Display ad**, responsive | Standard vertical banner for a 170px rail. |

One in-feed unit is enough — Google permits reusing the same ad unit
multiple times on a page, and each `<ins>` gets its own `push({})`. The
only cost is that all in-feed positions report as a single line in
AdSense. Create separate units if you want per-position numbers.

## Ad density

```js
const LINKS_PER_AD = 6;        // one ad every 6 job rows
const ADS_IN_MAIN_FEED = true; // false = ads only in search results
```

`ADS_IN_MAIN_FEED` was previously effectively `false`: ads appeared only
after a search, so the majority of visitors — who never search — saw none.

## How a placement is wired

`createInFeedAdLi()` returns `{ li, onInserted }` or `null`, and
`renderNextBatch()` calls `onInserted()` once the node is in the document.
The render loop does not know which network produced the element, so
adding or removing a network touches only that function.

---

## History: Adsterra (added and removed, Aug 2026)

Three Adsterra units were trialled — a 468×60 banner every 6th row, a
native banner below the list, and a Social Bar / popunder. All three have
been **fully removed**; nothing in the codebase references them.

The Social Bar was disabled before the rest was removed, because **Google
AdSense forbids serving its ads on pages that also run pop-unders** —
running both risked the AdSense account, which is the larger earner. If
Adsterra is ever reconsidered, that constraint still applies: the popunder
unit and the AdSense script tag cannot coexist on the same page.

The unit keys are recoverable from git history (`git log -S adsterra`) if
they are ever needed again.
