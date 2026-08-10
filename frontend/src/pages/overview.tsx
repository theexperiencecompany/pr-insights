import { TrendingDown, TrendingUp } from 'lucide-react'
import { useState } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from 'recharts'

import { ContributorBar } from '@/components/contributor-bar'
import { EmptyState } from '@/components/empty-state'
import { Loading } from '@/components/loading'
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { avatarUrl, getOverview, type OverviewData } from '@/lib/api'
import { comma, compact } from '@/lib/format'
import { useApi } from '@/lib/use-api'
import { cn } from '@/lib/utils'

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

function SectionTitle({ children }: { children: string }) {
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
    <div className="grid grid-cols-2 divide-x divide-border overflow-hidden rounded-[6px] border border-border sm:grid-cols-4 xl:grid-cols-8">
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
  const up = pct > 0
  const flat = pct === 0
  return (
    <Card className="rounded-[6px]">
      <CardContent className="p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-muted-foreground">{v.label}</span>
          {flat ? (
            <span className="text-xs font-semibold tabular-nums text-muted-foreground">—</span>
          ) : up ? (
            <span className="flex items-center gap-1 text-xs font-semibold tabular-nums text-green-600 dark:text-green-400">
              <TrendingUp className="size-3.5" />
              +{pct.toFixed(0)}%
            </span>
          ) : (
            <span className="flex items-center gap-1 text-xs font-semibold tabular-nums text-red-600 dark:text-red-400">
              <TrendingDown className="size-3.5" />
              {pct.toFixed(0)}%
            </span>
          )}
        </div>
        <div className="mt-1 text-xl font-semibold tabular-nums">{comma(v.current)}</div>
        <div className="text-[11px] text-muted-foreground">
          merged · vs {comma(v.previous)} last {v.label.replace('This ', '').toLowerCase()}
        </div>
      </CardContent>
    </Card>
  )
}

function BotBusCard({ data }: { data: OverviewData }) {
  const { bot, bus } = data
  const total = bot.humanMerged + bot.botMerged
  const humanPct = total > 0 ? ((bot.humanMerged / total) * 100).toFixed(0) : '0'
  const botPct = total > 0 ? ((bot.botMerged / total) * 100).toFixed(0) : '0'
  return (
    <Card className="rounded-[6px]">
      <CardContent className="flex h-full flex-col justify-center gap-3 p-4">
        <div>
          <div className="text-xs font-medium text-muted-foreground">
            Bot vs human merges
          </div>
          <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-muted">
            <div className="bg-[var(--chart-2)]" style={{ width: `${humanPct}%` }} />
            <div className="bg-[var(--chart-5)]" style={{ width: `${botPct}%` }} />
          </div>
          <div className="mt-1.5 flex justify-between text-xs tabular-nums text-muted-foreground">
            <span className="text-green-600 dark:text-green-400">
              Humans {comma(bot.humanMerged)} ({humanPct}%)
            </span>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="cursor-default">
                  Bots {comma(bot.botMerged)} ({botPct}%)
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs">{bot.bots.length ? bot.bots.join(', ') : 'No bot activity'}</p>
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex -space-x-1.5">
            {bus.top.map((c) => (
              <img
                key={c.login}
                src={avatarUrl(c.login)}
                alt=""
                className="size-5 rounded-full ring-2 ring-card"
                loading="lazy"
              />
            ))}
          </div>
          <span className="text-xs text-muted-foreground">
            Top 3 authors ship <span className="font-semibold text-foreground">{bus.top3Share.toFixed(0)}%</span>{' '}
            of merges
          </span>
        </div>
      </CardContent>
    </Card>
  )
}

function WhenWeShip({ data }: { data: OverviewData }) {
  const weekday = data.shipDist.weekday.map((v, i) => ({
    day: data.shipDist.weekdayLabels[i] ?? String(i),
    merged: v,
  }))
  const hour = data.shipDist.hour.map((v, i) => ({ hour: `${i}h`, merged: v }))
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card className="rounded-[6px]">
        <CardHeader className="pb-2">
          <SectionTitle>Merges by weekday</SectionTitle>
        </CardHeader>
        <CardContent>
          <ChartContainer config={weekdayChartConfig} className="aspect-auto h-36">
            <BarChart data={weekday} margin={{ left: 0, right: 4, top: 4 }}>
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
        <CardHeader className="pb-2">
          <SectionTitle>Merges by hour</SectionTitle>
        </CardHeader>
        <CardContent>
          <ChartContainer config={hourChartConfig} className="aspect-auto h-36">
            <BarChart data={hour} margin={{ left: 0, right: 4, top: 4 }}>
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
        Times in {data.shipDist.zone} (server local time)
      </div>
    </div>
  )
}

function OverviewContent({ data }: { data: OverviewData }) {
  const top = data.topContributors.slice(0, 10)
  const maxMerged = Math.max(1, ...top.map((c) => c.merged))
  const [hideReleases, setHideReleases] = useState(true)
  const largest = (hideReleases
    ? data.largest.filter(({ pull }) => !/release/i.test(pull.title))
    : data.largest
  ).slice(0, 5)

  return (
    <div className="flex flex-col gap-4">
      <StatStrip data={data} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {data.velocity.map((v) => (
          <VelocityCard key={v.label} v={v} />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <SectionTitle>Merged pull requests by month</SectionTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={mergedChartConfig} className="h-[300px]">
              <AreaChart data={data.monthly} margin={{ left: 4, right: 4, top: 4 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
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
                <Area
                  dataKey="merged"
                  type="natural"
                  stroke="var(--color-merged)"
                  strokeWidth={2}
                  fill="var(--color-merged)"
                  fillOpacity={0.2}
                />
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <SectionTitle>Lines changed by month</SectionTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={linesChartConfig} className="h-[300px]">
              <BarChart data={data.monthly} margin={{ left: 4, right: 4, top: 4 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  width={40}
                  tickFormatter={(v) => compact(Number(v))}
                />
                <ChartTooltip cursor={{ fill: 'var(--muted)' }} content={<ChartTooltipContent />} />
                <Bar dataKey="additions" stackId="lines" fill="var(--color-additions)" />
                <Bar dataKey="deletions" stackId="lines" fill="var(--color-deletions)" />
                <ChartLegend content={<ChartLegendContent />} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>

      <WhenWeShip data={data} />

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

      <BotBusCard data={data} />
    </div>
  )
}

export default function OverviewPage() {
  const { data, loading, error, refetch } = useApi(() => getOverview({ largest: 15 }), [])

  if (loading) return <Loading />
  if (error) {
    return (
      <PageHeader title="Overview" description="Pull request activity across the organisation.">
        <EmptyState text={`Failed to load: ${error}`}>
          <button onClick={refetch}>Try again</button>
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
      <PageHeader
        title="Overview"
        description={`Pull request activity across ${data.org}.`}
      />
      <OverviewContent data={data} />
    </div>
  )
}
