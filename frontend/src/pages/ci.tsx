import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Area,
  AreaChart,
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

function ThresholdBadge({ p50, p90, successRate }: { p50: number; p90: number; successRate?: number }) {
  const slow = p50 > 10 || p90 > 25 || (successRate !== undefined && successRate < 85)
  const watch = !slow && (p50 > 8 || p90 > 20 || (successRate !== undefined && successRate < 90))
  if (slow) return <Badge variant="destructive" className="px-1.5 py-0 text-[10px]">Slow</Badge>
  if (watch) return <Badge variant="secondary" className="px-1.5 py-0 text-[10px] bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200">Watch</Badge>
  return <Badge variant="secondary" className="px-1.5 py-0 text-[10px] bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-200">Healthy</Badge>
}

function HealthDot({ wf }: { wf: WorkflowHybrid }) {
  const slow = wf.isSlow || wf.successRate < 85
  const watch = !slow && (wf.p50Min > 8 || wf.p90Min > 20 || wf.successRate < 92)
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
  const totalEntry = rows.find((r) => r.dataKey === 'home' || r.dataKey === 'github')
  const total = totalEntry?.payload as CIRunnerBucket | undefined
  return (
    <TipShell label={label}>
      {rows.map((entry) => {
        const key = String(entry.dataKey)
        const val = Number(entry.value ?? 0)
        const col = getPayloadColor(entry) ?? (key === 'home' ? 'var(--chart-2)' : key === 'github' ? 'var(--chart-3)' : 'var(--chart-5)')
        const countVal = total ? (key === 'home' ? total.home : key === 'github' ? total.github : total.unknown) : 0
        return <TipRow key={key} color={col} label={key} value={`${val.toFixed(0)}% (${comma(countVal)} runs)`} />
      })}
      {total ? (
        <div className="flex items-center justify-between gap-4 border-t border-border/50 pt-1.5">
          <span className="text-muted-foreground">Total</span>
          <span className="font-mono font-medium tabular-nums">{comma(total.total)} runs · {comma(total.totalMinutes)} min</span>
        </div>
      ) : null}
      <div className="text-[11px] text-muted-foreground">github bottom · home top · 100% stacked</div>
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

export default function CIPage() {
  const [searchParams, setSearchParams] = useSearchParams()
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
        case 'p99': return dir * (a.p99Min - b.p99Min)
        case 'successRate': return dir * (a.successRate - b.successRate)
        case 'flake': return dir * (a.flakeScore - b.flakeScore)
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
    if (s.unknownRuns > 0) rows.push({ name: 'unknown', value: s.unknownRuns, runs: s.unknownRuns, minutes: 0, pct: s.unknownRuns / s.totalRuns * 100, fill: 'var(--chart-5)' })
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

  const handleSort = (k: string) => {
    setSortKey((s) => (s.key === k ? { key: k, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key: k, dir: 'desc' }))
  }

  const org = status?.org

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
            {Array.from({ length: 4 }).map((_, i) => (<Skeleton key={i} className="h-[84px] w-full rounded-[6px]" />))}
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <Skeleton className="h-[260px] w-full rounded-[6px]" />
            <Skeleton className="h-[260px] w-full rounded-[6px] lg:col-span-2" />
          </div>
          <Skeleton className="h-[360px] w-full rounded-[6px]" />
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
              <Card className={cn('rounded-[6px]', overall && (overall.p50 > 10 ? 'border-red-200 dark:border-red-900' : ''))}>
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

              <Card className={cn('rounded-[6px]', overall && overall.p90 > 25 ? 'border-red-200 dark:border-red-900' : '')}>
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
                    Δ home vs github {data.deltaHomeVsGithub != null ? `${data.deltaHomeVsGithub > 0 ? '+' : ''}${data.deltaHomeVsGithub.toFixed(1)} min` : '—'} {data.deltaHomeVsGithub < 0 ? '· home faster' : data.deltaHomeVsGithub > 0 ? '· home slower' : ''}
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-[6px]">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Total cost</span>
                    <Clock3 className="size-3.5 text-muted-foreground" />
                  </div>
                  <div className="mt-1 text-2xl font-semibold tabular-nums">{comma(data.totalMinutes)} <span className="text-sm font-normal text-muted-foreground">min</span></div>
                  <div className="mt-1 text-xs text-muted-foreground">{data.totalRuns} runs · {data.totalMinutes > 60 ? `${(data.totalMinutes/60).toFixed(1)} hrs` : `${data.totalMinutes} min`} · approx cost @{org ? `${org}/gaia` : ''}</div>
                  <div className="mt-1 text-[11px] text-muted-foreground">Budget share per workflow in table ↓ · p99 tail drives cost</div>
                </CardContent>
              </Card>

              <Card className="rounded-[6px]">
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
              <Card className="rounded-[6px]">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold">Runner split</CardTitle>
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
                          <div className="text-xl font-semibold tabular-nums">{data.split.homePctRuns.toFixed(0)}% <span className="text-xs font-normal text-muted-foreground">home</span></div>
                          <div className="text-[11px] text-muted-foreground">{data.split.homePctMinutes.toFixed(0)}% of minutes</div>
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center justify-center gap-3 text-xs">
                        <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-[2px] bg-[var(--chart-2)]" />home {data.split.homePctRuns.toFixed(0)}% ({comma(data.split.homeRuns)})</span>
                        <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-[2px] bg-[var(--chart-3)]" />github {data.split.githubPctRuns.toFixed(0)}% ({comma(data.split.githubRuns)})</span>
                        {data.split.unknownRuns>0 && <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-[2px] bg-[var(--chart-5)]" />unknown {((data.split.unknownRuns/data.split.totalRuns)*100).toFixed(0)}%</span>}
                      </div>
                      <p className="mt-2 text-center text-[11px] text-muted-foreground">Inferred via workflow name substring allowlist (heuristic, no jobs API yet). Unknown = empty workflow.</p>
                    </>
                  )}
                </CardContent>
              </Card>

              <Card className="rounded-[6px] lg:col-span-2">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-sm font-semibold">Stacked 100% area — github bottom · home top</CardTitle>
                      <p className="text-xs text-muted-foreground">{gran === 'week' ? 'Weekly' : 'Monthly'} share of runs · {data.trend.length} buckets · hover for counts</p>
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
                        <Area type="monotone" dataKey="github" stackId="1" stroke="var(--color-github)" fill="var(--color-github)" fillOpacity={0.9} />
                        <Area type="monotone" dataKey="home" stackId="1" stroke="var(--color-home)" fill="var(--color-home)" fillOpacity={0.85} />
                        {data.trend.some(b => b.unknown > 0) && (
                          <Area type="monotone" dataKey="unknown" stackId="1" stroke="var(--color-unknown)" fill="var(--color-unknown)" fillOpacity={0.6} />
                        )}
                      </AreaChart>
                    </ChartContainer>
                  )}
                  <p className="mt-2 text-[11px] text-muted-foreground">100% stacked — share per {gran} bucket. GitHub at bottom, home on top. Unknown gray when &gt;0. Source: heuristic RunnerGroup per Run.</p>
                </CardContent>
              </Card>
            </div>

            {/* Release tile row - show time-to-release alongside CI if available */}
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <Card className="rounded-[6px]">
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
              <Card className="rounded-[6px]">
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
              <Card className="rounded-[6px]">
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

            {/* Per-workflow big-number strip (slow-first 6) */}
            <div className="mt-6">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">Per-workflow lane health — big numbers, red if &gt; threshold</h2>
                <span className="text-xs text-muted-foreground">{data.workflows.length} workflows · thresholds p50&gt;10m p90&gt;25m success&lt;85% · n&lt;10 dimmed</span>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {data.workflows.slice(0, 6).map((wf) => {
                  const red = wf.isSlow || wf.successRate < 85
                  const dim = wf.isSampleSmall
                  return (
                    <Card key={wf.key} className={cn('rounded-[6px]', red ? 'border-red-200 dark:border-red-900' : '', dim && 'opacity-60')}>
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium" title={wf.workflow}>{wf.workflow}</div>
                            <div className="text-[11px] text-muted-foreground truncate">{wf.repo} · {wf.runs} runs · {wf.successRate.toFixed(0)}% success</div>
                          </div>
                          <HostingPill hosting={wf.hosting} />
                        </div>
                        <div className={cn('mt-2 flex items-baseline gap-2 text-xl font-semibold tabular-nums', red ? 'text-red-600 dark:text-red-400' : '')}>
                          <span>{wf.p50Min.toFixed(1)}m</span>
                          <span className="text-sm font-normal text-muted-foreground">p50 · p90 {wf.p90Min.toFixed(1)}m</span>
                          <span className="ml-auto"><ThresholdBadge p50={wf.p50Min} p90={wf.p90Min} successRate={wf.successRate} /></span>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">avg {fmtDuration(wf.avgMin)} · p99 {fmtDuration(wf.p99Min)} · queue {wf.queueMedianMin ? fmtDuration(wf.queueMedianMin) : '—'} · budget {wf.budgetSharePct.toFixed(1)}%</div>
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
                <h2 className="text-sm font-semibold">Lanes — detailed</h2>
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

              <Card className="mt-3 overflow-hidden rounded-[6px]">
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
                        <TableHead className="cursor-pointer select-none" onClick={() => handleSort('successRate')}>Success% {sortKey.key==='successRate' ? (sortKey.dir==='desc'?'↓':'↑') : ''}</TableHead>
                        <TableHead className="cursor-pointer select-none" onClick={() => handleSort('flake')}>Flake% {sortKey.key==='flake' ? (sortKey.dir==='desc'?'↓':'↑') : ''}</TableHead>
                        <TableHead className="cursor-pointer select-none" onClick={() => handleSort('queue')}>Queue {sortKey.key==='queue' ? (sortKey.dir==='desc'?'↓':'↑') : ''}</TableHead>
                        <TableHead className="cursor-pointer select-none" onClick={() => handleSort('budget')}>Budget {sortKey.key==='budget' ? (sortKey.dir==='desc'?'↓':'↑') : ''}</TableHead>
                        <TableHead>Hosting split</TableHead>
                        <TableHead className="cursor-pointer select-none" onClick={() => handleSort('delta')}>Δ {sortKey.key==='delta' ? (sortKey.dir==='desc'?'↓':'↑') : ''}</TableHead>
                        <TableHead className="cursor-pointer select-none" onClick={() => handleSort('lastRun')}>Last run {sortKey.key==='lastRun' ? (sortKey.dir==='desc'?'↓':'↑') : ''}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredWorkflows.length === 0 ? (
                        <TableRow><TableCell colSpan={14} className="py-10 text-center text-sm text-muted-foreground">No workflows match filters.</TableCell></TableRow>
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
                              <TableCell className={cn('tabular-nums text-xs', wf.successRate < 85 ? 'text-red-600 dark:text-red-400 font-medium' : wf.successRate < 92 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400')}>
                                {wf.successRate.toFixed(0)}%
                              </TableCell>
                              <TableCell className="tabular-nums text-xs">{wf.flakeScore.toFixed(0)}%{wf.flaky>0 ? ` (${wf.flaky})` : ''}</TableCell>
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
                  Health red if p50&gt;10m or p90&gt;25m or success&lt;85% · Hosting inferred via substring allowlist (lint,test,build,quality,mutation,trivy,docker,integration,e2e,unit,hybrid,home → home) · Queue = RunStartedAt − CreatedAt median · Flake = failure→success within 24h / failures · Budget = workflow minutes / total minutes · Δ = workflow p50 − opposite lane global p50 (negative = home faster)
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
