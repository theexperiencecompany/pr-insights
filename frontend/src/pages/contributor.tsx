import { Flame } from 'lucide-react'
import { useMemo } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import {
  Area,
  AreaChart,
  Brush,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  XAxis,
  YAxis,
} from 'recharts'

import { EmptyState } from '@/components/empty-state'
import { Heatmap } from '@/components/heatmap'
import { Loading } from '@/components/loading'
import { PrRow } from '@/components/pr-row'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import {
  ChartContainer,
  ChartTooltip,
  type ChartConfig,
} from '@/components/ui/chart'
import { TipShell, TipRow, getPayloadColor } from '@/components/chart-tips'
import { avatarUrl, getContributor } from '@/lib/api'
import { comma, compact, formatDate } from '@/lib/format'
import { useApi } from '@/lib/use-api'

const mergedConfig = {
  merged: { label: 'Merged', color: 'var(--chart-1)' },
} satisfies ChartConfig

const cycleConfig = {
  cycle: { label: 'Cycle time', color: 'var(--chart-4)' },
} satisfies ChartConfig

function MergedTip({ active, payload, label }: Partial<import('recharts').TooltipContentProps<number, string>>) {
  if (!active || !payload?.length) return null
  const entry = payload[0]
  if (entry?.value == null) return null
  const col = getPayloadColor(entry) ?? "var(--chart-1)"
  return (
    <TipShell label={label}>
      <TipRow color={col as string} label="Merged" value={`${comma(Number(entry.value))} PRs`} />
    </TipShell>
  )
}
function CycleTip({ active, payload, label }: Partial<import('recharts').TooltipContentProps<number, string>>) {
  if (!active || !payload?.length) return null
  const entry = payload[0]
  if (entry?.value == null) return null
  const col = getPayloadColor(entry) ?? "var(--chart-4)"
  return (
    <TipShell label={label}>
      <TipRow color={col as string} label="Median" value={`${Number(entry.value).toFixed(1)} days`} />
    </TipShell>
  )
}


function SectionTitle({ children }: { children: string }) {
  return <div className="text-sm font-semibold">{children}</div>
}

export default function ContributorPage() {
  const { login = '' } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const gran = searchParams.get('gran') === 'week' ? 'week' : 'month'
  const { data, loading, error } = useApi(() => getContributor(login, { gran }), [login, gran])

  const fromParam = searchParams.get('from')
  const toParam = searchParams.get('to')

  const weeklyTickFormatter = (value: string, index: number): string => {
    if (gran !== 'week') return value
    let bucket: any = data?.monthly[index]
    if (!bucket || bucket.label !== value) {
      bucket = (data?.monthly as any[])?.find((b: any) => b.label === value)
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
    if (gran !== 'week' || !data?.monthly) return [] as string[]
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
  }, [data?.monthly, gran])

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

  if (loading) return <Loading />
  if (error) return <EmptyState text={error} />
  if (!data) return null

  const c = data.contributor
  const cycleData = data.monthly
    .filter((b) => b.cycleCount > 0)
    .map((b) => ({ label: b.label, cycle: b.cycleMedianDays }))

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

  const hasBrush = data.monthly.length > 6

  return (
    <div className="flex flex-col gap-4">
      <Link to="/people" className="text-sm font-medium text-blue-600 hover:underline dark:text-blue-400">
        ← People
      </Link>

      <div className="flex flex-wrap items-center gap-4">
        <img src={avatarUrl(login)} alt="" className="size-12 rounded-full" loading="lazy" />
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold">{login}</h1>
            {data.isBot && <Badge variant="secondary">bot</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">
            {comma(c.merged)} merged · <span className="text-green-600 dark:text-green-400">+{comma(c.additions)}</span>{' '}
            <span className="text-red-600 dark:text-red-400">−{comma(c.deletions)}</span> ·{' '}
            {comma(c.reposCount)} repos
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2 text-xs">
          {c.currentStreak >= 2 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 font-semibold text-amber-700 dark:bg-amber-400/15 dark:text-amber-400">
              <Flame className="size-3.5" />
              {c.currentStreak}w streak
            </span>
          )}
          {c.longestStreak > 0 && (
            <span className="rounded-full bg-muted px-2.5 py-1 text-muted-foreground">
              longest {c.longestStreak}w
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-muted-foreground">Shipping</span>
        <div className="inline-flex rounded-md border">
          <button type="button" onClick={() => { const n=new URLSearchParams(searchParams); n.set('gran', 'month'); setSearchParams(n, {replace:true}) }} className={gran==='month' ? 'bg-muted px-3 py-1 text-xs font-medium' : 'px-3 py-1 text-xs text-muted-foreground'}>Monthly</button>
          <button type="button" onClick={() => { const n=new URLSearchParams(searchParams); n.set('gran', 'week'); setSearchParams(n, {replace:true}) }} className={gran==='week' ? 'bg-muted px-3 py-1 text-xs font-medium' : 'px-3 py-1 text-xs text-muted-foreground'}>Weekly</button>
        </div>
      </div>

      {fromParam && toParam ? (
        <div className="text-[11px] text-muted-foreground">
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
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <SectionTitle>{gran === 'week' ? 'Merged by week' : 'Merged by month'}</SectionTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={mergedConfig} className="aspect-auto h-56">
              <AreaChart data={data.monthly} margin={{ left: 0, right: 8, top: 4 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} tickFormatter={weeklyTickFormatter} />
                <YAxis tickLine={false} axisLine={false} width={36} tickFormatter={(v) => compact(Number(v))} />
                {yearBoundaries.map((x) => (
                  <ReferenceLine key={x} x={x} stroke="var(--border)" strokeDasharray="3 3" />
                ))}
                <ChartTooltip cursor={{ stroke: 'var(--border)' }} content={<MergedTip />} />
                <Area
                  type="monotone"
                  dataKey="merged"
                  stroke="var(--color-merged)"
                  strokeWidth={2}
                  fill="var(--color-merged)"
                  fillOpacity={0.2}
                  activeDot={{ r: 4 }}
                />
                {hasBrush ? (
                  <Brush dataKey="label" height={24} fill="var(--muted)" stroke="var(--border)" travellerWidth={12} onChange={handleBrushChange} />
                ) : null}
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <SectionTitle>{gran === 'week' ? 'Cycle time by week' : 'Cycle time by month'}</SectionTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={cycleConfig} className="aspect-auto h-56">
              <LineChart data={cycleData} margin={{ left: 0, right: 8, top: 4 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} tickFormatter={weeklyTickFormatter} />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={36}
                  tickFormatter={(v: number) => `${v}d`}
                />
                {yearBoundaries.map((x) => (
                  <ReferenceLine key={x} x={x} stroke="var(--border)" strokeDasharray="3 3" />
                ))}
                <ChartTooltip content={<CycleTip />} />
                <Line
                  type="monotone"
                  dataKey="cycle"
                  stroke="var(--color-cycle)"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
                {hasBrush ? (
                  <Brush dataKey="label" height={24} fill="var(--muted)" stroke="var(--border)" travellerWidth={12} onChange={handleBrushChange} />
                ) : null}
              </LineChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <SectionTitle>Activity — last 365 days</SectionTitle>
          {fromParam && toParam ? (
            <span className="text-[11px] text-muted-foreground">highlight {fromParam}→{toParam}</span>
          ) : null}
        </CardHeader>
        <CardContent>
          <Heatmap dates={data.heatmap} highlightFrom={highlightFrom} highlightTo={highlightTo} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <SectionTitle>Merged pull requests</SectionTitle>
        </CardHeader>
        <div>
          {data.merged.map((p) => (
            <PrRow key={`${p.repo}#${p.number}`} pull={p} />
          ))}
        </div>
      </Card>

      <p className="text-xs text-muted-foreground">
        First merged {formatDate(c.first)} · last merged {formatDate(c.last)}
      </p>
    </div>
  )
}
