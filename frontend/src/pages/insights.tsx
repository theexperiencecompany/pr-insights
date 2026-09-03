import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { DefaultLegendContentProps, TooltipContentProps } from 'recharts'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Brush,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  XAxis,
  YAxis,
} from 'recharts'
import { Loader2 } from 'lucide-react'

import { EmptyState } from '@/components/empty-state'
import { FilterBar } from '@/components/filter-bar'
import { PageHeader } from '@/components/page-header'
import { getInsights, getOverview, type OverviewData } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { comma, compact } from '@/lib/format'
import { useApi } from '@/lib/use-api'
import { cn } from '@/lib/utils'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  ChartContainer,
  ChartLegend,
  ChartTooltip,
  type ChartConfig,
} from '@/components/ui/chart'
import { TipShell, TipRow, getPayloadColor } from '@/components/chart-tips'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

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

const shipConfig = {
  merged: { label: 'Merged', color: 'var(--chart-1)' },
  lines: { label: 'Lines', color: 'var(--chart-2)' },
  cycle: { label: 'Cycle time', color: 'var(--chart-4)' },
} satisfies ChartConfig

// Locked palette for the "Pull requests merged" chart:
//  --chart-1 solid fill  → Merged (area)
//  --chart-5 solid thin  → MA trailing mean (5wk / 3mo window)
//  --chart-3 dashed 4/4  → Last year
//  --chart-1 dashed 6/3 dimmed → Forecast (gated, not a prediction)
const mergedConfig = {
  merged: { label: 'Merged', color: 'var(--chart-1)' },
  ma: { label: 'MA', color: 'var(--chart-5)' },
  prev: { label: 'Last year', color: 'var(--chart-3)' },
  forecast: { label: 'Forecast', color: 'var(--chart-1)' },
} satisfies ChartConfig

const FORECAST_STORAGE_KEY = 'pr-insights-show-forecast'

function Filter({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex items-center gap-2 text-xs text-muted-foreground">
      {label}
      {children}
    </label>
  )
}

// TipShell+TipRow imported from @/components/chart-tips (unified)

// Series metadata for the shipping charts: key → label + value formatter + dashed styling.
const SHIP_SERIES: Record<string, { label: string; format: (v: number) => string; dashed?: boolean; description?: string }> = {
  merged: { label: 'Merged', format: (v) => `${comma(Math.round(v))} PRs` },
  ma: { label: 'Moving average', format: (v) => `${comma(Math.round(v))} PRs`, dashed: true, description: 'Trailing moving average (prior 5wk/3mo, excludes current bucket)' },
  forecast: { label: 'Forecast', format: (v) => `${comma(Math.round(v))} PRs`, dashed: true, description: 'Forecast linear extrap +1..+3 — not a prediction' },
  prev: { label: 'Last year', format: (v) => `${comma(Math.round(v))} PRs`, dashed: true, description: 'Last year' },
  lines: { label: 'Lines', format: (v) => `${comma(Math.round(v))} lines` },
  cycle: { label: 'Bucket median', format: (v) => `${v.toFixed(1)} days`, description: 'Median cycle of this bucket only — dashed line is the median across buckets' },
  total: { label: 'Total lines', format: (v) => `${comma(Math.round(v))} lines` },
  p75: { label: 'p75', format: (v) => `${v.toFixed(1)} days`, dashed: true, description: 'p75 cycle time' },
  p90: { label: 'p90', format: (v) => `${v.toFixed(1)} days`, dashed: true, description: 'p90 cycle time' },
}

// Display order for the merged chart's tooltip rows (unknown series last).
const SERIES_ORDER = ['merged', 'ma', 'forecast', 'prev']
const seriesRank = (key: string): number => {
  const i = SERIES_ORDER.indexOf(key)
  return i === -1 ? SERIES_ORDER.length : i
}

// SeriesTip renders one row per series present in the hovered point, so every
// line (merged, moving average, last year, forecast, p75/p90) is explained at once.
// Dashed lines show dashed swatch + description per spec.
function SeriesTip({ active, payload, label }: Partial<TooltipContentProps<number, string>>) {
  if (!active || !payload?.length) return null
  const row = payload[0]?.payload as { merged?: number | null; ma?: number | null } | undefined
  const entries = payload
    .map((p) => {
      const key = String(p.dataKey)
      const col = (getPayloadColor(p) ?? p.color ?? p.stroke) as string | undefined
      return {
        key,
        spec: SHIP_SERIES[key],
        value: p.value,
        color: col ?? "var(--chart-1)",
      }
    })
    .filter((e): e is { key: string; spec: (typeof SHIP_SERIES)[string]; value: number; color: string } =>
      Boolean(e.spec) && typeof e.value === 'number' && Number.isFinite(e.value),
    )
    .sort((a, b) => seriesRank(a.key) - seriesRank(b.key))
  if (entries.length === 0) return null

  const mergedEntry = entries.find((e) => e.key === 'merged')
  const delta =
    mergedEntry && row && typeof row.merged === 'number' && typeof row.ma === 'number' && row.ma > 0
      ? ((row.merged - row.ma) / row.ma) * 100
      : null
  const dashedEntries = entries.filter((e) => e.spec.dashed)
  const tipLabel = typeof label === 'string' && label.startsWith('+') ? `Forecast ${label}` : label

  return (
    <TipShell label={tipLabel}>
      {entries.map((e) => (
        <TipRow key={e.key} color={e.color} label={e.spec.label} value={e.spec.format(e.value)} dashed={Boolean(e.spec.dashed)} />
      ))}
      {delta !== null ? (
        <div
          className={`text-[11px] ${
            delta >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
          }`}
        >
          {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(0)}% vs moving avg
        </div>
      ) : null}
      {dashedEntries.length > 0 ? (
        <div className="grid gap-0.5 border-t border-border/40 pt-1">
          {dashedEntries.map((d) => (
            <div key={d.key} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="h-0 w-3 shrink-0 border-t-2 border-dashed" style={{ borderColor: d.color }} aria-hidden />
              <span>{d.spec.description ?? d.spec.label} — dashed</span>
            </div>
          ))}
        </div>
      ) : null}
    </TipShell>
  )
}

function CumulativeTip({ active, payload, label }: Partial<TooltipContentProps<number, string>>) {
  if (!active || !payload?.length) return null
  const v = Number(payload[0]?.value ?? 0)
  if (!Number.isFinite(v)) return null
  const col = getPayloadColor(payload[0]) ?? "var(--chart-2)"
  return (
    <TipShell label={label}>
      <TipRow color={col} label="Total lines" value={`${comma(Math.round(v))} lines`} />
    </TipShell>
  )
}

const TSHIRT_HUMAN: Record<string,string> = { XS: "Tiny", S: "Small", M: "Medium", L: "Large", XL: "XL", XXL: "Massive" }
function TShirtTip({ active, payload }: Partial<TooltipContentProps<number, string>>) {
  if (!active || !payload?.length) return null
  const entry = payload[0]
  if (!entry?.value) return null
  const datum: any = entry.payload ?? {}
  const col = (getPayloadColor(entry) ?? datum.fill ?? datum.color ?? "var(--chart-1)") as string
  const raw = String(entry.name ?? datum.size ?? datum.label ?? "Size")
  const human = datum.human ?? TSHIRT_HUMAN[raw] ?? raw
  const avg = typeof datum.avgDays === "number" && Number.isFinite(datum.avgDays) ? ` · ${datum.avgDays.toFixed(1)}d avg` : ""
  const count = Number(entry.value ?? 0)
  const pct = typeof datum.pct === "number" ? ` · ${datum.pct.toFixed(1)}%` : ""
  return (
    <TipShell>
      <TipRow color={col} label={human} value={`${comma(count)}${pct}${avg}`} />
      {datum.size ? <div className="text-[11px] text-muted-foreground">{datum.size} · {datum.label ?? ""}</div> : null}
    </TipShell>
  )
}
function LeadTimeTip({ active, payload, label }: Partial<TooltipContentProps<number, string>>) {
  if (!active || !payload?.length) return null
  const rows = payload
    .filter((e) => typeof e.value === "number" && Number.isFinite(e.value as number))
    .sort((a, b) => Number(b.value) - Number(a.value))
  if (!rows.length) return null
  return (
    <TipShell label={label}>
      {rows.map((entry) => {
        const key = String(entry.dataKey)
        const isDashed = key === "p90" || key === "p75"
        const col = getPayloadColor(entry) ?? (key === "p90" ? "var(--chart-5)" : key === "p75" ? "var(--chart-2)" : "var(--chart-1)")
        const labelMap: Record<string, string> = { p50: "p50", p90: "p90", p75: "p75" }
        return (
          <TipRow key={key} color={col as string} label={labelMap[key] ?? key} value={`${Number(entry.value).toFixed(1)}d`} dashed={isDashed} />
        )
      })}
      {rows.some((r) => String(r.dataKey) === "p90") ? (
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="h-0 w-3 shrink-0 border-t-2 border-dashed" style={{ borderColor: "var(--chart-5)" }} aria-hidden />
          <span>p90 — 90th percentile (dashed)</span>
        </div>
      ) : null}
    </TipShell>
  )
}
function WipTip({ active, payload, label }: Partial<TooltipContentProps<number, string>>) {
  if (!active || !payload?.length) return null
  const v = Number(payload[0]?.value ?? 0)
  if (!Number.isFinite(v)) return null
  const col = getPayloadColor(payload[0]) ?? "var(--chart-1)"
  return (
    <TipShell label={label}>
      <TipRow color={col as string} label="Avg open" value={`${v.toFixed(1)} PRs`} />
    </TipShell>
  )
}
function AbandonTip({ active, payload }: Partial<TooltipContentProps<number, string>>) {
  if (!active || !payload?.length) return null
  const entry = payload[0]
  if (!entry?.value) return null
  const datum: any = entry.payload ?? {}
  const col = (getPayloadColor(entry) ?? datum.color ?? "var(--chart-3)") as string
  const name = String(entry.name ?? datum.label ?? "Segment")
  const count = Number(entry.value ?? 0)
  const pct = typeof datum.pct === "number" ? ` · ${datum.pct.toFixed(1)}% of all` : ""
  return (
    <TipShell>
      <TipRow color={col} label={name} value={`${comma(count)}${pct}`} />
    </TipShell>
  )
}

function ToggleLegend({
  payload,
  hiddenSeries,
  onToggleSeries,
}: DefaultLegendContentProps & {
  hiddenSeries: Record<string, boolean>
  onToggleSeries: (key: string) => void
}) {
  if (!payload?.length) return null
  return (
    <div className="flex items-center justify-center gap-4 pt-3">
      {payload
        .filter((item) => item.type !== 'none')
        .map((item) => {
          const key = String(item.dataKey)
          const inactive = Boolean(hiddenSeries[key])
          const isDashed = key === 'prev' || key === 'forecast'
          const isDimmed = key === 'forecast'
          return (
            <button
              key={key}
              type="button"
              onClick={() => onToggleSeries(key)}
              aria-pressed={!inactive}
              className={cn(
                'flex cursor-pointer items-center gap-1.5 transition-opacity',
                inactive && 'opacity-50',
              )}
            >
              {isDashed ? (
                <span
                  className="h-0 w-3 shrink-0 border-t-2"
                  style={{
                    borderColor: item.color,
                    borderStyle: 'dashed',
                    opacity: isDimmed ? 0.6 : 1,
                  }}
                />
              ) : (
                <span
                  className="size-2 shrink-0 rounded-[2px]"
                  style={{ backgroundColor: item.color, opacity: isDimmed ? 0.6 : 1 }}
                />
              )}
              <span className="text-muted-foreground">{item.value}</span>
            </button>
          )
        })}
    </div>
  )
}

function SectionHeading({ children }: { children: ReactNode }) {
  return <h2 className="mt-6 text-base font-semibold">{children}</h2>
}

function ChartCard({
  title,
  children,
  className,
}: {
  title: string
  children: ReactNode
  className?: string
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

// Primer palette for conventional-commit types (deuteranopia-safe order kept
// in the legend by sorting on count, not hue adjacency).
const SEM_COLORS: Record<string, string> = {
  feat: '#0969da',
  fix: '#cf222e',
  chore: '#8250df',
  docs: '#0a3069',
  style: '#1a7f37',
  refactor: '#bf8700',
  perf: '#9a6700',
  test: '#0550ae',
  build: '#6639ba',
  ci: '#6e7781',
  revert: '#82071e',
  other: '#656d76',
}

function SemanticTip({ active, payload }: Partial<TooltipContentProps<number, string>>) {
  if (!active || !payload?.length) return null
  const entry = payload[0]
  if (!entry?.value) return null
  const datum = (entry.payload as any) ?? {}
  const col = (getPayloadColor(entry) ?? datum.fill ?? '#0969da') as string
  const pct = typeof datum.percent === 'number' ? ` · ${datum.percent.toFixed(1)}%` : ''
  return (
    <TipShell>
      <TipRow color={col} label={String(entry.name ?? datum.type ?? 'Type')} value={`${comma(Number(entry.value))} PRs${pct}`} />
    </TipShell>
  )
}

// What we ship: semantic PR types + human/bot split + velocity deltas.
// Org-wide lifetime counters (not repo/period-filtered) — the caption says so.
function WhatWeShip({ overview }: { overview: OverviewData | undefined | null }) {
  const byType = overview?.semantic?.byType ?? []
  const total = byType.reduce((s, b) => s + b.count, 0)
  const pieData = [...byType].sort((a, b) => b.count - a.count).map((s) => ({ name: s.type, value: s.count, percent: s.percent }))
  const bot = overview?.bot
  const botTotal = (bot?.humanMerged ?? 0) + (bot?.botMerged ?? 0)
  const humanPct = botTotal > 0 ? ((bot?.humanMerged ?? 0) / botTotal) * 100 : 0
  const velocity = overview?.velocity ?? []
  if (!overview || (byType.length === 0 && !bot && velocity.length === 0)) return null
  return (
    <div className="mt-6">
      <SectionHeading>What we ship</SectionHeading>
      <p className="mt-1 text-xs text-muted-foreground">Org-wide lifetime mix — ignores the repo and period filters above.</p>
      <div className="mt-3 grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">PR types</CardTitle>
            <CardDescription className="text-xs">Conventional-commit prefix · {comma(total)} PRs</CardDescription>
          </CardHeader>
          <CardContent>
            {pieData.length > 0 ? (
              <>
                <ChartContainer config={{}} className="mx-auto aspect-square max-h-[200px]">
                  <PieChart>
                    <ChartTooltip content={<SemanticTip />} />
                    <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={48} outerRadius={76} paddingAngle={1}>
                      {pieData.map((entry) => (
                        <Cell key={entry.name} fill={SEM_COLORS[entry.name] ?? '#656d76'} stroke="var(--background)" strokeWidth={1} />
                      ))}
                    </Pie>
                  </PieChart>
                </ChartContainer>
                <div className="mt-2 flex flex-wrap justify-center gap-1.5">
                  {pieData.slice(0, 8).map((s) => (
                    <span key={s.name} className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium">
                      <span className="inline-block size-2 rounded-full" style={{ background: SEM_COLORS[s.name] ?? '#656d76' }} />
                      {s.name} {s.percent.toFixed(0)}%
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">No typed PRs.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Humans vs bots</CardTitle>
            <CardDescription className="text-xs">{comma(botTotal)} merged</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-semibold tabular-nums">{humanPct.toFixed(0)}%</span>
              <span className="text-xs text-muted-foreground">human</span>
            </div>
            <div className="flex h-2 overflow-hidden rounded-full bg-muted">
              <div className="bg-[var(--chart-2)]" style={{ width: `${humanPct}%` }} />
              <div className="bg-[var(--chart-5)]" style={{ width: `${100 - humanPct}%` }} />
            </div>
            <div className="flex justify-between text-xs tabular-nums text-muted-foreground">
              <span>{comma(bot?.humanMerged ?? 0)} human</span>
              <span>{comma(bot?.botMerged ?? 0)} bots</span>
            </div>
            {(bot?.bots.length ?? 0) > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {(bot?.bots ?? []).slice(0, 6).map((b) => (
                  <Badge key={b} variant="secondary" className="px-1.5 py-0 text-[11px] font-medium">
                    {b}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No bot merges.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Velocity</CardTitle>
            <CardDescription className="text-xs">Merged vs prior period</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {velocity.length > 0 ? (
              velocity.slice(0, 3).map((v) => {
                const isNew = v.previous === 0 && v.current > 0
                const up = v.deltaPct > 0
                const down = v.deltaPct < 0
                return (
                  <div key={v.label} className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-muted-foreground">{v.label}</span>
                    <span className="flex items-center gap-2 text-sm font-semibold tabular-nums">
                      {comma(v.current)}
                      {isNew ? (
                        <Badge variant="secondary" className="bg-blue-100 px-1.5 py-0 text-[10px] font-semibold text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">New</Badge>
                      ) : up ? (
                        <span className="text-xs font-semibold text-green-600 dark:text-green-400">+{v.deltaPct.toFixed(0)}%</span>
                      ) : down ? (
                        <span className="text-xs font-semibold text-red-600 dark:text-red-400">{v.deltaPct.toFixed(0)}%</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </span>
                  </div>
                )
              })
            ) : (
              <p className="text-xs text-muted-foreground">No velocity data.</p>
            )}
            <p className="text-[11px] text-muted-foreground">Current vs previous window · New means no merges in the prior window.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

// When we ship: weekday + hour-of-day merge distribution (server zone).
// Org-wide lifetime counters — the caption says so.
function WhenWeShip({ overview }: { overview: OverviewData | undefined | null }) {
  const dist = overview?.shipDist
  const weekdayData = (dist?.weekday ?? []).map((v, i) => ({
    day: dist?.weekdayLabels?.[i] ?? `Day ${i}`,
    merged: v,
  }))
  const hourData = (dist?.hour ?? []).map((v, i) => ({ hour: `${i}h`, merged: v }))
  const peakDay = weekdayData.reduce((a, b) => (b.merged > a.merged ? b : a), { day: '—', merged: 0 })
  const peakHour = hourData.reduce((a, b) => (b.merged > a.merged ? b : a), { hour: '—', merged: 0 })
  if (!dist || (peakDay.merged === 0 && peakHour.merged === 0)) return null
  return (
    <div className="mt-6">
      <SectionHeading>When we ship</SectionHeading>
      <p className="mt-1 text-xs text-muted-foreground">
        Org-wide · times in {dist.zone || 'UTC'} · busiest {peakDay.day}s around {peakHour.hour} — ignores the repo and period filters above.
      </p>
      <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard title="Merges by weekday">
          <ChartContainer config={{ merged: { label: 'Merged', color: 'var(--chart-1)' } }} className="aspect-auto h-44">
            <BarChart data={weekdayData} margin={{ left: 0, right: 4, top: 4 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={6} />
              <YAxis hide />
              <ChartTooltip cursor={{ fill: 'var(--muted)' }} content={<SeriesTip />} />
              <Bar dataKey="merged" fill="var(--color-merged)" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ChartContainer>
        </ChartCard>
        <ChartCard title="Merges by hour">
          <ChartContainer config={{ merged: { label: 'Merged', color: 'var(--chart-1)' } }} className="aspect-auto h-44">
            <BarChart data={hourData} margin={{ left: 0, right: 4, top: 4 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="hour" tickLine={false} axisLine={false} tickMargin={6} interval={3} />
              <YAxis hide />
              <ChartTooltip cursor={{ fill: 'var(--muted)' }} content={<SeriesTip />} />
              <Bar dataKey="merged" fill="var(--color-merged)" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ChartContainer>
        </ChartCard>
      </div>
    </div>
  )
}

export default function InsightsPage() {
  const [searchParams, setSearchParams] = useSearchParams()

  const rawPeriod = searchParams.get('period')
  const period: Period = PERIODS.includes(rawPeriod as Period) ? (rawPeriod as Period) : '6m'
  const rawGran = searchParams.get('gran')
  const gran: Gran = GRANS.includes(rawGran as Gran) ? (rawGran as Gran) : 'month'
  const repoParam = searchParams.get('repo') ?? 'all'

  const { data, loading, error } = useApi(() => getInsights({ repo: repoParam === 'all' ? undefined : repoParam, period, gran }), [repoParam, period, gran])
  // Org-wide context (semantic types, bots, velocity): the insights payload is
  // repo/period-filtered, these lifetime counters are not — always labeled so.
  const { data: overview } = useApi(() => getOverview({ largest: 5, gran }), [gran])
  const isInitialLoading = loading && !data
  const isReloading = loading && !!data

  const [hidden, setHidden] = useState<Record<string, boolean>>({})
  const [showForecast, setShowForecast] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem(FORECAST_STORAGE_KEY)
      return v === 'true'
    } catch {
      return false
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(FORECAST_STORAGE_KEY, String(showForecast))
    } catch {
      // storage unavailable
    }
  }, [showForecast])

  const updateParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams)
    if (value) next.set(key, value)
    else next.delete(key)
    setSearchParams(next)
  }

  const handleRepoChange = (value: string) => {
    updateParam('repo', value === 'all' ? '' : value)
  }

  // Weekly tickFormatter 'Jan 2 ’26' when year!=current + ReferenceLine Jan-1 helpers
  const weeklyTickFormatter = (value: string, index: number): string => {
    if (gran !== 'week') return value
    let bucket: any = data?.ship[index]
    if (!bucket || bucket.label !== value) {
      bucket = (data?.ship as any[])?.find((b: any) => b.label === value)
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

  const yearBoundaries = useMemo(() => {
    if (gran !== 'week' || !data?.ship) return [] as string[]
    const out: string[] = []
    for (let i = 1; i < data.ship.length; i++) {
      const prev: any = data.ship[i - 1]
      const cur: any = data.ship[i]
      const prevKey: string | undefined = prev?.key
      const curKey: string | undefined = cur?.key
      if (!prevKey || !curKey || prevKey.length !== 10 || curKey.length !== 10) continue
      const prevYear = new Date(prevKey + 'T00:00:00Z').getUTCFullYear()
      const curYear = new Date(curKey + 'T00:00:00Z').getUTCFullYear()
      if (curYear !== prevYear) out.push(cur.label)
    }
    return out
  }, [data, gran])

  const handleShipBrushChange = (range: any) => {
    if (!range) return
    const { startIndex, endIndex } = range
    if (startIndex == null || endIndex == null || !data?.ship) return
    if (startIndex === 0 && endIndex === data.ship.length - 1) {
      const next = new URLSearchParams(searchParams)
      next.delete('from')
      next.delete('to')
      setSearchParams(next, { replace: true })
      return
    }
    const fromBucket: any = data.ship[startIndex]
    const toBucket: any = data.ship[endIndex]
    const fromKey = fromBucket?.key ?? fromBucket?.label
    const toKey = toBucket?.key ?? toBucket?.label
    const next = new URLSearchParams(searchParams)
    if (fromKey) next.set('from', String(fromKey))
    if (toKey) next.set('to', String(toKey))
    setSearchParams(next, { replace: true })
  }

  // zero-fill helpers: longest zero-streak and gap dots
  const shipZeroStreak = useMemo(() => {
    if (!data?.ship?.length) return { longest: 0, current: 0, label: '' }
    let longest = 0
    let cur = 0
    let curStart = -1
    let bestStart = -1
    let bestEnd = -1
    for (let i = 0; i < data.ship.length; i++) {
      if (data.ship[i].merged === 0) {
        if (cur === 0) curStart = i
        cur++
        if (cur > longest) {
          longest = cur
          bestStart = curStart
          bestEnd = i
        }
      } else {
        cur = 0
      }
    }
    let trailing = 0
    for (let i = data.ship.length - 1; i >= 0 && data.ship[i].merged === 0; i--) trailing++
    const label = longest > 0 && bestStart >= 0 ? `${(data.ship[bestStart] as any)?.label} → ${(data.ship[bestEnd] as any)?.label}` : ''
    return { longest, current: trailing, label }
  }, [data])

  const cycleMedian = useMemo(() => {
    if (!data?.ship?.length) return 0
    const vals = data.ship.map((b) => b.cycleMedianDays).filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b)
    if (!vals.length) return 0
    const mid = Math.floor(vals.length / 2)
    return vals.length % 2 === 1 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2
  }, [data])

  const linesData = useMemo(
    () => data?.ship.map((b) => ({ label: b.label, lines: b.additions + b.deletions })) ?? [],
    [data],
  )
  const cycleData = useMemo(
    () =>
      data?.ship.filter((b) => b.cycleCount > 0).map((b) => ({ label: b.label, cycle: b.cycleMedianDays })) ?? [],
    [data],
  )

  // merged chart data: merged + moving average + year-ago + forecast extension
  // Tokens locked: merged --chart-1 solid fill, MA --chart-5 solid thin (trailing 5wk/3mo), prev --chart-3 dashed 4/4, forecast --chart-1 dashed 6/3 dimmed.
  // Forecast is gated: only when n>=6 and user has toggled it ON (default OFF, persisted).
  const mergedData = useMemo(() => {
    if (!data) return []
    const window = gran === 'week' ? 5 : 3
    const rows: { label: string; merged: number | null; ma: number | null; prev: number | null; forecast: number | null }[] = data.ship.map((b, i) => {
      // Trailing average over the previous `window` buckets only — the current
      // bucket is excluded so "% vs moving avg" never compares a point to itself.
      const lo = Math.max(0, i - window)
      const slice = data.ship.slice(lo, i)
      const ma = slice.length ? slice.reduce((s, x) => s + x.merged, 0) / slice.length : null
      return { label: b.label, merged: b.merged, ma: ma, prev: null, forecast: null }
    })
    if ((data.shipPrev ?? []).length === data.ship.length) {
      ;(data.shipPrev ?? []).forEach((b, i) => {
        rows[i].prev = b.merged
      })
    }
    // least-squares forecast over merged, anchored to the last real point — gated n>=6 and explicit opt-in
    if (showForecast) {
      const ys = rows.map((r) => r.merged ?? 0)
      const n = ys.length
      if (n >= 6) {
        const meanX = (n - 1) / 2
        const meanY = ys.reduce((s, v) => s + v, 0) / n
        let num = 0
        let den = 0
        ys.forEach((y, x) => {
          num += (x - meanX) * (y - meanY)
          den += (x - meanX) * (x - meanX)
        })
        const slope = den > 0 ? num / den : 0
        const intercept = meanY - slope * meanX
        // anchor: the forecast line starts exactly where the data ends
        rows[n - 1].forecast = rows[n - 1].merged
        for (let k = 1; k <= 3; k++) {
          const x = n - 1 + k
          rows.push({ label: `+${k}`, merged: null, ma: null, prev: null, forecast: Math.max(0, slope * x + intercept) })
        }
      }
    }
    return rows
  }, [data, gran, showForecast])

  const cumulativeData = useMemo(
    () => {
      if (!data) return []
      let total = 0
      return data.ship.map((b) => {
        total += b.additions + b.deletions
        return { label: b.label, total }
      })
    },
    [data],
  )

  const toggleSeries = (key: string) => setHidden((h) => ({ ...h, [key]: !h[key] }))

  return (
    <>
      <PageHeader title="Insights" description="Ship velocity" />

      <FilterBar>
        <Select value={repoParam} onValueChange={handleRepoChange}>
          <SelectTrigger size="sm" aria-label="Filter by repository" className="max-w-44">
            <SelectValue placeholder="All repos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All repos</SelectItem>
            {data?.repoOptions?.map((r) => (
              <SelectItem key={r.name} value={r.name}>
                {r.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Filter label="Period">
          <Select value={period} onValueChange={(v) => updateParam('period', v)}>
            <SelectTrigger size="sm" className="min-w-36">
              <SelectValue placeholder={PERIOD_LABELS[period]} />
            </SelectTrigger>
            <SelectContent>
              {PERIODS.map((p) => (
                <SelectItem key={p} value={p}>
                  {PERIOD_LABELS[p]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Filter>
        <Filter label="Granularity">
          <Select value={gran} onValueChange={(v) => updateParam('gran', v)}>
            <SelectTrigger size="sm" className="min-w-28">
              <SelectValue placeholder="Monthly" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="month">Monthly</SelectItem>
              <SelectItem value="week">Weekly</SelectItem>
            </SelectContent>
          </Select>
        </Filter>
        {(repoParam !== 'all') && (
          <Button variant="ghost" size="sm" onClick={() => handleRepoChange('all')} className="ml-auto">
            Clear
          </Button>
        )}
      </FilterBar>

      {isInitialLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-[64px] w-full rounded-[6px]" />
          <div className="grid gap-4 md:grid-cols-2">
            <Skeleton className="h-[300px] w-full rounded-[6px]" />
            <Skeleton className="h-[300px] w-full rounded-[6px]" />
          </div>
          <Skeleton className="h-[300px] w-full rounded-[6px]" />
          <Skeleton className="h-[300px] w-full rounded-[6px]" />
          <div className="grid gap-4 md:grid-cols-2">
            <Skeleton className="h-[300px] w-full rounded-[6px]" />
            <Skeleton className="h-[300px] w-full rounded-[6px]" />
          </div>
          <Skeleton className="h-[220px] w-full rounded-[6px]" />
        </div>
      ) : error && !data ? (
        <EmptyState text={error} />
      ) : data ? (
        <div className="relative">
          {isReloading && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-start justify-center pt-6">
              <div className="pointer-events-auto flex items-center gap-2 rounded-full border bg-background px-3 py-1.5 text-xs font-medium shadow-sm">
                <Loader2 className="size-3.5 animate-spin" />
                Loading {gran} view...
              </div>
            </div>
          )}
          <div className={cn(isReloading && 'opacity-50 pointer-events-none transition-opacity')} aria-busy={isReloading}>
            {isReloading && (
              <div className="mb-3 flex items-center gap-2">
                <Skeleton className="h-2 w-full" />
              </div>
            )}
            <>
          <SectionHeading>Shipping</SectionHeading>
          {shipZeroStreak.longest > 0 && (
            <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              Longest zero-streak: {shipZeroStreak.longest} {gran === 'week' ? 'weeks' : 'months'} with no merges{shipZeroStreak.label ? ` (${shipZeroStreak.label})` : ''} · current trailing: {shipZeroStreak.current}
            </div>
          )}
          {searchParams.get('from') && searchParams.get('to') ? (
            <div className="mt-2 text-[11px] text-muted-foreground">
              Highlighting {searchParams.get('from')} → {searchParams.get('to')}{' '}
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
            </div>
          ) : null}

          {data.ship.length === 0 ? (
            <Card className="mt-4">
              <EmptyState text="No pull request data for this filter." />
            </Card>
          ) : (
            <>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <ChartCard title="Pull requests merged">
                  <ChartContainer config={mergedConfig} className="aspect-auto h-64">
                    <AreaChart data={mergedData} margin={{ left: 0, right: 8, top: 4 }}>
                      <defs>
                        <linearGradient id="fillMerged" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="var(--color-merged)" stopOpacity={0.4} />
                          <stop offset="95%" stopColor="var(--color-merged)" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid vertical={false} />
                      <XAxis
                        dataKey="label"
                        tickLine={false}
                        axisLine={false}
                        tickMargin={8}
                        minTickGap={24}
                        tickFormatter={weeklyTickFormatter}
                      />
                      <YAxis tickLine={false} axisLine={false} tickFormatter={compact} />
                      {yearBoundaries.map((x) => (
                        <ReferenceLine key={x} x={x} stroke="var(--border)" strokeDasharray="3 3" />
                      ))}
                      <ChartTooltip content={<SeriesTip />} />
                      <ChartLegend content={<ToggleLegend hiddenSeries={hidden} onToggleSeries={toggleSeries} />} />
                      <Area
                        type="monotone"
                        dataKey="merged"
                        name="Merged"
                        stroke="var(--color-merged)"
                        strokeWidth={2}
                        fill="url(#fillMerged)"
                        connectNulls={false}
                        dot={{ r: 2, stroke: "var(--color-merged)", fill: "var(--background)" }}
                        activeDot={{ r: 4 }}
                        hide={Boolean(hidden.merged)}
                      />
                      <Line
                        type="monotone"
                        isAnimationActive={false}
                        dataKey="ma"
                        name="MA"
                        stroke="var(--color-ma)"
                        strokeWidth={1.5}
                        dot={false}
                        connectNulls={false}
                        activeDot={false}
                        hide={Boolean(hidden.ma)}
                      />
                      {mergedData.some((r) => r.prev !== null) && (
                        <Line
                          type="monotone"
                          isAnimationActive={false}
                          dataKey="prev"
                          name="Last year"
                          stroke="var(--color-prev)"
                          strokeWidth={1.5}
                          strokeDasharray="4 4"
                          dot={false}
                          connectNulls={false}
                          activeDot={false}
                          hide={Boolean(hidden.prev)}
                        />
                      )}
                      {showForecast && mergedData.some((r) => r.forecast !== null) && (
                        <Line
                          type="monotone"
                          isAnimationActive={false}
                          dataKey="forecast"
                          name="Forecast"
                          stroke="var(--color-forecast)"
                          strokeWidth={1.5}
                          strokeDasharray="6 3"
                          strokeOpacity={0.6}
                          dot={false}
                          connectNulls={false}
                          activeDot={false}
                          hide={Boolean(hidden.forecast)}
                          style={{ opacity: 0.6 } as React.CSSProperties}
                        />
                      )}
                      {data && data.ship.length > 6 ? (
                        <Brush dataKey="label" height={24} fill="var(--muted)" stroke="var(--border)" travellerWidth={12} onChange={handleShipBrushChange} />
                      ) : null}
                    </AreaChart>
                  </ChartContainer>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[11px] text-muted-foreground">
                      MA=trailing mean · Forecast=linear extrap +1..+3 — not a prediction
                      {gran === 'week' ? ' · MA window 5wk' : ' · MA window 3mo'}
                    </p>
                    <label className="flex cursor-pointer select-none items-center gap-1.5 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={showForecast}
                        onChange={(e) => setShowForecast(e.target.checked)}
                        disabled={(data?.ship.length ?? 0) < 6}
                        className="size-3.5 accent-[var(--chart-1)] disabled:opacity-50"
                      />
                      Show forecast
                      {(data?.ship.length ?? 0) < 6 ? ' (needs ≥6 points)' : ''}
                    </label>
                  </div>
                  {period !== '12m' && (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Switch to Last 12 months to compare year-over-year.
                    </p>
                  )}
                </ChartCard>

                <ChartCard title="Lines merged">
                  <ChartContainer config={shipConfig} className="aspect-auto h-64">
                    <AreaChart data={linesData} margin={{ left: 0, right: 8, top: 4 }}>
                      <defs>
                        <linearGradient id="fillLines" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="var(--color-lines)" stopOpacity={0.4} />
                          <stop offset="95%" stopColor="var(--color-lines)" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid vertical={false} />
                      <XAxis
                        dataKey="label"
                        tickLine={false}
                        axisLine={false}
                        tickMargin={8}
                        minTickGap={24}
                        tickFormatter={weeklyTickFormatter}
                      />
                      <YAxis tickLine={false} axisLine={false} tickFormatter={compact} />
                      {yearBoundaries.map((x) => (
                        <ReferenceLine key={x} x={x} stroke="var(--border)" strokeDasharray="3 3" />
                      ))}
                      <ChartTooltip content={<SeriesTip />} />
                      <Area
                        type="monotone"
                        dataKey="lines"
                        stroke="var(--color-lines)"
                        strokeWidth={2}
                        fill="url(#fillLines)"
                        connectNulls={false}
                        dot={{ r: 2, stroke: "var(--color-lines)", fill: "var(--background)" }}
                        activeDot={{ r: 4 }}
                      />
                      {data && data.ship.length > 6 ? (
                        <Brush dataKey="label" height={24} fill="var(--muted)" stroke="var(--border)" travellerWidth={12} onChange={handleShipBrushChange} />
                      ) : null}
                    </AreaChart>
                  </ChartContainer>
                </ChartCard>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                <ChartCard title="Cycle time — median days from opened to merged">
                  <ChartContainer config={shipConfig} className="aspect-auto h-64">
                    <LineChart data={cycleData} margin={{ left: 0, right: 8, top: 4 }}>
                      <CartesianGrid vertical={false} />
                      <XAxis
                        dataKey="label"
                        tickLine={false}
                        axisLine={false}
                        tickMargin={8}
                        minTickGap={24}
                        tickFormatter={weeklyTickFormatter}
                      />
                      <YAxis
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(v: number) => `${v}d`}
                      />
                      {yearBoundaries.map((x) => (
                        <ReferenceLine key={x} x={x} stroke="var(--border)" strokeDasharray="3 3" />
                      ))}
                      <ChartTooltip content={<SeriesTip />} />
                      {cycleMedian > 0 && (
                        <ReferenceLine y={cycleMedian} stroke="var(--chart-5)" strokeDasharray="3 3" label={{ value: `typical ${cycleMedian.toFixed(1)}d (median of buckets)`, position: "insideTopRight", fill: "var(--muted-foreground)", fontSize: 10 }} />
                      )}
                      <Line
                        type="monotone"
                        isAnimationActive={false}
                        dataKey="cycle"
                        stroke="var(--color-cycle)"
                        strokeWidth={2}
                        dot={{ r: 2, stroke: "var(--color-cycle)", fill: "var(--background)" }}
                        connectNulls={false}
                        activeDot={{ r: 4 }}
                      />
                      {data && data.ship.length > 6 ? (
                        <Brush dataKey="label" height={24} fill="var(--muted)" stroke="var(--border)" travellerWidth={12} onChange={handleShipBrushChange} />
                      ) : null}
                    </LineChart>
                  </ChartContainer>
                </ChartCard>
                <ChartCard title="Cumulative lines shipped">
                  <ChartContainer config={shipConfig} className="aspect-auto h-64">
                    <AreaChart data={cumulativeData} margin={{ left: 0, right: 8, top: 4 }}>
                      <CartesianGrid vertical={false} />
                      <XAxis
                        dataKey="label"
                        tickLine={false}
                        axisLine={false}
                        tickMargin={8}
                        minTickGap={24}
                        tickFormatter={weeklyTickFormatter}
                      />
                      <YAxis
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(v: number) => compact(Number(v))}
                      />
                      {yearBoundaries.map((x) => (
                        <ReferenceLine key={x} x={x} stroke="var(--border)" strokeDasharray="3 3" />
                      ))}
                      <ChartTooltip content={<CumulativeTip />} />
                      <Area
                        type="monotone"
                        dataKey="total"
                        name="Total lines"
                        stroke="var(--chart-2)"
                        strokeWidth={2}
                        fill="var(--chart-2)"
                        fillOpacity={0.15}
                        activeDot={{ r: 4 }}
                      />
                      {data && data.ship.length > 6 ? (
                        <Brush dataKey="label" height={24} fill="var(--muted)" stroke="var(--border)" travellerWidth={12} onChange={handleShipBrushChange} />
                      ) : null}
                    </AreaChart>
                  </ChartContainer>
                </ChartCard>
              </div>
            </>
          )}

          {/* DORA-lite flow health */}
          {data.tshirt && data.tshirt.length > 0 ? (
            <div className="mt-6">
              <SectionHeading>Flow health</SectionHeading>
              <p className="mt-1 truncate text-xs text-muted-foreground">Small changes shipped quickly with steady flow</p>
              <div className="mt-3 grid gap-4 md:grid-cols-2">
                <Card className="border border-border/50 rounded-lg shadow-none">
                  {(() => {
                    const total = data.tshirt.reduce((s: any, x: any) => s + x.count, 0)
                    const humanMap: Record<string, string> = { XS: "Tiny", S: "Small", M: "Medium", L: "Large", XL: "XL", XXL: "Massive" }
                    const most = [...data.tshirt].sort((a: any, b: any) => b.count - a.count)[0]
                    const mostHuman = most?.human ?? humanMap[most?.size] ?? most?.size ?? ""
                    const mostPct = most?.pct ?? 0
                    const xxl = data.tshirt.find((s: any) => s.size === "XXL")
                    const xxlPct = xxl?.pct ?? 0
                    const bigPct = data.tshirt.filter((s: any) => s.size === "L" || s.size === "XL" || s.size === "XXL").reduce((s: any, x: any) => s + (x.pct ?? 0), 0)
                    const health: "green" | "amber" | "red" = xxlPct > 10 || bigPct > 50 ? "red" : xxlPct > 5 || bigPct > 30 ? "amber" : "green"
                    const dotClass = health === "green" ? "bg-green-500" : health === "amber" ? "bg-amber-500" : "bg-red-500"
                    const badgeClass =
                      health === "green"
                        ? "bg-green-50 text-green-700 border-green-200 dark:bg-green-950/30 dark:text-green-300 dark:border-green-900"
                        : health === "amber"
                          ? "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-900"
                          : "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-300 dark:border-red-900"
                    const label = health === "green" ? "Healthy" : health === "amber" ? "Watch" : "Action"
                    return (
                      <>
                        <CardHeader className="pb-2">
                          <div className="flex items-center justify-between gap-2">
                            <CardTitle className="flex items-center gap-2 text-sm font-medium">
                              <span className={`size-2 rounded-full ${dotClass}`} aria-hidden />
                              Change size
                            </CardTitle>
                            <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${badgeClass}`}>{label}</span>
                          </div>
                          <CardDescription className="truncate text-xs">
                            {health === "green"
                              ? "Changes are small and easy to review"
                              : health === "amber"
                                ? `${bigPct.toFixed(0)}% are Large or bigger — some need splitting`
                                : `${bigPct.toFixed(0)}% are Large or bigger — split them`}
                          </CardDescription>
                        </CardHeader>
                        <CardContent>
                          <div className="flex items-baseline justify-between gap-2">
                            <div className="text-2xl font-semibold tabular-nums">
                              {mostHuman} {mostPct.toFixed(0)}%
                            </div>
                            <span className={`size-3 rounded-full ${dotClass}`} aria-label={health} />
                          </div>
                          <p className="truncate text-[11px] text-muted-foreground">{total} merged</p>
                          <ChartContainer
                            config={{
                              XS: { label: "Tiny", color: "var(--chart-2)" },
                              S: { label: "Small", color: "var(--chart-1)" },
                              M: { label: "Medium", color: "#1f883d" },
                              L: { label: "Large", color: "#d29922" },
                              XL: { label: "XL", color: "#cf222e" },
                              XXL: { label: "Massive", color: "#82071e" },
                            }}
                            className="mx-auto mt-3 aspect-square max-h-[180px]"
                          >
                            <PieChart>
                              <Pie data={data.tshirt} dataKey="count" nameKey="size" cx="50%" cy="50%" innerRadius={38} outerRadius={64} paddingAngle={2}>
                                {data.tshirt.map((e: any) => (
                                  <Cell key={e.size} fill={e.color} stroke="var(--background)" strokeWidth={1} />
                                ))}
                              </Pie>
                              <ChartTooltip content={<TShirtTip />} />
                            </PieChart>
                          </ChartContainer>
                          <div className="mt-2 flex flex-wrap gap-1">
                            {data.tshirt.map((s: any) => {
                              const human = s.human ?? humanMap[s.size] ?? s.size
                              return (
                                <span
                                  key={s.size}
                                  className="inline-flex items-center gap-1 rounded-full border border-border/50 px-2 py-0.5 text-[11px]"
                                >
                                  <span className="size-2 rounded-full" style={{ background: s.color }} />
                                  {human} {s.count} ({s.pct.toFixed(1)}%)
                                </span>
                              )
                            })}
                          </div>
                          <details className="mt-3 rounded-lg border border-border/50 bg-muted/20 px-3 py-2">
                            <summary className="cursor-pointer list-none text-xs font-medium text-primary">Learn</summary>
                            <div className="mt-2 space-y-2 text-xs text-muted-foreground">
                              <p>Buckets by diff additions plus deletions. Tiny 0 to 10, Small 11 to 50, Medium 51 to 200, Large 201 to 500, XL 501 to 1000, Massive over 1000.</p>
                              {(() => {
                                const tiny = data.tshirt.find((s: any) => s.size === "XS")
                                const xxlAvg = typeof xxl?.avgDays === "number" ? xxl.avgDays.toFixed(1) : "—"
                                const tinyAvg = typeof tiny?.avgDays === "number" ? tiny.avgDays.toFixed(1) : "—"
                                return xxl ? (
                                  <p>
                                    {xxl.count} Massive avg {xxlAvg} days vs {tiny?.count ?? 0} Tiny {tinyAvg} days. Try under 300 lines.
                                  </p>
                                ) : null
                              })()}
                              <div className="overflow-x-auto">
                                <Table>
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead className="text-xs">Bucket</TableHead>
                                      <TableHead className="text-xs">Lines</TableHead>
                                      <TableHead className="text-xs">Tip</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    <TableRow>
                                      <TableCell className="text-xs">Tiny</TableCell>
                                      <TableCell className="text-xs">0 to 10</TableCell>
                                      <TableCell className="text-xs text-muted-foreground">typo fix</TableCell>
                                    </TableRow>
                                    <TableRow>
                                      <TableCell className="text-xs">Small</TableCell>
                                      <TableCell className="text-xs">11 to 50</TableCell>
                                      <TableCell className="text-xs text-muted-foreground">ideal</TableCell>
                                    </TableRow>
                                    <TableRow>
                                      <TableCell className="text-xs">Medium</TableCell>
                                      <TableCell className="text-xs">51 to 200</TableCell>
                                      <TableCell className="text-xs text-muted-foreground">reviewable</TableCell>
                                    </TableRow>
                                    <TableRow>
                                      <TableCell className="text-xs">Large</TableCell>
                                      <TableCell className="text-xs">201 to 500</TableCell>
                                      <TableCell className="text-xs text-muted-foreground">careful</TableCell>
                                    </TableRow>
                                    <TableRow>
                                      <TableCell className="text-xs">XL</TableCell>
                                      <TableCell className="text-xs">501 to 1000</TableCell>
                                      <TableCell className="text-xs text-muted-foreground">risky</TableCell>
                                    </TableRow>
                                    <TableRow>
                                      <TableCell className="text-xs">Massive</TableCell>
                                      <TableCell className="text-xs">1000 plus</TableCell>
                                      <TableCell className="text-xs text-muted-foreground">split it</TableCell>
                                    </TableRow>
                                  </TableBody>
                                </Table>
                              </div>
                            </div>
                          </details>
                        </CardContent>
                      </>
                    )
                  })()}
                </Card>
                <Card className="border border-border/50 rounded-lg shadow-none">
                  {(() => {
                    const p50 = data.leadOverall?.p50 ?? 0
                    const p90 = data.leadOverall?.p90 ?? 0
                    const count = data.leadOverall?.count ?? 0
                    const health: "green" | "amber" | "red" = p50 > 4 || p90 > 14 ? "red" : p50 > 2 || p90 > 7 ? "amber" : "green"
                    const dotClass = health === "green" ? "bg-green-500" : health === "amber" ? "bg-amber-500" : "bg-red-500"
                    const badgeClass =
                      health === "green"
                        ? "bg-green-50 text-green-700 border-green-200 dark:bg-green-950/30 dark:text-green-300"
                        : health === "amber"
                          ? "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300"
                          : "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-300"
                    const label = health === "green" ? "Healthy" : health === "amber" ? "Watch" : "Action"
                    return (
                      <>
                        <CardHeader className="pb-2">
                          <div className="flex items-center justify-between gap-2">
                            <CardTitle className="flex items-center gap-2 text-sm font-medium">
                              <span className={`size-2 rounded-full ${dotClass}`} aria-hidden />
                              Time to merge
                            </CardTitle>
                            <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${badgeClass}`}>{label}</span>
                          </div>
                          <CardDescription className="truncate text-xs">Median {p50 ? p50.toFixed(1) + " days" : "—"}, 90 percent in {p90 ? p90.toFixed(1) + " days" : "—"}</CardDescription>
                        </CardHeader>
                        <CardContent>
                          <div className="flex items-baseline justify-between gap-2">
                            <div className="text-2xl font-semibold tabular-nums">{p50 ? `${p50.toFixed(1)} days` : "—"}</div>
                            <span className={`size-3 rounded-full ${dotClass}`} aria-label={health} />
                          </div>
                          <p className="truncate text-[11px] text-muted-foreground">{count} merges</p>
                          <details className="mt-3 rounded-lg border border-border/50 bg-muted/20 px-3 py-2">
                            <summary className="cursor-pointer list-none text-xs font-medium text-primary">Learn</summary>
                            <div className="mt-2 space-y-3">
                              <p className="text-xs text-muted-foreground">p75 {(data.leadOverall as any)?.p75 ? (data.leadOverall as any).p75.toFixed(1) + " days" : "—"} — the middle line below.</p>
                              {data.leadTime && data.leadTime.length > 0 ? (
                                <ChartContainer config={{ p50: { label: "p50", color: "var(--chart-1)" }, p75: { label: "p75", color: "var(--chart-2)" }, p90: { label: "p90", color: "var(--chart-5)" } }} className="h-[180px] w-full">
                                  <AreaChart data={data.leadTime} margin={{ left: 12, right: 12, top: 4 }}>
                                    <CartesianGrid vertical={false} />
                                    <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={16} />
                                    <YAxis tickLine={false} axisLine={false} tickMargin={8} width={30} tickFormatter={(v: number) => `${v.toFixed(0)}d`} />
                                    <ChartTooltip content={<LeadTimeTip />} />
                                    <Area type="monotone" dataKey="p90" stroke="var(--chart-5)" fill="var(--chart-5)" fillOpacity={0.15} strokeWidth={1} strokeDasharray="4 3" dot={false} />
                                    <Area type="monotone" dataKey="p75" stroke="var(--chart-2)" fill="var(--chart-2)" fillOpacity={0.12} strokeWidth={1} strokeDasharray="4 3" dot={false} />
                                    <Area type="monotone" dataKey="p50" stroke="var(--chart-1)" fill="var(--chart-1)" fillOpacity={0.25} strokeWidth={2} dot={false} />
                                  </AreaChart>
                                </ChartContainer>
                              ) : (
                                <p className="text-xs text-muted-foreground">No lead time data.</p>
                              )}
                              <p className="text-[11px] text-muted-foreground">Ideal median under 2 days, 90 percent under 7 days.</p>
                            </div>
                          </details>
                        </CardContent>
                      </>
                    )
                  })()}
                </Card>
                <Card className="border border-border/50 rounded-lg shadow-none">
                  {(() => {
                    const wip = data.wip
                    const cur = wip?.currentWip ?? 0
                    const avg = wip?.avgWip ?? 0
                    const err = wip?.errorPct ?? 0
                    const health: "green" | "amber" | "red" = err < 20 ? "green" : err < 40 ? "amber" : "red"
                    const dotClass = health === "green" ? "bg-green-500" : health === "amber" ? "bg-amber-500" : "bg-red-500"
                    const badgeClass =
                      health === "green"
                        ? "bg-green-50 text-green-700 border-green-200 dark:bg-green-950/30 dark:text-green-300"
                        : health === "amber"
                          ? "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300"
                          : "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-300"
                    const label = health === "green" ? "Healthy" : health === "amber" ? "Watch" : "Action"
                    return (
                      <>
                        <CardHeader className="pb-2">
                          <div className="flex items-center justify-between gap-2">
                            <CardTitle className="flex items-center gap-2 text-sm font-medium">
                              <span className={`size-2 rounded-full ${dotClass}`} aria-hidden />
                              Work in progress
                            </CardTitle>
                            <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${badgeClass}`}>{label}</span>
                          </div>
                          <CardDescription className="truncate text-xs">{cur} open now · avg {avg.toFixed(1)} open</CardDescription>
                        </CardHeader>
                        <CardContent>
                          <div className="flex items-baseline justify-between gap-2">
                            <div className="text-2xl font-semibold tabular-nums">{cur} open now</div>
                            <span className={`size-3 rounded-full ${dotClass}`} aria-label={health} />
                          </div>
                          {wip?.points && wip.points.length > 0 ? (
                            <ChartContainer config={{ wip: { label: "Open", color: "var(--chart-1)" } }} className="mt-2 h-[48px] w-full">
                              <AreaChart data={wip.points} margin={{ left: 0, right: 4, top: 4 }}>
                                <CartesianGrid vertical={false} />
                                <XAxis dataKey="date" hide />
                                <YAxis hide domain={["dataMin", "dataMax"]} />
                                <ChartTooltip content={<WipTip />} />
                                <Area type="monotone" dataKey="wip" stroke="var(--chart-1)" fill="var(--chart-1)" fillOpacity={0.15} strokeWidth={1.5} dot={false} />
                                {avg ? <ReferenceLine y={avg} stroke="var(--chart-5)" strokeDasharray="3 3" /> : null}
                              </AreaChart>
                            </ChartContainer>
                          ) : (
                            <p className="text-xs text-muted-foreground">No WIP data.</p>
                          )}
                          <details className="mt-3 rounded-lg border border-border/50 bg-muted/20 px-3 py-2">
                            <summary className="cursor-pointer list-none text-xs font-medium text-primary">Learn</summary>
                            <div className="mt-2 space-y-2 text-xs text-muted-foreground">
                              <p>
                                Avg {avg.toFixed(1)} open, predicted {(wip?.predictedWip ?? 0).toFixed(1)} open, error {err.toFixed(0)} percent.
                              </p>
                              <p>Throughput {(wip?.throughputPerDay ?? 0).toFixed(2)} per day, cycle {(wip?.cycleMeanDays ?? 0).toFixed(1)} days, window {wip?.windowDays ?? 90} days.</p>
                              <p>Flow is steady when error under 20 percent.</p>
                            </div>
                          </details>
                        </CardContent>
                      </>
                    )
                  })()}
                </Card>
                <Card className="border border-border/50 rounded-lg shadow-none">
                  {(() => {
                    const rate = data.abandon?.abandonedRate ?? 0
                    const closed = data.abandon?.closed ?? 0
                    const merged = data.abandon?.merged ?? 0
                    const totalClosed = merged + closed
                    const health: "green" | "amber" | "red" = rate >= 20 ? "red" : rate >= 10 ? "amber" : "green"
                    const dotClass = health === "green" ? "bg-green-500" : health === "amber" ? "bg-amber-500" : "bg-red-500"
                    const badgeClass =
                      health === "red"
                        ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 border-red-200 dark:border-red-800"
                        : health === "amber"
                          ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 border-amber-200 dark:border-amber-800"
                          : "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 border-green-200 dark:border-green-800"
                    const label = health === "green" ? "Healthy" : health === "amber" ? "Watch" : "Action"
                    const oneIn = rate > 0 ? Math.round(100 / rate) : 0
                    return (
                      <>
                        <CardHeader className="pb-2">
                          <div className="flex items-center justify-between gap-2">
                            <CardTitle className="flex items-center gap-2 text-sm font-medium">
                              <span className={`size-2 rounded-full ${dotClass}`} aria-hidden />
                              Shipped or wasted
                            </CardTitle>
                            <Badge variant="secondary" className={`shrink-0 border px-2 py-0.5 text-[11px] font-medium ${badgeClass}`}>
                              {label}
                            </Badge>
                          </div>
                          <CardDescription className="truncate text-xs">
                            {rate > 0 ? `${rate.toFixed(1)} percent wasted` : "Almost all work ships"}
                          </CardDescription>
                        </CardHeader>
                        <CardContent>
                          <div className="flex items-baseline justify-between gap-2">
                            <div className="text-2xl font-semibold tabular-nums">{rate > 0 ? `${rate.toFixed(1)}% wasted` : "No waste"}</div>
                            <span className={`size-3 rounded-full ${dotClass}`} aria-label={health} />
                          </div>
                          <p className="truncate text-[11px] text-muted-foreground">
                            {rate > 0 ? `1 in ${oneIn} decided PRs never ships` : `${closed} closed without merge`} {totalClosed ? `· ${closed} of ${totalClosed} decided (open PRs excluded)` : ""}
                          </p>
                          <ChartContainer
                            config={{
                              "Merged (good)": { label: "Merged (good)", color: "var(--chart-2)" },
                              "Closed without merge (wasted)": { label: "Closed without merge (wasted)", color: "var(--chart-3)" },
                              "Still open": { label: "Still open", color: "var(--chart-5)" },
                            }}
                            className="mx-auto mt-2 aspect-square max-h-[160px]"
                          >
                            <PieChart>
                              <Pie data={data.abandon?.segments ?? []} dataKey="count" nameKey="label" cx="50%" cy="50%" innerRadius={36} outerRadius={56} paddingAngle={2}>
                                {(data.abandon?.segments ?? []).map((e: any) => (
                                  <Cell key={e.label} fill={e.color} stroke="var(--background)" strokeWidth={1} />
                                ))}
                              </Pie>
                              <ChartTooltip content={<AbandonTip />} />
                            </PieChart>
                          </ChartContainer>
                          <details className="mt-3 rounded-lg border border-border/50 bg-muted/20 px-3 py-2">
                            <summary className="cursor-pointer list-none text-xs font-medium text-primary">Learn</summary>
                            <div className="mt-2 space-y-2 text-xs text-muted-foreground">
                              <p>Abandoned rate is closed-without-merge divided by merged plus closed — still-open PRs are excluded, so it overstates waste while many PRs are undecided.</p>
                              <p>Healthy under 10 percent, watch 10 to 20, high waste over 20.</p>
                              {data.abandon?.bySize ? (
                                <div>
                                  <p className="font-medium text-foreground">By size</p>
                                  <div className="mt-1 flex flex-wrap gap-1">
                                    {Object.entries(data.abandon.bySize as Record<string, number>).map(([k, v]) => (
                                      <span key={k} className="rounded-full border border-border/50 px-2 py-0.5 text-[11px]">
                                        {k} {v}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              ) : null}
                              <Link to="/pulls?state=closed" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                                View closed PRs
                              </Link>
                            </div>
                          </details>
                        </CardContent>
                      </>
                    )
                  })()}
                </Card>
              </div>
            </div>
          ) : null}

          {/* CI lives on the dedicated /ci page — no duplication here. */}
          <WhatWeShip overview={overview} />
          <WhenWeShip overview={overview} />

            </>
          </div>
        </div>
      ) : null}
    </>
  )
}
