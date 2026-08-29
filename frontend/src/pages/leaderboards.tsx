import { useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, Download, Loader2 } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'

import {
  avatarUrl,
  getContributors,
  getLeaderboards,
  getShame,
  type RankedPull,
} from '@/lib/api'
import { comma, formatDate } from '@/lib/format'
import { useApi } from '@/lib/use-api'
import { cn } from '@/lib/utils'

import { EmptyState } from '@/components/empty-state'
import { DatePresets, FilterBar } from '@/components/filter-bar'
import { Loading } from '@/components/loading'
import { PageHeader } from '@/components/page-header'
import { Pager } from '@/components/pager'
import { StateIcon } from '@/components/state-icon'
import { VirtualizedTable } from '@/components/virtualized-table'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

type Metric =
  | 'diff'
  | 'additions'
  | 'deletions'
  | 'files'
  | 'commits'
  | 'timemerge'
  | 'commitsperfile'
  | 'ageclose'

const METRICS: { value: Metric; label: string }[] = [
  { value: 'diff', label: 'Total lines' },
  { value: 'additions', label: 'Additions' },
  { value: 'deletions', label: 'Deletions' },
  { value: 'files', label: 'Files changed' },
  { value: 'commits', label: 'Commits' },
  { value: 'timemerge', label: 'Time to merge' },
  { value: 'commitsperfile', label: 'Commits per file' },
  { value: 'ageclose', label: 'Age when closed' },
]

const STATES: { value: string; label: string }[] = [
  { value: 'merged', label: 'Merged' },
  { value: 'open', label: 'Open' },
  { value: 'closed', label: 'Closed' },
  { value: 'all', label: 'All' },
]

function formatValue(metric: Metric, value: number): string {
  switch (metric) {
    case 'timemerge': {
      const days = value / 24
      if (days >= 10) return `${Math.round(days)}d`
      if (days >= 1) return `${days.toFixed(1)}d`
      return `${Math.round(value)}h`
    }
    case 'ageclose':
      return `${Math.round(value)}d`
    case 'commitsperfile':
      return value.toFixed(1)
    default:
      return comma(value)
  }
}

// metricCol describes how the active metric is shown as its own table column.
function metricCol(metric: Metric): { label: string; cell: (r: RankedPull) => ReactNode } {
  switch (metric) {
    case 'additions':
      return {
        label: 'Additions',
        cell: (r) => (
          <span className="font-mono text-green-600 dark:text-green-400">
            +{comma(r.pull.additions)}
          </span>
        ),
      }
    case 'deletions':
      return {
        label: 'Deletions',
        cell: (r) => (
          <span className="font-mono text-red-600 dark:text-red-400">
            −{comma(r.pull.deletions)}
          </span>
        ),
      }
    case 'files':
      return { label: 'Files changed', cell: (r) => comma(r.pull.changedFiles) }
    case 'commits':
      return { label: 'Commits', cell: (r) => comma(r.pull.commits) }
    case 'timemerge':
      return { label: 'Time to merge', cell: (r) => formatValue('timemerge', r.value) }
    case 'commitsperfile':
      return { label: 'Commits / file', cell: (r) => formatValue('commitsperfile', r.value) }
    case 'ageclose':
      return { label: 'Age when closed', cell: (r) => formatValue('ageclose', r.value) }
    default:
      return {
        label: 'Total lines',
        cell: (r) => <span className="font-semibold">{comma(r.value)}</span>,
      }
  }
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

export default function LeaderboardsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [exporting, setExporting] = useState(false)

  const metricParam = searchParams.get('metric') ?? 'diff'
  const metric = METRICS.some((m) => m.value === metricParam)
    ? (metricParam as Metric)
    : 'diff'
  const stateParam = searchParams.get('state') ?? 'merged'
  const state = STATES.some((s) => s.value === stateParam) ? stateParam : 'merged'
  const order = searchParams.get('order') === 'asc' ? 'asc' : 'desc'
  const authorParam = searchParams.get('author') ?? 'all'
  const repoParam = searchParams.get('repo') ?? 'all'
  const fromParam = searchParams.get('from') ?? ''
  const toParam = searchParams.get('to') ?? ''
  const pageParam = searchParams.get('page')
  const parsedPage = Number(pageParam)
  const page =
    pageParam !== null && Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1

  const { data, loading, error } = useApi(
    () =>
      getLeaderboards({
        metric,
        state,
        order,
        page,
        repo: repoParam === 'all' ? undefined : repoParam,
        author: authorParam === 'all' ? undefined : authorParam,
        from: fromParam || undefined,
        to: toParam || undefined,
      }),
    [metric, state, order, repoParam, authorParam, fromParam, toParam, page],
  )

  const { data: contributors } = useApi(getContributors)
  const { data: shame, loading: shameLoading, error: shameError } = useApi(getShame)

  const updateParams = (next: Record<string, string | null>) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev)
      for (const [key, value] of Object.entries(next)) {
        if (value === null || value === '') params.delete(key)
        else params.set(key, value)
      }
      return params
    })
  }

  const handleMetricChange = (value: string) => {
    updateParams({ metric: value, page: null })
  }

  const handleStateChange = (value: string) => {
    updateParams({ state: value, page: null })
  }

  const handleAuthorChange = (value: string) => {
    updateParams({ author: value === 'all' ? null : value, page: null })
  }

  const handleRepoChange = (value: string) => {
    updateParams({ repo: value === 'all' ? null : value, page: null })
  }

  const handleFromChange = (value: string) => {
    updateParams({ from: value || null, page: null })
  }

  const handleToChange = (value: string) => {
    updateParams({ to: value || null, page: null })
  }

  const handleOrderToggle = () => {
    updateParams({ order: order === 'asc' ? null : 'asc', page: null })
  }

  const handleClearFilters = () => {
    updateParams({ repo: null, author: null, state: null, from: null, to: null, order: null, page: null })
  }

  const handlePageChange = (nextPage: number) => {
    updateParams({ page: nextPage === 1 ? null : String(nextPage) })
    window.scrollTo({ top: 0 })
  }

  const handleExport = async () => {
    if (!data || data.rows.length === 0) return
    setExporting(true)
    try {
      const rows: RankedPull[] = []
      for (let p = 1; p <= data.pager.pages; p++) {
        const res = await getLeaderboards({
          metric,
          state,
          order,
          page: p,
          repo: repoParam === 'all' ? undefined : repoParam,
          author: authorParam === 'all' ? undefined : authorParam,
          from: fromParam || undefined,
          to: toParam || undefined,
        })
        rows.push(...res.rows)
      }
      if (rows.length === 0) return
      const header = [
        'rank',
        'title',
        'repo',
        'number',
        'author',
        'additions',
        'deletions',
        'files',
        'commits',
        'mergedAt',
        'value',
      ]
      const lines = [
        header.join(','),
        ...rows.map((row, i) =>
          [
            i + 1,
            csvEscape(row.pull.title),
            csvEscape(row.pull.repo),
            row.pull.number,
            csvEscape(row.pull.author),
            row.pull.additions,
            row.pull.deletions,
            row.pull.changedFiles,
            row.pull.commits,
            csvEscape(row.pull.mergedAt ?? ''),
            row.value,
          ].join(','),
        ),
      ]
      const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'leaderboards.csv'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(false)
    }
  }

  const rankClass = (rank: number) =>
    rank === 1
      ? 'font-bold text-amber-500'
      : rank === 2
        ? 'font-bold text-zinc-400'
        : rank === 3
          ? 'font-bold text-orange-700 dark:text-orange-400'
          : 'text-muted-foreground'

  return (
    <>
      <PageHeader
        title="Leaderboards"
        description="Biggest and most active pull requests"
      />

      <Tabs value={metric} onValueChange={handleMetricChange} className="mb-4">
        <TabsList className="w-full justify-start overflow-x-auto">
          {METRICS.map((m) => (
            <TabsTrigger key={m.value} value={m.value} className="flex-none px-3">
              {m.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <FilterBar>
        <Select value={repoParam} onValueChange={handleRepoChange}>
          <SelectTrigger aria-label="Filter by repository" className="max-w-44">
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
        <Select value={state} onValueChange={handleStateChange}>
          <SelectTrigger aria-label="Filter by state">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATES.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={authorParam} onValueChange={handleAuthorChange}>
          <SelectTrigger aria-label="Filter by author" className="max-w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All authors</SelectItem>
            {contributors?.rows.map((contributor) => (
              <SelectItem key={contributor.login} value={contributor.login}>
                {contributor.login}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="date"
          value={fromParam}
          onChange={(event) => handleFromChange(event.target.value)}
          aria-label="From"
          title="Merged after this date"
          className="w-36"
        />
        <Input
          type="date"
          value={toParam}
          onChange={(event) => handleToChange(event.target.value)}
          aria-label="To"
          title="Merged before this date"
          className="w-36"
        />
        <DatePresets from={fromParam} to={toParam} onFromChange={handleFromChange} onToChange={handleToChange} />
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon-sm"
                onClick={handleOrderToggle}
                aria-label="Toggle sort order"
              >
                {order === 'asc' ? <ArrowUp /> : <ArrowDown />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{order === 'asc' ? 'Descending' : 'Ascending'}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        {(repoParam !== 'all' || authorParam !== 'all' || fromParam || toParam || order === 'asc' || state !== 'merged') && (
          <Button variant="ghost" size="sm" onClick={handleClearFilters} className="ml-auto">
            Clear
          </Button>
        )}
      </FilterBar>

      <Card size="sm" className="overflow-hidden">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <span className="text-xs text-muted-foreground">
            {data ? `${comma(data.pager.total)} pull requests` : ''}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={exporting || !data || data.rows.length === 0}
          >
            {exporting ? <Loader2 className="animate-spin" /> : <Download />}
            {exporting ? 'Exporting…' : 'Export CSV'}
          </Button>
        </div>
        {loading ? (
          <Loading />
        ) : error ? (
          <EmptyState text={error} />
        ) : !data || data.rows.length === 0 ? (
          <EmptyState text="No pull requests match this filter." />
        ) : data.rows.length > 50 ? (
          <>
            <VirtualizedTable
              data={data.rows}
              rowKey={(row) => `${row.pull.repo}#${row.pull.number}`}
              columns={[
                {
                  header: 'Rank',
                  cell: (_row, i) => {
                    const rank = data.pager.from + i + 1
                    return <span className={cn(rankClass(rank))}>{rank}</span>
                  },
                },
                {
                  header: 'Pull request',
                  cell: (row) => (
                    <>
                      <a
                        href={row.pull.url}
                        target="_blank"
                        rel="noreferrer"
                        className="font-semibold hover:text-blue-600 dark:hover:text-blue-400"
                      >
                        {row.pull.title}
                      </a>
                      <span className="text-muted-foreground"> · {row.pull.repo}#{row.pull.number}</span>
                    </>
                  ),
                },
                {
                  header: 'Author',
                  cell: (row) => (
                    <div className="flex items-center gap-2">
                      <img src={avatarUrl(row.pull.author)} alt="" className="size-5 rounded-full" loading="lazy" />
                      <a
                        href={`https://github.com/${row.pull.author}`}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium text-foreground hover:text-blue-600 hover:underline dark:hover:text-blue-400"
                      >
                        {row.pull.author}
                      </a>
                    </div>
                  ),
                },
                ...(metric !== 'additions'
                  ? [
                      {
                        header: 'Additions',
                        headerClassName: 'text-right',
                        cellClassName: 'text-right font-mono text-green-600 tabular-nums dark:text-green-400',
                        cell: (row: RankedPull) => `+${comma(row.pull.additions)}`,
                      } as const,
                    ]
                  : []),
                ...(metric !== 'deletions'
                  ? [
                      {
                        header: 'Deletions',
                        headerClassName: 'text-right',
                        cellClassName: 'text-right font-mono text-red-600 tabular-nums dark:text-red-400',
                        cell: (row: RankedPull) => `−${comma(row.pull.deletions)}`,
                      } as const,
                    ]
                  : []),
                {
                  header: metricCol(metric).label,
                  headerClassName: 'text-right bg-muted',
                  cellClassName: 'text-right bg-muted font-semibold tabular-nums',
                  cell: (row: RankedPull) => metricCol(metric).cell(row),
                },
                ...(metric !== 'files'
                  ? [
                      {
                        header: 'Files',
                        headerClassName: 'text-right',
                        cellClassName: 'text-right tabular-nums',
                        cell: (row: RankedPull) => comma(row.pull.changedFiles),
                      } as const,
                    ]
                  : []),
                ...(metric !== 'commits'
                  ? [
                      {
                        header: 'Commits',
                        headerClassName: 'text-right',
                        cellClassName: 'text-right tabular-nums',
                        cell: (row: RankedPull) => comma(row.pull.commits),
                      } as const,
                    ]
                  : []),
                {
                  header: 'Merged',
                  headerClassName: 'text-right',
                  cellClassName: 'whitespace-nowrap text-right text-muted-foreground',
                  cell: (row: RankedPull) => formatDate(row.pull.mergedAt),
                },
              ]}
            />
            <Pager pager={data.pager} onPage={handlePageChange} />
          </>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-14">Rank</TableHead>
                  <TableHead>Pull request</TableHead>
                  <TableHead>Author</TableHead>
                  {metric !== 'additions' && (
                    <TableHead className="text-right">Additions</TableHead>
                  )}
                  {metric !== 'deletions' && <TableHead className="text-right">Deletions</TableHead>}
                  <TableHead className="text-right bg-muted">{metricCol(metric).label}</TableHead>
                  {metric !== 'files' && <TableHead className="text-right">Files</TableHead>}
                  {metric !== 'commits' && <TableHead className="text-right">Commits</TableHead>}
                  <TableHead className="text-right">Merged</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rows.map((row, i) => {
                  const rank = data.pager.from + i + 1
                  return (
                    <TableRow key={`${row.pull.repo}#${row.pull.number}`}>
                      <TableCell className={cn(rankClass(rank))}>{rank}</TableCell>
                      <TableCell>
                        <a
                          href={row.pull.url}
                          target="_blank"
                          rel="noreferrer"
                          className="font-semibold hover:text-blue-600 dark:hover:text-blue-400"
                        >
                          {row.pull.title}
                        </a>
                        <span className="text-muted-foreground">
                          {' '}
                          · {row.pull.repo}#{row.pull.number}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <img
                            src={avatarUrl(row.pull.author)}
                            alt=""
                            className="size-5 rounded-full"
                            loading="lazy"
                          />
                          <a
                            href={`https://github.com/${row.pull.author}`}
                            target="_blank"
                            rel="noreferrer"
                            className="font-medium text-foreground hover:text-blue-600 hover:underline dark:hover:text-blue-400"
                          >
                            {row.pull.author}
                          </a>
                        </div>
                      </TableCell>
                      {metric !== 'additions' && (
                        <TableCell className="text-right font-mono text-green-600 tabular-nums dark:text-green-400">
                          +{comma(row.pull.additions)}
                        </TableCell>
                      )}
                      {metric !== 'deletions' && (
                        <TableCell className="text-right font-mono text-red-600 tabular-nums dark:text-red-400">
                          −{comma(row.pull.deletions)}
                        </TableCell>
                      )}
                      <TableCell className="text-right bg-muted font-semibold tabular-nums">
                        {metricCol(metric).cell(row)}
                      </TableCell>
                      {metric !== 'files' && (
                        <TableCell className="text-right tabular-nums">
                          {comma(row.pull.changedFiles)}
                        </TableCell>
                      )}
                      {metric !== 'commits' && (
                        <TableCell className="text-right tabular-nums">
                          {comma(row.pull.commits)}
                        </TableCell>
                      )}
                      <TableCell className="whitespace-nowrap text-right text-muted-foreground">
                        {formatDate(row.pull.mergedAt)}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            <Pager pager={data.pager} onPage={handlePageChange} />
          </>
        )}
      </Card>

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Card size="sm">
          <CardHeader>
            <CardTitle>Longest open</CardTitle>
          </CardHeader>
          {shameLoading ? (
            <Loading />
          ) : shameError ? (
            <EmptyState text={shameError} />
          ) : !shame || shame.longestOpen.length === 0 ? (
            <EmptyState text="No pull requests." />
          ) : (
            shame.longestOpen.map((entry) => (
              <div
                key={`${entry.pull.repo}#${entry.pull.number}`}
                className="flex items-center gap-2 border-t px-3 py-2.5 hover:bg-muted/50"
              >
                <StateIcon state={entry.pull.state} isDraft={entry.pull.isDraft} />
                <a
                  href={entry.pull.url}
                  target="_blank"
                  rel="noreferrer"
                  className="min-w-0 flex-1 truncate font-medium hover:text-blue-600 hover:underline dark:hover:text-blue-400"
                >
                  {entry.pull.title}
                </a>
                <span className="shrink-0 text-muted-foreground">
                  · {entry.pull.repo}#{entry.pull.number}
                </span>
                <span className="shrink-0 font-semibold tabular-nums">
                  {entry.value.toFixed(0)}d
                </span>
              </div>
            ))
          )}
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardTitle>Longest to merge</CardTitle>
          </CardHeader>
          {shameLoading ? (
            <Loading />
          ) : shameError ? (
            <EmptyState text={shameError} />
          ) : !shame || shame.longestToMerge.length === 0 ? (
            <EmptyState text="No pull requests." />
          ) : (
            shame.longestToMerge.map((entry) => (
              <div
                key={`${entry.pull.repo}#${entry.pull.number}`}
                className="flex items-center gap-2 border-t px-3 py-2.5 hover:bg-muted/50"
              >
                <StateIcon state={entry.pull.state} isDraft={entry.pull.isDraft} />
                <a
                  href={entry.pull.url}
                  target="_blank"
                  rel="noreferrer"
                  className="min-w-0 flex-1 truncate font-medium hover:text-blue-600 hover:underline dark:hover:text-blue-400"
                >
                  {entry.pull.title}
                </a>
                <span className="shrink-0 text-muted-foreground">
                  · {entry.pull.repo}#{entry.pull.number}
                </span>
                <span className="shrink-0 font-semibold tabular-nums">
                  {entry.value.toFixed(0)}d
                </span>
              </div>
            ))
          )}
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardTitle>Closed without merge — biggest</CardTitle>
          </CardHeader>
          {shameLoading ? (
            <Loading />
          ) : shameError ? (
            <EmptyState text={shameError} />
          ) : !shame || shame.biggestClosed.length === 0 ? (
            <EmptyState text="No pull requests." />
          ) : (
            shame.biggestClosed.map((entry) => (
              <div
                key={`${entry.pull.repo}#${entry.pull.number}`}
                className="flex items-center gap-2 border-t px-3 py-2.5 hover:bg-muted/50"
              >
                <a
                  href={entry.pull.url}
                  target="_blank"
                  rel="noreferrer"
                  className="min-w-0 flex-1 truncate font-medium hover:text-blue-600 hover:underline dark:hover:text-blue-400"
                >
                  {entry.pull.title}
                </a>
                <span className="shrink-0 text-muted-foreground">
                  · {entry.pull.repo}#{entry.pull.number}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="font-mono text-green-600 dark:text-green-400">
                    +{comma(entry.pull.additions)}
                  </span>
                  <span className="font-mono text-red-600 dark:text-red-400">
                    −{comma(entry.pull.deletions)}
                  </span>
                  <span className="font-semibold tabular-nums">{comma(entry.value)}</span>
                </span>
              </div>
            ))
          )}
        </Card>
      </div>
    </>
  )
}
