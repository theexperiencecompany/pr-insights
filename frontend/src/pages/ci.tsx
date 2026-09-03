import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from 'recharts'
import { Activity, CheckCircle2, Clock3, Server, Timer, XCircle } from 'lucide-react'

import { EmptyState } from '@/components/empty-state'
import { FilterBar } from '@/components/filter-bar'
import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer, ChartTooltip, type ChartConfig } from '@/components/ui/chart'
import { TipShell, TipRow, getPayloadColor } from '@/components/chart-tips'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { getHybrid, getStatus, type CIRunnerBucket, type WorkflowHybrid } from '@/lib/api'
import { comma, fmtDuration, timeAgo } from '@/lib/format'
import { useApi } from '@/lib/use-api'
import { cn } from '@/lib/utils'

const PERIODS = ['3m', '6m', '12m', 'all'] as const
type Period = (typeof PERIODS)[number]
const GRANS = ['week', 'month'] as const
type Gran = (typeof GRANS)[number]

const PERIOD_LABELS: Record<Period, string> = {
  '3m': 'Last 3 months',
  '6m': 'Last 6 months',
  '12m': 'Last 12 months',
  all: 'All time',
}

const runnerConfig = {
  home: { label: 'Home (self-hosted)', color: 'var(--chart-2)' },
  github: { label: 'GitHub', color: 'var(--chart-3)' },
  unknown: { label: 'Unknown', color: 'var(--chart-5)' },
} satisfies ChartConfig

const trendConfig = {
  github: { label: 'GitHub', color: 'var(--chart-3)' },
  home: { label: 'Home', color: 'var(--chart-2)' },
  unknown: { label: 'Unknown', color: 'var(--chart-5)' },
} satisfies ChartConfig

function ThresholdBadge({ p50, p90, successRate, tP50 = 10, tP90 = 25 }: { p50: number; p90: number; successRate?: number; tP50?: number; tP90?: number }) {
  const slow = p50 > tP50 || p90 > tP90 || (successRate !== undefined && successRate < 85)
  const watch = !slow && (p50 > 8 || p90 > 20 || (successRate !== undefined && successRate < 90))
  if (slow) return <Badge variant="destructive" className="px-1.5 py-0 text-[10px]">Slow</Badge>
  if (watch) return <Badge variant="secondary" className="px-1.5 py-0 text-[10px] bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200">Watch</Badge>
  return <Badge variant="secondary" className="px-1.5 py-0 text-[10px] bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-200">Healthy</Badge>
}

function HealthDot({ wf }: { wf: WorkflowHybrid }) {
  const slow = wf.isSlow || wf.successRate < 85
  const watch = !slow && (wf.p50Min > 8 || wf.p90Min > 20 || wf.successRate < 90)
  const color = slow ? 'bg-red-500' : watch ? 'bg-amber-500' : 'bg-emerald-500'
  const label = slow ? 'Slow' : watch ? 'Watch' : 'Healthy'
  return (
    <span className="inline-flex items-center gap-1.5" title={label}>
      <span className={cn('size-2.5 rounded-full', color)} aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  )
}

function HostingPill({ hosting }: { hosting: string }) {
  if (hosting === 'home') {
    return <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200 border-emerald-200 dark:border-emerald-800">home</Badge>
  }
  if (hosting === 'github') {
    return <Badge className="bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200 border-slate-200 dark:border-slate-700">github</Badge>
  }
  return <Badge variant="outline" className="text-muted-foreground">unknown</Badge>
}

function PieTip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  // payload entries are slices; we want to show all slices? Use first payload's payload for totals?
  // Recharts Pie tooltip gives single entry; we will reconstruct from payload array if available via parent data
  // Safer: show single slice
  const entry = payload[0]
  if (!entry) return null
  const name = String(entry.name ?? entry.payload?.name ?? '')
  const value = Number(entry.value ?? 0)
  const payloadData = entry.payload as any
  const runs = payloadData?.runs
  const minutes = payloadData?.minutes
  const pct = payloadData?.pct != null ? ` · ${payloadData.pct.toFixed(1)}%` : ''
  return (
    <TipShell label={name}>
      <TipRow color={getPayloadColor(entry) ?? entry.payload?.fill} label={name} value={`${comma(value)} runs${pct}`} />
      {typeof runs === 'number' && typeof minutes === 'number' ? (
        <div className="text-[11px] text-muted-foreground">{comma(minutes)} min · {pct.replace(' · ','')} of runs</div>
      ) : null}
    </TipShell>
  )
}

function TrendTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const rows = payload as any[]
  // payload entries are trendData rows: github/home/unknown percentages plus _raw CIRunnerBucket
  const raw: CIRunnerBucket | undefined = (rows[0]?.payload as any)?._raw ?? (rows[0]?.payload as CIRunnerBucket | undefined)
  // raw contains counts and minutes per hosting with correct sums (home+github+unknown == total)
  return (
    <TipShell label={label}>
      {rows.map((entry) => {
        const key = String(entry.dataKey)
        const pct = Number(entry.value ?? 0)
        const col = getPayloadColor(entry) ?? (key === 'home' ? 'var(--chart-2)' : key === 'github' ? 'var(--chart-3)' : 'var(--chart-5)')
        let count = 0
        let minutes = 0
        let hostPct = pct
        if (raw) {
          if (key === 'home') {
            count = raw.home
            minutes = (raw as any).homeMinutes ?? 0
            hostPct = (raw as any).homePct ?? pct
          } else if (key === 'github') {
            count = raw.github
            minutes = (raw as any).githubMinutes ?? 0
            hostPct = (raw as any).githubPct ?? pct
          } else if (key === 'unknown') {
            count = raw.unknown
            minutes = (raw as any).unknownMinutes ?? 0
            hostPct = (raw as any).unknownPct ?? pct
          }
        }
        return <TipRow key={key} color={col} label={key} value={`${hostPct.toFixed(1)}% · ${comma(count)} runs · ${comma(minutes)} min`} />
      })}
      {raw ? (
        <>
          <div className="flex items-center justify-between gap-4 border-t border-border/50 pt-1.5">
            <span className="text-muted-foreground">Total</span>
            <span className="font-mono font-medium tabular-nums">{comma(raw.total)} runs · {comma(raw.totalMinutes)} min</span>
          </div>
          <div className="flex items-center justify-between gap-4 text-[11px] text-muted-foreground">
            <span>home {raw.homePct.toFixed(1)}% · github {raw.githubPct.toFixed(1)}%{raw.unknown > 0 ? ` · unknown ${raw.unknownPct.toFixed(1)}%` : ''}</span>
            <span>{raw.home} + {raw.github}{raw.unknown>0 ? ` + ${raw.unknown}` : ''} = {raw.total}</span>
          </div>
        </>
      ) : null}
      <div className="text-[11px] text-muted-foreground">github bottom · home middle · unknown top · 100% stacked</div>
    </TipShell>
  )
}

function HostSplitBar({ home, github, unknown }: { home: number; github: number; unknown: number }) {
  const total = home + github + unknown
  if (total === 0) return <span className="text-xs text-muted-foreground">—</span>
  const homePct = (home / total) * 100
  const ghPct = (github / total) * 100
  const unkPct = (unknown / total) * 100
  return (
    <div className="flex h-2 w-24 overflow-hidden rounded-full bg-muted" title={`home ${homePct.toFixed(0)}% · github ${ghPct.toFixed(0)}%${unknown>0 ? ` · unknown ${unkPct.toFixed(0)}%` : ''}`}>
      {home > 0 && <div className="bg-[var(--chart-2)]" style={{ width: `${homePct}%` }} />}
      {github > 0 && <div className="bg-[var(--chart-3)]" style={{ width: `${ghPct}%` }} />}
      {unknown > 0 && <div className="bg-[var(--chart-5)]" style={{ width: `${unkPct}%` }} />}
    </div>
  )
}

function TailTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const raw = (payload[0]?.payload as any) ?? {}
  const rows = [
    { key: 'p50', label: 'p50', value: raw.p50, color: 'var(--chart-1)' },
    { key: 'p90', label: 'p90', value: raw.p90, color: 'var(--chart-2)' },
    { key: 'p95', label: 'p95', value: raw.p95, color: 'var(--chart-5)' },
  ].filter((r) => typeof r.value === 'number' && Number.isFinite(r.value))
  if (!rows.length) return null
  return (
    <TipShell label={raw.workflow ?? label}>
      {rows.map((r) => (
        <TipRow key={r.key} color={r.color} label={r.label} value={fmtDuration(r.value)} />
      ))}
      <div className="text-[11px] text-muted-foreground">
        {comma(raw.runs ?? 0)} runs · queue {raw.queue != null ? fmtDuration(raw.queue) : '—'} · stacked p50 → p90 → p95
      </div>
    </TipShell>
  )
}

export default function CIPage() {  const [searchParams, setSearchParams] = useSearchParams()
  const rawPeriod = searchParams.get('period')
  const period: Period = (PERIODS as readonly string[]).includes(rawPeriod as string) ? (rawPeriod as Period) : '6m'
  const rawGran = searchParams.get('gran')
  const gran: Gran = (GRANS as readonly string[]).includes(rawGran as string) ? (rawGran as Gran) : 'month'
  const repoParam = searchParams.get('repo') ?? 'all'

  const hybridParams = useMemo(() => ({
    repo: repoParam === 'all' ? undefined : repoParam,
    period,
    gran,
  }), [repoParam, period, gran])

  const { data, loading, error } = useApi(() => getHybrid(hybridParams), [hybridParams.repo, hybridParams.period, hybridParams.gran])
  const isInitialLoading = loading && !data
  const isReloading = loading && !!data
  const { data: status } = useApi(getStatus)

  const [hideSmall, setHideSmall] = useState(false)
  const [onlySlow, setOnlySlow] = useState(false)
  const [sortKey, setSortKey] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'p90', dir: 'desc' })

  const updateParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams)
    if (value) next.set(key, value)
    else next.delete(key)
    setSearchParams(next)
  }

  const handleRepoChange = (value: string) => updateParam('repo', value === 'all' ? '' : value)

  const filteredWorkflows = useMemo(() => {
    if (!data) return []
    let rows = [...data.workflows]
    if (hideSmall) rows = rows.filter((w) => !w.isSampleSmall)
    if (onlySlow) rows = rows.filter((w) => w.isSlow || w.successRate < 85)
    const dir = sortKey.dir === 'asc' ? 1 : -1
    rows.sort((a, b) => {
      switch (sortKey.key) {
        case 'workflow': return dir * a.workflow.localeCompare(b.workflow)
        case 'runs': return dir * (a.runs - b.runs)
        case 'p50': return dir * (a.p50Min - b.p50Min)
        case 'p90': return dir * (a.p90Min - b.p90Min)
        case 'p95': return dir * ((a as any).p95Min - (b as any).p95Min)
        case 'p99': return dir * (a.p99Min - b.p99Min)
        case 'successRate': return dir * (a.successRate - b.successRate)
        case 'flake': return dir * (a.flakeScore - b.flakeScore)
        case 'mttr': return dir * (((a as any).mttrMedianMin ?? 0) - ((b as any).mttrMedianMin ?? 0))
        case 'wasted': return dir * (((a as any).wastedMinutes ?? 0) - ((b as any).wastedMinutes ?? 0))
        case 'queue': return dir * (a.queueMedianMin - b.queueMedianMin)
        case 'budget': return dir * (a.budgetSharePct - b.budgetSharePct)
        case 'delta': return dir * (a.deltaMin - b.deltaMin)
        case 'lastRun': return dir * String(a.lastRunAt ?? '').localeCompare(String(b.lastRunAt ?? ''))
        default: return 0
      }
    })
    return rows
  }, [data, hideSmall, onlySlow, sortKey])

  const pieData = useMemo(() => {
    if (!data) return []
    const s = data.split
    const rows = [
      { name: 'home', value: s.homeRuns, runs: s.homeRuns, minutes: s.homeMinutes, pct: s.homePctRuns, fill: 'var(--chart-2)' },
      { name: 'github', value: s.githubRuns, runs: s.githubRuns, minutes: s.githubMinutes, pct: s.githubPctRuns, fill: 'var(--chart-3)' },
    ]
    if (s.unknownRuns > 0) rows.push({ name: 'unknown', value: s.unknownRuns, runs: s.unknownRuns, minutes: (s as any).unknownMinutes ?? 0, pct: (s as any).unknownPctRuns ?? s.unknownRuns / s.totalRuns * 100, fill: 'var(--chart-5)' })
    return rows.filter(r => r.value > 0)
  }, [data])

  const trendData = useMemo(() => {
    if (!data?.trend?.length) return []
    // For 100% stacked, recharts docs: use stackId and provide percent values
    return data.trend.map((b) => ({
      label: b.label,
      github: b.githubPct,
      home: b.homePct,
      unknown: b.unknownPct,
      _raw: b,
      // keep raw for tooltip
      key: b.key,
    }))
  }, [data])

  const overall = data ? { p50: data.overallP50, p90: data.overallP90, avg: data.overallAvg, totalRuns: data.totalRuns, totalMinutes: data.totalMinutes, homePct: data.split.homePctRuns, homePctMin: data.split.homePctMinutes, githubPct: data.split.githubPctRuns } : null

  const slowCount = data?.workflows.filter(w => w.isSlow || w.successRate < 85).length ?? 0
  const tP50 = data?.thresholds?.p50 ?? 10
  const tP90 = data?.thresholds?.p90 ?? 25
  const budgetTop = useMemo(() => {
    if (!data) return []
    return [...data.workflows].sort((a, b) => b.budgetSharePct - a.budgetSharePct).slice(0, 8)
  }, [data])
  const maxBudget = Math.max(1, ...budgetTop.map((w) => w.budgetSharePct))
  // Tail distribution: top lanes by p90 as stacked p50 → p90 → p95 ranges.
  const tailTop = useMemo(() => {
    if (!data) return []
    return [...data.workflows]
      .sort((a, b) => b.p90Min - a.p90Min)
      .slice(0, 8)
      .map((w) => ({
        name: w.workflow.length > 22 ? `${w.workflow.slice(0, 21)}…` : w.workflow,
        workflow: w.workflow,
        p50: w.p50Min,
        d90: Math.max(0, w.p90Min - w.p50Min),
        d95: Math.max(0, (w.p95Min ?? w.p90Min) - w.p90Min),
        p90: w.p90Min,
        p95: w.p95Min ?? w.p90Min,
        runs: w.runs,
        queue: w.queueMedianMin,
      }))
  }, [data])
  const maxTail = Math.max(1, ...tailTop.map((t) => t.p50 + t.d90 + t.d95))

  const handleSort = (k: string) => {
    setSortKey((s) => (s.key === k ? { key: k, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key: k, dir: 'desc' }))
  }

  const org = status?.org
  void org

  return (
    <TooltipProvider>
      <PageHeader title="CI" description="Self-hosted CI — home vs GitHub lane health (16c home server)" />

      <FilterBar>
        <Select value={repoParam} onValueChange={handleRepoChange}>
          <SelectTrigger size="sm" aria-label="Filter by repository" className="max-w-44">
            <SelectValue placeholder="All repos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All repos</SelectItem>
            {data?.repoOptions?.map((r) => (
              <SelectItem key={r.name} value={r.name}>{r.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Period
          <Select value={period} onValueChange={(v) => updateParam('period', v)}>
            <SelectTrigger size="sm" className="min-w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PERIODS.map((p) => (<SelectItem key={p} value={p}>{PERIOD_LABELS[p]}</SelectItem>))}
            </SelectContent>
          </Select>
        </label>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Granularity
          <Select value={gran} onValueChange={(v) => updateParam('gran', v)}>
            <SelectTrigger size="sm" className="min-w-28"><SelectValue placeholder="Monthly" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="month">Monthly</SelectItem>
              <SelectItem value="week">Weekly</SelectItem>
            </SelectContent>
          </Select>
        </label>
        {(repoParam !== 'all') && (
          <button type="button" onClick={() => handleRepoChange('all')} className="ml-auto text-xs text-muted-foreground hover:text-foreground">Clear</button>
        )}
        <div className="ml-auto flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="hidden sm:inline">Thresholds: p50&gt;10m p90&gt;25m success&lt;85% → red</span>
        </div>
      </FilterBar>

      {isInitialLoading ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (<Skeleton key={i} className="h-[84px] w-full rounded-xl" />))}
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <Skeleton className="h-[260px] w-full rounded-xl" />
            <Skeleton className="h-[260px] w-full rounded-xl lg:col-span-2" />
          </div>
          <Skeleton className="h-[360px] w-full rounded-xl" />
        </div>
      ) : error && !data ? (
        <EmptyState text={error} />
      ) : data ? (
        <div className="relative">
          {isReloading && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-start justify-center pt-6">
              <div className="pointer-events-auto flex items-center gap-2 rounded-full border bg-background px-3 py-1.5 text-xs font-medium shadow-sm">
                <span className="size-2 animate-pulse rounded-full bg-[var(--chart-1)]" /> Loading {gran} view…
              </div>
            </div>
          )}
          <div className={cn(isReloading && 'pointer-events-none opacity-50 transition-opacity')}>
            {/* Top big numbers row */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Card className={cn(overall && overall.p50 > 10 ? 'border-red-200 dark:border-red-900' : '')}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Median · p50</span>
                    <Tooltip>
                      <TooltipTrigger asChild><span className="inline-flex"><Timer className="size-3.5 text-muted-foreground" /></span></TooltipTrigger>
                      <TooltipContent className="max-w-[280px] text-xs">Median CI duration across all filtered runs (success+failure). Red if &gt;10m. P50 threshold is one-line tuning in metrics_vision.go.</TooltipContent>
                    </Tooltip>
                  </div>
                  <div className={cn('mt-1 text-2xl font-semibold tabular-nums', overall && overall.p50 > 10 ? 'text-red-600 dark:text-red-400' : 'text-foreground')}>
                    {overall ? fmtDuration(overall.p50) : '—'}
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <span>avg {overall ? fmtDuration(overall.avg) : '—'} · p90 {overall ? fmtDuration(overall.p90) : '—'}</span>
                    {overall && (overall.p50 > 10 || overall.p90 > 25) ? <Badge variant="destructive" className="px-1.5 py-0 text-[10px]">Slow</Badge> : <Badge variant="secondary" className="px-1.5 py-0 text-[10px] bg-green-100 text-green-700 dark:bg-green-900/30">Healthy</Badge>}
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground">Threshold p50&gt;10m · {data.workflows.length} lanes · {slowCount} slow</div>
                </CardContent>
              </Card>

              <Card className={cn(overall && overall.p90 > 25 ? 'border-red-200 dark:border-red-900' : '')}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Tail · p90</span>
                    <Activity className="size-3.5 text-muted-foreground" />
                  </div>
                  <div className={cn('mt-1 text-2xl font-semibold tabular-nums', overall && overall.p90 > 25 ? 'text-red-600 dark:text-red-400' : '')}>
                    {overall ? fmtDuration(overall.p90) : '—'}
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <span>home p50 {data.homeP50 ? fmtDuration(data.homeP50) : '—'} · github p50 {data.githubP50 ? fmtDuration(data.githubP50) : '—'}</span>
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    Δ lanes (global p50) {data.deltaHomeVsGithub != null ? `${data.deltaHomeVsGithub > 0 ? '+' : ''}${data.deltaHomeVsGithub.toFixed(1)} min` : '—'} {data.deltaHomeVsGithub < 0 ? '· home faster' : data.deltaHomeVsGithub > 0 ? '· home slower' : ''}
                  </div>
                </CardContent>
              </Card>

              <Card >
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Total cost · cost per merge</span>
                    <Clock3 className="size-3.5 text-muted-foreground" />
                  </div>
                  <div className="mt-1 text-2xl font-semibold tabular-nums">{comma(data.totalMinutes)} <span className="text-sm font-normal text-muted-foreground">min</span> <span className="text-base font-normal text-muted-foreground">· {(data as any).costPerMerge ? `${((data as any).costPerMerge.perMergeMin ?? 0) > 0 ? fmtDuration((data as any).costPerMerge.perMergeMin) + ' / merge' : '— / merge'}` : ''}</span></div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {data.totalRuns} runs · {data.totalMinutes > 60 ? `${(data.totalMinutes/60).toFixed(1)} hrs` : `${data.totalMinutes} min`} · {(data as any).costPerMerge?.merged ? `${(data as any).costPerMerge.merged} merges` : 'no merges in window'} · {(data as any).globalWastedMinutes != null ? `waste ${comma((data as any).globalWastedMinutes)} min (${((data as any).globalWastedPct ?? 0).toFixed(0)}%)` : ''}
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground">Budget share per workflow in table ↓ · p99 tail drives cost · cost = totalMinutes / merges</div>
                </CardContent>
              </Card>

              <Card >
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Home vs GitHub</span>
                    <Server className="size-3.5 text-muted-foreground" />
                  </div>
                  <div className="mt-1 text-2xl font-semibold tabular-nums">
                    <span className="text-emerald-600 dark:text-emerald-400">{data.split.homePctRuns.toFixed(0)}%</span>
                    <span className="mx-1 text-muted-foreground text-lg">/</span>
                    <span className="text-slate-600 dark:text-slate-300">{data.split.githubPctRuns.toFixed(0)}%</span>
                    <span className="ml-2 text-xs font-normal text-muted-foreground">home / github</span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {comma(data.split.homeRuns)} home · {comma(data.split.githubRuns)} github {data.split.unknownRuns>0 ? `· ${data.split.unknownRuns} unknown` : ''} · {data.split.homePctMinutes.toFixed(0)}% of minutes on home
                  </div>
                  <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="bg-[var(--chart-2)]" style={{ width: `${data.split.homePctRuns}%` }} />
                    <div className="bg-[var(--chart-3)]" style={{ width: `${data.split.githubPctRuns}%` }} />
                    {data.split.unknownRuns>0 && <div className="bg-[var(--chart-5)]" style={{ width: `${(data.split.unknownRuns/data.split.totalRuns*100).toFixed(1)}%` }} />}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Pie + Trend row */}
            <div className="mt-4 grid gap-4 lg:grid-cols-3">
              <Card >
                <CardHeader className="pb-2">
                  <CardTitle className="text-base font-semibold">Runner split</CardTitle>
                  <p className="text-xs text-muted-foreground">{data.split.homeRuns} home · {data.split.githubRuns} github {data.split.unknownRuns>0 ? `· ${data.split.unknownRuns} unknown` : ''} · {data.repo} · {period}</p>
                </CardHeader>
                <CardContent>
                  {pieData.length === 0 ? (
                    <EmptyState text="No runs in period." />
                  ) : (
                    <>
                      <div className="relative">
                        <ChartContainer config={runnerConfig} className="aspect-square h-[220px] mx-auto">
                          <PieChart>
                            <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={56} outerRadius={88} paddingAngle={2} strokeWidth={0}>
                              {pieData.map((e: any) => (<Cell key={e.name} fill={e.fill} />))}
                            </Pie>
                            <ChartTooltip content={<PieTip />} />
                          </PieChart>
                        </ChartContainer>
                        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center" aria-hidden>
                          <div className="text-xl font-semibold tabular-nums">{data.split.homePctRuns.toFixed(0)}% <span className="text-xs font-normal text-muted-foreground">home (runs)</span></div>
                          <div className="text-[11px] text-muted-foreground">{comma(data.split.homeRuns)} runs · {comma(data.split.homeMinutes)} min</div>
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center justify-center gap-3 text-xs">
                        <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-[2px] bg-[var(--chart-2)]" />home {data.split.homePctRuns.toFixed(0)}% ({comma(data.split.homeRuns)})</span>
                        <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-[2px] bg-[var(--chart-3)]" />github {data.split.githubPctRuns.toFixed(0)}% ({comma(data.split.githubRuns)})</span>
                        {data.split.unknownRuns>0 && <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-[2px] bg-[var(--chart-5)]" />unknown {((data.split.unknownRuns/data.split.totalRuns)*100).toFixed(0)}%</span>}
                      </div>
                      <p className="mt-2 text-center text-[11px] text-muted-foreground">Home hosting started Aug 28, 2026 — runs before that are counted as GitHub. Home vs GitHub is inferred from the workflow name (heuristic, no jobs API yet). Unknown = empty workflow name.</p>
                    </>
                  )}
                </CardContent>
              </Card>

              <Card className="lg:col-span-2">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-base font-semibold">{gran === 'week' ? 'Weekly share of runs — home vs GitHub' : 'Monthly share of runs — home vs GitHub'}</CardTitle>
                      <p className="text-xs text-muted-foreground">{gran === 'week' ? 'Weekly' : 'Monthly'} share of runs · {data.trend.length} buckets · hover for counts · home hosting started Aug 28, 2026</p>
                    </div>
                    <Badge variant="outline" className="text-[10px]">{gran}</Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  {trendData.length === 0 ? (
                    <EmptyState text="No trend data for this period." />
                  ) : (
                    <ChartContainer config={trendConfig} className="h-[220px] w-full">
                      <AreaChart data={trendData} margin={{ left: 8, right: 8, top: 8, bottom: 0 }}>
                        <CartesianGrid vertical={false} strokeDasharray="3 3" />
                        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
                        <YAxis tickLine={false} axisLine={false} width={30} tickFormatter={(v: number) => `${v}%`} domain={[0, 100]} />
                        <ChartTooltip content={<TrendTip />} />
                        <Area type="monotone" dataKey="github" stackId="1" stroke="var(--chart-3)" fill="var(--chart-3)" fillOpacity={0.9} />
                        <Area type="monotone" dataKey="home" stackId="1" stroke="var(--chart-2)" fill="var(--chart-2)" fillOpacity={0.85} />
                        <Area type="monotone" dataKey="unknown" stackId="1" stroke="var(--chart-5)" fill="var(--chart-5)" fillOpacity={0.6} />
                      </AreaChart>
                    </ChartContainer>
                  )}
                  <p className="mt-2 text-[11px] text-muted-foreground">Home hosting started Aug 28, 2026 — earlier runs count as GitHub. Unknown (gray) appears only when a run has no workflow name. GitHub bottom, home middle, unknown top — 100% stacked.</p>
                </CardContent>
              </Card>
            </div>

            {/* Release tile row - show time-to-release alongside CI if available */}
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <Card >
                <CardContent className="p-4">
                  <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Time-to-release</div>
                  <div className="mt-1 text-xl font-semibold tabular-nums">
                    {data.release.count === 0 ? '—' : `${data.release.p50.toFixed(1)}d`}
                    {data.release.count > 0 && <span className="ml-2 text-sm font-normal text-muted-foreground">· p90 {data.release.p90.toFixed(1)}d</span>}
                  </div>
                  <div className="text-xs text-muted-foreground">{data.release.count === 0 ? 'No merges in window' : `n=${data.release.count} merges · ${data.release.windowDays}d window · avg ${data.release.avg?.toFixed(1)}d`}</div>
                  <div className="mt-1 text-[11px] text-muted-foreground">PR CreatedAt → MergedAt for same period/repo filters. Fast CI + slow release → review bottleneck.</div>
                </CardContent>
              </Card>
              <Card >
                <CardContent className="p-4">
                  <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Workflows</div>
                  <div className="mt-1 text-xl font-semibold tabular-nums">{data.workflows.length} <span className="text-sm font-normal text-muted-foreground">lanes</span></div>
                  <div className="text-xs text-muted-foreground">{slowCount} slow · {data.workflows.filter(w=>w.isSampleSmall).length} small (n&lt;10) · {data.workflows.filter(w=>w.hosting==='home').length} home · {data.workflows.filter(w=>w.hosting==='github').length} github</div>
                  <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="bg-[var(--chart-2)]" style={{ width: `${data.workflows.filter(w=>w.hosting==='home').length / Math.max(1,data.workflows.length) *100}%`}} title="home lanes" />
                    <div className="bg-[var(--chart-3)]" style={{ width: `${data.workflows.filter(w=>w.hosting==='github').length / Math.max(1,data.workflows.length) *100}%`}} />
                  </div>
                </CardContent>
              </Card>
              <Card >
                <CardContent className="p-4">
                  <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Budget insight</div>
                  <div className="mt-1 text-sm">
                    {(() => {
                      const top = [...data.workflows].sort((a,b)=>b.budgetSharePct - a.budgetSharePct)[0]
                      if (!top) return <span className="text-muted-foreground">—</span>
                      return <><span className="font-semibold">{top.workflow}</span> <span className="text-muted-foreground">consumes</span> <span className="font-semibold">{top.budgetSharePct.toFixed(1)}%</span> <span className="text-muted-foreground">of CI time ({fmtDuration(top.avgMin)} avg · {top.runs} runs)</span></>
                    })()}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">Largest budget share workflow — check p90 tail and queue median before moving lanes.</div>
                </CardContent>
              </Card>
            </div>

            {/* Budget, tail & queue distributions — top lanes by CI-time share */}
            {budgetTop.length > 0 ? (
              <Card className="mt-4">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base font-semibold">Where CI time goes</CardTitle>
                  <p className="text-xs text-muted-foreground">Top {budgetTop.length} lanes by budget share · bar = share of total CI minutes · red badge = over threshold (p50&gt;{tP50}m p90&gt;{tP90}m success&lt;85%)</p>
                </CardHeader>
                <CardContent className="flex flex-col gap-2.5">
                  {budgetTop.map((wf) => (
                    <div key={wf.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-sm font-medium" title={wf.workflow}>{wf.workflow}</span>
                        <HostingPill hosting={wf.hosting} />
                      </div>
                      <ThresholdBadge p50={wf.p50Min} p90={wf.p90Min} successRate={wf.successRate} tP50={tP50} tP90={tP90} />
                      <div className="col-span-2 h-2 overflow-hidden rounded-full bg-muted" title={`${wf.budgetSharePct.toFixed(1)}% of CI minutes`}>
                        <div className={cn('h-full', (wf.isSlow || wf.successRate < 85) ? 'bg-red-400' : 'bg-[var(--chart-2)]')} style={{ width: `${(wf.budgetSharePct / maxBudget) * 100}%` }} />
                      </div>
                      <div className="col-span-2 flex flex-wrap gap-x-3 text-[11px] tabular-nums text-muted-foreground">
                        <span>{wf.budgetSharePct.toFixed(1)}% budget</span>
                        <span>p50 {fmtDuration(wf.p50Min)}</span>
                        <span>p90 {fmtDuration(wf.p90Min)}</span>
                        {wf.p95Min ? <span>p95 {fmtDuration(wf.p95Min)}</span> : null}
                        <span>queue {wf.queueMedianMin ? fmtDuration(wf.queueMedianMin) : '—'}</span>
                        <span>{wf.successRate.toFixed(0)}% success · {comma(wf.runs)} runs</span>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ) : null}

            {/* Tail distribution — p50 → p90 → p95 stacked ranges per lane */}
            {tailTop.length > 0 ? (
              <Card className="mt-4">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base font-semibold">Tail distribution</CardTitle>
                  <p className="text-xs text-muted-foreground">Top {tailTop.length} lanes by p90 · stacked ranges p50 → p90 → p95 in minutes · long pale tail means outliers dominate the lane</p>
                </CardHeader>
                <CardContent>
                  <ChartContainer config={{ p50: { label: 'p50', color: 'var(--chart-1)' }, d90: { label: 'p50–p90', color: 'var(--chart-2)' }, d95: { label: 'p90–p95', color: 'var(--chart-5)' } }} className="h-[300px] w-full">
                    <BarChart data={tailTop} layout="vertical" margin={{ left: 8, right: 12, top: 4, bottom: 4 }}>
                      <CartesianGrid horizontal={false} />
                      <XAxis type="number" tickLine={false} axisLine={false} tickMargin={8} domain={[0, maxTail]} tickFormatter={(v: number) => `${Math.round(v)}m`} />
                      <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} tickMargin={8} width={130} tick={{ fontSize: 11 }} />
                      <ChartTooltip cursor={{ fill: 'var(--muted)' }} content={<TailTip />} />
                      <Bar dataKey="p50" stackId="tail" fill="var(--color-p50)" radius={[3, 0, 0, 3]} />
                      <Bar dataKey="d90" stackId="tail" fill="var(--color-d90)" />
                      <Bar dataKey="d95" stackId="tail" fill="var(--color-d95)" radius={[0, 3, 3, 0]} />
                    </BarChart>
                  </ChartContainer>
                </CardContent>
              </Card>
            ) : null}

            {/* Needs Attention — FLAKY full */}
            {(() => {
              const needs = (data as any).needsAttention as WorkflowHybrid[] | undefined
              const hasNeeds = Array.isArray(needs) && needs.length > 0
              return (
                <Card className={hasNeeds ? "mt-4  border-amber-200 dark:border-amber-900 bg-amber-50/40 dark:bg-amber-950/10" : "mt-4 "} role="region" aria-label="Workflows needing attention">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base font-semibold flex items-center gap-2">
                        <span className={hasNeeds ? "size-2.5 rounded-full bg-amber-500" : "size-2.5 rounded-full bg-green-500"} aria-hidden />
                        Needs attention
                        {hasNeeds ? <Badge variant="destructive" className="px-1.5 py-0 text-[10px]">{needs!.length}</Badge> : <Badge variant="secondary" className="px-1.5 py-0 text-[10px] bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-200">0</Badge>}
                      </CardTitle>
                      <span className="text-[11px] text-muted-foreground">flaky ≥15% · fail ≥20% · MTTR ≥2h · waste ≥25% · n≥10</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{hasNeeds ? `${needs!.length} of ${data.workflows.length} workflows need attention — honest, not auto-hidden. Flaky = failure→success within 24h / failures.` : "All stable — no workflow meets attention threshold (flake ≥15%, fail ≥20%, MTTR ≥2h, waste ≥25%)."}</p>
                  </CardHeader>
                  <CardContent>
                    {hasNeeds ? (
                      <div className="space-y-2">
                        {needs!.map((w) => {
                          const flakeRed = w.flakeScore >= 30
                          const flakeAmber = !flakeRed && w.flakeScore >= 15
                          const failRed = w.failureRate >= 20
                          const mttrWarn = w.mttrMedianMin >= 120
                          return (
                            <div key={w.key} className="flex flex-wrap items-center gap-2 rounded-md border bg-background px-3 py-2 text-xs">
                              <span className="font-medium truncate max-w-[160px]" title={w.workflow}>{w.workflow}</span>
                              <span className="text-muted-foreground truncate max-w-[100px]" title={w.repo}>{w.repo}</span>
                              <HostingPill hosting={w.hosting} />
                              <Badge variant={flakeRed ? "destructive" : flakeAmber ? "secondary" : "outline"} className={flakeRed ? "px-1.5 py-0 text-[10px]" : flakeAmber ? "px-1.5 py-0 text-[10px] bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200" : "px-1.5 py-0 text-[10px]"}>flake {w.flakeScore.toFixed(1)}%{w.flaky ? ` (${w.flaky})` : ''}</Badge>
                              <Badge variant={failRed ? "destructive" : "outline"} className="px-1.5 py-0 text-[10px]">fail {w.failureRate.toFixed(1)}% · {w.successRate.toFixed(0)}% success</Badge>
                              <span className="tabular-nums">p50 {fmtDuration(w.p50Min)} · p90 {fmtDuration(w.p90Min)}{w.p95Min ? ` · p95 ${fmtDuration(w.p95Min)}` : ''}</span>
                              <span className={mttrWarn ? "text-amber-600 dark:text-amber-400 tabular-nums" : "tabular-nums text-muted-foreground"}>MTTR {w.mttrMedianMin ? fmtDuration(w.mttrMedianMin) : '—'}{w.mttrCount ? ` · n=${w.mttrCount}` : ''}</span>
                              <span className={w.wastedPct >= 25 ? "text-red-600 dark:text-red-400 tabular-nums" : "tabular-nums text-muted-foreground"}>waste {comma(w.wastedMinutes)} min ({w.wastedPct.toFixed(0)}%)</span>
                              <span className="ml-auto text-[11px] text-muted-foreground">{w.runs} runs · {w.budgetSharePct.toFixed(1)}% budget · queue {w.queueMedianMin ? fmtDuration(w.queueMedianMin) : '—'}</span>
                            </div>
                          )
                        })}
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground">Thresholds are one-line tuning in api.go (needs: flake 15, fail 20, MTTR 120, waste 25%). All workflows below thresholds in this period.</div>
                    )}
                  </CardContent>
                </Card>
              )
            })()}

            {/* Per-workflow big-number strip (slow-first 6) */}
            <div className="mt-6">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold">Per-workflow lane health — big numbers, red if &gt; threshold</h2>
                <span className="text-xs text-muted-foreground">{data.workflows.length} workflows · thresholds p50&gt;{tP50}m p90&gt;{tP90}m success&lt;85% · n&lt;10 dimmed</span>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {data.workflows.slice(0, 6).map((wf) => {
                  const red = wf.isSlow || wf.successRate < 85
                  const dim = wf.isSampleSmall
                  return (
                    <Card key={wf.key} className={cn(red ? 'border-red-200 dark:border-red-900' : '', dim && 'opacity-60')}>
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate text-base font-semibold" title={wf.workflow}>{wf.workflow}</div>
                            <div className="text-[11px] text-muted-foreground truncate">{wf.repo} · {wf.runs} runs · {wf.successRate.toFixed(0)}% success</div>
                          </div>
                          <HostingPill hosting={wf.hosting} />
                        </div>
                        <div className={cn('mt-2 flex items-baseline gap-2 text-xl font-semibold tabular-nums', red ? 'text-red-600 dark:text-red-400' : '')}>
                          <span>{wf.p50Min.toFixed(1)}m</span>
                          <span className="text-sm font-normal text-muted-foreground">p50 · p90 {wf.p90Min.toFixed(1)}m</span>
                          <span className="ml-auto"><ThresholdBadge p50={wf.p50Min} p90={wf.p90Min} successRate={wf.successRate} tP50={tP50} tP90={tP90} /></span>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">avg {fmtDuration(wf.avgMin)} · p99 {fmtDuration(wf.p99Min)} · p95 {wf.p95Min ? fmtDuration(wf.p95Min) : '—'} · queue {wf.queueMedianMin ? fmtDuration(wf.queueMedianMin) : '—'} · budget {wf.budgetSharePct.toFixed(1)}%</div>
                        <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
                          <Badge variant={wf.flakeScore >= 15 ? "destructive" : "secondary"} className={wf.flakeScore >= 15 ? "px-1 py-0 text-[10px]" : "px-1 py-0 text-[10px] bg-muted text-muted-foreground"}>flake {wf.flakeScore.toFixed(0)}%{wf.flaky ? `:${wf.flaky}` : ''}</Badge>
                          <Badge variant="outline" className="px-1 py-0 text-[10px]">MTTR {wf.mttrMedianMin ? fmtDuration(wf.mttrMedianMin) : '—'}</Badge>
                          <Badge variant={wf.wastedPct >= 25 ? "destructive" : "secondary"} className={wf.wastedPct >= 25 ? "px-1 py-0 text-[10px]" : "px-1 py-0 text-[10px] bg-muted text-muted-foreground"}>waste {wf.wastedPct.toFixed(0)}% · {comma(wf.wastedMinutes)}m</Badge>
                        </div>
                        <div className="mt-2 flex h-1 overflow-hidden rounded-full bg-muted">
                          <div className="bg-[var(--chart-2)]" style={{ width: `${(wf.homeRuns / Math.max(1, wf.runs) * 100)}%` }} />
                          <div className="bg-[var(--chart-3)]" style={{ width: `${(wf.githubRuns / Math.max(1, wf.runs) * 100)}%` }} />
                          {wf.unknownRuns>0 && <div className="bg-[var(--chart-5)]" style={{ width: `${(wf.unknownRuns / Math.max(1, wf.runs) * 100)}%` }} />}
                        </div>
                        <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
                          <span>{wf.homeRuns} home · {wf.githubRuns} github</span>
                          <span>Δ {wf.deltaMin !== 0 ? `${wf.deltaMin > 0 ? '+' : ''}${wf.deltaMin.toFixed(1)}m` : '—'} vs {wf.hosting === 'home' ? 'github' : 'home'}</span>
                        </div>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
              {data.workflows.length > 6 && (
                <div className="mt-2 text-center text-xs text-muted-foreground">+ {data.workflows.length - 6} more in table below ↓</div>
              )}
            </div>

            {/* Per-workflow table */}
            <div className="mt-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-semibold">Lanes — detailed</h2>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <input type="checkbox" checked={hideSmall} onChange={(e) => setHideSmall(e.target.checked)} className="size-3.5" />
                    Hide n&lt;10
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <input type="checkbox" checked={onlySlow} onChange={(e) => setOnlySlow(e.target.checked)} className="size-3.5" />
                    Only slow / &lt;85%
                  </label>
                  <span className="text-xs text-muted-foreground">{filteredWorkflows.length}/{data.workflows.length} shown</span>
                </div>
              </div>

              <Card className="mt-3 overflow-hidden ">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10">Health</TableHead>
                        <TableHead>Workflow</TableHead>
                        <TableHead>Hosting</TableHead>
                        <TableHead className="cursor-pointer select-none" onClick={() => handleSort('runs')}>Runs {sortKey.key==='runs' ? (sortKey.dir==='desc'?'↓':'↑') : ''}</TableHead>
                        <TableHead className="cursor-pointer select-none" onClick={() => handleSort('p50')}>p50 {sortKey.key==='p50' ? (sortKey.dir==='desc'?'↓':'↑') : ''}</TableHead>
                        <TableHead className="cursor-pointer select-none" onClick={() => handleSort('p90')}>p90 {sortKey.key==='p90' ? (sortKey.dir==='desc'?'↓':'↑') : ''}</TableHead>
                        <TableHead className="cursor-pointer select-none" onClick={() => handleSort('p99')}>p99 {sortKey.key==='p99' ? (sortKey.dir==='desc'?'↓':'↑') : ''}</TableHead>
                        <TableHead className="cursor-pointer select-none" onClick={() => handleSort('p95')}>p95 {sortKey.key==='p95' ? (sortKey.dir==='desc'?'↓':'↑') : ''}</TableHead>
                        <TableHead className="cursor-pointer select-none" onClick={() => handleSort('successRate')}>Success% {sortKey.key==='successRate' ? (sortKey.dir==='desc'?'↓':'↑') : ''}</TableHead>
                        <TableHead className="cursor-pointer select-none" onClick={() => handleSort('flake')}>Flake% {sortKey.key==='flake' ? (sortKey.dir==='desc'?'↓':'↑') : ''}</TableHead>
                        <TableHead className="cursor-pointer select-none" onClick={() => handleSort('mttr')}>MTTR {sortKey.key==='mttr' ? (sortKey.dir==='desc'?'↓':'↑') : ''}</TableHead>
                        <TableHead className="cursor-pointer select-none" onClick={() => handleSort('wasted')}>Wasted {sortKey.key==='wasted' ? (sortKey.dir==='desc'?'↓':'↑') : ''}</TableHead>
                        <TableHead className="cursor-pointer select-none" onClick={() => handleSort('queue')}>Queue {sortKey.key==='queue' ? (sortKey.dir==='desc'?'↓':'↑') : ''}</TableHead>
                        <TableHead className="cursor-pointer select-none" onClick={() => handleSort('budget')}>Budget {sortKey.key==='budget' ? (sortKey.dir==='desc'?'↓':'↑') : ''}</TableHead>
                        <TableHead>Hosting split</TableHead>
                        <TableHead className="cursor-pointer select-none" onClick={() => handleSort('delta')}>Δ {sortKey.key==='delta' ? (sortKey.dir==='desc'?'↓':'↑') : ''}</TableHead>
                        <TableHead className="cursor-pointer select-none" onClick={() => handleSort('lastRun')}>Last run {sortKey.key==='lastRun' ? (sortKey.dir==='desc'?'↓':'↑') : ''}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredWorkflows.length === 0 ? (
                        <TableRow><TableCell colSpan={17} className="py-10 text-center text-sm text-muted-foreground">No workflows match filters.</TableCell></TableRow>
                      ) : (
                        filteredWorkflows.map((wf) => {
                          const red = wf.isSlow || wf.successRate < 85
                          return (
                            <TableRow key={wf.key} className={cn(wf.isSampleSmall && 'opacity-60', red && 'bg-red-50/40 dark:bg-red-950/10')}>
                              <TableCell><HealthDot wf={wf} /></TableCell>
                              <TableCell className="max-w-[180px]">
                                <div className="truncate font-medium text-xs" title={wf.workflow}>{wf.workflow}</div>
                                <div className="truncate text-[11px] text-muted-foreground" title={wf.repo}>{wf.repo}</div>
                              </TableCell>
                              <TableCell><HostingPill hosting={wf.hosting} /></TableCell>
                              <TableCell className="tabular-nums text-xs">{comma(wf.runs)}</TableCell>
                              <TableCell className={cn('tabular-nums text-xs', wf.p50Min > 10 ? 'text-red-600 dark:text-red-400 font-medium' : '')}>{fmtDuration(wf.p50Min)}</TableCell>
                              <TableCell className={cn('tabular-nums text-xs', wf.p90Min > 25 ? 'text-red-600 dark:text-red-400 font-medium' : '')}>{fmtDuration(wf.p90Min)}</TableCell>
                              <TableCell className="tabular-nums text-xs">{fmtDuration(wf.p99Min)}</TableCell>
                              <TableCell className={cn('tabular-nums text-xs', (wf as any).p95Min > 25 ? 'text-red-600 dark:text-red-400 font-medium' : '')}>{(wf as any).p95Min ? fmtDuration((wf as any).p95Min) : '—'}</TableCell>
                              <TableCell className={cn('tabular-nums text-xs', wf.successRate < 85 ? 'text-red-600 dark:text-red-400 font-medium' : wf.successRate < 92 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400')}>
                                {wf.successRate.toFixed(0)}%
                              </TableCell>
                              <TableCell className="tabular-nums text-xs">{wf.flakeScore.toFixed(0)}%{wf.flaky>0 ? ` (${wf.flaky})` : ''}</TableCell>
                              <TableCell className={cn('tabular-nums text-xs', (wf as any).mttrMedianMin >= 120 ? 'text-amber-600 dark:text-amber-400 font-medium' : '')}>{(wf as any).mttrMedianMin ? fmtDuration((wf as any).mttrMedianMin) : '—'}{(wf as any).mttrCount ? ` · ${(wf as any).mttrCount}` : ''}</TableCell>
                              <TableCell className={cn('tabular-nums text-xs', (wf as any).wastedPct >= 25 ? 'text-red-600 dark:text-red-400 font-medium' : (wf as any).wastedPct >= 10 ? 'text-amber-600 dark:text-amber-400' : '')}>{comma((wf as any).wastedMinutes ?? 0)}<span className="text-muted-foreground"> · {((wf as any).wastedPct ?? 0).toFixed(0)}%</span></TableCell>
                              <TableCell className="tabular-nums text-xs">{wf.queueMedianMin ? fmtDuration(wf.queueMedianMin) : '—'}</TableCell>
                              <TableCell className="tabular-nums text-xs">{wf.budgetSharePct.toFixed(1)}%</TableCell>
                              <TableCell><HostSplitBar home={wf.homeRuns} github={wf.githubRuns} unknown={wf.unknownRuns} /></TableCell>
                              <TableCell className={cn('tabular-nums text-xs', wf.deltaMin < 0 ? 'text-emerald-600 dark:text-emerald-400' : wf.deltaMin > 3 ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground')}>
                                {wf.deltaMin === 0 ? '—' : `${wf.deltaMin > 0 ? '+' : ''}${wf.deltaMin.toFixed(1)}m`}
                              </TableCell>
                              <TableCell className="text-xs tabular-nums">
                                <span title={wf.lastRunAt ?? ''}>{wf.lastRunAt ? timeAgo(wf.lastRunAt) : '—'}</span>
                                {wf.lastConclusion && (
                                  <span className="ml-1 inline-flex align-middle">
                                    {wf.lastConclusion === 'success' ? <CheckCircle2 className="size-3 text-emerald-500" /> : wf.lastConclusion === 'failure' ? <XCircle className="size-3 text-red-500" /> : <Clock3 className="size-3 text-muted-foreground" />}
                                  </span>
                                )}
                              </TableCell>
                            </TableRow>
                          )
                        })
                      )}
                    </TableBody>
                  </Table>
                </div>
                <div className="border-t bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
                  Health red if p50&gt;10m or p90&gt;25m or success&lt;85% · Watch if p50&gt;8m or p90&gt;20m or success&lt;90% · Hosting: workflow name contains self-hosted/hybrid/home → home (live since Aug 28, 2026; earlier runs count as GitHub) · Queue = RunStartedAt − CreatedAt median · Flake = failure→success within 24h / failures · MTTR = median recovery to next success · Wasted = failure minutes / total · Budget = workflow minutes / total minutes · Δ = workflow p50 − opposite lane global p50 (negative = home faster) · Cost = totalMinutes / merges
                </div>
              </Card>
            </div>

            <div className="mt-6 text-center text-[11px] text-muted-foreground">
              CI data derived from <code className="rounded bg-muted px-1 py-0.5">store.go:Data {`{ Pulls []Pull; Runs []Run }`}</code> — no new sync, heuristic RunnerGroup at read time, jobs API enrichment pending. Pie runs vs minutes tooltip + 100% stacked trend show placement; p50/p90 red thresholds are one-line tuning (<code>P50ThresholdMin=10 P90ThresholdMin=25</code>).
            </div>
          </div>
        </div>
      ) : null}
    </TooltipProvider>
  )
}
