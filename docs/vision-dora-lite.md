# VISION — DORA-lite (v-dora)

> **Scope:** 4-panel metrics strip for `pr-insights`. No new sync. Purely derived from `Pull` already in `store.go:Data`.  
> **Files to touch (next phase):** `metrics.go`, `features.go` — then `api.go` + `frontend/src/pages/*` in implementation follow-up.  
> **Design language:** Primer tokens, Recharts (donut = Pie, band = Area+Area, sparkline = tiny Area), Tailwind v4.

---

## 1. Goal

Add a **DORA-lite** observability row above the existing Insights charts — four small, read-at-a-glance panels that turn the current 851 PRs + 21k Runs data into flow-health signals without adding Deployment Frequency / CFR heavyweight DORA:

| Panel | One-liner | Proxy for |
|---|---|---|
| **T-shirt donut (XS–XXL)** | How big are the changes we ship? | Review risk / batch size |
| **Lead-time p50/p75/p90 band** | How long from `CreatedAt → MergedAt`? | Lead Time for Changes |
| **WIP + Little's Law sparkline** | How many PRs are open right now, and does `WIP ≈ Throughput × CycleTime` hold? | Flow stability / bottleneck |
| **Abandonment donut** | Closed-unmerged vs merged vs open | Waste / rework (light CFR proxy) |

Success = a manager can open `/insights?period=3m&gran=week` and in <5s answer: "are we shipping small, fast, steady, and not wasting work?"

---

## 2. Non-Goals

- Full DORA (Deployment Frequency stays as `merged/week` in `ShippingSeries`; Change Failure Rate / MTTR not proxied beyond abandonment; CI `Run` data not mixed into these 4 panels).
- Per-repo drift detection, forecasting, or alerting — just read-only metrics + empty-states.
- New GitHub fetches, DB, or persisted aggregates — all computed on read from `Snapshot()` + filtered by `repo`/`since`.
- Writing frontend now (vision only specifies contracts; implementation phase does `api.go` + React).

---

## 3. Users & Stories

- **IC / Reviewer:** "I want to see if my team is landing XS/S PRs, not XXL, so reviews stay kind."
- **Tech Lead:** "I want p90 lead-time trending down week-over-week; p50/p90 gap tells me variance."
- **EM:** "I want WIP flat and Little's Law error <20%; spikes mean we context-switch."
- **EM:** "I want abandonment <10% and not rising; XXL abandonment hurts."

---

## 4. Metric Spec (per panel)

### 4.1 T-shirt Donut — XS→XXL (metrics.go)

**Definition:** bucket by `diff = Additions+Deletions` (same as `MetricDiff.Value`). `isBot` PRs excluded by default; caller passes `includeBot bool` (default `false` for humans).

Thresholds (literature-aligned, matches 30/50/200/500/1000 breakpoints widely cited):

```
XS  :   0–  10  trivial  — docs/typo   color var(--chart-2)  #2da44e
S   :  11–  50  small    — ideal       color var(--chart-1)  #0969da
M   :  51– 200  medium  — reviewable   color #1f883d
L   : 201– 500  large   — careful     color #d29922
XL  : 501–1000  x-large — risky       color #cf222e
XXL : 1000+     xx-large— split it    color #82071e
```

*Rationale over 0-9/10-29/30-99 alternative:* the 50/200/500 cut aligns with "50 lines = 1 review slot", "200 = 1 focused session" studies and keeps XS meaningful for bots/docs. Document constant so tuning is 1 line.

**Computation:**
```go
type TShirt string
const (
  TShirtXS TShirt = "XS"
  TShirtS  TShirt = "S"
  TShirtM  TShirt = "M"
  TShirtL  TShirt = "L"
  TShirtXL TShirt = "XL"
  TShirtXXL TShirt = "XXL"
)
func TShirtFor(p Pull) TShirt // pure, O(1), used in sort/filter

type TShirtSegment struct {
  Size  TShirt  `json:"size"`  // "XS"
  Label string  `json:"label"` // "XS · 0–10"
  Count int     `json:"count"`
  Pct   float64 `json:"pct"`   // 0..100
  Color string  `json:"color"` // CSS var
}
func TShirtDistribution(pulls []Pull) []TShirtSegment // 6 entries, sum Count = len(filtered), Pct sums 100
func TShirtDistributionFiltered(pulls []Pull, repo string, since time.Time, includeBot bool) []TShirtSegment
```

Edge: empty input → all Count 0, Pct 0, frontend shows EmptyState "No merged PRs in period". Draft PRs counted if State==MERGED? No — only MERGED for this donut; CLOSED/OPEN excluded (prevents abandonment double-count).

Donut: Recharts `Pie` innerRadius 55 outerRadius 80, 6 slices, legend `XS 12 (34%)`. Tooltip `XS · 0–10 — 12 PRs (34%)`. Center label `n=35 median M`. Link click → `/pulls?state=merged&sort=diff` filtered to bucket range (needs frontend `from`/`to` lines).

### 4.2 Lead-Time p50 / p75 / p90 Band (metrics.go)

**Definition:** `leadDays = MergedAt.Sub(CreatedAt).Hours()/24` per MERGED pull (use `ClosedAt` for CLOSED if caller asks for closed). Unit days (float64). `IsDraft` excluded? No — drafts that later merged still count (CreatedAt is true start; `IsDraft` not a filter).

**Percentiles:** nearest-rank / linear interpolation via sorted slice (share `medianFloat` but extend). Use same helper as `medianFloat` but with pooling for alloc reuse (see §7).

```
p50 = median
p75 = 75th percentile
p90 = 90th percentile
mean, min, max also returned for tooltip
```

Bands per bucket (weekly or monthly) + overall summary for donut header.

```go
type LeadTimeBucket struct {
  Key   string  `json:"key"`   // "2026-01" or "2026-01-13" (Monday)
  Label string  `json:"label"` // bucketKey label
  Count int     `json:"count"`
  P50   float64 `json:"p50"`
  P75   float64 `json:"p75"`
  P90   float64 `json:"p90"`
  Mean  float64 `json:"mean"`
  Min   float64 `json:"min"`
  Max   float64 `json:"max"`
}
func LeadTimePercentiles(days []float64) (p50, p75, p90 float64) // pure, no alloc if caller reuses scratch
func LeadTimeSeries(pulls []Pull, repo string, g Granularity, since time.Time) []LeadTimeBucket
func LeadTimeStats(pulls []Pull, repo string, since time.Time) (overall LeadTimeBucket) // single rollup
```

Algorithm: collect `[]float64` per bucket keyed by `bucketKey(mergedAt, g)`; sort copy (`sort.Float64s`); percentile index `ceil(p/100*n)-1` with linear interpolation between `sorted[k]` and `sorted[k+1]` (consistent with numpy `linear`). Cache sorted slices per bucket only once.

Visualization: `AreaChart` with 3 layers — `p90` area (light fill opacity 0.12) to `p50`, `p75` line (dashed), `p50` line (solid var(--chart-1)). `XAxis` = `Label`, `YAxis` days. `Brush` syncs with existing ShippingSeries brush. Tooltip rows use `SeriesTip` pattern: `p50 2.3 days · p75 4.1 · p90 8.7 (n=12)`. For n<10, dim band and show "n small — variance high" chip; for n==0 bucket, all percentiles 0, area gap (Recharts `connectNulls=false`).

### 4.3 WIP + Little's Law Sparkline (metrics.go + features.go split)

**Definition:**

- **WIP(t)** = `# { p | CreatedAt ≤ t  AND  (MergedAt==nil && ClosedAt==nil  OR  max(MergedAt,ClosedAt) > t) }` i.e. open at instant `t`. Drafts counted as WIP (they block flow); bots excluded by default (`includeBot bool`).
- **Throughput λ** = `merged / windowDays` (merged per day over same window).
- **Cycle time W** = mean `leadDays` for merged in window.
- **Little's Law:** `L = λ × W` predicted steady-state WIP. Compare `AvgWIP` (time-averaged over window, integral of WIP(t) dt / windowDays) vs predicted.

Sparkline: daily WIP at UTC 00:00 for last 90 days (or `since..to` if insights period set). Zero-fill via `continuousKeys` pattern already in `metrics.go`.

```go
// metrics.go (raw series)
type WIPPoint struct {
  Date string  `json:"date"` // "2006-01-02"
  WIP  int     `json:"wip"`
}
func WIPSeries(pulls []Pull, repo string, from, to time.Time, includeBot bool) []WIPPoint
  // events sweep: sort CreatedAt (+1) and terminal (+-1) per pull, sweep daily
  // O(N log N) for sort + O(D) for days; N~851, D~90 => trivial

// features.go (interpreted)
type LittleLaw struct {
  WindowDays     int       `json:"windowDays"`
  AvgWIP         float64   `json:"avgWip"`         // time-averaged WIP
  ThroughputPerDay float64 `json:"throughputPerDay"` // λ
  CycleMeanDays  float64   `json:"cycleMeanDays"`  // W
  PredictedWIP   float64   `json:"predictedWip"`   // λ×W
  ErrorPct       float64   `json:"errorPct"`       // |Avg-Predicted|/Avg*100
  CurrentWIP     int       `json:"currentWip"`     // WIP today
  Points         []WIPPoint `json:"points"`        // sparkline data (90d)
}
func LittleLawOf(pulls []Pull, repo string, windowDays int) LittleLaw // windowDays 30/90 default 30
```

Sweep detail: build `map[day]int` deltas: `delta[createdDay]++`, `delta[terminalDay]--` where terminalDay = `max(mergedAt,closedAt)` floor to date; if still OPEN, no decrement. Then cumulative sum in date order = WIP at start of day. `AvgWIP = sum(WIP)/D`. `ThroughputPerDay = mergedInWindow / windowDays`. `CycleMeanDays = mean(leadDays for mergedInWindow)`.

Frontend sparkline: `AreaChart` tiny (height 48) with `Area dataKey="wip" stroke="var(--chart-1)" fill opacity 0.15`, Y domain `dataMin dataMax`, no axes/legend, `ReferenceLine` at `AvgWIP` dashed. Header `WIP 12 avg · 11 predicted · error 8% ✓` (green if error <20 else amber >20). Subtitle `Little's Law: WIP ≈ Throughput × CycleTime`. On hover: `Aug 29 — WIP 14`. Empty window → `AvgWIP 0`, sparkline flat, chip "No open PRs".

Reuse `continuousKeys`/`bucketKey` style; allocate maps with `len hint = distinctDays ≤ windowDays`.

### 4.4 Abandonment Donut (features.go)

**Definition:** among *terminated* PRs (`MERGED`+`CLOSED`), `abandonedRate = CLOSED / (MERGED+CLOSED) *100`. OPEN is shown as third segment for context but not in rate denominator; closed-by-bot distinguished as `botClosed` optional slice.

```go
type Abandonment struct {
  Total         int       `json:"total"`          // MERGED+CLOSED+OPEN
  Merged        int       `json:"merged"`
  Closed        int       `json:"closed"`         // abandoned
  Open          int       `json:"open"`
  AbandonedRate float64   `json:"abandonedRate"`  // closed/(merged+closed)*100, 0 if denom 0
  Segments      []DonutSegment `json:"segments"`  // 3 entries for chart
  BySize        map[TShirt]int `json:"bySize,omitempty"` // optional: abandoned count per T-shirt (insights)
}
type DonutSegment struct {
  Label string  `json:"label"` // "Merged" / "Abandoned" / "Open"
  Count int     `json:"count"`
  Pct   float64 `json:"pct"`   // vs Total
  Color string  `json:"color"`
}
func AbandonmentOf(pulls []Pull, repo string, since time.Time) Abandonment
```

Counts respect same `repo`/`since` filters as other panels ( Insights period). Colors: Merged `var(--chart-2)` green, Abandoned `var(--chart-3)` red, Open `var(--chart-5)` yellow/gray. Donut same Pie spec as T-shirt but 2-3 slices. Tooltip `Abandoned 14 (8.2%) — 14 closed without merge of 171 terminated`. Click Abandoned → `/pulls?state=closed`. Header badge: `<10%` green "Healthy", `10–20%` amber "Watch", `>20%` red "High waste".

Edge: if `merged+closed==0`, `abandonedRate 0`, both merged/closed segments 0, only Open slice if any; donut shows empty state mesg.

---

## 5. Data & API Contract

**Server builder** (add to `api.go`):

```go
type apiDoraLite struct {
  Repo        string           `json:"repo"`
  Period      string           `json:"period"` // "3m"|"6m"|"12m"|"all"
  Gran        string           `json:"gran"`   // week|month
  TShirt      []TShirtSegment  `json:"tshirt"`
  LeadTime    []LeadTimeBucket `json:"leadTime"`    // bucketed
  LeadOverall LeadTimeBucket   `json:"leadOverall"` // rollup summary
  WIP         LittleLaw        `json:"wip"`
  Abandon     Abandonment      `json:"abandon"`
  RepoOptions []RepoInfo       `json:"repoOptions"` // reuse helper
}
func computeDoraLite(snap Data, repo, period string, g Granularity) apiDoraLite
```

**HTTP:** `GET /api/dora-lite?repo=&period=&gran=` (same query shape as `/api/insights`). `period` defaults `6m`, `gran` defaults `month`. `repo=all` or `""` → all repos. 200 JSON, `no-store`. Uses existing `queryInt`/`bucketKeyFloor`/`continuousKeys` helpers.

Frontend types mirror in `frontend/src/lib/api.ts`:

```ts
export interface DoraLiteData {
  repo: string; period: string; gran: string;
  tshirt: { size: string; label: string; count: number; pct: number; color: string }[];
  leadTime: { key: string; label: string; count: number; p50: number; p75: number; p90: number; mean: number; min: number; max: number }[];
  leadOverall: { count: number; p50: number; p75: number; p90: number; mean: number };
  wip: { windowDays: number; avgWip: number; throughputPerDay: number; cycleMeanDays: number; predictedWip: number; errorPct: number; currentWip: number; points: { date: string; wip: number }[] };
  abandon: { total: number; merged: number; closed: number; open: number; abandonedRate: number; segments: { label: string; count: number; pct: number; color: string }[] };
  repoOptions: RepoInfo[];
}
export const getDoraLite = (params:{repo?:string;period?:string;gran?:string})=> fetch(`/api/dora-lite${qs(params)}`).then(json<DoraLiteData>)
```

No new storage; snapshot filters in-memory. Empty snapshot → all arrays empty/zero, frontend EmptyState.

---

## 6. File Ownership

| Function | File | Why |
|---|---|---|
| `TShirt`, `TShirtFor`, `TShirtDistribution*`, size constants, colors | `metrics.go` | Pure diff-size mapping; neighbours `MetricDiff`, `Rank`, `ShipBucket` |
| `LeadTimePercentiles`, `LeadTimeSeries`, `LeadTimeStats`, `LeadTimeBucket` | `metrics.go` | Time-bucketed series like `ShippingSeries`/`CISeries`; reuses `bucketKey`, `continuousKeys`, `medianFloat` |
| `WIPSeries`, `WIPPoint` | `metrics.go` | Raw event-sweep series (like `MonthlySeries`) |
| `LittleLaw`, `LittleLawOf` | `features.go` | Interpreted composite (pulls + intervals) alongside `VelocityDelta`, `BusFactor`, `BotSplit` |
| `Abandonment`, `DonutSegment`, `AbandonmentOf` | `features.go` | High-level waste insight akin to `BotSplitOf`/`ShipDistributionOf`/`Heatmap`; may import `TShirt` from `metrics.go` for `BySize` |

Do not duplicate `medianFloat` — extend it with `percentileFloat(sorted []float64, p float64)`. Do not duplicate `bucketKey` — reuse as-is. Add small helper `daysBetween(CreatedAt, MergedAt) float64` (hours/24).

`metrics.go` stays stdlib-only; `features.go` already imports `sort`, `strings`, `time` — no new deps.

---

## 7. Algorithm & Perf Notes

- All 4 panels share one filtered `[]Pull` per request (filter by `repo`+`since` once, pass slice views). Avoid per-panel `make([]Pull, len)` copies — slice header copy + iterate over shared backing.
- Percentiles: collect `[]float64` per bucket sized to bucket count; `sort.Float64s` in place; interpolate. Reuse `sync.Pool` scratch for `[]float64` if we opt in later (not required for 851 PRs; 90 days × ≤50 durations per bucket = ~4.5k floats).
- WIP sweep: one sort of `2*N` events (N≤851 → 1.7k ints) + linear sweep; negligible. Pre-size maps: `make(map[string]int, windowDays)` for daily deltas, `make(map[string][]float64, bucketCount)` for lead times.
- String keys: keep existing `bucketKey` string keys for series (consistent with `ShipBucket` contract) — int-key optimization is follow-up, not vision.
- Bots: filter `p.IsBot` (already set at ingestion via `IsBot(login)`) — no per-call `IsBot` + `ToLower` allocation here.
- Zero-fill: reuse `continuousKeys(from,to,g)` for LeadTime band; WIP daily does explicit date loop.

---

## 8. Visual Design (Primer + shadcn)

Layout: 2×2 grid on `md`+ (`grid-cols-2`), stack on `mobile`. Each `Card` header = `SectionTitle` + period pill, content = chart, footer = one-line insight.

- **T-shirt donut:** `ChartContainer` + Recharts `PieChart` `Pie` with `innerRadius 55 outerRadius 80 paddingAngle 2`. 6 slices colors above. Center text: total merged `n`. Legend rows with `size` + `count (pct%)`. On slice hover: highlight + tooltip. Use `chartConfig` mapping per size.
- **Lead-time band:** `AreaChart` with areas: `p90` base + `p50` diff as layered `Area` fills (band) — or `Area` for `p90` and `Area` for `p50` with `fillOpacity`. Lines: `p75` dashed `strokeDasharray 6 3`. `CartesianGrid`, `XAxis` tick `label`, `YAxis` `days`. + `ReferenceLine` at `leadOverall.p50`. Small stats row above chart: `p50 2.3d · p75 4.1d · p90 8.7d`.
- **WIP sparkline:** Card height compact. Header `Avg WIP 12.3 · Predicted 11 · error 8%`. Tiny `AreaChart` `height 48` margins 0. Y hidden. `Area stroke var(--chart-1)`. If error >20% show amber `Flow mismatch — throughput/cycle diverge` beneath.
- **Abandonment donut:** same `Pie` as T-shirt but 3 slices (Merged/Abandoned/Open). Header badge color by rate. Footer `Closed 14 of 171 terminated (8.2%)`.

Accessibility: each chart has `<table class="sr-only">` fallback (counts per bucket/size), `aria-label`, `Tooltip` keyboard focusable. Empty: `EmptyState` inside card, no chart.

Twin with existing `InsightsPage` controls: repo `FilterBar`, period `3m|6m|12m|all`, `gran week|month` (lead-time gran; WIP always daily; t-shirt/abandon granularity agnostic).

---

## 9. Edge Cases & Validation

- N=0 merged in period → all panels empty-state: T-shirt donut "No merged PRs", Lead band flat at 0 with dim overlay, WIP sparkline "No activity", Abandon donut shows only Open if any.
- n<10 per bucket → band semi-transparent, tooltip adds "(n=3 — interpret cautiously)".
- Negative lead-time (clock skew) → clamp to 0, log `slog.Warn` at ingestion if ever seen.
- Still-OPEN PRs excluded from lead-time (no MergedAt); included in WIP; counted in abandonment Open slice only.
- Draft vs non-draft: no special-case; `CreatedAt` is source of truth.
- Bot toggling: default exclude bots in T-shirt/WIP/Abandon; add `?includeBot=1` later if user asks (not in v1).
- Period `all` with 5-year span: WIP daily points could be 1800 points — cap sparkline at 90d (`WIP last 90d`) always, independent of period, to keep chart legible; document footnote.
- Repos with 1 PR: p75/p90 == p50 (interpolation collapses) — renders as tight band, correct.

---

## 10. Tests (next phase writes)

Table-driven `*_test.go` alongside each file (no new deps):

- `TestTShirtFor` — boundary table: 0→XS, 10→XS, 11→S, 50→S, 51→M, 200→M, 201→L, 500→L, 501→XL, 1000→XL, 1001→XXL, 5000→XXL.
- `TestTShirtDistribution` — 7 PRs spread → counts + pct sum 100 ±0.01, empty input → all 0.
- `TestLeadTimePercentiles` — known sorted durations `[1,2,3,4,5,6,7,8,9,10]` → p50 5.5, p75 7.75, p90 9.1; single element → all same.
- `TestLeadTimeSeries` — 3 PRs across 2 week buckets, missing week zero-fills, oldest-first, empty → nil.
- `TestWIPSeries` — craft 4 pulls with overlapping lifetimes (2 open, 2 closed), sweep 10 days, assert per-day WIP and avg.
- `TestLittleLaw` — synthetic 30d: 30 merged, avg WIP 5, throughput 1/d, cycle 5d → predicted 5 error ~0; diverging case error >30%.
- `TestAbandonmentOf` — 8 merged 2 closed 3 open → total 13, rate 20%, segments pct; 0 terminated → rate 0.
- Frontend (later): storybook/visual snapshots not in scope for vision.

All funcs pure, `time.Now()` injectable via explicit `now` param where needed (follow `ShippingSeriesRange` pattern).

---

## 11. Rollout

Phase V (this doc) → Phase I: `metrics.go` (TShirt*, LeadTime*, WIPSeries) + `features.go` (LittleLaw, Abandonment) + unit tests → Phase II: `api.go: computeDoraLite` + handler → Phase III: `frontend/src/lib/api.ts` types + `pages/insights.tsx` or new `pages/dora.tsx` 2×2 cards (reuse `Card`, `ChartContainer`, `ChartTooltip`, `EmptyState`).

No migration, no snapshot change, no deploy.sh change.

---

## 12. Open Questions (resolve in implementation review)

- Exact XS threshold 10 vs 11 — spec fixes at 10 inclusive; one-line const change if reviewer prefers 9.
- Include bot PRs toggle in v1 or hide behind feature flag?
- WIP window fixed 90d or tied to Insights `period`? Spec: sparkline always 90d, header stats match period — document divergence in tooltip.

---

*Vision author: Muse Spark (pi) — 2026-08-29 — for branch `main` base, files `metrics.go` + `features.go`.*
