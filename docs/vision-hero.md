# VISION — Hero 4-tile (v-hero)

> **Scope:** Replace `StatStrip` 8 lifetime counters with a 4-tile hero on `Overview`. No new sync. Purely derived from `Pull` + `Run` already in `store.go:Data`.  
> **Files to touch (next phase):** `api.go` (extend `apiOverview` + builder), `metrics.go` / `features.go` (pure helpers), `frontend/src/pages/overview.tsx` (replace `StatStrip`), `frontend/src/lib/api.ts` (types).  
> **Design language:** Primer tokens, Tailwind v4, shadcn `Card` + `Badge` + `Tooltip`, no new deps. Charts untouched (velocity, shipping trends, heatmap remain).

---

## 1. Goal

Replace the dense 8-cell `StatStrip` (lifetime totals: PRs, merged, open, contributors, lines ±, avg diff, files) with a **4-tile hero** that answers in <3s: "how fast, how reliable, how fast are we shipping, how concentrated?"

| Tile | One-liner | Proxy for | Source |
|---|---|---|---|
| **Cycle** | Median & p90 days from `CreatedAt → MergedAt` | Flow time / lead time | `Pull` merged |
| **CI success** | `success / (success+failure) ×100` | CI health / change confidence | `Run` recent |
| **Throughput** | Merged per week (last 4w avg + per day) | Delivery velocity | `Pull` merged |
| **Bus share** | Top-3 authors' share of merges | Concentration risk | `Contributor` |

Success = an EM opening `/` sees 4 numbers that explain health better than lifetime lines-added ever did, with tooltips that prove how each is computed and links to drill-downs.

---

## 2. Non-Goals

- New GitHub fetches, DB, persisted aggregates — all computed on read from `Snapshot()` (in-memory filter, same as `VelocityDeltas` / `BusFactorOf`).
- Replacing velocity cards (`This week / This month / This year`), shipping trends, heatmap, automation/bus cards — hero sits **above** them, not instead of.
- Full DORA (deployment frequency, CFR, MTTR) — those live in `vision-dora-lite` / `vision-flaky`; hero surfaces the 4 most decision-ready signals only.
- Per-repo hero drill-down in v1 — hero is org-wide (all `GITHUB_ORG` repos); repo filtering is follow-up `?repo=` like `insights`.
- Alerting / paging — read-only metrics + empty states.

---

## 3. Users & Stories

- **IC / Reviewer:** "I want p50 1.2d / p90 4.8d at a glance — if p90 >7d my review queue is stuck."
- **EM:** "I want CI 92% green — if <80% I know merges will stall this week."
- **Tech Lead:** "I want throughput 11/wk — if it drops to 3/wk vs last 4w, flow is blocked."
- **EM:** "I want bus 48% — if top3 >70% High concentration I need to spread ownership."

---

## 4. Metric Spec (per tile)

All 4 tiles share one `window` for recency: **last 90 days** for cycle/throughput/bus, **last 30 days** for CI (CI churns faster). If the org has < window days of history, use all available time. Lifetime counters remain accessible via tooltip/detail, not primary.

### 4.1 Cycle — p50 / p90 (metrics.go)

**Definition:** `cycleDays = MergedAt.Sub(CreatedAt).Hours()/24` per `MERGED` pull (exclude `OPEN`/`CLOSED`; `Draft` counts if later merged — `CreatedAt` is source of truth). Clamp negative (clock skew) to `0` and `slog.Warn` once per request if seen (same as DORA spec).

**Percentiles:** `p50 = median`, `p90 = 90th percentile` over `[]float64` via linear interpolation (`percentile(sorted, p)` — extend existing `medianFloat`, do not duplicate). Single element → p50==p90==value. `n==0` → both `0`, tile shows `—`.

**Window:** `since = now.AddDate(0,0,-90)` (UTC). Collect cycles for `MergedAt ∈ (since, now]`. If `count==0` in window but org has older merges, fall back to lifetime (avoid empty hero on young deployment) and add footnote "all-time" pill.

```go
type CycleStats struct {
  P50    float64 `json:"p50"`    // days
  P90    float64 `json:"p90"`    // days
  P75    float64 `json:"p75,omitempty"` // optional for tooltip, computed if n>=5
  Mean   float64 `json:"mean,omitempty"`
  Count  int     `json:"count"`  // n in window
  WindowDays int `json:"windowDays"` // 90 (or lifetime fallback)
}

func CycleStatsOf(pulls []Pull, since time.Time) CycleStats
func LeadTimePercentiles(days []float64) (p50, p75, p90 float64) // reuse from DORA; or percentile helper
func percentile(sorted []float64, p float64) float64 // 0<=p<=100, linear, sorted input
```

**Thresholds** (one-line tuning, document as consts):
```
p50 <2d green, 2–4d amber, >4d red
p90 <7d green, 7–14d amber, >14d red
n<10 → dim value, add "n small — interpret cautiously" chip
```

Display header `Cycle p50 1.8d · p90 5.2d (n=44)` — p50 large, p90 smaller muted. Risk color driven by p90 (tail matters more than median).

### 4.2 CI success — success% (metrics.go or api.go builder)

**Definition:** over `Run` where `RunStartedAt` (fallback `CreatedAt`) in last 30d, `Conclusion` in `{"success","failure"}` (exclude `other`/`skipped`/`cancelled` which inflate denom and hide signal — same as `computeInsights` fix):

```
successRate = success / (success+failure) *100
total = success+failure
```

If `total==0` → `successRate 0`, tile shows `—` + EmptyState "No CI runs in 30d".

**Window:** `since = now.AddDate(0,0,-30)` (UTC). Uses `Run.RunStartedAt` (fallback `CreatedAt`) for bucketing — existing `CISeries` semantics.

```go
type CISuccess struct {
  Success     int     `json:"success"`
  Failure     int     `json:"failure"`
  Total       int     `json:"total"` // success+failure
  Rate        float64 `json:"rate"`  // 0..100
  WindowDays  int     `json:"windowDays"` // 30
}

func CISuccessOf(runs []Run, since time.Time) CISuccess
```

**Thresholds:**
```
rate >=90 green "Healthy", 80–90 amber "Watch", <80 red "Needs attention"
total <20 → dim, tooltip "n<20 — low CI volume"
```

Do not divide by `other`; success bar uses `Rate`, not `success/totalRuns`. Keeps parity with `insights` fix (`denom = success+failure`).

### 4.3 Throughput — merged per week (metrics.go)

**Definition:** delivery throughput in PRs/week.

```
merged = count Pull where State==MERGED && MergedAt ∈ (since, now] where since = now-28d (last 4 weeks)
perWeek = merged / 4
perDay  = merged / 28
avgPerWeek4w = same as perWeek (v1) — future: rolling weekly array for sparkline
```

For trend chip, also compute previous 4w (`prevSince=now-56d` to `now-28d`) and `deltaPct = (cur-prev)/prev*100` (0 when prev 0 — reuse velocity logic, show "New" badge).

```go
type Throughput struct {
  Merged      int     `json:"merged"`      // in window
  PerWeek     float64 `json:"perWeek"`     // merged/4
  PerDay      float64 `json:"perDay"`      // merged/28
  WindowDays  int     `json:"windowDays"`  // 28
  PrevMerged  int     `json:"prevMerged"`
  DeltaPct    float64 `json:"deltaPct"`
}

func ThroughputOf(pulls []Pull, now time.Time) Throughput
```

Display `11.2/wk · 1.6/day` (large perWeek, small perDay) + delta badge `+12%` / `—` / `New`. No chart in v1 hero tile; sparkline is `insights` responsibility.

**Thresholds:** no red/green — throughput is context dependent; show amber only when `merged==0` ("No merges in 28d").

### 4.4 Bus share — top-3 concentration (features.go / reuse BusFactor)

**Definition:** reuse `BusFactorOf(contribs, totalMerged)` where `contribs = Contributors(windowPulls)` filtered to same 90d window as cycle (consistent recency). If window count is 0, fall back to lifetime (same as cycle). Return `Top3Share` + `Top` (3 contributors) — already typed `BusFactor`.

```
top3Share = sum(top3.merged)/totalMerged*100
riskLabel = top3Share >=70 ? "High concentration" : >=50 ? "Moderate" : "Healthy"
```

```go
// reuse existing
type BusFactor struct {
  Top3Share float64       `json:"top3Share"`
  Top       []Contributor `json:"top"`
}
func BusFactorOf(contribs []Contributor, totalMerged int) BusFactor // already in features.go
```

Hero shows `48%` large + `of merges by top 3` small + risk pill color (healthy emerald, moderate amber, high red) same palette as `BusCard`. Avatars row reused but compact (3 dots, 16px) in tile footer.

Window alignment note: spec fixes hero bus to **90d window** so cycle/throughput/bus share the same denominator period; document divergence if reviewer prefers lifetime bus (one-line change to `since` arg).

---

## 5. Data & API Contract

**Server builder** (extend `api.go`):

```go
type Hero struct {
  Cycle      CycleStats  `json:"cycle"`
  CI         CISuccess   `json:"ci"`
  Throughput Throughput  `json:"throughput"`
  Bus        BusFactor   `json:"bus"`
  WindowNote string      `json:"windowNote,omitempty"` // "90d window" or "all-time fallback"
}

type apiOverview struct {
  Org             string        `json:"org"`
  AvatarURL       string        `json:"avatarUrl"`
  SyncedAt        *time.Time    `json:"syncedAt,omitempty"`
  LastError       string        `json:"lastError,omitempty"`
  RepoErrorCount  int           `json:"repoErrorCount"`
  Gran            string        `json:"gran"`
  Hero            Hero          `json:"hero"` // NEW — 4-tile source of truth
  Stats           overviewStats `json:"stats"` // kept for back-compat one release, not rendered
  Contributors    int           `json:"contributors"`
  Monthly         []ShipBucket  `json:"monthly"`
  TopContributors []Contributor `json:"topContributors"`
  Largest         []RankedPull  `json:"largest"`
  Velocity        []VelocityDelta `json:"velocity"`
  Bot             BotSplit      `json:"bot"`
  ShipDist        ShipDistribution `json:"shipDist"`
  Bus             BusFactor     `json:"bus"` // kept, but hero bus is canonical
  Heatmap         []DayCount    `json:"heatmap"`
}

func computeOverview(snap Data, largestN int, gran Granularity) apiOverview
// internally calls:
//   CycleStatsOf(windowPulls90, since90)
//   CISuccessOf(windowRuns30, since30)
//   ThroughputOf(allPulls, now)
//   BusFactorOf(Contributors(windowPulls90), mergedWindow)
```

`since90 = now.AddDate(0,0,-90)` (UTC), `since30 = now.AddDate(0,0,-30)`. All helpers pure; `now` injected via `time.Now().UTC()` at handler level for testability (same pattern as `ShippingSeriesRange`).

**HTTP:** `GET /api/overview?largest=&gran=` unchanged (additive field). `period` not added in v1; hero windows are fixed constants. If reviewer wants `?period=30d|90d` make it `queryInt("heroWindow")` follow-up. `200 JSON, no-store, CORS *`. Empty snapshot → `hero.{cycle.count==0, ci.total==0, throughput.merged==0, bus.top3Share==0}`, frontend empties tiles to `—` with tooltip "No data yet".

Frontend types in `frontend/src/lib/api.ts`:

```ts
export interface HeroCycle { p50:number; p90:number; p75?:number; mean?:number; count:number; windowDays:number }
export interface HeroCI { success:number; failure:number; total:number; rate:number; windowDays:number }
export interface HeroThroughput { merged:number; perWeek:number; perDay:number; windowDays:number; prevMerged:number; deltaPct:number }
export interface Hero { cycle:HeroCycle; ci:HeroCI; throughput:HeroThroughput; bus:{top3Share:number; top:Contributor[]}; windowNote?:string }
export interface OverviewData {
  // ... existing
  hero: Hero
  stats: { total:number; merged:number; open:number; closed:number; additions:number; deletions:number; files:number; commits:number; avgDiff:number; avgFiles:number } // kept compat
}
```

No new storage; snapshot filters in-memory. Lifetime `stats` stays in payload one release so old frontend doesn't 500, then removed.

---

## 6. File Ownership

| Function / Type | File | Why |
|---|---|---|
| `CycleStats`, `CycleStatsOf`, `percentile`, `LeadTimePercentiles` reuse | `metrics.go` | Pure `[]Pull → []float64 → pXX` series like `medianFloat`, `ShipBucket`, `CISeries`; stdlib-only. Reuses `bucketKey` if windowing needed. |
| `CISuccess`, `CISuccessOf` | `metrics.go` or `api.go` builder | Simple `[]Run` rollup (success/(success+failure)); keep near `CISeries`/`WorkflowStats` if in `metrics.go`, else inline in `api.go:computeOverview` to avoid exporting. |
| `Throughput`, `ThroughputOf` | `metrics.go` | Pure `[]Pull, now → perWeek/perDay`; neighbours `CountState`, `Contributors`. |
| `Hero`, `computeOverview` extension, `handleAPIOverview` glue | `api.go` | Shared builder pattern (same as `computeInsights`, `computeDoraLite`); owns `now` injection and snapshot filtering. |
| `BusFactor` reuse | `features.go` (already there) | No new type; hero bus calls existing `BusFactorOf`. |
| `HeroTiles` / `HeroTile` components, `StatStrip` removal | `frontend/src/pages/overview.tsx` | Primary file per task; replaces `StatStrip`. Reuses `Card`, `Badge`, `Tooltip`, `cn`, `comma`, `compact`. |
| `Hero*` TS interfaces, `getOverview` return shape | `frontend/src/lib/api.ts` | Mirrors `apiOverview`. Additive only. |

Do not duplicate `medianFloat` — extend with `percentile(sorted []float64, p float64) float64` and `LeadTimePercentiles`. Do not duplicate `bucketKey` — hero windows use `since time.Time` filtering, not bucket keys.

`metrics.go` stays stdlib-only (`sort`, `time`, `math`); `features.go` already imports `sort`/`time` — no new deps. `api.go` stays stdlib + existing helpers.

---

## 7. Algorithm & Perf Notes

- **Single filtered `[]Pull` per request:** hero filters `pulls90 = filterMergedSince(pulls, since90)` once (linear `O(P)` where `P≈851`) and shares slice header across `CycleStatsOf`, `Throughput window + BusFactor`. No per-tile `make([]Pull, len)` copy — slice header copy + iterate over shared backing (same guidance as `vision-dora-lite §7`). `windowRuns30` likewise one linear scan over `Runs` (`R≈21k`) → ~21k loop, still <1ms.
- **Percentiles:** collect `[]float64` sized to `count` (cap `merged` in 90d, typically 50–150). `sort.Float64s` in place; interpolation `k = p/100*(n-1)` between `sorted[⌊k⌋]` and `sorted[⌈k⌉]` (consistent with numpy `linear`). Reuse `sync.Pool` scratch follow-up optional — not required at N≤150.
- **Throughput delta:** two `countMergedBetween` passes over `pulls` (reusing helper from `features.go`) — or single pass with 2 if branches; negligible.
- **Bus share:** `Contributors(windowPulls90)` builds map `login→Contributor` (`O(windowMerged)`); then `BusFactorOf` sums top3. Lifetime fallback path does full `Contributors(pulls)` only when window empty.
- **CI success:** one scan of `Runs` checking `RunStartedAt` (fallback `CreatedAt`) against `since30`; counts `success` vs `failure`. `other` excluded by design.
- **Zero alloc niceties:** pre-size `cycles := make([]float64, 0, count)` after first count pass; avoid `time.Parse` in loop — compare `time.Time` directly; `now` captured once per request.
- **Injection:** helpers take `now time.Time` or `since time.Time` — no `time.Now()` inside `metrics.go` (testable, mirrors `ShippingSeriesRange`).
- **String keys:** hero has no bucket keys — just scalar rollups; no `bucketKey`/`continuousKeys` needed.

---

## 8. Visual Design (Primer + shadcn)

**Layout:** hero replaces `<StatStrip />` at same DOM position — first element under `<PageHeader>`.

```
<div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
  <HeroTile cycle />
  <HeroTile ci />
  <HeroTile throughput />
  <HeroTile bus />
</div>
```

Each `HeroTile` is `Card rounded-[6px]` with `CardContent p-3 flex flex-col gap-1`:

- **Top row:** `label` (`text-[11px] font-medium text-muted-foreground uppercase tracking-wide`) left + `risk pill / delta badge` right (`Badge` or colored `span` with icon). Cycle: risk color by p90; CI: by rate; Throughput: delta badge `TrendingUp/Down` (green/red) or `—`; Bus: by share.
- **Value row:** `text-xl font-semibold tabular-nums` large. Cycle: `1.8d` + `· p90 5.2d` smaller muted; CI: `92%`; Throughput: `11.2/wk`; Bus: `48%`.
- **Sub row:** `text-[11px] text-muted-foreground` — Cycle: `median · n=44 · 90d` (+ all-time fallback pill); CI: `48 success · 4 fail · 30d`; Throughput: `1.6/day · 44 in 28d vs 38 prior`; Bus: `of merges by top 3` + 3-dot avatars / names compact.
- **Footer hint:** optional tiny bar: CI has 2-color `bg-muted` bar `success%` fill (`var(--chart-2)` + `var(--chart-5)`); Bus has bar `top3Share%` fill (`var(--chart-1)`); Cycle no bar; Throughput no bar (trend is in badge).
- **Tooltip:** wrap tile in `Tooltip` — trigger is the whole card, content lists exact `window`, counts, formula, threshold legend, and CTA `Click to see throughput trends → scroll to Shipping trends`.
- **Click:** Cycle → scroll to shipping trends (anchor `id="shipping-trends"`); CI → navigate `href="/insights?period=1m"` (CI drill-down); Throughput → anchor `id="shipping-trends"`; Bus → anchor `id="bus-factor"` (existing `BusCard`).

**StatStrip removal:** delete `function StatStrip` (≈30 lines) and its call. Lifetime totals move to tooltips only (hover throughput vs prior shows prevMerged; cycle tooltip shows mean/min/max; CI tooltip shows success+failure). No data loss, just de-emphasized.

**Skeleton:** loading state replaces 8-skeleton grid with same `grid-cols-2 lg:grid-cols-4` — 4 `Card`s each with `Skeleton h-5 w-16` (value) + `h-3 w-24` (label). Keeps layout shift 0.

**Responsive:** `grid-cols-2` on mobile (2×2), `lg:grid-cols-4` on desktop (1×4). Same border/ring treatment as current `StatStrip` but using `Card` ring (`ring-1 ring-foreground/10`) for consistency with velocity cards.

**A11y:** each tile `role="region" aria-label="Median cycle"`, value has `aria-label="1.8 days median"`; `sr-only` table fallback inside card with 2 rows (value + window). Badges have `title` with threshold legend. Empty → `—` with `aria-label="No data"`.

**Colors (Primer tokens, Tailwind v4):**
- healthy emerald: `text-green-600 dark:text-green-400` / `bg-green-500`
- moderate amber: `text-amber-600 dark:text-amber-400`
- high red: `text-red-600 dark:text-red-400`
- muted: `text-muted-foreground`
Matches existing `BusCard` + `AutomationCard` palette; no new hex.

Twin with `InsightsPage` period controls is intentional follow-up: hero windows fixed 90d/30d today, so tooltip must state window explicitly. Future `?heroWindow=` toggle would share same `since` derivation.

---

## 9. Edge Cases & Validation

- `n==0` merged in 90d (fresh org, or all `OPEN`/`CLOSED`): Cycle shows `—`, sub `No merges in 90d · all-time 0`, tooltip "No cycle data — lifetime also empty"; p50/p90 not rendered as `0.0d` (confusing). Same for Throughput `—` + "No merges in 28d". Fallback to lifetime only shows pill when fallback non-empty; don't silently mix windows.
- `n<10` per window: dim value `opacity-60`, add small `Badge variant="outline"` chip "n=3 — interpret cautiously" + tooltip note (same guidance as DORA lead-time spec).
- Negative `cycleDays` (clock skew where `MergedAt < CreatedAt`): clamp to `0`, `slog.Warn` once per request with `pull.repo#number` sample, continue (do not drop PRs). Prevents p90 NaN.
- `Run` with `RunStartedAt.IsZero()` → fallback `CreatedAt`; if both zero → skip run (invalid, warn if >5 cases). Prevents hero CI crashing on malformed sync rows.
- Still-OPEN PRs excluded from cycle/throughput (no `MergedAt`); counted nowhere in hero (intentional — hero is ship health).
- Bot PRs: cycle/throughput/bus **exclude bots by default?** Spec: hero includes bots (`IsBot` not filtered) for honesty — lifetime statstrip also included bots. Add `?includeBot=` toggle follow-up noted in Open Questions, not v1. Document inclusion.
- CI `other` (cancelled/skipped/timed_out mapped to other) excluded from denom; if org is 100% `other` (e.g., all `queued`), `total==0` → `—`, not `0%` with red alarming.
- Longest `p90` with 1 PR: p90==p50 (interpolation collapses) — renders correctly as equal; no division by zero.
- Snapshot empty (`pulls==nil && runs==nil`): all 4 tiles show `—`, `EmptyState` above hero "Waiting for data — the first sync is in progress." (same as current `!data || total==0` guard). No chart rendering.
- Large window (90d) with 5-year span: hero is O(P) filter, no bucket generation — no perf concern unlike WIP daily sweep. 90d cap keeps `cycles` slice small.
- Dark mode: tile borders and bars must remain visible — use `var(--chart-1/2/5)` and `bg-muted` fills that adapt; test both themes (like verification in `vision-dora-lite`).

---

## 10. Tests (next phase writes)

Table-driven `*_test.go` alongside `metrics.go`/`features.go` (stdlib only, `now` injected):

- `TestCycleStatsOf_Empty` — 0 pulls → `Count 0, P50 0, P90 0`.
- `TestCycleStatsOf_Single` — 1 pull with 2d lead → p50==p90==2.0 ±1e-9.
- `TestCycleStatsOf_Known` — durations `[1,2,3,4,5,6,7,8,9,10]` days (10 synthetic pulls) → p50 5.5, p75 7.75, p90 9.1 (linear interpolation) — same oracle as DORA `TestLeadTimePercentiles`.
- `TestCycleStatsOf_Window` — 3 pulls 10/40/100 days ago, `since=now-90d` → count 2, verifies old excluded.
- `TestCycleStatsOf_NegativeClamp` — `MergedAt == CreatedAt -2h` → cycle 0, not negative, warn path not panic.
- `TestPercentile_Edge` — sorted `[1]`, p0=1 p50=1 p100=1; sorted `[1,2]`, p50=1.5, p0=1 p100=2.
- `TestCISuccessOf_Empty` — 0 runs → Rate 0 Total 0.
- `TestCISuccessOf_Mix` — 8 success, 2 failure, 3 other → Rate 80, Total 10, other ignored.
- `TestCISuccessOf_Window` — runs 40/10/35 days ago, since30 → only 10d one counted.
- `TestThroughputOf_Basic` — 56 merged in 28d → PerWeek 14, PerDay 2, Prev window 28 merged → DeltaPct 100.
- `TestThroughputOf_EmptyPrev` — cur 12 prev 0 → DeltaPct 0, IsNew semantics true (badge "New").
- `TestThroughputOf_Zero` — 0 merged → PerWeek 0, badge "—".
- `TestBusShare_HeroWindow` — 10 merges windowed 90d, contribs A:5 B:3 C:2 → Top3Share 100% (same as BusFactor path), fallback lifetime path tested.
- `TestComputeOverview_HeroFields` — synthetic snap with pulls+runs, assert `Hero.Cycle.Count`, `Hero.CI.Rate`, `Hero.Throughput.PerWeek`, `Hero.Bus.Top3Share` non-zero and JSON tags round-trip.

Helpers: `mustParseTime(t string) time.Time`, `pullMerged(since time.Duration, author string)` factory, `run(conclusion string, daysAgo int)` factory — reuse existing `metrics_test.go` factories where possible.

All funcs pure; `time.Now()` injected via explicit `now` param (follow `ShippingSeriesRange` pattern). No FS/network.

---

## 11. Rollout

Phase V (this doc) → Phase I: `metrics.go` (`CycleStats`, `CycleStatsOf`, `percentile`, `CISuccessOf`, `ThroughputOf`) + unit tests → Phase II: `api.go: Hero` struct + `computeOverview` extension (wire `since90`/`since30`, `now` injection, `windowNote`, back-compat `Stats` retention) + handler + `frontend/src/lib/api.ts` types → Phase III: `frontend/src/pages/overview.tsx` deliverables:

1. Delete `StatStrip` function + its `grid 8` call, add `HeroTile` + `HeroTiles` 4-tile grid (isolated, no chart dep) — ship first, immediate value.
2. Skeletons: replace 8-skeleton loader with 4-tile loader (`grid-cols-4`), verify a11y + dark mode.
3. Wire tooltips + anchors (`id="shipping-trends"` on Shipping trends container, `id="bus-factor"` on BusCard), verify `useApi` loading + empty guards (`hero.cycle.count==0`).
4. Polish: risk colors, bars, delta badges, `EmptyState` for hero zero, doc footnote window disclosure.

No migration, no `state.json` / `data` change, no `deploy.sh` change. Additive API (`hero` field) — old frontend ignores new field, new frontend ignores `stats` rendering (but still reads for one release).

Flag: no feature flag; hero replaces statstrip on deploy (one-line revert is restoring `StatStrip` function if PM asks).

---

## 12. Open Questions (resolve in implementation review)

- **Window fixed 90d/30d vs tied to Insights `period`?** Spec fixes hero to 90d/30d for recency; alternative ties to `?heroPeriod=30d|90d|all` query — one-line change to `since` derivation, document in tooltip. Reviewer to confirm EM prefers fixed recency over "hero follows period pill".
- **Include bot PRs in cycle/throughput/bus?** Spec includes bots for honesty (same as statstrip); toggle `?includeBot=0` could filter `p.IsBot`. One-line `if p.IsBot skip` — defer to follow-up unless reviewer wants human-only hero.
- **Fallback to lifetime when window empty:** Spec shows all-time pill when fallback non-empty; alternative always shows empty hero to encourage windowing honesty — implement as `if count==0 { hide cycle value, show — }` not fallback average. One-line policy.
- **p90 vs p95:** Spec fixes p90 (tail but not noisy extreme); if reviewer prefers p95 like `vision-flaky`, change const `p=90→95` — same `percentile` call.
- **Throughput sparkline in tile?** Spec omits sparkline (keeps tile compact); add tiny `AreaChart height 28` in Throughput tile follow-up if PM wants "7-day sparkline inside tile". Reuse `Area` stroke `var(--chart-1)` (like WIP sparkline spec).
- **CI window 30d vs 7d:** Spec 30d for stability; alternative 7d is more reactive but noisy (n<20 often). One-line `AddDate(0,0,-7)` toggle — reviewer to pick.
- **Bus window lifetime vs 90d:** Spec aligns bus to 90d window with cycle/throughput; alternative keeps `BusFactor` lifetime (current `computeOverview` top3 over all). Either accepted — document choice in `windowNote` tooltip.

---

*Vision author: Muse Spark (pi) — 2026-08-29 — for branch `main` base, files `frontend/src/pages/overview.tsx` + `api.go` (helpers `metrics.go`/`features.go`/`frontend/src/lib/api.ts`).*
