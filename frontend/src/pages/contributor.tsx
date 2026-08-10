import { Flame } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
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
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { avatarUrl, getContributor } from '@/lib/api'
import { comma, compact, formatDate } from '@/lib/format'
import { useApi } from '@/lib/use-api'

const mergedConfig = {
  merged: { label: 'Merged', color: 'var(--chart-1)' },
} satisfies ChartConfig

const cycleConfig = {
  cycle: { label: 'Cycle time', color: 'var(--chart-4)' },
} satisfies ChartConfig

function SectionTitle({ children }: { children: string }) {
  return <div className="text-sm font-semibold">{children}</div>
}

export default function ContributorPage() {
  const { login = '' } = useParams()
  const { data, loading, error } = useApi(() => getContributor(login), [login])

  if (loading) return <Loading />
  if (error) return <EmptyState text={error} />
  if (!data) return null

  const c = data.contributor
  const cycleData = data.monthly
    .filter((b) => b.cycleCount > 0)
    .map((b) => ({ label: b.label, cycle: b.cycleMedianDays }))

  return (
    <div className="flex flex-col gap-4">
      <Link to="/contributors" className="text-sm font-medium text-blue-600 hover:underline dark:text-blue-400">
        ← Contributors
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

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <SectionTitle>Merged by month</SectionTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={mergedConfig} className="aspect-auto h-56">
              <AreaChart data={data.monthly} margin={{ left: 0, right: 8, top: 4 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
                <YAxis tickLine={false} axisLine={false} width={36} tickFormatter={(v) => compact(Number(v))} />
                <ChartTooltip
                  cursor={{ stroke: 'var(--border)' }}
                  content={<ChartTooltipContent formatter={(v) => `${comma(Number(v))} PRs`} />}
                />
                <Area
                  type="monotone"
                  dataKey="merged"
                  stroke="var(--color-merged)"
                  strokeWidth={2}
                  fill="var(--color-merged)"
                  fillOpacity={0.2}
                  activeDot={{ r: 4 }}
                />
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <SectionTitle>Cycle time by month</SectionTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={cycleConfig} className="aspect-auto h-56">
              <LineChart data={cycleData} margin={{ left: 0, right: 8, top: 4 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={36}
                  tickFormatter={(v: number) => `${v}d`}
                />
                <ChartTooltip
                  content={<ChartTooltipContent formatter={(v) => `${Number(v).toFixed(1)} days`} />}
                />
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
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <SectionTitle>Activity — last 365 days</SectionTitle>
        </CardHeader>
        <CardContent>
          <Heatmap dates={data.heatmap} />
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
