# VISION — Entire Join: scatter checkpoints→PRs bubble, unified timeline brush, streak guard, token coach (v-entire)

> **Scope:** Join agent checkpoint analytics (`entire.io` activity/recap) with shipped PRs (`store.go:Data.Pulls`); unified temporal brushing across all timeline charts; streak-at-risk guard; token-efficiency coaching. No new sync, no new external API. Purely derived from `EntireClient Snapshot()` + `State Snapshot()` already in memory.
> **Files to touch (next phase):** `entire.go` (join types + StreakGuard/TokenCoach pure fns) → `metrics.go` (shared `percentileFloat` helper reuse, optional token bucket) → `api.go` + `server.go` (builders + route `GET /api/entire` extension or `GET /api/entire/join`) → `frontend/src/lib/api.ts` (types) → `frontend/src/pages/entire.tsx` (Scatter bubble + Brush + guard + coach cards).
> **Design language:** Primer tokens, Recharts (`ScatterChart` + `Bubble`, `BarChart` + `Brush`, `AreaChart`), shadcn `Card`/`Table`/`Badge`/`ChartContainer`, Tailwind v4. Mirrors `insights.tsx` brush/sync patterns and `overview.tsx` heatmap week handling.

---

## 1. Goal

Turn the current `/entire` page from "checkpoint dashboard" into a **conversion observability** surface — an EM or IC can in <5s answer:

1. **Do checkpoints convert to PRs?** — per-repo bubble scatter (x=checkpoints, y=merged PRs) shows which repos are productive vs busy.
2. **When did activity ship?** — unified timeline brush across daily/hourly/6-mo strips isolates any window and cross-filters the repo table + agent recap.
3. **Is my streak safe?** — guard card warns before UTC midnight break with exact hours left + what counts to save it.
4. **Am I burning tokens efficiently?** — coach card turns `tokens / checkpoint / file / session` + `toolMix` into tier + 1–3 actionable tips, not raw numbers.

Success = opening `/entire` with `?from=2026-07-01&to=2026-08-29` shows a brushed window where the bubble, daily bars, 6-mo area, and repo table all agree, guard says "Safe · 14h left", and coach says "Efficient · 1.2k tok/cp — try fewer mcp calls".

---

## 2. Non-Goals

- New GitHub or entire.io fetches, DB columns, or persisted aggregates. All computed on read from `Snapshot()` snapshots.
- Per-checkpoint drill-down (individual session transcript viewer) or per-file diff — repo/day granularity only.
- Forecasting streak or token burn (linear extrap is follow-up; guard/coach are read-only).
- Auto-creating PRs or mutating streak externally — coaching text only.
- Writing full frontend now beyond contract/types (vision specifies contracts; implementation phase does React).

---

## 3. Users & Stories

- **IC / Heavy pi user:** "I checkpointed 40 times on `gaia` but shipped 1 PR — am I spinning?"
- **Tech Lead:** "Show me which repo has high checkpoints but low PRs — that's where specs are fuzzy."
- **EM:** "Brush August — did that checkpoint spike ship the same week or lag?"
- **Streak user:** "I'm at 28d streak — will I lose it tonight? What exactly do I need to do?"
- **Cost-aware IC:** "My tokens/checkpoint doubled after switching to `opencode` — coach, what changed?"
- **On-call:** "Hourly heatmap brushed to 14h–18h — does that align with merged-PRs-per-hour?"

---

## 4. Metric Spec (per feature)

All metrics respect unified window `?from=&to=` (ISO `YYYY-MM-DD`, UTC inclusive-start, exclusive-end next-day, same `queryFromTo` pattern as `/api/leaderboards`) plus `repo` optional scope for table filtering. `gran` is `day` by default for the brush master; hourly bins remain `hour` (0–23) but respond to `from/to` by filtering `hourly_contributions.date`.

Data sources:
- Entire: `EntireData.activity.daily_contributions: {date, agents:Record<string,int>}`, `hourly_contributions: {date,hour,agent,value}`, `repos: {repo,total,agents}`, `recap.agents: Record<id, EntireAgent{me:{sessions,checkpoints,tokens,transcriptTokens,filesChanged,toolMix,mcpServers,...}}}` , `recap.daily: {date,count}`, `activity.stats:{tasks,orchestration,iteration,throughput,continuity_hours,streak,current_streak,lifetime_streak,lifetime_current_streak}`.
- PRs: `Data.Pulls[]` with `Repo,MergedAt,State==MERGED`, plus `RepoInfo` for display name normalization like `entire.go` vs `pr-insights`.

### 4.1 Scatter Checkpoints → PRs Bubble (entire.go + metrics.go)

**Definition:** Per-repo join and optional per-day scatter (two granularities sharing same primitive).

#### Per-repo bubble (primary)

One point per `repo` that appears in *either* side (union of `activity.repos[].repo` and PR repos with `Total>0`). For selected window:

```
windowCheckpoints[repo] = sum daily_contributions where date in [from,to) of sum(agents values) grouped by repo?
```

Repo-level `activity.repos` is *all-time* aggregate in payload (not bucketed by day × repo). So per-repo per-window cannot be read from `activity.repos` alone. We derive:

- **Ideal:** extend `entire.io` cell payload does not have daily×repo matrix. Workaround v1: use `activity.repos` *ratio* to apportion daily totals, or fetch `daily_contributions` which is total-per-day not per-repo. Since API lacks `daily×repo`, v1 spec intentionally uses **all-time repo checkpoints** for bubble x vs **window PRs** for y, with explicit label "Checkpoints (all-time ↑) vs PRs (window)". Future upgrade if API adds daily×repo is one-line swap.

Alternative v1-b that avoids mismatch: x = checkpoints in window = `sum over daily_contributions` apportioned? Could also define x as `repo.total` (all-time) but y as `merged PRs all-time` for honest ratio — which is stable. Spec chooses **all-time vs all-time** for repo bubble in v1, and **daily scatter** (see next) gives windowed temporal honesty. Both surfaced, labeled clearly.

So:

```go
type RepoJoinPoint struct {
  Repo            string         `json:"repo"`            // "org/repo" raw or short name
  Short           string         `json:"short"`           // basename after "/"
  Checkpoints     int            `json:"checkpoints"`     // from activity.repos[].total (all-time) or windowed if matrix available
  MergedPRs       int            `json:"mergedCount"`     // count Pulls where repo==Short && State==MERGED && in window (or all-time for parity)
  Tokens          int64          `json:"tokens"`          // sum tokens for repo's dominant agents? v1: 0 or proportional; if no per-repo token, use 0 and size by checkpoints
  DominantAgent   string         `json:"dominantAgent"`   // agent id with max n for that repo
  Agents          map[string]int `json:"agents"`          // copy for tooltip legend
  AddedLines      int            `json:"addedLines"`      // sum additions for tooltip efficiency
  BubbleSize      int            `json:"bubbleSize"`      // = Checkpoints or Tokens mapped to Z range
  CpPerPR         float64        `json:"cpPerPR"`         // Checkpoints / max(1,MergedPRs) — efficiency: lower is more PRs per checkpoint
  IsOutlierLowCut float64        `json:"-"`               // internal for styling
}
```

Computation:

```go
func EntireRepoJoin(activity *entireActivity, recap *entireRecap, pulls []Pull, windowFrom, windowTo time.Time) []RepoJoinPoint
// steps:
// 1. Build pullsByRepo: map[short(count filtered by window if window non-zero)] — use IsBot? spec says include all merges (human+bot), footnote that bots inflate PRs; filter bots optionally via ?includeBot later.
// 2. Union keys = set(activity.repos[].repo short) ∪ pullsByRepo keys
// 3. For each repo key, find activity row (nil→0), pull count (0 default), dominant = argmax Agents
// 4. Tokens: if recap.agents have per-repo token? No — recap summary not repo split. So v1 bubbleSize = Checkpoints. Future: if entire adds repo token, fill it.
// 5. Compute CpPerPR, sort by Checkpoints desc for legend stability.
// 6. Drop repos where Checkpoints==0 && MergedPRs==0 (noise)
```

Bubble mapping to chart:

- `XAxis type="number" dataKey="checkpoints" label="Checkpoints (all-time)" tickFormatter={compact}`
- `YAxis type="number" dataKey="mergedCount" label="Merged PRs (all-time or window)"`
- `ZAxis dataKey="bubbleSize" range={[60,400]}` (Recharts Scatter bubble radius)
- `Scatter` per point with `fill=agentColor(dominantAgent)` and stroke border. On hover tooltip shows `gaia — 412 cps · 88 PRs · 4.7 cp/PR · dominant Claude Code · +12k lines`.
- Quadrant guide: `ReferenceLine x=median(CP)` and `y=median(PRs)` splits into 4 quads (Efficient upper-left = many PRs few cps; Busy lower-right = many cps few PRs).

#### Per-day scatter (secondary, optional v1 stretch, in same chart toggle)

When brush window >14d, show toggle "Per-day | Per-repo". Per-day mode: one point per day where `x=daily checkpoint total`, `y=merged PRs that day` (from `Data.Pulls` bucketed by `MergedAt` day). Bubble size = tokens that day if `recap.daily` has count but not tokens — so use `transcriptTokens`? v1 uses fixed size. Reveals lag: spike in x often precedes y by 0–2 days. Lag annotation via `ReferenceLine` offset is follow-up (not v1).

Edge: daily y often 0 — render gap correctly via `allowDecimals=false` y domain and don't jitter; empty day scatter is dense at y=0 baseline — still informative (shows busyness without ship).

### 4.2 Unified Timeline Brush (api + entire.tsx)

**Definition:** Single temporal selection drives all timeline views + cross-filters.

State:

```ts
// entire.tsx state
type BrushRange = { from: string | null; to: string | null } // YYYY-MM-DD UTC, null = unbrushed (full extent)
// persisted in URL ?from=&to=, consistent with pulls/leaderboards/insights patterns already using useSearchParams
```

Sources:

- Master extent = min → max of `recap.daily[].date` union `activity.daily_contributions[].date`. Fallback `recap.since..until` if either missing.
- Master granularity = `day` (one point per date). 6-mo area and daily bars both consume daily series; hourly is aggregation over brushed dates.

Behaviour:

- Master `Brush` rendered on the **daily bar** card (the 6-mo `AreaChart` can optionally show a faint `Brush` that is synced via same handler — v1 only master to reduce clutter). Pattern mirrors `insights.tsx:handleShipBrushChange` and `contributor.tsx:handleBrushChange`:

```ts
const handleBrushChange = (range: any) => {
  if (!range) return
  const start = dailyRows[range.startIndex]?.rawDate // raw "YYYY-MM-DD"
  const end = dailyRows[range.endIndex]?.rawDate
  if (!start || !end) return
  setSearchParams(prev => { const n = new URLSearchParams(prev); n.set("from", start); n.set("to", exclusiveNextDay(end)); return n }, {replace:true})
}
```

- On brush change, derived selectors recomputed:

```ts
const filteredDaily = useMemo(() => dailyRows.filter(r => inRange(r.rawDate, from, to)), [dailyRows, from, to])
const filteredRecapDaily = useMemo(() => recapDailyRows.filter(r => inRange(r.rawDate, from, to)), ...)
const filteredHourly = useMemo(() => hourlyRowsForRange(filteredDates), [activity, from, to]) // recompute hourly aggregation only over brushed dates
const filteredRepos = useMemo(() => repoJoinPoints with prs filtered by window) // repo bubble y already windowed if using windowed PRs
```

- URL sync gives shareable link: `/entire?from=2026-08-01&to=2026-08-29` highlight text beneath chart "Filtering Aug 1 → Aug 29 · Clear".
- Reset button clears `from/to` params, brush snaps back (Brush `startIndex/endIndex` reset).
- All charts share `syncId="entireTimeline"` (Recharts prop) so tooltip crosshair and brush move together even when two timeline charts render.
- If `from/to` param outside master extent → clamp to extent, no error.

Visual:

- Brush height 24, `stroke="var(--chart-1)"`, `travellerWidth=10`, fill 8% opacity. Same tokens as `insights.tsx`+`contributor.tsx`.
- Cards under brush show subtitle `Brushed: 28 days · 312 cps · 22 PRs`.

### 4.3 Streak Guard (entire.go + entire.tsx)

**Definition:** Translates `activity.stats.(current_streak|lifetime_streak|lifetime_current_streak|streak|throughput) + daily_contributions` into a guard banner.

Computation (pure, stdlib):

```go
type StreakGuard struct {
  Current         int     `json:"currentStreak"`       // stats.current_streak
  Lifetime        int     `json:"lifetimeStreak"`      // stats.lifetime_streak
  LifetimeCurrent int     `json:"lifetimeCurrent"`     // stats.lifetime_current_streak
  StreakField     int     `json:"streak"`              // raw stats.streak (legacy)
  LastActiveDate  string  `json:"lastActiveDate"`      // YYYY-MM-DD UTC of last daily_contributions entry with total>0
  DaysSinceActive int     `json:"daysSinceActive"`     // (TodayUTC - LastActiveDate) in days
  HoursLeftUTC    float64 `json:"hoursLeftUtc"`        // hours until next UTC midnight (00:00Z) from now
  State           string  `json:"state"`               // "safe" | "at_risk" | "broken" | "unknown"
  Reason          string  `json:"reason"`              // human-readable one-liner
  NeedToday       bool    `json:"needToday"`           // true if today has 0 cps and streak>0
  ThroughputHint  string  `json:"throughputHint"`      // e.g. "1.2k tok/cp"
}

const StreakGuardHoursThreshold = 6 // <6h left → at_risk accent

func StreakGuardOf(stats entireStats, daily []entireDaily, now time.Time) StreakGuard
// now is injected (time.Now().UTC()) for testability, mirrors ShippingSeriesRange pattern
// algorithm:
// - lastActiveDate = max date where sum(agents)>0 else "".
// - daysSinceActive = floor((nowDate - lastActiveDate)/24h)
// - hoursLeft = (nextMidnightUTC - now).Hours()
// - if Current==0 → State="broken" if LastActiveDate non-empty else "unknown"
// - else if daysSinceActive==0 → State="safe" (already checkpointed today)
//   else if daysSinceActive>=1 → State="broken" (missed a day, streak should be 0 per upstream, but guard still shows broken)
//   else if daysSinceActive==0 and today hasn't been active yet??? daily_contributions last entry is yesterday — need to infer today via now date vs lastActiveDate.
//   Simplify: NeedToday = (lastActiveDate != todayYYYYMMDD)
//   if NeedToday && HoursLeft < 6 → at_risk, Reason="Streak at risk — 5.2h left, add 1 checkpoint today"
//   else if NeedToday → at_risk soft "Checkpoint needed today to keep 28d streak"
//   else safe.
```

Edge nuance: Entire.io streak definition is "activity day" (any checkpoint). Our guard must match that. If `activity.daily_contributions` is sparse (gap days omitted), missing date = 0. But payload already includes zero days? Check sample — daily_contributions includes every date in window with agents map (maybe zeros omitted). So we must normalize missing dates to 0 via continuousKeys-like gap fill between first and last.

Frontend card:

- Header `Streak Guard` with icon `Flame` (already imported) tinted by state: safe=emerald, at_risk=amber, broken=red/gray.
- Row: `Current 28d · Lifetime 84d` + right `Hours left 5.2h` when at_risk (countdown live via 1-min tick `setInterval` or static snapshot `timeAgo` style).
- Body: `State` pill (`Safe`/`At risk`/`Broken`) colored, message beneath: "Checked in today — streak safe" / "No checkpoint today — add one before 00:00 UTC to keep 28d" / "Streak broken 1d ago — start a new one today".
- Extra: progress `iteration` and `throughput` as footnote `1.4× iteration · 340 tok/cp avg`.
- Empty when `stats==null` → `EmptyState` "No streak data yet".

### 4.4 Token Coach (entire.go + metrics helpers + entire.tsx)

**Definition:** Turns per-agent token/tool data into efficiency tier + tips.

Per-agent and rollup stats:

```go
type TokenCoachAgent struct {
  AgentID            string  `json:"agentId"`
  AgentLabel         string  `json:"agentLabel"`
  TokensPerCP        float64 `json:"tokensPerCp"`        // tokens / checkpoints
  TokensPerFile      float64 `json:"tokensPerFile"`      // tokens / filesChanged
  TokensPerSession   float64 `json:"tokensPerSession"`   // tokens / sessions
  TranscriptRatio    float64 `json:"transcriptRatio"`    // transcriptTokens / tokens (could be >1 if transcript counts input+output vs output-only tokens)
  ToolMixShellPct    float64 `json:"shellPct"`
  ToolMixMCPPct      float64 `json:"mcpPct"`
  Tier               string  `json:"tier"`               // "efficient" | "moderate" | "heavy"
  Tips               []string `json:"tips"`              // 0–3
}

type TokenCoach struct {
  RollupTokensPerCP   float64           `json:"rollupTokensPerCp"`  // total tokens / total checkpoints across agents
  RollupTokensPerFile float64           `json:"rollupTokensPerFile"`
  RollupThroughput    float64           `json:"throughput"`         // stats.throughput*1000
  ByAgent             []TokenCoachAgent `json:"byAgent"`            // sorted heavy → light
  SummaryTip          string            `json:"summaryTip"`         // one sentence for header
  WastedEstTokens     int64             `json:"wastedEstTokens"`    // optional: transcriptTokens - tokens where >0, as "context overhead"
}

// thresholds (one-line tuning, documented)
const (
  TokenPerCP_Efficient = 1500
  TokenPerCP_Heavy     = 4000
  TranscriptRatioWarn  = 3.0  // transcript >3× tokens → context bloat
  ShellPctWarn         = 60   // >60% shell → maybe too many exec loops
  MCPPctWarn           = 40   // >40% mcp → verify server caching
)

func TokenCoachOf(agents map[string]entireAgent, stats entireStats) TokenCoach
```

Tip generation rules (pure, deterministic, 1–3 tips max per agent, priority order):

1. `tokensPerCP > 4000` → "Heavy per-checkpoint (~4.2k). Try smaller prompts or chunked edits — large code pastes inflate tokens."
2. `tokensPerCP < 800 && checkpoints>20` → "Very lean — efficient batching. Keep it."
3. `transcriptRatio > 3` → "Transcript 4.1× tokens — context window churn. Prune history / use ` /clear` more often."
4. `toolMixShellPct >60` → "Shell-heavy (68%). Batch file reads or use search before exec loops."
5. `toolMixMCPPct >40` → "MCP-heavy — check server caching and deduplicate tool calls."
6. fallback summary tip aggregator: if median per-agent >1500 → "Moderate — coach: keep checkpoints scoped to one task" else efficient message.

Tooltip/legend: "Tok/CP = tokens ÷ checkpoints" footnote.

Frontend:

- Card `Token Coach` with `Zap` icon (already imported) — header shows rollup `1.8k tok/cp · Efficient` tier badge color (efficient=emerald, moderate=amber, heavy=red).
- Top row `StatCard`-like mini grid: `Tokens/CP`, `Tokens/File`, `Tokens/Session`, `Transcript ratio`.
- Per-agent rows (table or stacked cards): agent dot + label, tokens, cp, tok/cp, tier pill, tip bullet list (max 2 lines, muted). Sorted heavy first so worst efficiency surfaces.
- Reuse existing per-agent cards but add coach tip line under tool-mix bar when `tier!="efficient"`: `Coach: Heavy — try smaller prompts` with `Badge variant="outline"` accent.
- Empty when `recap==null` or tokens 0 → card hidden, `EmptyState` "No token data yet".

---

## 5. Data & API Contract

**Option A — extend `GET /api/entire` (preferred, additive, no new route):**

Add to `EntireData` (frontend) / `entireSnapshot` (backend):

```go
type EntireDataExt struct {
  // existing fields unchanged
  FetchedAt *time.Time `json:"fetchedAt"`
  LastError string     `json:"lastError"`
  User      *entireUser `json:"user"`
  Activity  *entireActivity `json:"activity"`
  Recap     *entireRecap `json:"recap"`
  // NEW (all computed, optional so old cache loads)
  RepoJoin  []RepoJoinPoint `json:"repoJoin,omitempty"` // guarded: present when both activity & pulls available
  Guard     *StreakGuard    `json:"guard,omitempty"`
  Coach     *TokenCoach     `json:"coach,omitempty"`
  BrushMeta *BrushMeta      `json:"brushMeta,omitempty"` // extent for frontend brush init
}
type BrushMeta struct {
  MinDate string `json:"minDate"` // YYYY-MM-DD
  MaxDate string `json:"maxDate"`
  From    string `json:"from,omitempty"` // echoed from query
  To      string `json:"to,omitempty"`
}
```

Builder:

```go
func computeEntireJoin(snap Data, entSnap entireSnapshot, fromStr, toStr string) entireSnapshotExt
// - parse from/to via existing helpers (helpers.go: parseDate)
// - filter pulls by MergedAt in window for RepoJoin y (or AllTime if window empty)
// - call EntireRepoJoin, StreakGuardOf, TokenCoachOf
// - fill BrushMeta from recap.daily min/max
```

HTTP: `GET /api/entire?from=YYYY-MM-DD&to=YYYY-MM-DD&repo=` — query same shape as `GET /api/overview?gran=` / `GET /api/leaderboards?from=&to=`. `from/to` default empty = all-time join metrics. `200 JSON, no-store`. Existing clients ignore new fields.

**Option B — dedicated `GET /api/entire/join?...`**

Same payload minimal:

```go
type apiEntireJoin struct {
  From     string         `json:"from"`
  To       string         `json:"to"`
  Join     []RepoJoinPoint `json:"join"`
  Guard    StreakGuard    `json:"guard"`
  Coach    TokenCoach     `json:"coach"`
  Meta     BrushMeta      `json:"meta"`
}
```

Router `GET /api/entire/join` → calls same pure fns. Advantage: leaves `/api/entire` payload size flat (entire.json cache stays small). Spec accepts either; preference A for simplicity unless reviewer wants B to avoid recompute on cached snapshot.

Caching: Ent snapshot still file `entire.json`; join is in-memory filtered (no persistence). Window filtering is `O(N+M+D)` per request, N=merged PRs ~851, M=activity rows ~180, D=recap.daily ~180 => <1ms.

Frontend types mirror in `frontend/src/lib/api.ts`:

```ts
export interface RepoJoinPoint {
  repo: string; short: string;
  checkpoints: number; mergedCount: number;
  tokens: number; dominantAgent: string;
  agents: Record<string,number>;
  addedLines: number; bubbleSize: number;
  cpPerPR: number;
}
export interface StreakGuard {
  currentStreak: number; lifetimeStreak: number; lifetimeCurrent: number;
  streak: number;
  lastActiveDate: string; daysSinceActive: number;
  hoursLeftUtc: number; state: 'safe'|'at_risk'|'broken'|'unknown';
  reason: string; needToday: boolean; throughputHint: string;
}
export interface TokenCoachAgent {
  agentId: string; agentLabel: string;
  tokensPerCp: number; tokensPerFile: number; tokensPerSession: number;
  transcriptRatio: number; shellPct: number; mcpPct: number;
  tier: 'efficient'|'moderate'|'heavy'; tips: string[];
}
export interface TokenCoach {
  rollupTokensPerCp: number; rollupTokensPerFile: number;
  throughput: number; byAgent: TokenCoachAgent[];
  summaryTip: string; wastedEstTokens: number;
}
export type EntireData = {
  fetchedAt: string|null; lastError:string;
  user: EntireUser|null;
  activity: EntireActivity|null; recap: EntireRecap|null;
  // extended
  repoJoin?: RepoJoinPoint[]; guard?: StreakGuard; coach?: TokenCoach;
  brushMeta?: {minDate:string; maxDate:string; from?:string; to?:string};
}
export const getEntire = (params:{from?:string; to?:string; repo?:string}={}):Promise<EntireData> =>
  fetch(`/api/entire${qs(params)}`).then(json<EntireData>)
```

`getRepos` stays second fetch for full table's `merged` denominator cross-check but bubble uses PRs server-side; frontend can drop the `repos.data?.find` lookup once join lands (today's `merged` column does client-side join via `getRepos` — replace with join field).

No new storage; `entire.json` and `state.json` unchanged.

---

## 6. File Ownership

| Function / Type | File | Why |
|---|---|---|
| `RepoJoinPoint`, `EntireRepoJoin` (pure) | `entire.go` | Extends `entireActivity`/`entireSnapshot` domain; neighbours `fetch()`/`Snapshot()`. Keeps join logic with entire data. |
| `StreakGuard`, `StreakGuardOf`, `TokenCoach`, `TokenCoachOf`, thresholds consts | `entire.go` (or `metrics.go` if shared `percentile`) | Pure `stats+daily+agents → numbers`. `entire.go` keeps token/streak close to source types; allowed to stay stdlib-only (`sort`, `time`, `math`, `strings`). |
| `percentileFloat` / `median` reuse | `metrics.go` | If `TokenCoach` needs p50/p95 token dist, reuse existing `Percentile` helper from DORA spec instead of duplicating. |
| `computeEntireJoin`, `handleEntire`, route glue, query parsers `from/to` | `api.go` / `server.go` | Same pattern as `computeOverview`/`computeInsights`. Reuses `parseGran` helpers, `repoOptionsWithPulls`. |
| `RepoJoinPoint`, `StreakGuard`, `TokenCoach`, `getEntire(params)` types + fetch | `frontend/src/lib/api.ts` | Mirrors `EntireData`. Additive only. |
| Scatter bubble (`ScatterChart`), unified `Brush` + `syncId`, guard card, coach card, brushed filter, URL sync | `frontend/src/pages/entire.tsx` | Primary file per task; reuse `ChartContainer`, `StatCard`, `Badge`, `EmptyState`, `PageHeader`, `useApi` + `useSearchParams`. No new deps. |
| Helpers `shortDate`, `agentColor`, `timeAgo`, `comma`, `compact`, `fmtDuration` | `frontend/src/lib/format.ts` (reuse) | Guard hours left uses `fmtDuration` + live tick. |

Do not duplicate `medianFloat`/`percentile` — extend once in `metrics.go`. Do not duplicate `bucketKey`/`continuousKeys` — guard gap-fill reuses.

`entire.go` and `metrics.go` stay stdlib-only; `entire.tsx` adds no new deps beyond `recharts` primitives already imported (`Scatter`, `ZAxis`, `Brush`, `ReferenceLine`).

---

## 7. Algorithm & Perf Notes

- **Single filtered `[]Pull` per request:** filter merged pulls once by `repo`+`windowFrom/To`, share slice header to `EntireRepoJoin`, `TokenCoach` not needed (tokens from entire side), `RepoStats` if still used. One `make(map[string]int, distinctRepos)` for pull counts (≤ ~10 repos). O(P) where P=851.
- **Repo join:** union keys ≤ distinct pr-insights repos (current org `theexperiencecompany` has ~<20). For each repo, linear scan `activity.repos` (≤20) — trivial. Sorting final `[]RepoJoinPoint` by `Checkpoints` desc O(R log R), R small.
- **Brush filtering:** daily arrays small (~180). Filter is linear scan `for _,d:=range daily` + `inRange`. Hourly aggregation for brushed window rebuilds `map[hour]int` with 24 keys — negligible.
- **StreakGuard:** gap-fill: iterate sorted daily dates, detect gaps >1 day via `(next-date - cur-date)/24h`. Fill not needed for `lastActiveDate` but needed for daysSinceActive correctness if last entry is stale. Single sort of daily dates `sort.Strings` (already sorted by API, but defensive) O(D log D) ~180 log 180.
- **TokenCoach:** per-agent loop over `recap.agents` (≤13 agents). Each computes 3 divisions + toolMix percentages (6 adds/divides). Sort `byAgent` by `TokensPerCp` desc O(A log A), A≤13.
- **Zero alloc niceties:** pre-size maps (`make(map[string]int, len(activity.repos))`), reuse `[]float64` scratch for any percentile (pooled or stack). Avoid per-call `time.Parse` in hot loop — parse dates once per request into `time.Time` slice.
- **String keys:** keep `short = strings.Cut` on `repo` same as `entire.tsx: rep.repo.split('/').pop()` parity; server uses `path.Base` or `strings.LastIndex`.
- **Clock injector:** `StreakGuardOf(…, now time.Time)` and `computeEntireJoin` accepts `now` param for tests, same as `ShippingSeriesRange` pattern. Handlers pass `time.Now().UTC()`.
- **No mutation of snapshot backing arrays:** builders only read snapshots, produce new slices.

---

## 8. Visual Design (Primer + shadcn)

Layout extends current `entire.tsx` (which today is header → stats 6-col grid → 2-col daily/hourly bars → 6-mo area → repos Table → agent comparison Table → tool mix+MCP 2-col → per-agent recap grid). New order:

```
PageHeader (user badge + synced + Refresh)
[Guard + Coach] 2-col row                           ← NEW
Stats 6-col grid (existing throughput / streak / tasks …)
[Scatter bubble — checkpoints → PRs] Card           ← NEW  (full width)
Timeline row: daily bars + 6-mo area + Brush         (existing cards, now brushed + syncId)
Repos table (filtered to brush window, adds Cp/PR column) — enhanced
Agent comparison + Tool mix + MCP (existing)
Per-agent recap grid (adds coach tip line)
```

### 8.1 Scatter bubble (Card)

`Card` with `CardHeader` title `Ship conversion — checkpoints → merged PRs` + badge `n=12 repos` + toggle `All-time | Window`. Subtitle `All-time cps vs window PRs · bubble = cps · color = dominant agent` when toggle All-time, else `Windowed`.

Inside `ChartContainer` (h-72) → `ScatterChart`:

- `CartesianGrid strokeDasharray 3 3`
- `XAxis type="number" dataKey="checkpoints" name="Checkpoints" domain={["auto","auto"]} tickFormatter={compact}` labeled bottom
- `YAxis type="number" dataKey="mergedCount" name="PRs" allowDecimals=false` labeled left
- `ZAxis dataKey="bubbleSize" range={[60,420]}` — bubble radius, not shown axis
- `Tooltip cursor={{strokeDasharray:"3 3"}}` content custom `BubbleTip` rendering repo short, dominant agent chip, `Cp/PR` with 1 decimal, `Checkpoints`, `Merged PRs`, `+lines`, `Agents` badges truncated.
- `Scatter` data={points} shape={(props)=> <circle r={Math.sqrt(props.payload.bubbleSize)/k} fill={agentColor(payload.dominantAgent)} stroke="var(--border)" /> or use Recharts default bubble}
- `ReferenceLine` at `medianCheckpoints` vertical dashed muted, `medianPRs` horizontal dashed — quadrants labeled via `ReferenceArea` subtle `fillOpacity 0.04` for 2×2 quads (optional).
- Legend: reuse agent legend mapping `AGENT_COLORS` so bubble colors match daily bars.
- Interaction: click bubble → filters repos table to that repo (sets `?repo=short` searchParam that already drives `getRepos` filter and could filter pulls list). Hover dims others.

When points empty (no merged PRs in window) → `EmptyState` inside card "No PRs in selected window — bubble shows activity only."

### 8.2 Unified timeline brush

- Master Brush on daily `BarChart` card (`daily_contributions` stacked bars by agent). `Brush dataKey="rawDate" height=24 stroke="var(--chart-1)" travellerWidth=10` with `onChange=handleBrushChange`. Same handler syncs **6-mo AreaChart** by filtering its data array (not second Brush).
- Add `syncId="entireTimeline"` to both `BarChart` and `AreaChart` so Recharts syncs tooltip/brush domain internally (mirrors `insights.tsx` ship series sync pattern).
- Below timeline row, small meta bar: `Showing 2026-07-15 → 2026-08-29 · 45 days · 210 checkpoints · 18 PRs [Clear filter]` — [Clear] removes `from/to` query params, brush resets.
- `recapDailyRows` and `hourlyRows` recomputed via brush-filtered data; unchanged height but data array shrinks to brushed window → visual zoom.
- If brush range <7 days → bar width keeps readable; no dense tick overlap because `XAxis minTickGap=32` already.

### 8.3 Streak guard card

`Card` `role="region" aria-label="Streak guard"` :

- Header `CardTitle` with `Flame` icon tinted by `state` (safe emerald, at_risk amber, broken gray). Title `Streak Guard` + right pill `State` (`Safe` emerald secondary, `At risk` amber, `Broken` destructive outline).
- Body 3-col stats mini: `Current 28d` (large tabular), `Lifetime 84d`, `Hours left 5.2h` (only when `needToday`).
- Progress/detail line `Last active 2026-08-28 · 0 days ago · need 1 checkpoint today`.
- Message line in `text-xs text-muted-foreground`: dynamic `reason` e.g. "Checkpoint needed today before 00:00 UTC to keep 28d streak — any agent counts."
- When `at_risk`, add subtle `bg-amber-50 dark:bg-amber-950/20` border accent and live tick: `useEffect setInterval 60s` recomputes `hoursLeft` locally so countdown ticks without re-fetch.
- Accessibility: `aria-live="polite"` on message.

### 8.4 Token coach card

`Card` with `Zap` icon:

- Header `Token Coach` + right tier badge (`Efficient` green, `Moderate` amber, `Heavy` red) plus `rollup tok/cp` value.
- Grid 4 mini stats: `Tok/CP 1.8k`, `Tok/File 420`, `Tok/Session 5.4k`, `Transcript 2.1×`.
- Divider then per-agent list compact (max height with scroll if >6 agents):

```
[●] Claude Code  1.2k tok/cp  Efficient  "Lean — keep batching"
[●] pi           3.9k tok/cp  Heavy      "Heavy — smaller prompts; shell-heavy 62%"
```

Rows show colored dot per agent, label, 3 numbers, tier pill, tip line `text-[11px] text-muted-foreground truncate` (max 2 tips joined by ` · `). Table-like but div flex.

- Footer footnote `Wasted overhead ~12k tokens (transcript−tokens) · Throughput 340 tok/cp avg` + link `Docs: entire.io tokens`.
- When rollup `heavy` → header banner amber note `3 agents heavy — see rows above`.

Tokens: `var(--chart-1)` primary, `var(--chart-2)` efficient, `var(--chart-3)` heavy, `var(--chart-5)` muted; Tailwind `text-muted-foreground` secondary.

Accessibility: all charts have `<table class="sr-only">` fallback (like insights.tsx pattern), brush has `aria-label="Timeline brush"`, guard has sr-only state description. Empty states use `EmptyState` everywhere, never blank.

---

## 9. Edge Cases & Validation

- `activity==null || recap==null` (entire not logged in): bubble hidden, guard/coach cards show `EmptyState` "No Entire data — install entire CLI …" (reuse existing entire.tsx empty bloc); brush meta `minDate` empty → hide brush.
- No pulls in window: y=0 for all repos/days; bubble collapses to baseline. Header note "No merged PRs in window (Aug) — showing activity only. Bubble Y=0. Try All-time."
- Repo name mismatch: Entire `repo` strings may be `"controlplane"` vs PR `Repo=="gaia"` short — normalizing via `strings.ToLower` + `path.Base` + fallback contains check; if still mismatched, repo appears with one side zero and tooltip clarifies "No PRs for this repo" not error.
- All-time vs window semantics: card subtitle must always disclose denominator — "Checkpoints (all-time) vs PRs (window)" or both windowed when toggle is Window. Avoid lying with mismatched windows.
- Clock skew & streak: if `now` is before payload `daily_contributions` max date (future date?) clamp `daysSinceActive` to 0, warn `slog.Warn` once.
- Single-repo org: scatter has 1 dot — still renders bubble + median referenceLines degenerate to dot; tooltip still useful; not an error.
- `tokens==0` or `checkpoints==0` → `tokensPerCP =0` not NaN; tier `"unknown"` or hidden; tip "No token data for this agent".
- `from>to` (bad query): server returns 400? v1 silently swaps or clamps: if `from.After(to)` → swap, plus frontend also clamps to min/max extent before fetch.
- Longest streak vs current: guard picks `current_streak` for state, but shows `lifetime_streak` for context. If `lifetime_current_streak>0` variant differs, footnote "(current season 12d)".
- Brush outside extent: clamp indices to `[0, len-1]`, no out-of-bounds panic.
- Dark mode: bubble stroke must remain visible on dark background — use `stroke="var(--border)"` with fill opacity 0.85 already used in `entire.tsx` legend dots.

---

## 10. Tests (next phase writes)

Table-driven `*_test.go` alongside `entire.go` / `metrics.go` (stdlib only, no network/FS). Pure funcs, `now` injected.

- `TestEntireRepoJoin_AllTime` — synthetic `activity.repos: [{repo:"a/b", total:100},{repo:"a/c",total:10}]` + pulls: b has 5 merged, c has 1 merged, d (PR-only) has 2 merged but 0 cps → expect 3 points, d's `checkpoints=0`, `cpPerPR` 0/20/10, sorted desc (b first).
- `TestEntireRepoJoin_Windowed` — pulls with `MergedAt` on 3 dates, window 1 date → y counts only within window, verify all-time variant counts all.
- `TestEntireRepoJoin_Empty` — no activity, no pulls → `[]`.
- `TestStreakGuard_SafeToday` — stats `current_streak=5`, daily last= today, now 14:00 UTC → state safe, needToday false, hoursLeft ~10.
- `TestStreakGuard_AtRisk` — current 28, last=today-1 (yesterday), now 22:00 UTC (2h left) → at_risk, needToday true, reason contains "2.0h left".
- `TestStreakGuard_Broken` — current 0, last=yesterday → broken.
- `TestStreakGuard_Unknown` — stats nil or daily empty → unknown, empty lastActive.
- `TestTokenCoach_Tiers` — agents: a) 10000 tokens/5 cp=2000 → moderate; b) 50000/10=5000 heavy with shell 70% → tip contains "Shell-heavy"; verify wastedEstTokens = transcript-tokens.
- `TestTokenCoach_Empty` — empty agents → rollup 0, byAgent empty.
- `TestBrushMetaClamp` — computeEntireJoin with from/to outside min/max → meta correct, join not panic.
- `TestTokenCoach_TranscriptRatio` — transcript 9000 vs tokens 2000 → ratio 4.5 → tip "context window churn".
- Frontend (later): `entire.tsx` brush sync — storybook/visual snapshot not in vision scope, but unit for `handleBrushChange` URL mapping.

All funcs pure; `time.Now()` injected.

---

## 11. Rollout

Phase V (this doc) → Phase I: `entire.go` (`RepoJoinPoint`, `EntireRepoJoin`, `StreakGuardOf`, `TokenCoachOf`, const thresholds) + `metrics.go` percentile helper extension if needed + unit tests (`entire_test.go`) → Phase II: `api.go:computeEntireJoin` + `server.go:handleEntire` extension (query `from/to/repo` passthru, `BrushMeta` fill) + wire `getEntire` param shape → Phase III: `frontend/src/lib/api.ts` types + `frontend/src/pages/entire.tsx` deliverables in order:

1. Guard + Coach cards (isolated, no brush dep) — ship first, visible value immediate.
2. Unified timeline brush (URL sync + filtered selectors for daily/hourly/recap area).
3. Scatter bubble (`ScatterChart` + `BubbleTip`) + repo table `Cp/PR` column, click→filter.
4. Polish: `syncId`, quadrant guides, `EmptyState` polish, live guard tick.

No migration: `state.json` + `entire.json` files unchanged (join is in-memory). No `deploy.sh` change (Entire login flow unchanged). Feature is progressive — when `from/to` absent, page behaves exactly as today (back-compat).

Flag: `?brush=0` not needed — empty table simply shows all data; guard/coach always visible.

---

## 12. Open Questions (resolve in implementation review)

- **Repo bubble denominator:** All-time vs windowed — spec fixes v1 to All-time vs All-time (honest ratio) + daily scatter gives windowed truth. If reviewer wants repo bubble windowed by partitioning daily totals via repo share ratio, implement apportionment (`windowCheckpoints[repo] = dailyTotal[day] * (repo.total / sumRepose)`) — one-line toggle, document rounding.
- **Per-repo tokens:** `entire.io` recap not repo-scoped. Should bubble `Z` size by `checkpoints` or by estimated `tokens` (`repoShare * totalTokens`)? Spec sizes by cps to avoid misleading estimate; add `sizeBy="tokens"` toggle follow-up if server adds per-repo token field.
- **Brush granularity:** Master `day` vs allow `hour` brush for hourly chart zoom? Spec brushes day only (hourly auto-aggregates). Hour zoom is follow-up with second Brush if PM wants "14h–18h" isolated.
- **Streak timezone:** Entire defines streak in UTC (payload shows `timezone=UTC`). Guard uses UTC midnight. If user `homeJurisdiction` indicates different tz, should guard shift? Spec keeps UTC to match upstream, footnote "(UTC)".
- **Token throughput vs `stats.throughput*1000`:** Keep raw `throughput` as `avg tokens/checkpoint` already — coach shows both raw throughput and computed `tokensPerCP` for cross-check; note discrepancy >10% in tooltip as "(stats: 340 vs computed 360)".
- **Include bot PRs in join?** Spec includes all merges for conversion honesty; add toggle `?includeBot=0` follow-up if EM wants human-only conversion.
- **Separate `/api/entire/join` vs extend `/api/entire`:** Spec prefers extend to keep one fetch; either accepted — reviewer to confirm payload size tolerance (join adds ~1KB). If reviewer prefers dedicated route to keep cache file untouched, implement `apiEntireJoin`.

---

*Vision author: Muse Spark (pi) — 2026-08-29 — for branch `main` base, file `frontend/src/pages/entire.tsx` + friends `entire.go`/`api.go`/`server.go`/`frontend/src/lib/api.ts`.*
