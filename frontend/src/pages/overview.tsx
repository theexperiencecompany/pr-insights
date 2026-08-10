import { Lock } from 'lucide-react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from 'recharts'

import { EmptyState } from '@/components/empty-state'
import { Loading } from '@/components/loading'
import { PageHeader } from '@/components/page-header'
import { PrRow } from '@/components/pr-row'
import { Badge } from '@/components/ui/badge'
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

function Stat({
  label,
  value,
  valueClassName,
}: {
  label: string
  value: string
  valueClassName?: string
}) {
  return (
    <Card className="rounded-[6px]">
      <CardContent className="p-4">
        <div className={cn('text-2xl font-semibold tabular-nums', valueClassName)}>
          {value}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  )
}

function SectionTitle({ children }: { children: string }) {
  return <div className="text-sm font-semibold">{children}</div>
}

function OverviewContent({ data }: { data: OverviewData }) {
  const top = data.topContributors.slice(0, 10)
  const maxMerged = Math.max(1, ...top.map((c) => c.merged))
  const largest = data.largest.slice(0, 5)
  const recent = data.recent.slice(0, 10)

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Pull requests" value={comma(data.stats.total)} />
        <Stat
          label="Merged"
          value={comma(data.stats.merged)}
          valueClassName="text-purple-600 dark:text-purple-400"
        />
        <Stat
          label="Open"
          value={comma(data.stats.open)}
          valueClassName="text-green-600 dark:text-green-400"
        />
        <Stat label="Contributors" value={comma(data.contributors)} />
        <Stat
          label="Lines added"
          value={compact(data.stats.additions)}
          valueClassName="text-green-600 dark:text-green-400"
        />
        <Stat
          label="Lines deleted"
          value={compact(data.stats.deletions)}
          valueClassName="text-red-600 dark:text-red-400"
        />
        <Stat label="Avg PR size" value={comma(Math.round(data.stats.avgDiff))} />
        <Stat label="Files changed" value={comma(data.stats.files)} />
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
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
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
                    <ChartTooltipContent
                      formatter={(value) => `${comma(Number(value))} PRs`}
                    />
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
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  width={40}
                  tickFormatter={(v) => compact(Number(v))}
                />
                <ChartTooltip
                  cursor={{ fill: 'var(--muted)' }}
                  content={<ChartTooltipContent />}
                />
                <Bar
                  dataKey="additions"
                  stackId="lines"
                  fill="var(--color-additions)"
                />
                <Bar
                  dataKey="deletions"
                  stackId="lines"
                  fill="var(--color-deletions)"
                />
                <ChartLegend content={<ChartLegendContent />} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <SectionTitle>Top contributors</SectionTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-1.5">
              {top.map((c) => (
                <div key={c.login} className="flex items-center gap-3">
                  <img
                    src={avatarUrl(c.login)}
                    alt=""
                    className="size-5 shrink-0 rounded-full"
                    loading="lazy"
                  />
                  <a
                    href={`https://github.com/${c.login}`}
                    target="_blank"
                    rel="noreferrer"
                    className="w-32 shrink-0 truncate font-semibold text-blue-600 hover:underline dark:text-blue-400"
                  >
                    {c.login}
                  </a>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-[var(--chart-1)]"
                      style={{ width: `${(c.merged / maxMerged) * 100}%` }}
                    />
                  </div>
                  <span className="w-20 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                    {comma(c.merged)} merged
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <SectionTitle>Largest pull requests</SectionTitle>
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

      <Card>
        <CardHeader>
          <SectionTitle>Repositories</SectionTitle>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Repository</TableHead>
              <TableHead className="text-right">PRs</TableHead>
              <TableHead className="text-right">Merged</TableHead>
              <TableHead className="text-right">Open</TableHead>
              <TableHead className="text-right">Additions</TableHead>
              <TableHead className="text-right">Deletions</TableHead>
              <TableHead className="text-right">Avg diff</TableHead>
              <TableHead className="text-right">Contributors</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.repos.map((repo) => (
              <TableRow key={repo.name}>
                <TableCell className="max-w-[420px]">
                  <span className="flex items-center gap-2">
                    <a
                      href={`https://github.com/${data.org}/${repo.name}`}
                      target="_blank"
                      rel="noreferrer"
                      className="truncate font-semibold text-foreground hover:text-blue-600 dark:hover:text-blue-400"
                    >
                      {repo.name}
                    </a>
                    {repo.private ? (
                      <Lock className="size-3.5 shrink-0 text-muted-foreground" />
                    ) : null}
                    {repo.archived ? (
                      <Badge
                        variant="secondary"
                        className="text-muted-foreground"
                      >
                        archived
                      </Badge>
                    ) : null}
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {comma(repo.total)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {comma(repo.merged)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {comma(repo.open)}
                </TableCell>
                <TableCell className="text-right font-mono text-green-600 tabular-nums dark:text-green-400">
                  +{comma(repo.additions)}
                </TableCell>
                <TableCell className="text-right font-mono text-red-600 tabular-nums dark:text-red-400">
                  −{comma(repo.deletions)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {comma(Math.round(repo.avgDiff))}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {comma(repo.contributors)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Card>
        <CardHeader>
          <SectionTitle>Recently merged</SectionTitle>
        </CardHeader>
        {recent.length > 0 ? (
          <div className="flex flex-col">
            {recent.map((pull) => (
              <PrRow key={`${pull.repo}#${pull.number}`} pull={pull} />
            ))}
          </div>
        ) : (
          <CardContent>
            <div className="py-8 text-center text-sm text-muted-foreground">
              No pull requests merged yet.
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  )
}

export default function OverviewPage() {
  const { data, loading, error, refetch } = useApi(getOverview)

  return (
    <>
      <PageHeader
        title="Overview"
        description={
          data
            ? `Pull request activity across ${data.org}`
            : 'Pull request activity across your organization'
        }
      />
      {loading ? (
        <Loading />
      ) : error ? (
        <EmptyState text={error}>
          <Button variant="outline" size="sm" className="mt-4" onClick={refetch}>
            Try again
          </Button>
        </EmptyState>
      ) : !data ? (
        <EmptyState text="No data available" />
      ) : data.stats.total === 0 ? (
        <EmptyState text="Waiting for data — the first sync is in progress." />
      ) : (
        <OverviewContent data={data} />
      )}
    </>
  )
}
