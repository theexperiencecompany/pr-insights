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
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
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

// Semantic PR types — conventional commits palette (Primer + chart tokens)
const SEM_TYPES = ["feat","fix","chore","docs","style","refactor","perf","test","build","ci","revert","other"] as const
const SEM_COLORS: Record<string, string> = {
  feat: "var(--chart-1)",
  fix: "var(--chart-2)",
  chore: "#0969da",
  docs: "var(--chart-3)",
  style: "var(--chart-5)",
  refactor: "#cf222e",
  perf: "#8250df",
  test: "#bf8700",
  build: "#6639ba",
  ci: "#1f883d",
  revert: "#82071e",
  other: "var(--muted-foreground)",
}
const semanticPieConfig = SEM_TYPES.reduce((acc, t) => {
  acc[t as string] = { label: t, color: SEM_COLORS[t] ?? "var(--chart-1)" }
  return acc
}, {} as ChartConfig)
const semanticAreaConfig = { ...semanticPieConfig } satisfies ChartConfig

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="text-sm font-semibold">{children}</div>
}

// Dense one-line stat strip: value + label in a single bordered row.
function StatStrip({ data }: { data: OverviewData }) {
  const cells: { label: string; value: string; className?: string }[] = [
    { label: 'Pull requests', value: comma(data.stats.total) },
    { label: 'Merged', value: comma(data.stats.merged), className: 'text-purple-600 dark:text-purple-400' },
    { label: 'Open', value: comma(data.stats.open), className: 'text-green-600 dark:text-green-400' },
    { label: 'Contributors', value: comma(data.contributors) },
    { label: 'Lines added', value: compact(data.stats.additions), className: 'text-green-600 dark:text-green-400' },
    { label: 'Lines deleted', value: compact(data.stats.deletions), className: 'text-red-600 dark:text-red-400' },
    { label: 'Avg PR size', value: comma(Math.round(data.stats.avgDiff)) },
    { label: 'Files changed', value: comma(data.stats.files) },
  ]
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[6px] border border-border bg-border sm:grid-cols-4 xl:grid-cols-8">
      {cells.map((c) => (
        <div key={c.label} className="flex flex-col gap-0.5 bg-card px-3 py-2">
          <span className={cn('text-base font-semibold leading-tight tabular-nums', c.className)}>
            {c.value}
          </span>
          <span className="text-[11px] leading-tight text-muted-foreground">{c.label}</span>
        </div>
      ))}
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
                <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={52} outerRadius={88} paddingAngle={1}>
                  {pieData.map((entry) => (
                    <Cell key={entry.name} fill={SEM_COLORS[entry.name] ?? "var(--chart-1)"} stroke="var(--background)" strokeWidth={1} />
                  ))}
                </Pie>
                <ChartLegend content={<ChartLegendContent nameKey="name" />} />
              </PieChart>
            </ChartContainer>
            <div className="mt-2 flex flex-wrap justify-center gap-1.5">
              {byType.map((s) => (
                <span key={s.type} className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium">
                  <span className="inline-block size-2 rounded-full" style={{ background: SEM_COLORS[s.type] ?? "var(--chart-1)" }} />
                  {s.type} {comma(s.count)} ({s.percent.toFixed(1)}%)
                </span>
              ))}
            </div>
          </div>
          {/* Stacked 100% area */}
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-2 text-center">Evolution (stacked 100% area)</div>
            <ChartContainer config={semanticAreaConfig} className="h-[260px] w-full">
              <AreaChart data={areaData} stackOffset="expand" margin={{ left: 12, right: 12, top: 4 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={16} interval="preserveStartEnd" />
                <YAxis tickLine={false} axisLine={false} tickMargin={8} width={30} tickFormatter={(v: number) => `${Math.round(v * 100)}%`} domain={[0, 1]} />
                <ChartTooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null
                    const row = payload[0]?.payload as Record<string, number> | undefined
                    const t = row?.total as number ?? 0
                    return (
                      <div className="grid min-w-40 gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
                        <div className="font-medium">{String(label)} · {comma(t)} PRs</div>
                        {SEM_TYPES.filter((k) => (row?.[k] as number) > 0)
                          .sort((a, b) => (row?.[b] as number) - (row?.[a] as number))
                          .map((k) => {
                            const v = (row?.[k] as number) ?? 0
                            const pct = t > 0 ? (v / t) * 100 : 0
                            return (
                              <div key={k} className="flex items-center justify-between gap-4">
                                <span className="flex items-center gap-1.5">
                                  <span className="size-2 rounded-[2px]" style={{ background: SEM_COLORS[k] ?? "var(--chart-1)" }} />
                                  <span className="text-muted-foreground">{k}</span>
                                </span>
                                <span className="font-mono font-medium tabular-nums">
                                  {comma(v)} · {pct.toFixed(0)}%
                                </span>
                              </div>
                            )
                          })}
                      </div>
                    )
                  }}
                />
                {SEM_TYPES.filter((t) => byType.some((b) => b.type === t)).map((t) => (
                  <Area key={t} type="monotone" dataKey={t} stackId="1" stroke={SEM_COLORS[t] ?? "var(--chart-1)"} fill={SEM_COLORS[t] ?? "var(--chart-1)"} fillOpacity={0.85} strokeWidth={1} />
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
              <ChartTooltip
                cursor={{ fill: 'var(--muted)' }}
                content={<ChartTooltipContent formatter={(v) => `${comma(Number(v))} merged`} />}
              />
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
              <ChartTooltip
                cursor={{ fill: 'var(--muted)' }}
                content={<ChartTooltipContent formatter={(v) => `${comma(Number(v))} merged`} />}
              />
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
      <StatStrip data={data} />

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
              <AreaChart data={data.monthly} margin={{ left: 4, right: 4, top: 4 }}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  minTickGap={isWeek ? 24 : 16}
                  interval="preserveStartEnd"
                  tickFormatter={weeklyTickFormatter}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  width={40}
                  tickFormatter={(v) => compact(Number(v))}
                />
                <ChartTooltip
                  cursor={{ stroke: 'var(--border)' }}
                  content={
                    <ChartTooltipContent formatter={(value) => `${comma(Number(value))} PRs`} />
                  }
                />
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
                  <Brush dataKey="label" height={20} stroke="var(--chart-1)" travellerWidth={8} onChange={handleBrushChange} />
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
              <BarChart data={data.monthly} margin={{ left: 4, right: 4, top: 4 }}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  minTickGap={isWeek ? 24 : 16}
                  interval="preserveStartEnd"
                  tickFormatter={weeklyTickFormatter}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  width={40}
                  tickFormatter={(v) => compact(Number(v))}
                />
                <ChartTooltip cursor={{ fill: 'var(--muted)' }} content={<ChartTooltipContent />} />
                {yearBoundaries.map((x) => (
                  <ReferenceLine key={x} x={x} stroke="var(--border)" strokeDasharray="3 3" />
                ))}
                <Bar dataKey="additions" stackId="lines" fill="var(--color-additions)" />
                <Bar dataKey="deletions" stackId="lines" fill="var(--color-deletions)" />
                <ChartLegend content={<ChartLegendContent />} />
                {hasBrush ? (
                  <Brush dataKey="label" height={20} stroke="var(--chart-1)" travellerWidth={8} onChange={handleBrushChange} />
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
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <SectionTitle>Activity · 365d · {comma(data.heatmap.reduce((s, d) => s + d.merged, 0))} merges</SectionTitle>
            {fromParam && toParam ? (
              <span className="text-[11px] text-muted-foreground">
                highlight {fromParam}→{toParam}
              </span>
            ) : null}
          </CardHeader>
          <CardContent>
            <Heatmap dates={data.heatmap} highlightFrom={highlightFrom} highlightTo={highlightTo} />
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
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[6px] border border-border bg-border sm:grid-cols-4 xl:grid-cols-8">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-2 bg-card px-3 py-3">
              <Skeleton className="h-5 w-12" />
              <Skeleton className="h-3 w-20" />
            </div>
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
