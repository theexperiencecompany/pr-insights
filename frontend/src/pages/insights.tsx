import { useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { DefaultLegendContentProps, TooltipContentProps } from 'recharts'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from 'recharts'
import { CheckCircle2, CircleDashed, XCircle } from 'lucide-react'

import { EmptyState } from '@/components/empty-state'
import { Loading } from '@/components/loading'
import { PageHeader } from '@/components/page-header'
import { StatCard } from '@/components/stat-card'
import { getInsights, getStatus } from '@/lib/api'
import { comma, compact, fmtDuration, formatDate } from '@/lib/format'
import { useApi } from '@/lib/use-api'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  ChartContainer,
  ChartLegend,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
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

const ciConfig = {
  success: { label: 'Success', color: 'var(--chart-2)' },
  failure: { label: 'Failure', color: 'var(--chart-3)' },
  other: { label: 'Cancelled & other', color: 'var(--chart-5)' },
  rate: { label: 'Success rate', color: 'var(--chart-2)' },
  duration: { label: 'Median duration', color: 'var(--chart-1)' },
} satisfies ChartConfig

function Filter({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex items-center gap-2 text-xs text-muted-foreground">
      {label}
      {children}
    </label>
  )
}

function TipShell({ label, children }: { label?: string | number; children: ReactNode }) {
  return (
    <div className="grid min-w-32 items-start gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
      {label !== undefined ? <div className="font-medium">{String(label)}</div> : null}
      {children}
    </div>
  )
}

function TipRow({ color, label, value }: { color?: string; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-1.5">
        {color ? (
          <span className="size-2 shrink-0 rounded-[2px]" style={{ backgroundColor: color }} />
        ) : null}
        <span className="text-muted-foreground">{label}</span>
      </div>
      <span className="font-mono font-medium text-foreground tabular-nums">{value}</span>
    </div>
  )
}

function MergedTip({ active, payload, label }: Partial<TooltipContentProps<number, string>>) {
  if (!active || !payload?.length) return null
  const merged = Number(payload[0]?.value ?? 0)
  return (
    <TipShell label={label}>
      <div className="font-mono font-medium tabular-nums">
        {merged.toLocaleString()} PRs merged
      </div>
    </TipShell>
  )
}

function LinesTip({ active, payload, label }: Partial<TooltipContentProps<number, string>>) {
  if (!active || !payload?.length) return null
  const lines = Number(payload[0]?.value ?? 0)
  return (
    <TipShell label={label}>
      <div className="font-mono font-medium tabular-nums">{lines.toLocaleString()} lines</div>
    </TipShell>
  )
}

function CycleTip({ active, payload, label }: Partial<TooltipContentProps<number, string>>) {
  if (!active || !payload?.length) return null
  const days = Number(payload[0]?.value ?? 0)
  return (
    <TipShell label={label}>
      <div className="font-mono font-medium tabular-nums">{days.toFixed(1)} days</div>
    </TipShell>
  )
}

function RateTip({ active, payload, label }: Partial<TooltipContentProps<number, string>>) {
  if (!active || !payload?.length) return null
  const rate = Number(payload[0]?.value ?? 0)
  return (
    <TipShell label={label}>
      <div className="font-mono font-medium tabular-nums">{rate.toFixed(1)}%</div>
    </TipShell>
  )
}

function DurationTip({ active, payload, label }: Partial<TooltipContentProps<number, string>>) {
  if (!active || !payload?.length) return null
  const minutes = Number(payload[0]?.value ?? 0)
  return (
    <TipShell label={label}>
      <div className="font-mono font-medium tabular-nums">{fmtDuration(minutes)}</div>
    </TipShell>
  )
}

function CiTip({
  active,
  payload,
  label,
  hidden,
}: Partial<TooltipContentProps<number, string>> & { hidden?: Record<string, boolean> }) {
  if (!active || !payload?.length) return null
  const rows = payload.filter((entry) => !hidden?.[String(entry.dataKey)])
  if (!rows.length) return null
  const total = rows.reduce((sum, entry) => sum + Number(entry.value ?? 0), 0)
  return (
    <TipShell label={label}>
      {rows.map((entry) => (
        <TipRow
          key={String(entry.dataKey)}
          color={entry.color}
          label={String(entry.name ?? entry.dataKey)}
          value={Number(entry.value ?? 0).toLocaleString()}
        />
      ))}
      <div className="flex items-center justify-between gap-4 border-t border-border/50 pt-1.5">
        <span className="text-muted-foreground">Total</span>
        <span className="font-mono font-medium tabular-nums">{total.toLocaleString()}</span>
      </div>
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
              <span
                className="size-2 shrink-0 rounded-[2px]"
                style={{ backgroundColor: item.color }}
              />
              <span className="text-muted-foreground">{item.value}</span>
            </button>
          )
        })}
    </div>
  )
}

function ConclusionIcon({ conclusion }: { conclusion: string }) {
  if (conclusion === 'success') {
    return <CheckCircle2 className="size-4 shrink-0 text-chart-2" />
  }
  if (conclusion === 'failure') {
    return <XCircle className="size-4 shrink-0 text-chart-3" />
  }
  return <CircleDashed className="size-4 shrink-0 text-chart-5" />
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

export default function InsightsPage() {
  const [searchParams, setSearchParams] = useSearchParams()

  const repo = searchParams.get('repo') ?? ''
  const rawPeriod = searchParams.get('period')
  const period: Period = PERIODS.includes(rawPeriod as Period) ? (rawPeriod as Period) : '6m'
  const rawGran = searchParams.get('gran')
  const gran: Gran = GRANS.includes(rawGran as Gran) ? (rawGran as Gran) : 'month'

  const { data, loading, error } = useApi(
    () => getInsights({ repo: repo || undefined, period, gran }),
    [repo, period, gran],
  )
  const { data: status } = useApi(getStatus)

  const [hidden, setHidden] = useState<Record<string, boolean>>({})

  const updateParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams)
    if (value) next.set(key, value)
    else next.delete(key)
    setSearchParams(next)
  }

  const repoOptions = useMemo(() => {
    const names = new Set((data?.repoOptions ?? []).map((r) => r.name))
    if (repo && !names.has(repo)) names.add(repo)
    return Array.from(names)
  }, [data, repo])

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
  const mergedData = useMemo(() => {
    if (!data) return []
    const window = gran === 'week' ? 5 : 3
    const rows: { label: string; merged: number | null; ma: number | null; prev: number | null; forecast: number | null }[] = data.ship.map((b, i) => {
      const lo = Math.max(0, i - window + 1)
      const slice = data.ship.slice(lo, i + 1)
      const ma = slice.reduce((s, x) => s + x.merged, 0) / slice.length
      return { label: b.label, merged: b.merged, ma: ma, prev: null, forecast: null }
    })
    if ((data.shipPrev ?? []).length === data.ship.length) {
      ;(data.shipPrev ?? []).forEach((b, i) => {
        rows[i].prev = b.merged
      })
    }
    // least-squares forecast over merged
    const ys = rows.map((r) => r.merged ?? 0)
    const n = ys.length
    if (n >= 4) {
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
      for (let k = 1; k <= 3; k++) {
        const x = n - 1 + k
        rows.push({ label: `+${k}`, merged: null, ma: null, prev: null, forecast: Math.max(0, slope * x + intercept) })
      }
    }
    return rows
  }, [data, gran])

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

  const ciMinutesData = useMemo(
    () => data?.ci.map((b) => ({ label: b.label, minutes: b.totalMinutes })) ?? [],
    [data],
  )

  const [showAllWorkflows, setShowAllWorkflows] = useState(false)
  const visibleWorkflows = data?.workflows.slice(0, showAllWorkflows ? undefined : 8) ?? []

  const toggleSeries = (key: string) => setHidden((h) => ({ ...h, [key]: !h[key] }))

  const org = status?.org

  return (
    <>
      <PageHeader title="Insights" description="Ship velocity and CI health" />

      <div className="mb-6 flex flex-wrap items-center gap-x-5 gap-y-3">
        <Filter label="Repository">
          <Select value={repo} onValueChange={(v) => updateParam('repo', v)}>
            <SelectTrigger size="sm" className="min-w-44">
              <SelectValue placeholder="All repositories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All repositories</SelectItem>
              {repoOptions.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Filter>
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
      </div>

      {loading ? (
        <Loading />
      ) : error ? (
        <EmptyState text={error} />
      ) : data ? (
        <>
          <SectionHeading>Shipping</SectionHeading>

          {data.ship.length === 0 ? (
            <Card className="mt-4">
              <EmptyState text="No pull request data for this filter." />
            </Card>
          ) : (
            <>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <ChartCard title="Pull requests merged">
                  <ChartContainer config={shipConfig} className="aspect-auto h-64">
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
                      />
                      <YAxis tickLine={false} axisLine={false} tickFormatter={compact} />
                      <ChartTooltip content={<MergedTip />} />
                      {mergedData.some((r) => r.prev !== null) && (
                        <Line
                          type="monotone"
                          dataKey="prev"
                          name="Last year"
                          stroke="var(--chart-5)"
                          strokeWidth={1.5}
                          strokeDasharray="4 4"
                          dot={false}
                          activeDot={false}
                        />
                      )}
                      <Area
                        type="monotone"
                        dataKey="merged"
                        stroke="var(--color-merged)"
                        strokeWidth={2}
                        fill="url(#fillMerged)"
                        activeDot={{ r: 4 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="ma"
                        name="Moving average"
                        stroke="var(--chart-5)"
                        strokeWidth={1.5}
                        strokeDasharray="4 4"
                        dot={false}
                        activeDot={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="forecast"
                        name="Forecast"
                        stroke="var(--chart-1)"
                        strokeWidth={1.5}
                        strokeDasharray="6 3"
                        dot={false}
                        activeDot={false}
                      />
                    </AreaChart>
                  </ChartContainer>
                  {period !== '12m' && (
                    <p className="mt-2 text-[11px] text-muted-foreground">
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
                      />
                      <YAxis tickLine={false} axisLine={false} tickFormatter={compact} />
                      <ChartTooltip content={<LinesTip />} />
                      <Area
                        type="monotone"
                        dataKey="lines"
                        stroke="var(--color-lines)"
                        strokeWidth={2}
                        fill="url(#fillLines)"
                        activeDot={{ r: 4 }}
                      />
                    </AreaChart>
                  </ChartContainer>
                </ChartCard>
              </div>

              <div className="mt-4 grid gap-4">
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
                      />
                      <YAxis
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(v: number) => `${v}d`}
                      />
                      <ChartTooltip content={<CycleTip />} />
                      <Line
                        type="monotone"
                        dataKey="cycle"
                        stroke="var(--color-cycle)"
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4 }}
                      />
                    </LineChart>
                  </ChartContainer>
                </ChartCard>
              </div>

              <div className="mt-4 grid gap-4">
                <ChartCard title="Cumulative lines shipped">
                  <ChartContainer config={shipConfig} className="aspect-auto h-56">
                    <AreaChart data={cumulativeData} margin={{ left: 0, right: 8, top: 4 }}>
                      <CartesianGrid vertical={false} />
                      <XAxis
                        dataKey="label"
                        tickLine={false}
                        axisLine={false}
                        tickMargin={8}
                        minTickGap={24}
                      />
                      <YAxis
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(v: number) => compact(Number(v))}
                      />
                      <ChartTooltip
                        content={
                          <ChartTooltipContent
                            formatter={(value) => `${comma(Number(value))} lines`}
                          />
                        }
                      />
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
                    </AreaChart>
                  </ChartContainer>
                </ChartCard>
              </div>
            </>
          )}

          <SectionHeading>CI</SectionHeading>

          {data.ci.length === 0 ? (
            <Card className="mt-4">
              <EmptyState text="No workflow runs found for this filter." />
            </Card>
          ) : (
            <>
              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard label="Workflow runs" value={comma(data.ciStats.totalRuns)} />
                <Card className="rounded-[6px]">
                  <CardContent className="p-4">
                    <div className="text-2xl font-semibold tabular-nums text-chart-2">
                      {data.ciStats.successRate != null && Number.isFinite(data.ciStats.successRate)
                        ? `${data.ciStats.successRate.toFixed(1)}%`
                        : '—'}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">Success rate</div>
                  </CardContent>
                </Card>
                <StatCard
                  label="Median duration"
                  value={
                    data.ciStats.medianDuration > 0 ? fmtDuration(data.ciStats.medianDuration) : '—'
                  }
                />
                <StatCard label="Workflows" value={comma(data.ciStats.workflows)} />
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <ChartCard title="Workflow runs">
                  <ChartContainer config={ciConfig} className="aspect-auto h-64">
                    <BarChart data={data.ci} margin={{ left: 0, right: 8, top: 4 }}>
                      <CartesianGrid vertical={false} />
                      <XAxis
                        dataKey="label"
                        tickLine={false}
                        axisLine={false}
                        tickMargin={8}
                        minTickGap={24}
                      />
                      <YAxis tickLine={false} axisLine={false} tickFormatter={compact} />
                      <ChartTooltip content={<CiTip hidden={hidden} />} />
                      <ChartLegend content={<ToggleLegend hiddenSeries={hidden} onToggleSeries={toggleSeries} />} />
                      <Bar
                        dataKey="success"
                        name="Success"
                        stackId="ci"
                        fill="var(--color-success)"
                        hide={Boolean(hidden.success)}
                      />
                      <Bar
                        dataKey="failure"
                        name="Failure"
                        stackId="ci"
                        fill="var(--color-failure)"
                        hide={Boolean(hidden.failure)}
                      />
                      <Bar
                        dataKey="other"
                        name="Cancelled & other"
                        stackId="ci"
                        fill="var(--color-other)"
                        hide={Boolean(hidden.other)}
                        radius={[2, 2, 0, 0]}
                      />
                    </BarChart>
                  </ChartContainer>
                </ChartCard>

                <ChartCard title="Success rate">
                  <ChartContainer config={ciConfig} className="aspect-auto h-64">
                    <LineChart data={data.ci} margin={{ left: 0, right: 8, top: 4 }}>
                      <CartesianGrid vertical={false} />
                      <XAxis
                        dataKey="label"
                        tickLine={false}
                        axisLine={false}
                        tickMargin={8}
                        minTickGap={24}
                      />
                      <YAxis
                        domain={[0, 100]}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(v: number) => `${v}%`}
                      />
                      <ChartTooltip content={<RateTip />} />
                      <Line
                        type="monotone"
                        dataKey="rate"
                        stroke="var(--color-rate)"
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4 }}
                      />
                    </LineChart>
                  </ChartContainer>
                </ChartCard>
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <ChartCard title="CI minutes per bucket">
                  <ChartContainer config={ciConfig} className="aspect-auto h-64">
                    <BarChart data={ciMinutesData} margin={{ left: 0, right: 8, top: 4 }}>
                      <CartesianGrid vertical={false} />
                      <XAxis
                        dataKey="label"
                        tickLine={false}
                        axisLine={false}
                        tickMargin={8}
                        minTickGap={24}
                      />
                      <YAxis
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(v: number) => compact(Number(v))}
                      />
                      <ChartTooltip
                        cursor={{ fill: 'var(--muted)' }}
                        content={
                          <ChartTooltipContent
                            formatter={(value) => `${comma(Number(value))} min`}
                          />
                        }
                      />
                      <Bar
                        dataKey="minutes"
                        name="Minutes"
                        fill="var(--chart-1)"
                        radius={[3, 3, 0, 0]}
                      />
                    </BarChart>
                  </ChartContainer>
                </ChartCard>

                <ChartCard title="Median duration">
                  <ChartContainer config={ciConfig} className="aspect-auto h-64">
                    <LineChart data={data.ci} margin={{ left: 0, right: 8, top: 4 }}>
                      <CartesianGrid vertical={false} />
                      <XAxis
                        dataKey="label"
                        tickLine={false}
                        axisLine={false}
                        tickMargin={8}
                        minTickGap={24}
                      />
                      <YAxis
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(v: number) => `${v}m`}
                      />
                      <ChartTooltip content={<DurationTip />} />
                      <Line
                        type="monotone"
                        dataKey="duration"
                        stroke="var(--color-duration)"
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4 }}
                      />
                    </LineChart>
                  </ChartContainer>
                </ChartCard>
              </div>

              <ChartCard title="Workflows" className="mt-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Workflow</TableHead>
                      <TableHead>Repository</TableHead>
                      <TableHead className="text-right">Runs</TableHead>
                      <TableHead className="text-right">Success rate</TableHead>
                      <TableHead>Trend (6 mo)</TableHead>
                      <TableHead className="text-right">Median</TableHead>
                      <TableHead className="text-right">Longest</TableHead>
                      <TableHead className="text-right">Last run</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleWorkflows.map((wf) => {
                      const repoHref = org
                        ? `https://github.com/${org}/${wf.repo}/actions`
                        : null
                      return (
                        <TableRow key={`${wf.repo}/${wf.workflow}`}>
                          <TableCell className="max-w-[240px]">
                            <div className="flex items-center gap-2">
                              <ConclusionIcon conclusion={wf.lastConclusion} />
                              <span className="truncate font-semibold">{wf.workflow}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            {repoHref ? (
                              <a
                                href={repoHref}
                                target="_blank"
                                rel="noreferrer"
                                className="text-primary hover:underline"
                              >
                                {wf.repo}
                              </a>
                            ) : (
                              <span className="text-muted-foreground">{wf.repo}</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {comma(wf.runs)}
                          </TableCell>
                          <TableCell
                            className={cn(
                              'text-right tabular-nums',
                              wf.successRate >= 90 ? 'text-chart-2' : 'text-chart-3',
                            )}
                          >
                            {wf.successRate.toFixed(1)}%
                          </TableCell>
                          <TableCell>
                            <div
                              className="flex items-center gap-1"
                              title={`Monthly success rate: ${wf.trend
                                .map((v) => (v < 0 ? '–' : `${v.toFixed(0)}%`))
                                .join(' · ')}`}
                            >
                              {wf.trend.map((v, i) => (
                                <span
                                  key={i}
                                  className={cn(
                                    'size-2 rounded-full',
                                    v < 0
                                      ? 'bg-muted'
                                      : v >= 90
                                        ? 'bg-chart-2'
                                        : v >= 50
                                          ? 'bg-amber-500'
                                          : 'bg-chart-3',
                                  )}
                                />
                              ))}
                            </div>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {fmtDuration(wf.medianDurationMin)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {fmtDuration(wf.longestDurationMin)}
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground">
                            {formatDate(wf.lastRunAt) || 'Never'}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
                {data.workflows.length > 8 && (
                  <div className="border-t border-border px-4 py-2">
                    <button
                      type="button"
                      onClick={() => setShowAllWorkflows((s) => !s)}
                      className="text-sm font-medium text-primary hover:underline"
                    >
                      {showAllWorkflows
                        ? `Show fewer`
                        : `Show all (${data.workflows.length})`}
                    </button>
                  </div>
                )}
              </ChartCard>
            </>
          )}
        </>
      ) : null}
    </>
  )
}
