# VISION — Hybrid CI Lane + Time-to-Release (v-hybrid)

> **Scope:** Hybrid CI observability slice for `pr-insights/insights`. Classify every `Run` as `home` vs `github` via a cheap heuristic, surface per-workflow p50/p90 duration as big numbers with red thresholds at the top, and a github-vs-home pie for cost attribution — plus a lean time-to-release (PR open→merge) tile. No new sync. Purely derived from `Run` + `Pull` already in `store.go:Data`.
> **Files to touch (next phase):** `github.go` (extend `Run` + `RunnerGroup` heuristic), `metrics.go` (pure helpers: percentiles, hybrid stats, runner split), `frontend/src/pages/insights.tsx` (big-number strip + pie + release tile), `api.go` / `frontend/src/lib/api.ts` (contract).  
> **Design language:** Primer tokens, Tailwind v4, shadcn `Card` + `Badge` + `Tooltip`, Recharts `PieChart` + existing `ChartContainer`, no new deps. Charts untouched beyond the new top strip + pie (CI lane performance stays in `metrics.go` with `CISeries` semantics).

---

## 1. Goal

Turn the hybrid runner experiment (`gaia-home` self-hosted vs `ubuntu-latest` GitHub-hosted) from tribal knowledge into **three glanceable signals** on `/insights`:

| Signal | One-liner | Proxy for | Source |
|---|---|---|---|
| **Hybrid lane** | `home` vs `github` share of runs & minutes | Where CI actually ran; cost & speed attribution | `Run` → `RunnerGroup` heuristic |
| **Per-workflow p50/p90** | `avg / median / p90` duration per workflow as big numbers at the top, **red if > threshold** | Lane health & tail risk — slowest lane pops first | `Run.DurationSec` per `workflow` (success+failure) |
| **Github vs home pie** | One pie (runs) + tooltip (minutes) per selected period/repo | Is home absorbing the lanes we expect? | Same split, bucketed by `CISeries` `since`/`repo` filters |
| **Time-to-release** | Median & p90 `CreatedAt → MergedAt` (days) for the same window | Release flow — CI health vs ship health | `Pull` merged (same window as ship) |

Success = an EM opening `/insights?period=3m&repo=gaia&gran=week` sees at the top: "home 68% of runs (412 vs 192) · slowest lane `test-python` p50 9.2m / p90 24m **red** · github/home pie confirms lane split · release p50 1.4d" before scrolling to the existing CI bars. No extra GitHub fetches, no persisted aggregates.

---

## 2. Non-Goals

- Per-job runner-label fidelity (`/repos/.../actions/runs/{id}/jobs` API `labels` / `runner_name`). Heuristic is intentionally coarse and documented; precise job-level API is a follow-up that would 10× API cost and rate-limit budget.
- DORA deployment frequency / CFR / MTTR — those live in `vision-dora-lite` / `vision-flaky`; hybrid surfaces CI *placement* + release *lag* only.
- Alerting / paging / Slack — read-only metrics + empty states.
- New persisted aggregates or DB migration — `RunnerGroup` is computed at read time from `Workflow` (plus backfilled at sync write for new rows); snapshot filters remain in-memory.
- Writing full frontend beyond contract/types in this vision (next phase does `insights.tsx` React). Contracts below are normative.

---

## 3. Users & Stories

- **EM / Platform:** "I want to know what % of CI actually ran on home this week — if home drops to 20% the fallback is burning Actions minutes."
- **Tech Lead:** "I want per-workflow p50/p90 as big numbers — if `test-python` p90 >25m, that lane is the bottleneck regardless of success rate."
- **IC:** "I want red thresholds, not me remembering SLOs — red tells me which lane to open first."
- **FinOps:** "I want github vs home pie in minutes, not just run count — a workflow with 10% of runs but 40% of minutes is the cost driver."
- **EM:** "I want time-to-release p50/p90 alongside CI durations — if CI is fast but release p90 is 9d, reviews are the blocker, not runners."

---

## 4. Metric Spec

All metrics respect the same filters as Insights: `repo` (single repo or `all`), `period` (`3m`/`6m`/`12m`/`all` → `since time.Time`), and `gran` only for thePie's subtitle context (pie is window aggregate, not bucketed). `Runs` considered are `Conclusion in {"success","failure"}` for durations (exclude `other`/`cancelled`/`skipped` which skew tails — same denom as `WorkflowStats`/`CISeries` fix). Time-to-release uses `Pull` where `State==MERGED` + `MergedAt ∈ (since, now]`.

Data sources: `store.go:Data { Pulls []Pull; Runs []Run }`. `Run` fields: `Workflow`, `Conclusion`, `DurationSec`, `CreatedAt`/`RunStartedAt` for window bucketing, `Repo`. `Pull` fields: `CreatedAt`, `MergedAt`, `Repo`.

### 4.1 Run → RunnerGroup heuristic (`github.go` + `metrics.go`)

**Goal:** classify every `Run` without an extra API round-trip.

```go
type RunnerGroup string

const (
    RunnerHome    RunnerGroup = "home"    // gaia-home self-hosted lane
    RunnerGithub  RunnerGroup = "github"  // ubuntu-latest fallback
    RunnerUnknown RunnerGroup = "unknown" // duration==0 or undecidable
)

func InferRunnerGroup(workflow string) RunnerGroup
func RunnerGroupOf(r Run) RunnerGroup // stored if present else Infer
```

**Stored schema** (additive, backward-compatible):

```go
type Run struct {
    ID           int64       `json:"id"`
    Repo         string      `json:"repo"`
    Workflow     string      `json:"workflow"`
    Branch       string      `json:"branch"`
    Event        string      `json:"event"`
    Conclusion   string      `json:"conclusion"`
    Status       string      `json:"status"`
    CreatedAt    time.Time   `json:"createdAt"`
    UpdatedAt    time.Time   `json:"updatedAt"`
    RunStartedAt time.Time   `json:"runStartedAt"`
    DurationSec  int         `json:"durationSec"`
    RunnerGroup  RunnerGroup `json:"runnerGroup,omitempty"` // NEW
}
```

Existing `state.json` rows without `runnerGroup` decode as `""` → `RunnerGroupOf` infers at read; new syncs write it. No migration script — first sync backfills new rows, read-time inference covers old rows. Document `omitempty` so `json.Marshal` on old readers ignores it.

**Heuristic v1 (one-line tuning, substring allowlist, case-insensitive):**

```go
var homeSubstrings = []string{
    "lint", "test", "build", "quality", "mutation",
    "trivy", "docker", "integration", "e2e", "unit",
    "hybrid", "home",
}

func InferRunnerGroup(workflow string) RunnerGroup {
    if workflow == "" {
        return RunnerUnknown
    }
    lw := strings.ToLower(workflow)
    for _, s := range homeSubstrings {
        if strings.Contains(lw, s) {
            return RunnerHome
        }
    }
    // Known GitHub-only lanes (explicit denylist wins over empty allowlist):
    // "deploy", "release", "pages", "codeql" → github
    if strings.Contains(lw, "deploy") || strings.Contains(lw, "release") {
        return RunnerGithub
    }
    return RunnerGithub // default: anything not matched is assumed github-hosted
}
```

Rationale: `gaia`'s `main.yml: select-runner` sends every compute lane (`build`, `test-python`, `test-typescript`, `code-quality`, `mutation`, `trivy`, `docker-image`) to `gaia-home` when idle; only `deploy-web` / `release` stay on `ubuntu-latest`. Substring allowlist captures that without fetching `jobs[*].labels`. It is repo-agnostic: non-`gaia` repos fall back to `github` gracefully (all workflows miss the allowlist → github), pie shows `github 100%` which is honest. Tuning is one line: add/remove substrings in `homeSubstrings`.

**Accuracy note:** a run that *should* have landed on home but fell back (`is_self_hosted==false`) will be misclassified as `home` by this heuristic. That is accepted for v1 — the slice still answers "which lanes are *intended* home" and the duration signal (home runs are 2–4× faster) will make fallback visible as p90 tail. A follow-up `?strictRunner=1` that fetches `GET /repos/{org}/{repo}/actions/runs/{id}/jobs` and reads `labels` → exact label is reserved, not in v1.

**Thresholds / SLOs for isSlow (shared with 4.2):**

```go
const (
    P50ThresholdMin = 10 // >10m median is slow
    P90ThresholdMin = 25 // >25m tail is slow
)
```

Same thresholds apply to per-workflow big-number red. One-line tuning constants, documented alongside heuristic.

**Tests for heuristic:**

- `"test-python (unit-a)"` → home, `"Build"` → home, `"Code Quality"` → home, `"Deploy Web"` → github, `"Release"` → github, `""` → unknown, `"random-workflow"` → github (fallback).

### 4.2 Per-workflow avg / p50 / p90 — big numbers at top (`metrics.go`)

**Definition:** per workflow rollup over `[]Run` filtered by `repo`+`since`, `Conclusion in {success,failure}`.

For each `workflow+repo` key (`k = repo + "/" + workflow`):

```
durations = []float64{ DurationSec/60 for each run in group }  // minutes
sort.Float64s(durations)
p50 = percentile(durations, 50)   // linear interpolation, same helper as flaky/DORA
p90 = percentile(durations, 90)
avg = mean(durations)
median = p50 (alias for big-number title)
count = len(durations)
```

Helper reuse: existing `medianFloat` is extended with `Percentile(sorted []float64, p float64) float64` (0≤p≤100, linear between `sorted[floor(k)]` and `sorted[ceil(k)]` where `k = p/100*(n-1)`). Single element → all equal. Empty → 0. Do not duplicate — `metrics.go` gets one `percentile` function used by hero, DORA, flaky, and hybrid.

```go
type WorkflowHybrid struct {
    Repo         string  `json:"repo"`
    Workflow     string  `json:"workflow"`
    Key          string  `json:"key"` // repo/workflow
    Runs         int     `json:"runs"`
    P50Min       float64 `json:"p50Min"`
    P90Min       float64 `json:"p90Min"`
    AvgMin       float64 `json:"avgMin"`
    MinMin       float64 `json:"minMin,omitempty"`
    MaxMin       float64 `json:"maxMin,omitempty"`
    ThresholdP50 float64 `json:"thresholdP50"`
    ThresholdP90 float64 `json:"thresholdP90"`
    IsSlow       bool    `json:"isSlow"` // p50>ThresholdP50 || p90>ThresholdP90
    IsSampleSmall bool   `json:"isSampleSmall"` // runs < 10
}

func WorkflowHybridStats(runs []Run, repo string, since time.Time) []WorkflowHybrid
// ranked slow-first: IsSlow desc, then P90 desc, then P50 desc, then Runs desc, then key asc

func Percentile(sorted []float64, p float64) float64
func meanFloat(v []float64) float64
```

**Thresholds (one-line tuning, document as consts):**

```
p90 > 25m → red (High tail)           // primary — tail matters for CI queuing
p50 > 10m → red (Slow median)          // secondary — lane is slow overall
p50 > 8m  → amber (Watch) when p90 not red
n < 10    → dim value, tooltip "n<10 — interpret cautiously"
```

Big-number card shows `p50 8.2m · p90 21.4m (n=44 · avg 9.1m)` — p50 large, p90 smaller muted, avg in tooltip/mini. Red when `IsSlow`; amber when p50 in `[8,10]` and not slow. Generic across repos — same thresholds for `gaia` and external orgs; follow-up per-workflow tuning (`workflowThresholds map[string]float64`) is one-line if PM wants "test-python 12m, build 6m".

**Display order:** top strip sorted **slowest-first** (tail hunters see the offender immediately without clicking table sort). Limit top strip to `maxTiles = min(6, len(workflows))` + overflow "＋N more ↓" anchor to full table. Table default sort remains `flakeScore` or `p90` depending on whether flaky extension landed; hybrid table section adds sortable heads `p50`/`p90`/`avg` that reuse this rollup.

### 4.3 Github vs home pie (`metrics.go`)

**Definition:** aggregate over the same filtered `[]Run` (success+failure, by `repo`+`since`):

```
homeRuns    = count where RunnerGroup==home
githubRuns  = count where RunnerGroup==github
unknownRuns = count where RunnerGroup==unknown
totalRuns   = home+github+unknown

homeMinutes    = sum DurationSec/60 where home
githubMinutes  = sum DurationSec/60 where github
totalMinutes   = home+github+unknown
homePctRuns    = homeRuns/totalRuns*100
githubPctRuns  = githubRuns/totalRuns*100
homePctMinutes = homeMinutes/totalMinutes*100
```

```go
type RunnerSplit struct {
    HomeRuns      int     `json:"homeRuns"`
    GithubRuns    int     `json:"githubRuns"`
    UnknownRuns   int     `json:"unknownRuns"`
    TotalRuns     int     `json:"totalRuns"`
    HomeMinutes   int     `json:"homeMinutes"`
    GithubMinutes int     `json:"githubMinutes"`
    TotalMinutes  int     `json:"totalMinutes"`
    HomePctRuns   float64 `json:"homePctRuns"`
    HomePctMin    float64 `json:"homePctMinutes"`
}

func RunnerSplitOf(runs []Run, repo string, since time.Time) RunnerSplit
```

**Visualization:** one `PieChart` with two slices (home `var(--chart-2)` emerald, github `var(--chart-3)` slate/red). Data: `[{name:"home", value:HomeRuns}, {name:"github", value:GithubRuns}]` (unknown folded into github for pie simplicity but shown as footnote "unknown N" when >0). Center label `Home 68%`. Tooltip: `home 412 runs (2,340 min) · github 192 runs (1,820 min) — home 43% of minutes despite 68% of runs → home lanes are shorter`. Legend clickable to filter table? v1 pie is read-only.

When `totalRuns==0` → pie hidden, `EmptyState` "No runs in period for this filter."

### 4.4 Time-to-release — PR open→merge (`metrics.go`)

**Definition:** same as `CycleStats` in `vision-hero` but scoped to Insights' `repo`+`period` window (so it tracks with the pie). `releaseDays = MergedAt.Sub(CreatedAt).Hours()/24` per `MERGED` pull where `MergedAt ∈ (since, now]`. Negative clamped to `0` with one `slog.Warn` per request sample.

```
p50Release = percentile(days, 50)
p90Release = percentile(days, 90)
avgRelease = mean(days)
count      = len(days)
windowDays = days between since and now (for label)
```

```go
type ReleaseStats struct {
    P50        float64 `json:"p50"` // days
    P90        float64 `json:"p90"`
    Avg        float64 `json:"avg,omitempty"`
    Count      int     `json:"count"`
    WindowDays int     `json:"windowDays"`
}

func ReleaseStatsOf(pulls []Pull, repo string, since time.Time) ReleaseStats
```

Reuses same `Percentile`/`meanFloat`. Thresholds (reuse hero constants):

```
p50 <2d green, 2–5d amber, >5d red
p90 <7d green, 7–14d amber, >14d red
```

Displayed as a single tile alongside the per-workflow strip: `Release p50 1.8d · p90 5.2d (n=44 · 12w)` — large p50, muted p90, release count. Share tooltip with CI big numbers to answer "is slow release caused by slow CI or review queue?" No chart in v1; timeline correlation is a follow-up scatter `CI duration vs release lag`.

---

## 5. Data & API Contract

**Server builder** (add to `api.go`, additive — no breaking change):

```go
type HybridStats struct {
    Period       string           `json:"period"` // "3m"|"6m"|"12m"|"all"
    Gran         string           `json:"gran"`
    Repo         string           `json:"repo"`
    Split        RunnerSplit      `json:"split"`
    Workflows    []WorkflowHybrid `json:"workflows"`   // per-workflow p50/p90, slow-first
    Release      ReleaseStats     `json:"release"`     // PR time-to-merge p50/p90 for same window
    Thresholds   map[string]float64 `json:"thresholds"` // {"p50":10,"p90":25}
    RepoOptions  []RepoInfo       `json:"repoOptions"`
}

func computeHybrid(snap Data, repo, period string, gran Granularity) HybridStats
// internally:
//   since := periodToSince(period) // same helper as computeInsights
//   runs := filterRuns(snap.Runs, repo, since) with RunnerGroup inference
//   pulls := filterPulls(snap.Pulls, repo, since)
//   split := RunnerSplitOf(runs, repo, since)
//   workflows := WorkflowHybridStats(runs, repo, since)
//   release := ReleaseStatsOf(pulls, repo, since)
```

**Alternative minimal increment** (acceptable if reviewer prefers fewer routes): extend existing `apiInsights` with three additive fields instead of a new route:

```go
type apiInsights struct {
    Repo        string           `json:"repo"`
    Period      string           `json:"period"`
    Gran        string           `json:"gran"`
    RepoOptions []RepoInfo       `json:"repoOptions"`
    Ship        []ShipBucket     `json:"ship"`
    ShipPrev    []ShipBucket     `json:"shipPrev,omitempty"`
    CI          []CIBucket       `json:"ci"`
    CIStats     insightsStats    `json:"ciStats"`
    Workflows   []WorkflowStat   `json:"workflows"`
    Hybrid      *HybridStats     `json:"hybrid,omitempty"` // NEW — additive, old clients ignore
}
```

Spec accepts **either** shape; preference is **new `GET /api/hybrid`** to keep `/api/insights` payload small until the slice proves useful, with fallback to additive if reviewer wants one fewer round-trip. Document choice in PR description.

**HTTP:**

- `GET /api/hybrid?repo=&period=&gran=` (same query shape as `/api/insights`) — `period` defaults `6m`, `gran` defaults `month`, `repo=all|""` → all repos. `200 JSON`, `Cache-Control: no-store`, `Access-Control-Allow-Origin: *`.
- If additive path chosen: `GET /api/insights` gains `hybrid` field with same query.
- `GET /api/workflow-runs?workflow=&repo=&limit=` unchanged but now includes `runnerGroup` per run for drill-down.

**Frontend types mirror in `frontend/src/lib/api.ts`:**

```ts
export type RunnerGroup = 'home' | 'github' | 'unknown'

export interface RunnerSplit {
  homeRuns: number; githubRuns: number; unknownRuns: number; totalRuns: number
  homeMinutes: number; githubMinutes: number; totalMinutes: number
  homePctRuns: number; homePctMinutes: number
}

export interface WorkflowHybrid {
  repo: string; workflow: string; key: string
  runs: number
  p50Min: number; p90Min: number; avgMin: number
  minMin?: number; maxMin?: number
  thresholdP50: number; thresholdP90: number
  isSlow: boolean; isSampleSmall: boolean
}

export interface ReleaseStats {
  p50: number; p90: number; avg?: number; count: number; windowDays: number
}

export interface HybridData {
  period: string; gran: string; repo: string
  split: RunnerSplit
  workflows: WorkflowHybrid[] // slow-first
  release: ReleaseStats
  thresholds: { p50: number; p90: number }
  repoOptions: RepoInfo[]
  ship?: ShipBucket[]; ci?: CIBucket[] // when additive, reuse existing arrays
}

export interface WorkflowRun {
  id: number; repo: string; workflow: string; branch: string
  event: string; conclusion: string; status: string
  createdAt: string; updatedAt: string; runStartedAt: string
  durationSec: number; runnerGroup: RunnerGroup
}

export const getHybrid = (params:{repo?:string;period?:string;gran?:string}={}) =>
  fetch(`/api/hybrid${qs(params)}`).then(json<HybridData>)
```

`WorkflowRun` extension is additive (`runnerGroup` omitted on old captures → frontend treats as `unknown`).

No new storage; snapshot filtering is in-memory `O(R+P)` per request (R≈21k, P≈851 → <1ms). `RunnerGroup` stored only for new sync rows; old rows inferred at read.

---

## 6. File Ownership

| Function / Type | File | Why |
|---|---|---|
| `RunnerGroup`, `InferRunnerGroup`, `RunnerGroupOf`, `Run.RunnerGroup`, `fetchRunsPage` write of `RunnerGroup` | `github.go` | Extends ingestion domain; neighbours `fetchRepoRuns`, `apiRun`, `duration` calc. Keeps heuristic with source type. |
| `WorkflowHybrid`, `RunnerSplit`, `ReleaseStats`, `WorkflowHybridStats`, `RunnerSplitOf`, `ReleaseStatsOf`, `Percentile`, `meanFloat`, `medianFloat` extension | `metrics.go` | Pure `[]Run`/`[]Pull` → numbers, neighbours `WorkflowStats`, `CISeries`, `CycleStatsOf`, `Contributors`. Keeps `metrics.go` stdlib-only; no new deps. |
| `HybridStats`, `computeHybrid`, `handleAPIHybrid`, route `GET /api/hybrid` (or additive `apiInsights.Hybrid` + glue in `handleAPIInsights`), query parsers `period`/`gran`/`repo`, `periodToSince` helper reuse | `api.go` / `server.go` | HTTP wiring, same pattern as `computeInsights`/`handleAPIInsights`; reuses `repoOptionsWithPulls`, `queryInt`, `bucketKeyFloor`. |
| `RunnerGroup`, `RunnerSplit`, `WorkflowHybrid`, `ReleaseStats`, `HybridData`, `WorkflowRun.runnerGroup`, `getHybrid` types + fetch | `frontend/src/lib/api.ts` | Mirrors `HybridStats`/`WorkflowHybrid` contracts. Additive only. |
| Hybrid top strip (per-workflow big numbers, red if > threshold), github-vs-home pie (`PieChart`), release tile, threshold legend, empty states | `frontend/src/pages/insights.tsx` | Collocated with existing CI `CIStats` + `CISeries` + `WorkflowStats` table + `hide` prefs. Reuses `StatCard`, `Card`, `ChartContainer`, `ChartTooltip`, `Badge`, `EmptyState`, `SortableHead`, `fmtDuration`, `comma`, `compact`. |
| Helpers `shortWorkflowLabel`, `thresholdColor`, `fmtDays` | `frontend/src/lib/format.ts` (reuse) | Color helper drives red/amber logic; `fmtDays` formats release tile. |

Do not duplicate `medianFloat` — extend with `Percentile(sorted []float64, p float64) float64` and `meanFloat`. Do not duplicate `bucketKey`/`continuousKeys` — hybrid rollups are *not* bucketed in v1 (per-workflow aggregates); pie is window aggregate. `github.go` stays stdlib + existing HTTP helpers.

`metrics.go` stays stdlib-only (`sort`, `strings`, `time`, `math`); `insights.tsx` adds `Pie`/`PieChart`/`Cell` from `recharts` (already imported via `chart.tsx`) — no new npm deps.

---

## 7. Algorithm & Perf Notes

- **Single filtered slice per request:** `runs = filterRuns(snap.Runs, repo, since)` once (linear `O(R)` ≈21k) then fan out to `RunnerSplitOf` (one more linear pass) and `WorkflowHybridStats` (one `map[string][]float64` grouping + per-group sorts). Reuse the filtered header — no per-workflow `make([]Pull)` copy.
- **Per-workflow grouping:** `map[string][]float64` keyed by `repo/workflow` composite (consistent with `WorkflowStats`). Hint `make(map[string][]float64, distinctWorkflows)` where `distinctWorkflows ≤ ~30`. For each run, `append(durationsMap[key], float64(r.DurationSec)/60)`. Then for each group `sort.Float64s` in place and interpolate `p50/p90` via `Percentile`. Group sizes sum to `R` so total sort work is `Σ n_i log n_i ≤ R log max(n_i)` — trivial.
- **Percentile:** copy-free on already-sorted slice: `k = p/100*(n-1)`, `f=math.Floor(k), c=math.Ceil(k)`, linear `sorted[f]*(c-k)+sorted[c]*(k-f)`. Guard `n==0 → 0`, `n==1 → sorted[0]`.
- **Runner split:** one pass over `runs` counting `RunnerGroup` → `homeMinutes/githubMinutes` via `DurationSec/60`; no map needed.
- **Release stats:** one pass over filtered `Pull`s collecting `days := MergedAt.Sub(CreatedAt).Hours()/24` for `MERGED && MergedAt in (since,now]`; clamped negative→0; then `sort.Float64s` + `Percentile`. `n` typically 50–150 in `6m` window.
- **String helpers:** `InferRunnerGroup` lowercases once (`strings.ToLower`) and loops over `homeSubstrings` (≤10); hot path per `Run` → avoid regex.
- **Injection for testability:** helpers take `since time.Time` / `runs []Run` explicitly — no `time.Now()` inside `metrics.go` (follow `ShippingSeriesRange` pattern). `computeHybrid` captures `now:=time.Now().UTC()` once and derives `since`.
- **Caching:** snapshot still `state.json`; hybrid is in-memory filtered per request. Window filtering `O(R+P)` per request → <1ms at current scale. No new file I/O.
- **Zero-alloc niceties:** pre-size `durationsMap` values with `make([]float64,0,expectedGroupSize)` if first pass counts per-key; otherwise let `append` grow. Avoid `time.Parse` in hot loop — compare `time.Time` directly.

---

## 8. Visual Design (Primer + shadcn)

**Placement:** hybrid slice lives **above** the existing CI `Workflow runs` bars — same lane as the current `StatCard` 4-up but with workflow-specific big numbers. Twin timeline: "where did it run → how long did it take → when did it ship?"

```
┌──────────────────────────────────────────────────────────────────────┐
│ Hybrid CI lane  ( period=6m · gaia · week )                   [? tip]│
│                                                                       │
│  github vs home                                           Release     │
│  ┌──────────────────────┐  ┌─────────────────────────────────┐  ┌──────────────────┐ │
│  │  ●● Pie (60% home)   │  │ p50  8.2m · p90 21.4m  n=44  avg  │  │ p50 1.8d · p90 5.2d │ │
│  │  home 412 (68%)      │  │ test-python  9.2/24m  🔴 Slow    │  │ n=44 · 12w         │ │
│  │  github 192 (32%)    │  │ build        3.1/8m   ● Healthy │  │                     │ │
│  └──────────────────────┘  └─────────────────────────────────┘  └──────────────────┘ │
│                                                                       │
│  Per-workflow lane health — big numbers, red if > threshold           │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │ Workflow    P50     P90     Avg   Runs   Lane   Slow?   Last run │ │
│  │ test-python  9.2m   24.1m   10.2m  112   home 68%  🔴 p90>25m 2h ago│ │
│  │ build        3.1m    8.0m    4.0m   88   home 92%  ● ok      1d ago│ │
│  │ code-quality 6.0m   18.2m    7.1m   64   home 71%  amber     3h ago│ │
│  └──────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

Details:

- **Top strip (big numbers):** `grid gap-3` — left: **pie card** (`Card`), center: **per-workflow big-number cards** (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`), right: **release tile** (`Card`). Each big-number tile is `Card rounded-[6px]` with `CardContent p-4`:

  - **Value row:** `text-2xl font-semibold tabular-nums` — `p50` large, `· p90 xx` smaller muted, red when `isSlow` (`text-red-600 dark:text-red-400`), amber when watch, otherwise `text-foreground`. Threshold pill right: `🔴 p90>25m` / `amber p50>8m` / `● Healthy` (`Badge` colored).
  - **Sub row:** `text-[11px] text-muted-foreground` — `avg xm · n=44 · home 68%` + workflow name link to `https://github.com/{org}/{repo}/actions/workflows/{workflow}`.
  - **Footer hint:** thin bar `home%` fill (`var(--chart-2)`) when workflow has split data.

  Limit to 6 tiles; overflow collapsed behind `Show all (N)` toggle that scrolls to the full workflows table. Skeleton loading: same grid with `Skeleton h-6 w-16`.

- **Github vs home pie:** `ChartContainer` + `PieChart` (`recharts`):

  ```tsx
  <PieChart>
    <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={42} outerRadius={64} paddingAngle={2}>
      {pieData.map(e => <Cell key={e.name} fill={e.name==='home' ? 'var(--chart-2)' : 'var(--chart-3)'} />)}
    </Pie>
    <ChartTooltip content={<PieTip />} />
  </PieChart>
  ```

  Data: `[{name:"home", value: split.homeRuns}, {name:"github", value: split.githubRuns}]` (unknown footnote). Center label via absolute overlay `Home 68%` (runs) + sub `42% of minutes`. Tooltip shows both runs and minutes: `home 412 runs (2,340 min · 43% of CI time)`. Legend horizontal below.

  Pie `CardHeader` title `Runner split` + subtitle `412 home · 192 github (period)`. Unknown footnote `+3 unknown` when >0.

- **Release tile:** single `StatCard`-like `Card`:

  - Value `p50 1.8d` large + `· p90 5.2d` muted
  - Sub `n=44 merges · 12w window`
  - Risk pill same palette as hero cycle: `Healthy` emerald / `Watch` amber / `Slow` red driven by p90 release threshold (reuse hero constants).
  - Tooltip on hover: `Open → merge: median 1.8d, p90 5.2d, avg 2.1d · 44 PRs in 90d of 851 lifetime`.

- **Workflows table enhancement (below pie):** extend existing `Workflows` table with sortable heads `P50` / `P90` / `Avg` (default sort `p90 desc` so slowest tail surfaces). Each cell `fmtDuration(m)`, slow rows get `text-red-600` on `P90`. Lane column shows `home 68%` mini bar (same `--chart-2` fill). Click expands `Recent runs` drill-down now including `runnerGroup` badge (`home` emerald / `github` slate).

- **Threshold legend:** small footer `Thresholds: p50>10m red, p90>25m red · n<10 dimmed` with `Tooltip` explaining tuning.

**Responsive:** `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4` for strip; pie `h-56` on mobile, `h-64` on desktop; table horizontal scroll preserved (`overflow-x-auto`).

**A11y:** each tile `role="region" aria-label="test-python median 9.2m"`; pie has `role="img" aria-label="Runner split home 68 percent"` + sr-only table fallback; big numbers have `aria-label="9.2 minutes median"`; color never alone conveys meaning — slow text always includes "Slow" / "Watch".

**Tokens:** `var(--chart-1)` primary, `var(--chart-2)` home/success, `var(--chart-3)` github/failure, `var(--chart-5)` muted/unknown; Tailwind `text-muted-foreground` for secondary; red `text-red-600 dark:text-red-400`, amber `text-amber-600` matching `vision-hero`/`BusCard`.

---

## 9. Edge Cases & Validation

- `runs==0` or `period` with no runs → `split.totalRuns==0`, pie hidden → `EmptyState` "No workflow runs in period." Hybrid workflows `[]`, release tile shows `—` with "No merges in window." Big numbers hide.
- `n < 10` per workflow → tile dimmed `opacity-60`, `Badge variant="outline"` chip "n=3 — interpret cautiously", still computed but excluded from "Slow" red prominence (show amber note instead to avoid alert fatigue). Same guidance as `vision-flaky`.
- `DurationSec == 0` or negative → clamp to 0; exclude zero durations from `p90` unless workflow legitimately has sub-minute runs (still counts, but `p90==0` will correctly show fast). Warn if >10% of runs are zero-duration (sync anomaly).
- `RunnerGroup` unknown (`DurationSec==0` or empty workflow name) → counts toward `unknownRuns`/`unknownMinutes`, pie footnote "3 unknown (no duration)" and not counted toward home/github percentages; thresholds still apply to workflow p50/p90 (since unknown runs are still timed).
- Workflow with single run → p50==p90==value, `IsSlow` still evaluated; no division by zero.
- Snapshot empty (`pulls==nil && runs==nil`) → all tiles show `—`, `EmptyState` "Waiting for data — the first sync is in progress." (same as current `!data` guard). No chart rendering.
- Long window (`all`) with 5-year span → workflows bounded by distinct keys (~tens), not time; `ReleaseStats` O(P) still trivial at 851 pulls. 90d of history with 15k runs still <1ms.
- Repos with 1 workflow: ranking degenerates to single tile — still renders, pie shows `home vs github` for that one workflow.
- Dark mode: pie strokes and legend must remain visible — use `var(--chart-*)` tokens that adapt; test both themes.
- Back-compat: old `state.json` without `runnerGroup` → `RunnerGroupOf` inference covers; new field `omitempty` means old frontend that doesn't read it ignores it (no 500). New frontend on old data shows inferred split with footnote "inferred".

---

## 10. Tests (next phase writes)

Table-driven `*_test.go` alongside `metrics.go`/`github.go` (stdlib only, `since` injected, no network):

- `TestInferRunnerGroup` — table: `"test-python"` → home, `"Build"` → home, `"Code Quality"` → home, `"Deploy Web"` → github, `"release"` → github, `""` → unknown, `"random"` → github, `"lint"` → home, case-fold `"TEST"` → home.
- `TestRunnerGroupOf_PersistedVsInferred` — Run with `RunnerGroup=github` returns github even when workflow would infer home; empty stored field infers.
- `TestWorkflowHybridStats_Empty` — 0 runs → `[]`.
- `TestWorkflowHybridStats_Known` — 2 workflows: A durations `[2,4,6,8,10,12,30]` (7 runs) → p50 8, p90 ~24.4, avg ~10.3, isSlow true on p90>25? borderline; B `[2,3,3,4,4,5]` → p50 ~3.5 not slow; assert slow-first ordering and thresholds.
- `TestWorkflowHybridStats_Window` — 3 runs 10/40/100 days ago, `since=now-90d` → only 2 counted (40d and 10d), old excluded.
- `TestPercentile_Edge` — sorted `[1]`, p0=1 p50=1 p100=1; sorted `[1,2]`, p50 1.5, p0 1 p100 2.
- `TestRunnerSplitOf` — 10 runs: 6 home (5m each) + 4 github (20m each) → `homePctRuns 60`, `homePctMin 27.3`, totalRuns 10.
- `TestRunnerSplitOf_Unknown` — including 2 unknown runs → counts toward unknown, pie percents still over totalRuns.
- `TestReleaseStatsOf` — 10 pulls with known `CreatedAt→MergedAt` gaps `[1,2,3,4,5,6,7,8,9,20]d` → p50 5.5d, p90 10.9d (linear), avg ~6.5.
- `TestReleaseStatsOf_Window` — old pull outside `since` excluded.
- `TestReleaseStatsOf_Empty` — 0 pulls → count 0 p50 0 p90 0 tile shows "—".
- `TestComputeHybrid_Fields` — synthetic snap with pulls+runs, assert `Hybrid.Split.TotalRuns`, `Hybrid.Workflows[0].IsSlow`, `Hybrid.Release.Count`, JSON tags round-trip.
- `TestHybridThresholds_Tuning` — override consts `P50ThresholdMin=5` and verify `IsSlow` flips (proves one-line tuning).
- Frontend (later): `insights.tsx` sort-key toggles and empty-states — storybook snapshots not in scope for vision.

All funcs pure; `time.Now()` injected via explicit `since` param (follow `ShippingSeriesRange` pattern). Tests do not hit network or filesystem. Use `mustParseTime` factory like `metrics_test.go`, `run(workflow, durationSec, daysAgo)`.

---

## 11. Rollout

Phase V (this doc) → Phase I: `metrics.go` (`RunnerGroup` type, `InferRunnerGroup`, `Percentile`, `WorkflowHybrid`, `WorkflowHybridStats`, `RunnerSplitOf`, `ReleaseStatsOf`) + `github.go` (`Run.RunnerGroup` field + write path in `fetchRunsPage` + `RunnerGroupOf` read helper) + table-driven unit tests → Phase II: `api.go: HybridStats` + `computeHybrid` + handler `GET /api/hybrid` (or additive `apiInsights.Hybrid`) + `frontend/src/lib/api.ts` types → Phase III: `frontend/src/pages/insights.tsx` deliverables:

1. Hybrid top strip — `HybridStrip` component: pie card + per-workflow big-number cards (red if > threshold) + release tile, isolated above existing CI bars — ship first, immediate value.
2. Workflows table enhancement — add `P50`/`P90`/`Avg` sortable heads, lane `home%` bar, `runnerGroup` badge in expanded runs, reuse `SortableHead`, `ConclusionIcon`, `fmtDuration`.
3. Skeletons + empty guards (`hybrid.workflows.length==0` → `EmptyState`), verify `useApi(getHybrid)` loading, dark mode, a11y.
4. Polish: threshold legends, tooltips proving formula, docs footnote window disclosure, persist `hide` prefs still apply (hybrid table shares same `hide`).

No migration, no `state.json` schema break (additive `runnerGroup` `omitempty`), no `deploy.sh` change. Additive API (`hybrid` field or new route) — old frontend ignores new field, new frontend ignores missing `hybrid` (shows `EmptyState`).

Flag: no feature flag; hybrid replaces/extends CI lane section on deploy (one-line revert is restoring previous `insights.tsx` CI header if PM asks).

---

## 12. Open Questions (resolve in implementation review)

- **Heuristic exactness vs cost:** Spec fixes substring heuristic to avoid an extra `jobs` API fan-out (8× rate-limit). If reviewer wants exact `labels` fidelity, add `GET /repos/{org}/{repo}/actions/runs/{id}/jobs` fetch batched (page 100, workers 5) and prefer `labels` → exact `home` if `labels` contains `self-hosted`+`gaia-home`. One-line swap in `fetchRunsPage`: if jobs fetch enabled, prefer `jobLabelsToGroup` over `InferRunnerGroup`. Document tradeoff in PR.
- **Thresholds global vs per-workflow:** Spec fixes global `p50>10m, p90>25m`. Alternative per-workflow map `map[string]struct{p50,p90 int}` (e.g., `test-python 12/30`, `build 6/15`) — one-line change to `isSlow` to lookup map. Reviewer to confirm EM wants uniform SLO or lane-specific.
- **Pie by runs vs minutes:** Spec shows pie by `runs` with minutes in tooltip. Alternative primary by `minutes` (cost-weighted). One-line swap `value: split.homeMinutes`. Keep both in tooltip regardless.
- **Unknown slice rendering:** Spec folds `unknown` into footnote only. Alternative renders 3-slice pie (home/github/unknown muted gray). One-line `Pie` data extension — reviewer to pick if unknown >5% common.
- **Time-to-release window tied to CI period?** Spec ties release to same `since` as hybrid (so `period=3m` → CI + release both 3m). Alternative pins release to fixed `90d` like hero (recency-stable) regardless of CI period — one-line `since` derivation change. Document in tooltip.
- **Big-number count:** Spec caps top strip at 6 tiles slow-first. Alternative shows all workflows as big numbers (up to ~12). One-line `maxTiles` constant; reviewer to pick density vs glanceability.
- **Color thresholds linear vs SLO bands:** Spec binary red/amber/green. Alternative SLO bands (`p90 0–20 green, 20–30 amber, 30+ red` and `p50 0–8 green, 8–12 amber, 12+ red`) — same `thresholdColor(p50,p90)` helper, one-line `switch`.
- **Backfill strategy:** Spec does read-time inference for old rows (zero cost). Alternative writes backfill on load (`Save()` after inference) — one-line `if r.RunnerGroup=="" {r.RunnerGroup=InferRunnerGroup(r.Workflow)}` in `Load()`. Either accepted; read-time is less I/O.

---

*Vision author: Muse Spark (pi) — 2026-08-29 — for branch `main` base, files `github.go` + `metrics.go` + `frontend/src/pages/insights.tsx` (`api.go` + `frontend/src/lib/api.ts`).*
