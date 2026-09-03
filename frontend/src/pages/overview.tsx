import { Loader2, TrendingDown, TrendingUp } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Brush,
  CartesianGrid,
  ReferenceLine,
  XAxis,
  YAxis,
} from 'recharts'

import { EmptyState } from '@/components/empty-state'
import { Heatmap } from '@/components/heatmap'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/page-header'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import {
  ChartContainer,
  ChartLegend,
  ChartTooltip,
  type ChartConfig,
} from '@/components/ui/chart'
import { TipShell, TipRow, getPayloadColor, ToggleLegend } from '@/components/chart-tips'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { avatarUrl, getOverview, type OverviewData } from '@/lib/api'
import { comma, compact, fmtDuration } from '@/lib/format'
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
        <span className="text-muted-foreground">Changed (added + removed, stacked upward)</span>
        <span className="font-mono font-medium tabular-nums">{comma(Math.round(total))} lines</span>
      </div>
    </TipShell>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="text-base font-semibold">{children}</div>
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
          <Card key={i} className="">
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
            <Card className="cursor-default" role="region" aria-label="Median cycle">
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
                {cycle.count>0 ? <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted" title={`p90 ${cycle.p90.toFixed(1)}d vs 14d red line`}><div className="h-full bg-[var(--chart-1)]" style={{ width: `${Math.min(100, (cycle.p90/14)*100)}%` }} /></div> : null}
              </CardContent>
            </Card>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-[360px] text-xs leading-relaxed">
            <div className="font-medium">Cycle p50 {cycle.p50.toFixed(1)}d · p90 {cycle.p90.toFixed(1)}d (n={cycle.count})</div>
            <div>Median &amp; p90 days from CreatedAt → MergedAt in last 90d. Clamp negative to 0.</div>
            {hasCycleDelta ? <div>Δ vs trailing 90d: {cycleDeltaLabel} · trailing p50 {cyclePrevP50?.toFixed(1)}d (n={cyclePrevCount})</div> : <div>Δ vs trailing 90d: no prior window data</div>}
            <div className="text-[11px] opacity-70">Badge follows p90: &gt;14d red · 7–14d watch · &lt;7d healthy. p50 shown for reference.</div>
          </TooltipContent>
        </Tooltip>
        {/* CI tile — success% 30d + median duration */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Card className="cursor-default" role="region" aria-label="CI success">
              <CardContent className="flex flex-col gap-1 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">CI success</span>
                  {ci.total===0 ? <Badge variant="outline" className="px-1.5 py-0 text-[10px]">no runs</Badge> : ci.total<20 ? <Badge variant="outline" className="px-1.5 py-0 text-[10px]">n&lt;20</Badge> : ci.rate>=90 ? <Badge variant="secondary" className="px-1.5 py-0 text-[10px] bg-green-100 text-green-700 dark:bg-green-900/40">Healthy</Badge> : ci.rate>=80 ? <Badge variant="secondary" className="px-1.5 py-0 text-[10px] bg-amber-100 text-amber-700">Watch</Badge> : <Badge variant="destructive" className="px-1.5 py-0 text-[10px]">Needs attention</Badge>}
                </div>
                <div className={"text-xl font-semibold tabular-nums " + (ci.total===0 ? 'text-muted-foreground' : ciColor)}>{ci.total===0 ? '—' : `${ci.rate.toFixed(0)}%`}</div>
                <div className="text-[11px] text-muted-foreground">{ci.total===0 ? 'No CI runs in 30d' : `${ci.success} success · ${ci.failure} fail · 30d`}</div>
                {ciMedianMin != null && ci.total>0 ? <div className="text-[11px] text-muted-foreground">median duration {fmtDuration(ciMedianMin)}</div> : ci.total>0 ? <div className="text-[11px] text-muted-foreground">median duration —</div> : null}
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
            <Card className="cursor-default" role="region" aria-label="Throughput">
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
            <Card className="cursor-default" role="region" aria-label="Bus share">
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

function OverviewContent({
  data,
  gran,
  onGranChange,
}: {
  data: OverviewData
  gran: 'week' | 'month'
  onGranChange: (v: 'week' | 'month') => void
}) {
  const [searchParams, setSearchParams] = useSearchParams()
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

      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-base font-semibold">Shipping trends</div>
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

      {/* WhenWeShip moved to Insights — Overview keeps Hero + Shipping + Heatmap only */}

      {/* Semantic PR types visible on Insights/People — Overview minimal */}

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
            <Card key={i} className="">
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
            <Card key={i} className="">
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
          <Skeleton className="h-[340px] w-full rounded-xl" />
          <Skeleton className="h-[340px] w-full rounded-xl" />
        </div>
        <Skeleton className="h-[140px] w-full rounded-xl" />
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
