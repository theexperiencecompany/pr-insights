import { Loader2, TrendingDown, TrendingUp } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Brush,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ReferenceLine,
  XAxis,
  YAxis,
} from 'recharts'

import { ContributorBar } from '@/components/contributor-bar'
import { EmptyState } from '@/components/empty-state'
import { Heatmap } from '@/components/heatmap'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  type ChartConfig,
} from '@/components/ui/chart'
import { TipShell, TipRow, getPayloadColor, ToggleLegend } from '@/components/chart-tips'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { avatarUrl, getOverview, type OverviewData } from '@/lib/api'
import { comma, compact } from '@/lib/format'
import { useApi } from '@/lib/use-api'
import { cn } from '@/lib/utils'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

const mergedChartConfig = {
  merged: { label: 'Merged', color: 'var(--chart-1)' },
} satisfies ChartConfig

const linesChartConfig = {
  additions: { label: 'Added', color: 'var(--chart-2)' },
  deletions: { label: 'Deleted', color: 'var(--chart-3)' },
} satisfies ChartConfig

const weekdayChartConfig = {
  weekday: { label: 'Merged', color: 'var(--chart-1)' },
} satisfies ChartConfig

const hourChartConfig = {
  hour: { label: 'Merged', color: 'var(--chart-1)' },
} satisfies ChartConfig

// Semantic PR types — Primer open palette, colorblind-safe distinct hues
// Light: Primer open; Dark: lighter variants via CSS var --semantic-* for contrast on #0d1117
// - feat #0969da blue, fix #cf222e red, chore #8250df purple, docs #0a3069 navy
// - style #1a7f37 green, refactor #bf8700 yellow, perf #9a6700 orange, test #0550ae dark blue
// - build #6639ba purple-dark (distinct from chore), ci #6e7781 gray, revert #82071e red-dark (distinct from fix), other #656d76 muted
// Deuteranopia safe: red (#cf222e) not adjacent to green (#1a7f37) in stack — separated by purple/navy;
// green (#1a7f37) not adjacent to yellow (#bf8700) — ci gray buffers in stack order; palette uses luminance + hue distance.
// Heatmap collision avoided: heatmap greens are #9be9a8/#40c463/#30a14e — semantic greens are darker #1a7f37 / #3fb950 dark.
// Contrast >3:1 vs white and vs #0d1117 via dark variants defined in index.css.
const SEM_TYPES = ["feat","fix","chore","docs","style","refactor","perf","test","build","ci","revert","other"] as const
const SEM_COLORS: Record<string, string> = {
  feat: "var(--semantic-feat)",
  fix: "var(--semantic-fix)",
  chore: "var(--semantic-chore)",
  docs: "var(--semantic-docs)",
  style: "var(--semantic-style)",
  refactor: "var(--semantic-refactor)",
  perf: "var(--semantic-perf)",
  test: "var(--semantic-test)",
  build: "var(--semantic-build)",
  ci: "var(--semantic-ci)",
  revert: "var(--semantic-revert)",
  other: "var(--semantic-other)",
}
const semanticPieConfig = SEM_TYPES.reduce((acc, t) => {
  acc[t as string] = { label: t, color: SEM_COLORS[t] ?? "var(--semantic-feat)" }
  return acc
}, {} as ChartConfig)
const semanticAreaConfig = { ...semanticPieConfig } satisfies ChartConfig
// Stack order for Area (deuteranopia safe): separates red↔green and green↔yellow with neutral buffers
const SEM_STACK_ORDER = ["feat","fix","chore","docs","perf","test","style","ci","refactor","build","revert","other"] as const

// --- Unified tooltip helpers (use TipShell+TipRow, color dot via p.color/p.stroke, dashed where needed) ---
function MergedTip({ active, payload, label }: Partial<import('recharts').TooltipContentProps<number, string>>) {
  if (!active || !payload?.length) return null
  const entry = payload[0]
  if (entry?.value == null) return null
  const col = getPayloadColor(entry) ?? "var(--chart-1)"
  return (
    <TipShell label={label}>
      <TipRow color={col} label="Merged" value={`${comma(Number(entry.value))} PRs`} />
    </TipShell>
  )
}
function LinesStackedTip({ active, payload, label, hidden }: Partial<import('recharts').TooltipContentProps<number, string>> & { hidden?: Record<string, boolean> }) {
  if (!active || !payload?.length) return null
  const rows = payload.filter((e) => !hidden?.[String(e.dataKey)])
  if (!rows.length) return null
  const total = rows.reduce((s, e) => s + Number(e.value ?? 0), 0)
  const nameMap: Record<string, string> = { additions: "Added", deletions: "Deleted" }
  const fmtMap: Record<string, (v:number)=>string> = {
    additions: (v) => `+${comma(Math.round(v))}`,
    deletions: (v) => `−${comma(Math.round(v))}`,
  }
  return (
    <TipShell label={label}>
      {rows.map((entry) => {
        const key = String(entry.dataKey)
        const col = getPayloadColor(entry)
        const fmt = fmtMap[key] ?? ((v:number)=>comma(Math.round(v)))
        return <TipRow key={key} color={col} label={nameMap[key] ?? String(entry.name ?? key)} value={fmt(Number(entry.value ?? 0))} />
      })}
      <div className="flex items-center justify-between gap-4 border-t border-border/50 pt-1.5">
        <span className="text-muted-foreground">Total</span>
        <span className="font-mono font-medium tabular-nums">{comma(Math.round(total))} lines</span>
      </div>
    </TipShell>
  )
}
function WeekdayTip({ active, payload, label }: Partial<import('recharts').TooltipContentProps<number, string>>) {
  if (!active || !payload?.length) return null
  const entry = payload[0]
  if (entry?.value == null) return null
  return (
    <TipShell label={label}>
      <TipRow color={getPayloadColor(entry) ?? "var(--chart-1)"} label="Merged" value={`${comma(Number(entry.value))} PRs`} />
    </TipShell>
  )
}
function HourTip({ active, payload, label }: Partial<import('recharts').TooltipContentProps<number, string>>) {
  if (!active || !payload?.length) return null
  const entry = payload[0]
  if (entry?.value == null) return null
  return (
    <TipShell label={label}>
      <TipRow color={getPayloadColor(entry) ?? "var(--chart-1)"} label="Merged" value={`${comma(Number(entry.value))} PRs`} />
    </TipShell>
  )
}
function SemanticPieTip({ active, payload }: Partial<import('recharts').TooltipContentProps<number, string>>) {
  if (!active || !payload?.length) return null
  const entry = payload[0]
  if (!entry?.value) return null
  const col = getPayloadColor(entry) ?? (entry.payload as any)?.fill ?? "var(--chart-1)"
  // entry.name is type, entry.value is count, payload has percent via entry.payload?.payload?.percent? Pie payload: entry.payload holds original datum with name/value/percent
  const datum = (entry.payload as any) ?? {}
  const percent = typeof datum.percent === "number" ? ` · ${datum.percent.toFixed(1)}%` : (typeof (entry.payload as any)?.payload?.percent === "number" ? ` · ${(entry.payload as any).payload.percent.toFixed(1)}%` : "")
  // Try to read percent from original pieData: entry.payload may be {name, value, percent}
  const pct = datum.percent != null ? datum.percent : ((entry as any).payload?.percent ?? null)
  const pctText = typeof pct === "number" ? ` · ${pct.toFixed(1)}%` : percent
  return (
    <TipShell>
      <TipRow color={col as string} label={String(entry.name ?? datum.name ?? "Type")} value={`${comma(Number(entry.value))} PRs${pctText}`} />
    </TipShell>
  )
}
function SemanticAreaTip({ active, payload, label }: Partial<import('recharts').TooltipContentProps<number, string>>) {
  if (!active || !payload?.length) return null
  const row = payload[0]?.payload as Record<string, number> | undefined
  const t = row?.total as number ?? 0
  return (
    <TipShell label={`${String(label)} · ${comma(t)} PRs`}>
      {payload
        .filter((e) => e.value != null && Number(e.value) > 0)
        .sort((a,b)=>Number(b.value)-Number(a.value))
        .map((entry) => {
          const k = String(entry.dataKey)
          const col = getPayloadColor(entry) ?? (SEM_COLORS[k] ?? "var(--semantic-feat)")
          const v = Number(entry.value ?? 0)
          const pct = t > 0 ? (v / t) * 100 : 0
          return <TipRow key={k} color={col as string} label={k} value={`${comma(v)} · ${pct.toFixed(0)}%`} />
        })}
      <div className="pt-1 text-[11px] text-muted-foreground">100% stacked — share of PR types per bucket</div>
    </TipShell>
  )
}


function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="text-sm font-semibold">{children}</div>
}

// VISION v-hero — see docs/vision-hero.md
// Replaces StatStrip 8-cell lifetime strip with 4-tile windowed hero (90d cycle/throughput/bus, 30d CI).
function HeroTiles({ data }: { data: OverviewData }) {
  const hero = (data as any).hero as OverviewData['hero'] | undefined
  const stats = (data as any).stats as OverviewData['stats'] | undefined
  if (!hero) {
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="rounded-[6px]">
            <CardContent className="p-3">
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">—</div>
              <div className="mt-1 text-xl font-semibold tabular-nums">—</div>
              <div className="text-[11px] text-muted-foreground">No data</div>
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }
  const cycle = hero.cycle
  const ci = hero.ci
  const thr = hero.throughput
  const bus = hero.bus as any
  const cycleRisk = cycle.count === 0 ? 'empty' : cycle.count < 10 ? 'small' : cycle.p90 > 14 ? 'red' : cycle.p90 > 7 ? 'amber' : 'green'
  const ciRisk = ci.total === 0 ? 'empty' : ci.total < 20 ? 'small' : ci.rate >= 90 ? 'green' : ci.rate >= 80 ? 'amber' : 'red'
  const busRisk = bus.top3Share >= 70 ? 'High concentration' : bus.top3Share >= 50 ? 'Moderate' : 'Healthy'
  const busColor = bus.top3Share >= 70 ? 'text-red-600 dark:text-red-400' : bus.top3Share >= 50 ? 'text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400'
  const cycleColor = cycleRisk === 'red' ? 'text-red-600 dark:text-red-400' : cycleRisk === 'amber' ? 'text-amber-600 dark:text-amber-400' : 'text-foreground'
  const ciColor = ciRisk === 'red' ? 'text-red-600 dark:text-red-400' : ciRisk === 'amber' ? 'text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400'
  // Cycle Δ vs trailing 90d
  const cycleDeltaPct = (cycle as any).deltaPct as number | undefined
  const cyclePrevCount = (cycle as any).prevCount as number | undefined
  const cyclePrevP50 = (cycle as any).prevP50 as number | undefined
  const hasCycleDelta = cyclePrevCount != null && cyclePrevCount > 0 && cycleDeltaPct != null && cycle.count > 0
  const cycleDeltaLabel = hasCycleDelta ? `${cycleDeltaPct! >= 0 ? '+' : ''}${cycleDeltaPct!.toFixed(0)}% vs trailing 90d` : null
  const cycleDeltaColor = hasCycleDelta ? (cycleDeltaPct! > 0 ? 'text-red-600 dark:text-red-400' : cycleDeltaPct! < 0 ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground') : 'text-muted-foreground'
  // CI median duration
  const ciMedianMin = (ci as any).medianDurationMin as number | undefined
  // Throughput vs 3-mo median
  const thrMedian = (thr as any).median3Mo as number | undefined
  const thrMedianPerWeek = (thr as any).medianPerWeek as number | undefined
  const thrDeltaVsMedian = (thr as any).deltaVsMedianPct as number | undefined
  const hasThrMedian = thrMedian != null && thrMedian > 0
  const thrVsMedianLabel = hasThrMedian && thr.merged > 0 ? `${thrDeltaVsMedian! >= 0 ? '+' : ''}${thrDeltaVsMedian!.toFixed(0)}% vs 3-mo median` : null
  const thrVsMedianColor = hasThrMedian && thrDeltaVsMedian != null ? (thrDeltaVsMedian! > 0 ? 'text-green-600 dark:text-green-400' : thrDeltaVsMedian! < 0 ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground') : 'text-muted-foreground'
  const thrDeltaLabel = thr.prevMerged === 0 && thr.merged > 0 ? 'New' : thr.prevMerged === 0 && thr.merged === 0 ? '—' : `${thr.deltaPct >= 0 ? '+' : ''}${thr.deltaPct.toFixed(0)}%`
  // Bus per-repo max + trend
  const busPerRepoMax = (bus as any).perRepoMax as number | undefined
  const busPerRepoMaxRepo = (bus as any).perRepoMaxRepo as string | undefined
  const busTrendPct = (bus as any).trendPct as number | undefined
  const busPrevShare = (bus as any).prevTop3Share as number | undefined
  const hasBusTrend = busTrendPct != null && busPrevShare != null && busPrevShare > 0
  const busTrendLabel = hasBusTrend ? `${busTrendPct! >= 0 ? '+' : ''}${busTrendPct!.toFixed(0)}pp vs trailing 90d` : null
  const busTrendColor = hasBusTrend ? (busTrendPct! > 5 ? 'text-red-600 dark:text-red-400' : busTrendPct! < -5 ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground') : 'text-muted-foreground'

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {/* Cycle tile — p50/p90 + n + Δ vs trailing 90d */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Card className="rounded-[6px] cursor-default" role="region" aria-label="Median cycle">
              <CardContent className="flex flex-col gap-1 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Cycle</span>
                  {cycle.count === 0 ? <Badge variant="outline" className="px-1.5 py-0 text-[10px]">no data</Badge> : cycle.count < 10 ? <Badge variant="outline" className="px-1.5 py-0 text-[10px]">n={cycle.count} small</Badge> : cycleRisk === 'red' ? <Badge variant="destructive" className="px-1.5 py-0 text-[10px]">p90&gt;14d</Badge> : cycleRisk === 'amber' ? <Badge variant="secondary" className="px-1.5 py-0 text-[10px] bg-amber-100 text-amber-700 dark:bg-amber-900/40">Watch</Badge> : <Badge variant="secondary" className="px-1.5 py-0 text-[10px] bg-green-100 text-green-700 dark:bg-green-900/40">Healthy</Badge>}
                </div>
                <div className="flex items-baseline gap-1">
                  <span className={"text-xl font-semibold tabular-nums " + (cycle.count===0 ? 'text-muted-foreground' : cycleColor)}>{cycle.count===0 ? '—' : `${cycle.p50.toFixed(1)}d`}</span>
                  {cycle.count>0 ? <span className="text-xs text-muted-foreground">· p90 {cycle.p90.toFixed(1)}d</span> : null}
                </div>
                <div className="text-[11px] text-muted-foreground">{cycle.count===0 ? 'No merges in 90d' : `median · n=${cycle.count} · 90d`} {hero.windowNote ? <span className="rounded bg-muted px-1 py-0.5 text-[10px]">{hero.windowNote}</span> : null}</div>
                {hasCycleDelta ? (
                  <div className={"flex items-center gap-1 text-[11px] font-medium tabular-nums " + cycleDeltaColor}>
                    {cycleDeltaPct! > 0 ? <TrendingUp className="size-3" /> : cycleDeltaPct! < 0 ? <TrendingDown className="size-3" /> : null}
                    {cycleDeltaLabel} {cyclePrevP50 != null ? <span className="text-[10px] text-muted-foreground">· prev p50 {cyclePrevP50.toFixed(1)}d</span> : null}
                  </div>
                ) : cycle.count>0 && cycle.count < 10 ? (
                  <div className="text-[11px] text-muted-foreground">n small — Δ vs trailing 90d unavailable</div>
                ) : cycle.count>0 ? (
                  <div className="text-[11px] text-muted-foreground">Δ vs trailing 90d — no prior data</div>
                ) : null}
                {cycle.count>0 ? <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted"><div className="h-full bg-[var(--chart-1)]" style={{ width: `${Math.min(100, (cycle.p50/7)*100)}%` }} /></div> : null}
              </CardContent>
            </Card>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-[360px] text-xs leading-relaxed">
            <div className="font-medium">Cycle p50 {cycle.p50.toFixed(1)}d · p90 {cycle.p90.toFixed(1)}d (n={cycle.count})</div>
            <div>Median &amp; p90 days from CreatedAt → MergedAt in last 90d. Clamp negative to 0.</div>
            {hasCycleDelta ? <div>Δ vs trailing 90d: {cycleDeltaLabel} · trailing p50 {cyclePrevP50?.toFixed(1)}d (n={cyclePrevCount})</div> : <div>Δ vs trailing 90d: no prior window data</div>}
            <div className="text-[11px] opacity-70">Thresholds: p50 &lt;2d green, 2–4d amber, &gt;4d red · p90 &lt;7d green, 7–14d amber, &gt;14d red</div>
          </TooltipContent>
        </Tooltip>
        {/* CI tile — success% 30d + median duration */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Card className="rounded-[6px] cursor-default" role="region" aria-label="CI success">
              <CardContent className="flex flex-col gap-1 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">CI success</span>
                  {ci.total===0 ? <Badge variant="outline" className="px-1.5 py-0 text-[10px]">no runs</Badge> : ci.total<20 ? <Badge variant="outline" className="px-1.5 py-0 text-[10px]">n&lt;20</Badge> : ci.rate>=90 ? <Badge variant="secondary" className="px-1.5 py-0 text-[10px] bg-green-100 text-green-700 dark:bg-green-900/40">Healthy</Badge> : ci.rate>=80 ? <Badge variant="secondary" className="px-1.5 py-0 text-[10px] bg-amber-100 text-amber-700">Watch</Badge> : <Badge variant="destructive" className="px-1.5 py-0 text-[10px]">Needs attention</Badge>}
                </div>
                <div className={"text-xl font-semibold tabular-nums " + (ci.total===0 ? 'text-muted-foreground' : ciColor)}>{ci.total===0 ? '—' : `${ci.rate.toFixed(0)}%`}</div>
                <div className="text-[11px] text-muted-foreground">{ci.total===0 ? 'No CI runs in 30d' : `${ci.success} success · ${ci.failure} fail · 30d`}</div>
                {ciMedianMin != null && ci.total>0 ? <div className="text-[11px] text-muted-foreground">median duration {ciMedianMin.toFixed(1)}m</div> : ci.total>0 ? <div className="text-[11px] text-muted-foreground">median duration —</div> : null}
                {ci.total>0 ? <div className="mt-1 flex h-1 overflow-hidden rounded-full bg-muted"><div className="bg-[var(--chart-2)]" style={{ width: `${ci.rate}%` }} /><div className="bg-[var(--chart-5)]" style={{ width: `${100-ci.rate}%` }} /></div> : null}
              </CardContent>
            </Card>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-[320px] text-xs leading-relaxed">
            <div>Success / (success+failure) ×100 in last 30d. Excludes cancelled/skipped.</div>
            {ciMedianMin != null ? <div>Median duration {ciMedianMin.toFixed(1)} min across {ci.total} runs</div> : null}
          </TooltipContent>
        </Tooltip>
        {/* Throughput tile — 28d vs 3-mo median */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Card className="rounded-[6px] cursor-default" role="region" aria-label="Throughput">
              <CardContent className="flex flex-col gap-1 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Throughput</span>
                  <span className={"flex items-center gap-1 text-xs font-semibold tabular-nums " + (hasThrMedian ? thrVsMedianColor : thrDeltaLabel.includes('New') ? 'text-blue-600' : '')}>{thr.merged===0 ? '—' : hasThrMedian ? (<><span className={thrVsMedianColor}>{thrVsMedianLabel}</span></>) : thrDeltaLabel.includes('New') ? <Badge variant="secondary" className="bg-blue-100 text-blue-700 dark:bg-blue-900/40 px-1.5 py-0 text-[10px]">New</Badge> : <>{thr.deltaPct>0 ? <TrendingUp className="size-3.5" /> : thr.deltaPct<0 ? <TrendingDown className="size-3.5" /> : null}{thrDeltaLabel}</>}</span>
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-xl font-semibold tabular-nums">{thr.merged===0 ? '—' : `${thr.perWeek.toFixed(1)}/wk`}</span>
                  {thr.merged>0 ? <span className="text-xs text-muted-foreground">· {thr.perDay.toFixed(1)}/day</span> : null}
                </div>
                <div className="text-[11px] text-muted-foreground">{thr.merged===0 ? 'No merges in 28d' : hasThrMedian ? `${thr.merged} in 28d vs ${thrMedian} median 3-mo · ${thrMedianPerWeek?.toFixed(1)}/wk median` : `${thr.merged} in 28d vs ${thr.prevMerged} prior`}</div>
                {thr.merged>0 && !hasThrMedian ? <div className="text-[10px] text-muted-foreground">Δ vs prior 28d: {thrDeltaLabel}</div> : null}
              </CardContent>
            </Card>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-[320px] text-xs"><div>{thr.merged} merged in last 28d {hasThrMedian ? `vs ${thrMedian} median (3-mo) · median ${thrMedianPerWeek?.toFixed(1)}/wk` : `vs ${thr.prevMerged} prior 28d`}. 3-mo median is median of last three 28d windows.</div></TooltipContent>
        </Tooltip>
        {/* Bus tile — top-3 share% + per-repo max + trend */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Card className="rounded-[6px] cursor-default" role="region" aria-label="Bus share">
              <CardContent className="flex flex-col gap-1 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Bus share</span>
                  <span className={"text-[10px] font-medium " + busColor}>{busRisk}</span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className={"text-xl font-semibold tabular-nums " + busColor}>{bus.top3Share.toFixed(0)}%</span>
                  <span className="text-[11px] text-muted-foreground">of merges by top 3</span>
                </div>
                <div className="flex items-center gap-1">
                  {bus.top.slice(0,3).map((c:any)=>(<img key={c.login} src={avatarUrl(c.login)} alt={c.login} title={c.login} className="size-6 rounded-full ring-1 ring-border" loading="lazy" />))}
                  {bus.top.length===0 ? <span className="text-xs text-muted-foreground">No data</span> : null}
                </div>
                {busPerRepoMax != null && busPerRepoMax > 0 ? <div className="text-[11px] text-muted-foreground">per-repo max {busPerRepoMax.toFixed(0)}%{busPerRepoMaxRepo ? ` · ${busPerRepoMaxRepo}` : ''}</div> : null}
                {hasBusTrend ? <div className={"flex items-center gap-1 text-[11px] font-medium tabular-nums " + busTrendColor}>{busTrendPct! > 0 ? <TrendingUp className="size-3" /> : busTrendPct! < 0 ? <TrendingDown className="size-3" /> : null}{busTrendLabel}</div> : bus.top3Share>0 ? <div className="text-[11px] text-muted-foreground">trend vs trailing 90d — no prior data</div> : null}
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted"><div className="bg-[var(--chart-1)]" style={{ width: `${bus.top3Share.toFixed(0)}%` }} /></div>
              </CardContent>
            </Card>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-[320px] text-xs leading-relaxed">
            <div>Top 3 authors share of merges in 90d window. High &gt;70% concentration.</div>
            {busPerRepoMax != null ? <div>Per-repo max {busPerRepoMax.toFixed(0)}%{busPerRepoMaxRepo ? ` in ${busPerRepoMaxRepo}` : ''}</div> : null}
            {hasBusTrend ? <div>Trend {busTrendLabel} (prev {busPrevShare?.toFixed(0)}%)</div> : null}
          </TooltipContent>
        </Tooltip>
      </div>
      {/* Footer — lifetime totals in tooltip */}
      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span className="text-[11px]">Hero windows: Cycle 90d + Δ vs trailing 90d · CI 30d · Throughput 28d vs 3-mo median · Bus 90d + per-repo max + trend</span>
        {stats ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="cursor-help underline decoration-dotted underline-offset-2">Lifetime totals</span>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-[360px] text-xs leading-relaxed">
              <div className="font-medium">Lifetime totals (footer tooltip)</div>
              <div>{comma(stats.total)} PRs · {comma(stats.merged)} merged · {comma(stats.open)} open · {comma(stats.closed)} closed</div>
              <div>{comma(stats.additions)} ++ · {comma(stats.deletions)} -- · {comma(stats.files)} files · {comma(stats.commits)} commits</div>
              <div>Contributors {comma(data.contributors)} · avg diff {comma(stats.avgDiff)} · avg files {comma(stats.avgFiles)}</div>
              <div className="text-[11px] opacity-70">Lifetime counters kept for back-compat — hero shows windowed health.</div>
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>
    </div>
  )
}

function VelocityCard({ v }: { v: OverviewData['velocity'][number] }) {
  const pct = v.deltaPct
  const isNew = v.previous === 0 && v.current > 0
  const isEmpty = v.current === 0 && v.previous === 0
  const up = pct > 0
  const down = pct < 0
  const flat = !isNew && !isEmpty && pct === 0

  // date ranges for tooltip — prefer server-provided human ranges, fallback to computed
  const currentRange = v.currentRange
  const previousRange = v.previousRange
  const tooltipMain = currentRange && previousRange
    ? `${currentRange} vs ${previousRange}`
    : isNew
      ? `${comma(v.current)} in ${v.label} — no merges in prior period`
      : `${comma(v.current)} vs ${comma(v.previous)} prior ${v.label.replace('This ', '').toLowerCase()}`

  let badge: React.ReactNode
  if (isEmpty) {
    badge = <span className="text-xs font-semibold tabular-nums text-muted-foreground">—</span>
  } else if (isNew) {
    badge = (
      <Badge
        variant="secondary"
        className="bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 border-blue-200 dark:border-blue-800 px-1.5 py-0 text-[11px] font-semibold"
      >
        New
      </Badge>
    )
  } else if (flat) {
    badge = <span className="text-xs font-semibold tabular-nums text-muted-foreground">—</span>
  } else if (up) {
    badge = (
      <span className="flex items-center gap-1 text-xs font-semibold tabular-nums text-green-600 dark:text-green-400">
        <TrendingUp className="size-3.5" />+{pct.toFixed(0)}%
      </span>
    )
  } else if (down) {
    badge = (
      <span className="flex items-center gap-1 text-xs font-semibold tabular-nums text-red-600 dark:text-red-400">
        <TrendingDown className="size-3.5" />
        {pct.toFixed(0)}%
      </span>
    )
  } else {
    badge = <span className="text-xs font-semibold tabular-nums text-muted-foreground">—</span>
  }

  return (
    <Card className="rounded-[6px]">
      <CardContent className="p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-muted-foreground">{v.label}</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="cursor-default">{badge}</span>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[300px] text-xs leading-relaxed">
              <div className="font-medium">{v.label} velocity</div>
              {currentRange && previousRange ? (
                <>
                  <div>
                    Current: {currentRange} · {comma(v.current)} merged
                  </div>
                  <div>
                    Previous: {previousRange} · {comma(v.previous)} merged
                  </div>
                </>
              ) : (
                <div>
                  {comma(v.current)} vs {comma(v.previous)} prior {v.label.replace('This ', '').toLowerCase()}
                </div>
              )}
              {isNew ? (
                <div className="text-[11px] opacity-80">No merges in previous period — marked New, not +100%</div>
              ) : isEmpty ? (
                <div className="text-[11px] opacity-80">No merges in either period</div>
              ) : null}
              {v.currentFrom && v.currentTo && v.previousFrom && v.previousTo ? (
                <div className="text-[11px] opacity-70">
                  {v.currentFrom} → {v.currentTo} vs {v.previousFrom} → {v.previousTo} (UTC)
                </div>
              ) : null}
            </TooltipContent>
          </Tooltip>
        </div>
        <div className="mt-1 text-xl font-semibold tabular-nums">{comma(v.current)}</div>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="cursor-default text-[11px] text-muted-foreground">
              merged · vs {comma(v.previous)} last {v.label.replace('This ', '').toLowerCase()}
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            {tooltipMain}
          </TooltipContent>
        </Tooltip>
      </CardContent>
    </Card>
  )
}

function AutomationCard({ data }: { data: OverviewData }) {
  const { bot } = data
  const total = bot.humanMerged + bot.botMerged
  const humanPct = total > 0 ? ((bot.humanMerged / total) * 100).toFixed(0) : '0'
  const botPct = total > 0 ? ((bot.botMerged / total) * 100).toFixed(0) : '0'
  return (
    <Card className="rounded-[6px]">
      <CardHeader className="pb-2">
        <SectionTitle>Automation</SectionTitle>
        <span className="text-xs text-muted-foreground">
          {bot.bots.length ? `${bot.bots.length} bot${bot.bots.length > 1 ? 's' : ''} · ` : ''}
          {comma(total)} merged
        </span>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div>
          <div className="mt-1 flex h-2 overflow-hidden rounded-full bg-muted">
            <div className="bg-[var(--chart-2)]" style={{ width: `${humanPct}%` }} />
            <div className="bg-[var(--chart-5)]" style={{ width: `${botPct}%` }} />
          </div>
          <div className="mt-2 flex justify-between text-xs tabular-nums text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="inline-block size-2 rounded-full bg-[var(--chart-2)]" />
              <span className="text-green-600 dark:text-green-400">
                Humans {comma(bot.humanMerged)} ({humanPct}%)
              </span>
            </span>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="cursor-default flex items-center gap-1.5">
                  <span className="inline-block size-2 rounded-full bg-[var(--chart-5)]" />
                  Bots {comma(bot.botMerged)} ({botPct}%)
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs">{bot.bots.length ? bot.bots.join(', ') : 'No bot activity'}</p>
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
        {bot.bots.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {bot.bots.map((b) => (
              <Badge key={b} variant="secondary" className="px-1.5 py-0 text-[11px] font-medium">
                {b}
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No bot merges in this period.</p>
        )}
      </CardContent>
    </Card>
  )
}

function BusCard({ data }: { data: OverviewData }) {
  const { bus } = data
  const riskLabel =
    bus.top3Share >= 70 ? 'High concentration' : bus.top3Share >= 50 ? 'Moderate' : 'Healthy'
  const riskColor =
    bus.top3Share >= 70
      ? 'text-red-600 dark:text-red-400'
      : bus.top3Share >= 50
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-green-600 dark:text-green-400'
  return (
    <Card className="rounded-[6px]">
      <CardHeader className="pb-2">
        <SectionTitle>Bus factor</SectionTitle>
        <span className={"text-xs font-medium " + riskColor}>{riskLabel}</span>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold tabular-nums">{bus.top3Share.toFixed(0)}%</span>
            <span className="text-xs text-muted-foreground">of merges by top 3 authors</span>
          </div>
          <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-muted">
            <div className="bg-[var(--chart-1)]" style={{ width: `${bus.top3Share.toFixed(0)}%` }} />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          {bus.top.map((c) => (
            <div key={c.login} className="flex items-center gap-2 text-xs">
              <img src={avatarUrl(c.login)} alt="" className="size-6 rounded-full ring-1 ring-border" loading="lazy" />
              <span className="font-medium">{c.login}</span>
              <span className="ml-auto tabular-nums text-muted-foreground">{comma(c.merged)} merges</span>
            </div>
          ))}
          {bus.top.length === 0 ? (
            <p className="text-xs text-muted-foreground">No contributor data.</p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}

function SemanticSection({ data, gran }: { data: OverviewData; gran: 'week' | 'month' }) {
  const byType = data.semantic?.byType ?? []
  const timeline = data.semantic?.timeline ?? []
  const total = data.stats.total
  const sum = byType.reduce((s, b) => s + b.count, 0)
  // Transform timeline for 100% stacked area: flat rows with each type count
  const areaData = useMemo(() => {
    return timeline.map((b) => {
      const row: Record<string, string | number> = { label: b.label, key: b.key, total: b.total }
      for (const t of SEM_TYPES) {
        row[t] = b.counts?.[t] ?? 0
      }
      return row
    })
  }, [timeline])
  const hasData = byType.length > 0
  const pieData = useMemo(() => byType.map((s) => ({ name: s.type, value: s.count, percent: s.percent })), [byType])
  if (!hasData) return null
  return (
    <Card className="rounded-[6px]">
      <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
        <div>
          <SectionTitle>Semantic PR types</SectionTitle>
          <span className="text-xs text-muted-foreground">
            Conventional commits · regex <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">^(feat|fix|chore|docs|style|refactor|perf|test|build|ci|revert)(\(.*\))?!?:</code>
            {' · '}
            {comma(sum)} / {comma(total)} PRs · {total === sum ? '✓ counts match' : 'mismatch'}
          </span>
        </div>
        <span className="rounded-full border bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">{gran === 'week' ? 'by week' : 'by month'}</span>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Pie */}
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-2 text-center">Distribution (pie)</div>
            <ChartContainer config={semanticPieConfig} className="mx-auto aspect-square max-h-[260px]">
              <PieChart>
                <ChartTooltip content={<SemanticPieTip />} />
                <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={52} outerRadius={88} paddingAngle={1}>
                  {pieData.map((entry) => (
                    <Cell key={entry.name} fill={SEM_COLORS[entry.name] ?? "var(--semantic-feat)"} stroke="var(--background)" strokeWidth={1} />
                  ))}
                </Pie>
                <ChartLegend content={<ChartLegendContent nameKey="name" />} />
              </PieChart>
            </ChartContainer>
            <div className="mt-2 flex flex-wrap justify-center gap-1.5">
              {byType.map((s) => (
                <span key={s.type} className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium">
                  <span className="inline-block size-2 rounded-full" style={{ background: SEM_COLORS[s.type] ?? "var(--semantic-feat)" }} />
                  {s.type} {comma(s.count)} ({s.percent.toFixed(1)}%)
                </span>
              ))}
            </div>
          </div>
          {/* Stacked 100% area */}
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-2 text-center">Evolution (stacked 100% area)</div>
            <ChartContainer config={semanticAreaConfig} className="h-[260px] w-full">
              <AreaChart data={areaData} stackOffset="expand" margin={{ left: 12, right: 12, top: 4, bottom: 20 }}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  interval={0}
                  angle={-30}
                  textAnchor="end"
                  height={50}
                  tick={{ fontSize: 11 }}
                />
                <YAxis tickLine={false} axisLine={false} tickMargin={8} width={30} tickFormatter={(v: number) => `${Math.round(v * 100)}%`} domain={[0, 1]} />
                <ChartTooltip content={<SemanticAreaTip />} />
                {SEM_STACK_ORDER.filter((t) => byType.some((b) => b.type === t)).map((t) => (
                  <Area key={t} type="monotone" dataKey={t} stackId="1" stroke={SEM_COLORS[t] ?? "var(--semantic-feat)"} fill={SEM_COLORS[t] ?? "var(--semantic-feat)"} fillOpacity={0.85} strokeWidth={1} />
                ))}
                <ChartLegend content={<ChartLegendContent />} />
              </AreaChart>
            </ChartContainer>
            <p className="mt-1 text-center text-[11px] text-muted-foreground">100% stacked — share of PR types per {gran} (CreatedAt). Zero-filled weeks show 0%.</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function WhenWeShip({ data }: { data: OverviewData }) {
  const viewerTz = (() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone
    } catch {
      return 'UTC'
    }
  })()

  const weekStartsOn = useMemo(() => {
    try {
      // @ts-ignore
      const loc = new Intl.Locale(navigator.language)
      // @ts-ignore
      const info = (loc as any).weekInfo ?? (loc as any).getWeekInfo?.()
      if (info?.firstDay != null) {
        return info.firstDay === 7 ? 0 : info.firstDay
      }
    } catch {}
    return 1
  }, [])

  const [tzMode, setTzMode] = useState<'server' | 'local'>(() => {
    try {
      const v = localStorage.getItem('pr-insights-tz-mode')
      return v === 'local' ? 'local' : 'server'
    } catch {
      return 'server'
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem('pr-insights-tz-mode', tzMode)
    } catch {}
  }, [tzMode])

  const { weekdayData, hourData, zoneLabel } = useMemo(() => {
    if (tzMode === 'server') {
      const wd = data.shipDist.weekday.map((v, i) => ({
        day: data.shipDist.weekdayLabels[i] ?? String(i),
        merged: v,
      }))
      const hr = data.shipDist.hour.map((v, i) => ({ hour: `${i}h`, merged: v }))
      let finalWd = wd
      if (weekStartsOn === 0) {
        const sun = wd[6]
        finalWd = [sun, ...wd.slice(0, 6)]
      }
      return { weekdayData: finalWd, hourData: hr, zoneLabel: data.shipDist.zone || 'UTC' }
    }
    const offsetHours = -new Date().getTimezoneOffset() / 60
    const shift = Math.round(offsetHours)
    const shiftedHour = new Array(24).fill(0)
    for (let i = 0; i < 24; i++) {
      const localHour = (i + shift + 24) % 24
      shiftedHour[localHour] = (shiftedHour[localHour] ?? 0) + (data.shipDist.hour[i] ?? 0)
    }
    const hr = shiftedHour.map((v, i) => ({ hour: `${i}h`, merged: v }))
    let wd = data.shipDist.weekday.map((v, i) => ({
      day: data.shipDist.weekdayLabels[i] ?? String(i),
      merged: v,
    }))
    const dayShift = Math.round(shift / 24)
    if (dayShift !== 0) {
      const n = wd.length
      const rotated = new Array(n)
      for (let i = 0; i < n; i++) {
        rotated[(i + dayShift + n) % n] = wd[i]
      }
      wd = rotated.map((entry: any, idx: number) => ({
        day: data.shipDist.weekdayLabels[(idx - dayShift + n) % n] ?? String(idx),
        merged: entry.merged,
      }))
    }
    let finalWd = wd
    if (weekStartsOn === 0) {
      const sun = wd[6]
      finalWd = [sun, ...wd.slice(0, 6)]
    }
    return { weekdayData: finalWd, hourData: hr, zoneLabel: viewerTz }
  }, [data.shipDist, tzMode, viewerTz, weekStartsOn])

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card className="rounded-[6px]">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <SectionTitle>Merges by weekday</SectionTitle>
          <div className="flex items-center gap-1 text-[11px]">
            <button
              type="button"
              onClick={() => setTzMode('server')}
              className={cn(
                'rounded px-2 py-0.5 text-xs font-medium',
                tzMode === 'server' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted',
              )}
            >
              Server (UTC)
            </button>
            <button
              type="button"
              onClick={() => setTzMode('local')}
              className={cn(
                'rounded px-2 py-0.5 text-xs font-medium',
                tzMode === 'local' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted',
              )}
              title={viewerTz}
            >
              Local
            </button>
          </div>
        </CardHeader>
        <CardContent>
          <ChartContainer config={weekdayChartConfig} className="aspect-auto h-36">
            <BarChart data={weekdayData} margin={{ left: 0, right: 4, top: 4 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={6} />
              <YAxis hide />
              <ChartTooltip cursor={{ fill: 'var(--muted)' }} content={<WeekdayTip />} />
              <Bar dataKey="merged" fill="var(--color-weekday)" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>
      <Card className="rounded-[6px]">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <SectionTitle>Merges by hour</SectionTitle>
          <div className="flex items-center gap-1 text-[11px]">
            <button
              type="button"
              onClick={() => setTzMode('server')}
              className={cn(
                'rounded px-2 py-0.5 text-xs font-medium',
                tzMode === 'server' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted',
              )}
            >
              Server (UTC)
            </button>
            <button
              type="button"
              onClick={() => setTzMode('local')}
              className={cn(
                'rounded px-2 py-0.5 text-xs font-medium',
                tzMode === 'local' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted',
              )}
              title={viewerTz}
            >
              Local
            </button>
          </div>
        </CardHeader>
        <CardContent>
          <ChartContainer config={hourChartConfig} className="aspect-auto h-36">
            <BarChart data={hourData} margin={{ left: 0, right: 4, top: 4 }}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="hour"
                tickLine={false}
                axisLine={false}
                tickMargin={6}
                interval={3}
              />
              <YAxis hide />
              <ChartTooltip cursor={{ fill: 'var(--muted)' }} content={<HourTip />} />
              <Bar dataKey="merged" fill="var(--color-hour)" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>
      <div className="text-[11px] text-muted-foreground lg:col-span-2">
        Times in {zoneLabel} {tzMode === 'local' ? `· viewer ${viewerTz}` : '· server UTC'} {weekStartsOn === 0 ? '· week starts Sunday' : '· week starts Monday'}
      </div>
    </div>
  )
}

function OverviewContent({
  data,
  gran,
  onGranChange,
}: {
  data: OverviewData
  gran: 'week' | 'month'
  onGranChange: (v: 'week' | 'month') => void
}) {
  const top = data.topContributors.slice(0, 10)
  const maxMerged = Math.max(1, ...top.map((c) => c.merged))
  const [hideReleases, setHideReleases] = useState(true)
  const [searchParams, setSearchParams] = useSearchParams()
  const largest = (hideReleases
    ? data.largest.filter(({ pull }) => !/release/i.test(pull.title))
    : data.largest
  ).slice(0, 5)
  const [hiddenLines, setHiddenLines] = useState<Record<string, boolean>>({})
  const toggleLines = (key: string) => setHiddenLines((h) => ({ ...h, [key]: !h[key] }))

  const isWeek = gran === 'week'
  const periodLabel = isWeek ? 'by week' : 'by month'
  const fromParam = searchParams.get('from')
  const toParam = searchParams.get('to')

  const weeklyTickFormatter = (value: string, index: number): string => {
    if (!isWeek) return value
    let bucket: any = data.monthly[index]
    if (!bucket || bucket.label !== value) {
      bucket = (data.monthly as any[]).find((b: any) => b.label === value)
    }
    const key: string | undefined = bucket?.key
    if (!key || key.length !== 10) return value
    const d = new Date(key + 'T00:00:00Z')
    if (Number.isNaN(d.getTime())) return value
    const curYear = new Date().getUTCFullYear()
    const y = d.getUTCFullYear()
    if (y !== curYear) {
      const m = d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })
      const day = d.getUTCDate()
      const yy = String(y).slice(-2)
      return `${m} ${day} ’${yy}`
    }
    return value
  }

  const yearBoundaries: string[] = useMemo(() => {
    if (!isWeek) return []
    const out: string[] = []
    for (let i = 1; i < data.monthly.length; i++) {
      const prev: any = data.monthly[i - 1]
      const cur: any = data.monthly[i]
      const prevKey: string | undefined = prev?.key
      const curKey: string | undefined = cur?.key
      if (!prevKey || !curKey || prevKey.length !== 10 || curKey.length !== 10) continue
      const prevYear = new Date(prevKey + 'T00:00:00Z').getUTCFullYear()
      const curYear = new Date(curKey + 'T00:00:00Z').getUTCFullYear()
      if (curYear !== prevYear) out.push(cur.label)
    }
    return out
  }, [data.monthly, isWeek])

  const handleBrushChange = (range: any) => {
    if (!range) return
    const { startIndex, endIndex } = range
    if (startIndex == null || endIndex == null) return
    if (startIndex === 0 && endIndex === data.monthly.length - 1) {
      const next = new URLSearchParams(searchParams)
      next.delete('from')
      next.delete('to')
      setSearchParams(next, { replace: true })
      return
    }
    const fromBucket: any = data.monthly[startIndex]
    const toBucket: any = data.monthly[endIndex]
    const fromKey = fromBucket?.key ?? fromBucket?.label
    const toKey = toBucket?.key ?? toBucket?.label
    const next = new URLSearchParams(searchParams)
    if (fromKey) next.set('from', String(fromKey))
    if (toKey) next.set('to', String(toKey))
    setSearchParams(next, { replace: true })
  }

  const { highlightFrom, highlightTo } = useMemo(() => {
    if (!fromParam || !toParam) return { highlightFrom: null as string | null, highlightTo: null as string | null }
    let from = fromParam
    let to = toParam
    if (/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      const d = new Date(to + 'T00:00:00Z')
      if (!Number.isNaN(d.getTime())) {
        d.setUTCDate(d.getUTCDate() + 6)
        to = d.toISOString().slice(0, 10)
      }
    } else if (/^\d{4}-\d{2}$/.test(to)) {
      const [y, m] = to.split('-').map(Number)
      const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
      to = last
      if (/^\d{4}-\d{2}$/.test(from)) from = from + '-01'
    }
    if (/^\d{4}-\d{2}$/.test(from) && !/^\d{4}-\d{2}-\d{2}$/.test(from)) from = from + '-01'
    return { highlightFrom: from, highlightTo: to }
  }, [fromParam, toParam])

  const hasBrush = data.monthly.length > 6

  return (
    <div className="flex flex-col gap-4">
      <HeroTiles data={data} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {data.velocity.map((v) => (
          <VelocityCard key={v.label} v={v} />
        ))}
      </div>

      <div className="rounded-lg rounded border bg-muted/30 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-semibold">Shipping trends</div>
          <div className="flex items-center gap-2">
            <Tabs value={gran} onValueChange={(v) => onGranChange(v as 'week' | 'month')}>
              <TabsList className="h-7">
                <TabsTrigger value="week" className="px-3 py-1 text-xs">
                  Week
                </TabsTrigger>
                <TabsTrigger value="month" className="px-3 py-1 text-xs">
                  Month
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <span className="rounded-full border bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
              {data.monthly.length} buckets
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 pt-3 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <SectionTitle>{`Merged pull requests ${periodLabel}`}</SectionTitle>
            </CardHeader>
          <CardContent>
            <ChartContainer config={mergedChartConfig} className="h-[300px]">
              <AreaChart data={data.monthly} margin={{ left: 4, right: 4, top: 4, bottom: 20 }}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  interval={0}
                  angle={isWeek ? -35 : -30}
                  textAnchor="end"
                  height={50}
                  tick={{ fontSize: 11 }}
                  tickFormatter={weeklyTickFormatter}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  width={40}
                  domain={[0, 'auto']}
                  allowDecimals={false}
                  tickFormatter={(v) => compact(Number(v))}
                />
                <ChartTooltip cursor={{ stroke: 'var(--border)' }} content={<MergedTip />} />
                {yearBoundaries.map((x) => (
                  <ReferenceLine key={x} x={x} stroke="var(--border)" strokeDasharray="3 3" />
                ))}
                <Area
                  dataKey="merged"
                  type="natural"
                  stroke="var(--color-merged)"
                  strokeWidth={2}
                  fill="var(--color-merged)"
                  fillOpacity={0.2}
                />
                {hasBrush ? (
                  <Brush dataKey="label" height={24} fill="var(--muted)" stroke="var(--border)" travellerWidth={12} onChange={handleBrushChange} />
                ) : null}
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <SectionTitle>{`Lines changed ${periodLabel}`}</SectionTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={linesChartConfig} className="h-[300px]">
              <BarChart data={data.monthly} margin={{ left: 4, right: 4, top: 4, bottom: 20 }}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  interval={0}
                  angle={isWeek ? -35 : -30}
                  textAnchor="end"
                  height={50}
                  tick={{ fontSize: 11 }}
                  tickFormatter={weeklyTickFormatter}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  width={40}
                  domain={[0, 'auto']}
                  allowDecimals={false}
                  tickFormatter={(v) => compact(Number(v))}
                />
                <ChartTooltip cursor={{ fill: 'var(--muted)' }} content={<LinesStackedTip hidden={hiddenLines} />} />
                {yearBoundaries.map((x) => (
                  <ReferenceLine key={x} x={x} stroke="var(--border)" strokeDasharray="3 3" />
                ))}
                <Bar dataKey="additions" name="Added" stackId="lines" fill="var(--color-additions)" hide={Boolean(hiddenLines.additions)} />
                <Bar dataKey="deletions" name="Deleted" stackId="lines" fill="var(--color-deletions)" hide={Boolean(hiddenLines.deletions)} radius={[2, 2, 0, 0]} />
                <ChartLegend content={<ToggleLegend hiddenSeries={hiddenLines} onToggleSeries={toggleLines} />} />
                {hasBrush ? (
                  <Brush dataKey="label" height={24} fill="var(--muted)" stroke="var(--border)" travellerWidth={12} onChange={handleBrushChange} />
                ) : null}
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
        </div>
      </div>

      <WhenWeShip data={data} />

      <SemanticSection data={data} gran={gran} />

      {isWeek ? (
        <p className="text-[11px] text-muted-foreground">Weekly buckets start Monday · Jan 1 marked · brush to highlight heatmap weeks via ?from=&to={fromParam && toParam ? ` (${fromParam} → ${toParam})` : ''}</p>
      ) : null}
      {fromParam && toParam ? (
        <p className="text-[11px] text-muted-foreground">
          Highlighting {fromParam} → {toParam}{' '}
          <button
            type="button"
            onClick={() => {
              const n = new URLSearchParams(searchParams)
              n.delete('from')
              n.delete('to')
              setSearchParams(n, { replace: true })
            }}
            className="ml-1 text-xs text-primary hover:underline"
          >
            clear
          </button>
        </p>
      ) : null}

      {data.heatmap && data.heatmap.length > 0 ? (
        <Card className="@container overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <SectionTitle>Activity · 365d · {comma(data.heatmap.reduce((s, d) => s + d.merged, 0))} merges</SectionTitle>
            {fromParam && toParam ? (
              <span className="text-[11px] text-muted-foreground">
                highlight {fromParam}→{toParam}
              </span>
            ) : null}
          </CardHeader>
          <CardContent className="w-full @container px-3 sm:px-4 [container-type:inline-size]">
            <Heatmap dates={data.heatmap} highlightFrom={highlightFrom} highlightTo={highlightTo} className="w-full" />
          </CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <AutomationCard data={data} />
        <BusCard data={data} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <SectionTitle>Top contributors</SectionTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-1.5">
              {top.map((c) => (
                <ContributorBar key={c.login} contributor={c} maxMerged={maxMerged} />
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <SectionTitle>Largest pull requests</SectionTitle>
            <Button
              variant={hideReleases ? 'secondary' : 'outline'}
              size="sm"
              onClick={() => setHideReleases((h) => !h)}
              aria-pressed={hideReleases}
            >
              {hideReleases ? 'Release PRs hidden' : 'Showing release PRs'}
            </Button>
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pull request</TableHead>
                <TableHead className="text-right">Additions</TableHead>
                <TableHead className="text-right">Deletions</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Files</TableHead>
                <TableHead className="text-right">Commits</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {largest.map(({ value, pull }) => (
                <TableRow key={`${pull.repo}#${pull.number}`}>
                  <TableCell className="max-w-[520px]">
                    <span className="flex items-baseline gap-1.5">
                      <a
                        href={pull.url}
                        target="_blank"
                        rel="noreferrer"
                        className="truncate font-semibold text-foreground hover:text-blue-600 dark:hover:text-blue-400"
                      >
                        {pull.title}
                      </a>
                      <span className="shrink-0 text-muted-foreground">
                        · {pull.repo}#{pull.number}
                      </span>
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-mono text-green-600 tabular-nums dark:text-green-400">
                    +{comma(pull.additions)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-red-600 tabular-nums dark:text-red-400">
                    −{comma(pull.deletions)}
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {comma(value)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {comma(pull.changedFiles)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {comma(pull.commits)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </div>
    </div>
  )
}

export default function OverviewPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const rawGran = searchParams.get('gran')
  const gran: 'week' | 'month' = rawGran === 'week' ? 'week' : 'month'
  const { data, loading, error, refetch } = useApi(() => getOverview({ largest: 15, gran }), [gran])
  const isInitialLoading = loading && !data
  const isReloading = loading && !!data

  const handleGranChange = (v: 'week' | 'month') => {
    const next = new URLSearchParams(searchParams)
    next.set('gran', v)
    setSearchParams(next)
  }

  if (isInitialLoading) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Overview" description="Pull request activity across the organisation." />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="rounded-[6px]">
              <CardContent className="flex flex-col gap-2 p-3">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-5 w-12" />
                <Skeleton className="h-3 w-24" />
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="rounded-[6px]">
              <CardContent className="p-3">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="mt-2 h-6 w-16" />
                <Skeleton className="mt-1 h-3 w-32" />
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-7 w-36 rounded-md" />
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Skeleton className="h-[340px] w-full rounded-[6px]" />
          <Skeleton className="h-[340px] w-full rounded-[6px]" />
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Skeleton className="h-36 w-full rounded-[6px]" />
          <Skeleton className="h-36 w-full rounded-[6px]" />
        </div>
        <Skeleton className="h-[140px] w-full rounded-[6px]" />
      </div>
    )
  }
  if (error && !data) {
    return (
      <PageHeader title="Overview" description="Pull request activity across the organisation.">
        <EmptyState text={`Failed to load: ${error}`}>
          <button onClick={refetch} className="text-sm text-primary hover:underline">Try again</button>
        </EmptyState>
      </PageHeader>
    )
  }
  if (!data || data.stats.total === 0) {
    return (
      <PageHeader title="Overview" description="Pull request activity across the organisation.">
        <EmptyState text="Waiting for data — the first sync is in progress." />
      </PageHeader>
    )
  }
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Overview" description={`Pull request activity across ${data.org}.`} />
      <div className="relative">
        {isReloading && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-start justify-center pt-6">
            <div className="pointer-events-auto flex items-center gap-2 rounded-full border bg-background px-3 py-1.5 text-xs font-medium shadow-sm">
              <Loader2 className="size-3.5 animate-spin" />
              Loading {gran} view...
            </div>
          </div>
        )}
        <div className={cn(isReloading && 'opacity-50 pointer-events-none transition-opacity', 'flex flex-col gap-4')} aria-busy={isReloading}>
          <OverviewContent data={data} gran={gran} onGranChange={handleGranChange} />
          {isReloading && (
            <div className="grid gap-2">
              <Skeleton className="h-2 w-full" />
              <Skeleton className="h-2 w-3/4" />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
