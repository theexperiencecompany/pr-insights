# VISION — CI Flakiness (v-flaky)

> **Scope:** Flakiness observability slice for `pr-insights/insights`. No new sync. Purely derived from `Run` already in `store.go:Data` + `Pull` for `cost-per-merge`.  
> **Files to touch (next phase):** `metrics.go` — then `api.go` + `frontend/src/pages/insights.tsx` in implementation follow-up.  
> **Design language:** Primer tokens, Recharts (Bar + Line + tiny Area), shadcn `Card`, `Table`, `Badge`, `ChartContainer`, Tailwind v4.

---

## 1. Goal

Add a **CI flakiness** observability row above / alongside the existing Insights CI charts — compact, read-at-a-glance signals that turn the current ~21k `Run`s (+ 851 `Pull`s for cost) into reliability + waste signals without adding per-job logs or external test-retry APIs:

| Signal | One-liner | Proxy for |
|---|---|---|
| **flakeScore** | How often does this workflow fail in an *isolated* way (next run on same branch succeeds within recovery window)? | Flakiness / intermittency (vs true breakage) |
| **p50 / p95 duration** | What does a typical vs tail run cost in minutes? | Runtime variance / slow-tail |
| **MTTR** | How fast do we recover from failure to next success on the same workflow? | Mean/median Time To Recovery |
| **wastedMinutes** | How many CI minutes burned on `failure`/`timed_out` (`other` → excluded by default, toggle on)? | Waste / retry cost |
| **Needs attention** | Which 3–5 workflows hurt the most right now? | Triage — honest, not auto-hidden |
| **sort flakiest** | One-click table sort by `flakeScore` descending (then `wastedMinutes`, then `failure%`) | Drill-down |
| **cost-per-merge** | `total CI minutes / merged PRs` over the selected period | Efficiency — are we paying more per ship? |

Success = an EM can open `/insights?period=3m&gran=month&repo=gaia` and in <5s answer: "which workflows are flakiest, how long do they waste, how fast do we recover, and what does each merge cost us?"

---

## 2. Non-Goals

- Per-job / per-step failure logs or rerun attempt APIs (`run.attempt`); `Run` is the unit. Collapsing multiple `Run`s for the same commit into one logical attempt is *not* in scope — each stored `Run` is one attempt.
- Failure root-cause classification (infra vs test vs lint) — just statistical flakiness.
- Alerting / paging / Slack — read-only metrics + empty-states only.
- New GitHub fetches, DB, or persisted aggregates — all computed on read from `Snapshot()` + filtered by `repo`/`since` (same as `CISeries`/`WorkflowStats`).
- Writing frontend now beyond contract/types (vision only specifies contracts; implementation phase does `api.go` + React in `insights.tsx`).

---

## 3. Users & Stories

- **IC / Merge queue owner:** "I want to see which workflow keeps flaking on `main` so I stop re-running blindly."
- **Tech Lead:** "I want p95 vs p50 gap — if p95 is 3× p50, our tail is noisy and caching is off."
- **EM:** "I want MTTR trending down; if MTTR >2h for `ci` workflow, batch merges are blocked."
- **EM / FinOps:** "I want wasted minutes and cost-per-merge — if we burn 40k minutes to ship 50 PRs, that's ~13h per merge."
- **On-call:** "I want a 'Needs attention' card that calls out 3 workflows above flake threshold, not buried in a table."

---

## 4. Metric Spec

All metrics respect the same filters as Insights: `repo` (single repo or `all`), `period` (`3m`/`6m`/`12m`/`all` → `since time.Time`), and `gran` where charted. Bots are *not* a filter for `Run`s (workflows are infra-owned); `cost-per-merge` uses merged `Pull`s (bots excluded? No — cost counts all merges; includeBot flag reserved for follow-up, default include all).

Data source: `store.go:Data { Pulls []Pull; Runs []Run }`. `Run` fields used: `Repo`, `Workflow`, `Conclusion` (`success`/`failure`/other), `CreatedAt` (fallback `RunStartedAt`), `DurationSec`, `Branch`. `Pull` fields for cost: `State==MERGED`, `MergedAt`.

### 4.1 flakeScore — per-workflow (metrics.go)

**Definition:** a failure counts as *flaky* when the *next* run of the **same workflow+repo** (any branch) is a `success` and `next.CreatedAt - failed.CreatedAt ≤ recoveryWindow`. Intentionally coarse — any-branch recovery, not per-SHA — so reruns, adjacent pushes, and `main` recoveries all qualify. Matches "isolated failure vs consecutive breakage" heuristic widely used when attempt IDs are unavailable.

```
recoveryWindow = 24h   // const, one-line tuning
minRuns        = 10    // don't score workflows with <10 runs in period (insufficient signal)

let sorted = runs for workflow sorted ascending by CreatedAt
for i, r := range sorted {
  if r.Conclusion == "failure" && i+1 < len(sorted) && sorted[i+1].Conclusion == "success" {
    if sorted[i+1].CreatedAt.Sub(r.CreatedAt) <= 24h {
      flaky++
    }
  }
}
flakeScore = flaky / failure * 100   // 0..100, 0 when failure==0 → 0
```

*Why not `flaky/total`?* Dividing by `failure` isolates flakiness from failure rate; a 5% failure workflow that's 80% flaky is worse than a 30% failure workflow that's 10% flaky. Display both `failureRate` and `flakeScore` side by side.

*Edge for consecutive failures:* two failures in a row → first is **not** flaky (next is failure), second may be flaky if followed by success. Burst of 3 failures + success = 1/3 ≈33%. This rewards rapid recovery.

**Computation:**
```go
const FlakeRecoveryWindow = 24 * time.Hour
const FlakeMinRuns = 10

// FlakeScore returns (flaky, failure, score). Score 0–100, 0 when failure==0.
func FlakeScore(runs []Run) (flaky, failure int, score float64)

// per-workflow bulk (reuses sorted slice, shares median helper)
type FlakyStat struct { // extends WorkflowStat fields — new struct or WorkflowStat extension
  Repo              string   `json:"repo"`
  Workflow          string   `json:"workflow"`
  Runs              int      `json:"runs"`
  Failure           int      `json:"failure"`
  Success           int      `json:"success"`
  Flaky             int      `json:"flaky"`
  FlakeScore        float64  `json:"flakeScore"` // 0..100
  FailureRate       float64  `json:"failureRate"` // failure/(success+failure)*100
  SuccessRate       float64  `json:"successRate"`
  P50Min            float64  `json:"p50Min"`
  P95Min            float64  `json:"p95Min"`
  MTTRMedianMin     float64  `json:"mttrMedianMin"` // median time to next success
  MTTRMeanMin       float64  `json:"mttrMeanMin"`
  WastedMinutes     int      `json:"wastedMinutes"`
  WastedPct         float64  `json:"wastedPct"` // wasted / totalMinutes *100
  CostLabel         string   `json:"-"` // not serialized; frontend derives
}

func FlakyStats(runs []Run, repo string, since time.Time) []FlakyStat // ranked "flakiest" first
```

Ranking for **sort flakiest**: `sort.Slice` by `FlakeScore` desc, then `WastedMinutes` desc, then `FailureRate` desc, then `Repo|Workflow` asc as tie-breaker. Table default sort key = `flakeScore` desc (not `runs`). Caller may resort by `p95`, `mttr`, `wasted`.

Zero-failure → `FlakeScore 0`, not `NaN`. `<10 runs` → still computed but frontend dims row and tooltip says "n<10 — interpret cautiously" + Needs-attention excludes.

### 4.2 p50 / p95 duration — per-workflow (metrics.go)

**Definition:** `durationMin = DurationSec/60` per run where `Conclusion` is `success` or `failure` (exclude `other`/cancelled which skews tails). `p50` = median, `p95` = 95th percentile over sorted `[]float64` via linear interpolation (same helper as DORA `LeadTimePercentiles` / `medianFloat`, extended).

```
p50 = percentile(durations, 50)
p95 = percentile(durations, 95)
```

Also return `min`, `max`, `mean` for tooltip sparklines (optional header `p50 8.2m · p95 21.4m`).

```go
func DurationPercentiles(durations []float64) (p50, p95 float64) // pure, no alloc if caller reuses scratch
func Percentile(sorted []float64, p float64) float64            // 0<=p<=100, linear interpolation, sorted input
// reuses same percentile helper added for LeadTime; don't duplicate medianFloat
```

Algorithm: copy durations for workflow → `sort.Float64s` → interpolate between `sorted[k]` and `sorted[k+1]` where `k = p/100 * (n-1)`. Single element → p50==p95==value. Empty → 0.

Visualization hint: badge row under workflow name `p50 4.1m / p95 18m` + thin bar where `p95-p50` width signals tail variance. Table columns sortable by `p95` (tail hunters) and `p50` (typical cost).

### 4.3 MTTR — per-workflow (metrics.go)

**Definition:** for each `failure` run, measure `recovery = nextSuccess.CreatedAt - failure.CreatedAt` where `nextSuccess` is the first subsequent `success` for the same `workflow+repo` (any branch). Collect all recovery durations (>0) in `[]float64` (minutes). Then:

```
mttrMedianMin = median(recovery)
mttrMeanMin   = mean(recovery)
mttrP95Min    = percentile(recovery, 95) // optional, for tooltip
count         = len(recovery)            // number of recoveries observed
```

If a failure has no following success in the window, it is **unrecovered** and excluded (right-censored). If `count==0` → MTTR 0 and frontend shows "—" with tooltip "no recoveries in period". For `other` runs interspersed: they are skipped — only `failure → ... → success` matters (failures separated by cancellations still recover).

```go
func MTTRForRuns(sortedRuns []Run) (medianMin, meanMin float64, count int)
// or as fields on FlakyStat; FlakyStats computes it inline
```

Example: 100 runs, 12 failures, 8 of those followed by success within weeks → 8 recoveries, median 47m, mean 95m, p95 4.2h.

Frontend: `MTTR median 47m (mean 1.6h · n=8)`; if median >120m, amber. If `failure>0` but `count==0` → "no recovery yet".

### 4.4 wastedMinutes & wastedPct — per-workflow + rollup (metrics.go)

**Definition:** sum of `DurationSec/60` for wasted runs. Default wasted = `failure` only. Optional `timed_out` already maps to `failure` in current ingestion; `other` (`cancelled`/`skipped`/`neutral`) is **excluded** unless caller opts `includeOther bool` (not in v1).

```
wastedMinutes = sum DurationSec/60 where Conclusion=="failure"
totalMinutes  = sum DurationSec/60 where Conclusion in {"success","failure"} // same denom as percentile
wastedPct     = wastedMinutes / totalMinutes *100  // 0..100, 0 when total 0
```

Rollup for the period header:

```
globalWasted  = sum wastedMinutes across workflows
globalTotal   = sum totalMinutes
globalWastedPct = globalWasted/globalTotal*100
```

Also expose per-workflow wasted for sorting (top wasters hurt even if not flakiest).

Edge: `DurationSec` may be 0 for skipped runs — contributes nothing. Clock units stay integer minutes in JSON (`int`) but `wastedPct` is `float64`.

### 4.5 cost-per-merge — global (metrics.go or api.go builder)

**Definition:** CI efficiency — how many CI minutes did we burn per shipped PR?

```
windowMerged = count Pull where State==MERGED && MergedAt in (since, now] [+ repo filter]
totalCIMin   = sum Run.DurationSec/60 where Run in window [+ repo filter] and Conclusion in {"success","failure"}
costPerMerge = totalCIMin / windowMerged        // minutes per merge, 0 when merged==0
```

Units: **minutes per merge**. Also show `costPerMergeHours = minutes/60` in tooltip when >60. Companion `mergedPerHour = windowMerged / totalCIMin *60` optional but not required.

```go
type CostPerMerge struct {
  TotalMinutes int     `json:"totalMinutes"`
  Merged       int     `json:"merged"`
  PerMergeMin  float64 `json:"perMergeMin"` // 0 when merged==0
  PerMerge     string  `json:"perMerge"`    // fmtDuration(PerMergeMin)
}

func CostPerMergeOf(runs []Run, pulls []Pull, repo string, since time.Time) CostPerMerge
```

Note: same `since`/`repo` filters as `computeInsights` — caller filters once, passes slices. `totalMinutes` reuses same `CISeries` total so header stays consistent.

Frontend header example (above CI charts): `Cost per merge: 42 min — 1,840 min across 44 merges (3m)` + sparkline of `totalMinutes / merged` over time if `gran` weekly.

### 4.6 Needs attention card (insights.tsx, derived from FlakyStats)

**Definition:** a shortlist card that surfaces up to `N=5` workflows demanding action in the current filter window. Honest, never auto-hiding.

**Inclusion rule:**
```
include if  Runs >= 10
        && (FlakeScore >= 15  OR  FailureRate >= 20  OR  MTTRMedianMin >= 120  OR  WastedPct >= 25)
```

**Order:** by `FlakeScore` desc, tie `WastedMinutes` desc. If no workflow meets threshold → show empty-state "All stable — no workflow meets attention threshold (flake ≥15%, fail ≥20%, MTTR ≥2h, waste ≥25%)." instead of hiding.

**Card fields per row:**
- `workflow` (truncate), `repo` link to `https://github.com/{org}/{repo}/actions`
- chips: `flake 34%` (red ≥30, amber ≥15 else muted), `fail 18%`, `p95 22m`, `MTTR 48m`, `waste 312 min`
- sparkline: last 6-trend dots (reuse `WorkflowStat.Trend` coloring; muted if trend missing)
- click → expands workflow drill-down (same as existing `toggleExpand`) or navigates to `?hide=` filter

Thresholds are constants (`needsAttentionFlake=15`, `needsAttentionFail=20`, `needsAttentionMTTR=120`, `needsAttentionWastePct=25`) — one-line tuning in `insights.tsx`.

Accessibility: card has `role="region" aria-label="Workflows needing attention"` and an sr-only table fallback.

### 4.7 sort flakiest — table integration (insights.tsx)

The existing workflows `Table` (in `insights.tsx` ~line 800) gains sortable heads:

- default `sort.key = "flakeScore"` `dir="desc"`
- columns: `Flake` (`flakeScore`), `Fail%` (`failureRate`), `p50`, `p95`, `MTTR` (`mttrMedianMin`), `Waste` (`wastedMinutes`)
- `handleWfSort` extended cases; sort comparator:

```ts
switch (wfSort.key) {
  case 'flakeScore': return dir * (a.flakeScore - b.flakeScore)
  case 'p95':        return dir * (a.p95Min - b.p95Min)
  case 'mttr':       return dir * (a.mttrMedianMin - b.mttrMedianMin)
  case 'waste':      return dir * (a.wastedMinutes - b.wastedMinutes)
  // fallback: runs, successRate, median
}
```

Initially sorted "flakiest first" so opening the page answers the question without clicking.

---

## 5. Data & API Contract

**Server builder** (add to `api.go`):

```go
type apiFlaky struct {
  Repo         string       `json:"repo"`
  Period       string       `json:"period"` // "3m"|"6m"|"12m"|"all"
  Gran         string       `json:"gran"`   // week|month (reserved; p50/p95 not bucketed in v1, but keeps shape parity with insights)
  GlobWasted   int          `json:"globalWastedMinutes"`
  GlobWastedPct float64     `json:"globalWastedPct"`
  Cost         CostPerMerge `json:"costPerMerge"`
  Workflows    []FlakyStat  `json:"workflows"`    // flakiest first, includes p50/p95/mttr/wasted
  Needs        []FlakyStat  `json:"needsAttention"` // subset of Workflows per threshold, ≤5
  RepoOptions  []RepoInfo   `json:"repoOptions"`
}
func computeFlaky(snap Data, repo, period string, g Granularity) apiFlaky
```

Alternative minimal increment: extend existing `apiInsights` with `flaky []FlakyStat`, `cost CostPerMerge`, `needsAttention []FlakyStat` — either shape is accepted; spec prefers a dedicated `apiFlaky` to avoid bloating `insights` payload until UI proves cost.

**HTTP:** `GET /api/flaky?repo=&period=&gran=` (same query shape as `/api/insights`). `period` defaults `6m`, `gran` defaults `month`. `repo=all` or `""` → all repos. 200 JSON, `no-store`. Uses existing `queryInt`/`bucketKeyFloor` helpers.

If payload extension is chosen: `GET /api/insights` adds `flaky`, `costPerMerge`, `needsAttention` without breaking existing clients (additive).

Frontend types mirror in `frontend/src/lib/api.ts`:

```ts
export interface FlakyStat {
  repo: string; workflow: string;
  runs: number; success: number; failure: number; flaky: number;
  flakeScore: number; failureRate: number; successRate: number;
  p50Min: number; p95Min: number;
  mttrMedianMin: number; mttrMeanMin: number; mttrCount: number;
  wastedMinutes: number; wastedPct: number;
  trend: number[]; lastRunAt: string | null; lastConclusion: string;
}
export interface FlakyData {
  repo: string; period: string; gran: string;
  globalWastedMinutes: number; globalWastedPct: number;
  costPerMerge: { totalMinutes: number; merged: number; perMergeMin: number };
  workflows: FlakyStat[];       // flakiest first
  needsAttention: FlakyStat[];  // ≤5
  repoOptions: RepoInfo[];
}
export const getFlaky = (params:{repo?:string;period?:string;gran?:string})=> fetch(`/api/flaky${qs(params)}`).then(json<FlakyData>)
```

No new storage; snapshot filters in-memory. Empty snapshot (`runs==0` or `period` has no data) → `workflows:[]`, `needsAttention:[]`, `costPerMerge:{0,0,0}`, frontend shows `EmptyState` per section.

---

## 6. File Ownership

| Function / Type | File | Why |
|---|---|---|
| `FlakeRecoveryWindow`, `FlakeMinRuns`, `FlakeScore`, `FlakyStat`, `FlakyStats`, `DurationPercentiles`, `Percentile`, `MTTRForRuns`, `WastedMinutes`, `CostPerMerge`, `CostPerMergeOf` | `metrics.go` | Pure `[]Run`/`[]Pull` → numbers, neighbours `WorkflowStats`, `CISeries`, `medianFloat`, `ShipBucket`. Keeps `metrics.go` stdlib-only; no new deps. |
| `apiFlaky`, `computeFlaky`, `handleAPIFlaky`, route `GET /api/flaky` | `api.go` / `server.go` | HTTP wiring, same pattern as `computeInsights`/`handleAPIInsights`; reuses `repoOptionsWithPulls`, `queryInt`. |
| `FlakyStat`, `FlakyData`, `getFlaky` types + fetch | `frontend/src/lib/api.ts` | Mirrors `WorkflowStat`/`InsightsData` contracts. |
| Needs-attention card, extra sortable heads, p50/p95/MTTR/waste cells, cost-per-merge header | `frontend/src/pages/insights.tsx` | Collocated with existing workflows `Table` + `hide` prefs. Reuses `SortableHead`, `ConclusionIcon`, `fmtDuration`, `comma`, `ChartCard`, `ToggleLegend`. |

Do not duplicate `medianFloat` — extend with `Percentile(sorted []float64, p float64) float64`. Do not duplicate `bucketKey`/`continuousKeys` — flakiness metrics are *not* bucketed in v1 (per-workflow rollups); bucketing is a follow-up via `FlakySeries` if needed.

`metrics.go` stays stdlib-only (`sort`, `time`, `math`); `insights.tsx` adds no new deps.

---

## 7. Algorithm & Perf Notes

- All per-workflow stats share one filtered `[]Run` per request (filter by `repo`+`since` once; pass slice views). Then group by `repo/workflow` key (`map[string][]Run` with hint `len hint = distinctWorkflows ≤ ~30`). For each group, sort by `CreatedAt` once (`sort.Slice`) and reuse that ordering for flakeScore, MTTR, and duration collection — one sort per workflow.
- Duration percentiles: collect `[]float64` per workflow sized to workflow runs (success+failure only); `sort.Float64s` in place; interpolate. `sync.Pool` scratch optional follow-up, not required for ≤21k runs across workflows.
- MTTR: linear walk over already-sorted runs; `O(n)` per workflow.
- FlakeScore: linear walk comparing adjacent conclusions; `O(n)` per workflow; uses `CreatedAt.Sub` and `≤24h` check.
- Cost-per-merge: one pass over filtered `Pull`s (merged count) + one pass over filtered `Run`s (total minutes) — `O(N+M)`.
- String keys: keep existing `repo/workflow` composite key (`k := r.Repo + "/" + r.Workflow`) consistent with `WorkflowStats`.
- Zero-alloc niceties: pre-size maps, reuse `[]float64` slices with `make([]float64,0,n)`, avoid per-call `IsBot` in hot loop.
- No mutation of `Snapshot()` backing arrays — readers copy `Data` header; compute funcs only read.

---

## 8. Visual Design (Primer + shadcn)

Layout: within `insights.tsx` after the existing CI `CI minutes per bucket` + `Median duration` cards, insert:

```
┌──────────────────────────────────────────────────────────────────────┐
│ CI Flakiness                                                          │
│  Cost per merge  42 min  (1,840 min / 44 merges)  · Waste 612 min (33%) │
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │ Needs attention (≤5)                              [View flakiest→]│ │
│  │  gaia/ci           flake 34%  fail 18%  p95 22m  MTTR 48m waste 312m│ │
│  │  gaia/lint         flake 22%  fail 12%  p95 8m   MTTR 2.1h waste 90m│ │
│  │  gaia/code-quality flake 16%  fail 25%  p95 14m  MTTR 15m waste 45m│ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                                                       │
│  Workflows  [Sort: Flakiest ▾]  [Search]  (honest: N hidden banner)  │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │ Workflow ▸ Flake ▸ Fail%  p50  p95  MTTR  Waste  Trend  Last run │ │
│  │ ci        34.0%  18.2%   4m  22m  48m  312m  ●●●●●●  2h ago     │ │
│  │ lint      22.1%  12.0%   2m   8m 130m   90m  ●●●●●●  1d ago     │ │
│  └──────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

Details:

- **Needs-attention card:** `Card` with `CardHeader` `Workflows needing attention` + badge `N`. Rows are compact `flex` rows, not a `Table`, for glanceability. Each metric chip colored: `flakeScore ≥30` red, `≥15` amber else muted; same for `failureRate`. MTTR >120m amber, >240m red. Wasted >500m red. Hover shows tooltip `Flaky 8/24 failures recovered within 24h`. Empty → `EmptyState` "All stable" with thresholds in footnote.
- **Workflows table enhancements:** extend header with `SortableHead` for `flakeScore` (label "Flake"), `failureRate` ("Fail %"), `p50Min`/`p95Min`, `mttrMedianMin` ("MTTR"), `wastedMinutes` ("Waste"). Default sort `flakeScore desc`. Each `Flake` cell renders as `xx.x%` plus subtle bar background `width=flakeScore%` in `var(--chart-3)` 12% opacity. `p95/p50` cells use `fmtDuration`. `MTTR` cell shows median, tooltip reveals mean+n. `Waste` cell `comma(min) + " min"`.
- **Cost-per-merge header:** `Card` stat strip `4-col` (or header inline): `Total CI minutes` `Wasted minutes`+`%` `Cost per merge` `Merged PRs`. `Cost per merge` highlighted `text-chart-1` larger. Subtitle footnote `sum(minutes where success||failure) / merged PRs in period`.
- **Charts (v1 deferred):** per-workflow duration histogram is *not* in v1; reuse existing `medianDurationMin` line for trend context. Follow-up may add tiny `p95-p50` band `AreaChart`.

Accessibility: each sortable head is a `<button>` with `aria-sort`; table has `<caption class="sr-only">CI workflows ranked flakiest first</caption>`; Needs-attention card has `role="region"`; color alone never conveys meaning — chips always include numeric text.

Tokens: `var(--chart-1)` primary, `var(--chart-2)` success, `var(--chart-3)` failure/flake, `var(--chart-5)` muted; Tailwind `text-muted-foreground` for secondary.

---

## 9. Edge Cases & Validation

- `runs==0` or `period` with no runs → `workflows:[]`, header shows `—`, table empty-state "No workflow runs in period." Needs-attention empty as above.
- `n < FlakeMinRuns` → score still computed but row dimmed `opacity-60`, tooltip "fewer than 10 runs — score volatile" and excluded from Needs-attention.
- `failure==0` → `flakeScore 0`, `failureRate 0`, no MTTR rows, `wastedPct 0`. Sort still works (0 at bottom).
- No recovery observed (failures never followed by success in window) → MTTR fields `0`, cell renders "—" with tooltip "no recoveries yet in period".
- `DurationSec == 0` or negative → clamp to 0; exclude zeros from percentile unless workflow legitimately has sub-minute runs (still counts, but `p95==0` will correctly show fast).
- `totalMinutes==0` → `wastedPct 0`, `costPerMerge 0` — footer says "no CI minutes / merges in period" not `NaN%`.
- Long window (`all`) with 5-year span → `workflows` bounded by distinct workflow keys (~tens), not time; cost-per-merge O(N) still trivial.
- `other` conclusions (`cancelled`/`skipped`/`timed_out` normalized to `failure` at ingestion? Current code groups as `Other` — wastedMinutes excludes `other` to avoid inflating waste with manually cancelled runs; document toggle for follow-up `?includeOther=1`.
- Repos with 1 workflow: ranking degenerates to single row — still renders, no division by zero.

---

## 10. Tests (next phase writes)

Table-driven `*_test.go` alongside `metrics.go` (no new deps), mirroring DORA spec style:

- `TestFlakeScore` — table: empty → 0/0/0; 0 failures → 0; single failure+success within 24h → 1/1/100; failure+failure+success (window 24h) → 1/2/50; failure+success outside 48h → 0/1/0; faster window boundary 24h inclusive; consecutive stale order unsorted → sort first.
- `TestFlakyStats_SortFlakiest` — 4 workflows with differing `flakeScore` and `wastedMinutes`, assert output order `flake desc → wasted desc`.
- `TestDurationPercentiles` — known durations `[2,4,4,4,5,5,7,9]` → p50 4.5, p95 ~7.25 (linear interp); single element → all same; empty → 0,0.
- `TestPercentile_Linear` — direct helper: sorted `[1..10]` → p50 5.5, p75 7.75, p90 9.1 (mirrors numpy linear).
- `TestMTTR` — craft 6 runs: F@0h,S@1h,F@10h,F@11h,S@12h,Other@13h → recoveries `[1h,1h]` (F@10h→S@12h is 2h, but F@11h→S@12h is 1h? depends skipping) — assert median 1h, mean ~1.33h, count 2; no-recovery case → 0,0,0.
- `TestWastedMinutes` — 5 runs: succ 10m, fail 20m, fail 5m, cancelled 100m, succ 15m → wasted 25, total 50, pct 50; empty → 0.
- `TestCostPerMerge` — 100 total min / 10 merged → 10 min/merge; 0 merged → 0; repo filter isolates counts.
- `TestNeedsAttention` — synthetic 6 workflows with thresholds crossing at boundary, verify inclusion and cap at 5, sorted flakiest.
- Frontend (later): `insights.tsx` sort-key toggles and empty-states — storybook snapshots not in scope for vision.

All funcs pure; `time.Now()` injectable via explicit `since` param where needed (follow `ShippingSeriesRange` pattern). Tests do not hit network or filesystem.

---

## 11. Rollout

Phase V (this doc) → Phase I: `metrics.go` (`FlakyStat`, `FlakeScore`, `FlakyStats`, `DurationPercentiles`/`Percentile`, `MTTRForRuns`, `CostPerMergeOf`) + unit tests → Phase II: `api.go:computeFlaky` + handler `GET /api/flaky` (or additive fields on `/api/insights`) + `server.go` route → Phase III: `frontend/src/lib/api.ts` types + `pages/insights.tsx` Needs-attention card + table sort heads + cost-per-merge header (reuse `Card`, `ChartContainer`, `EmptyState`, `SortableHead`).

No migration, no snapshot change, no `deploy.sh` change. Feature flags via query param `?flaky=0` not needed; empty table simply shows no data.

---

## 12. Open Questions (resolve in implementation review)

- Exact recovery window: 24h vs 12h vs 48h — spec fixes at 24h; one-line const change if reviewer prefers tighter window. Per-workflow `branch==main` only vs any branch is second knob; spec uses any-branch to capture reruns/matched pushes.
- Include `other` (cancelled) in wasted? Spec says exclude; follow-up toggle `?includeOther=1` can flip without contract break.
- Should `flakeScore` denom be `failure` (as spec) or `total`? Implementation review to confirm that "isolated failure rate among failures" matches stakeholder mental model; document choice in code comment.
- `cost-per-merge` unit: minutes vs hours — spec uses minutes (consistent with `fmtDuration`, `totalMinutes`); Hours shown only when `>60` in tooltip.
- `Needs attention` thresholds (flake 15%, fail 20%, MTTR 2h, waste 25%) — spec fixes; tune after a week of real `gaia` data if card is always empty or always full.
- Dedicated `/api/flaky` vs extending `/api/insights` — spec prefers dedicated to limit payload churn; either is accepted if reviewer prefers atomic `insights` fetch.

---

*Vision author: Muse Spark (pi) — 2026-08-29 — for branch `main` base, files `metrics.go` + `insights.tsx`.*
