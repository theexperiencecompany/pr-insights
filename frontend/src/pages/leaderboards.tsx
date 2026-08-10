import { useState } from 'react'
import { ArrowDown, ArrowUp, Download, Loader2 } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'

import { avatarUrl, getContributors, type Pager as PagerData, type Pull, type RankedPull, type RepoInfo } from '@/lib/api'
import { comma, formatDate } from '@/lib/format'
import { useApi } from '@/lib/use-api'
import { cn } from '@/lib/utils'

import { EmptyState } from '@/components/empty-state'
import { Loading } from '@/components/loading'
import { PageHeader } from '@/components/page-header'
import { Pager } from '@/components/pager'
import { StateIcon } from '@/components/state-icon'
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

interface LeaderboardResponse {
  metric: string
  state: string
  order: string
  rows: RankedPull[]
  pager: PagerData
  repoOptions: RepoInfo[]
}

interface ShameEntry {
  pull: Pull
  value: number
}

interface ShameResponse {
  longestOpen: ShameEntry[]
  biggestClosed: ShameEntry[]
}

async function getJSON<T>(path: string): Promise<T> {
  let res: Response
  try {
    res = await fetch(path)
  } catch {
    throw new Error('Network error — is the server reachable?')
  }
  if (!res.ok) {
    let detail = res.statusText
    try {
      const body = await res.json()
      if (body && typeof body.error === 'string') detail = body.error
    } catch {
      // non-JSON error body; keep status text
    }
    throw new Error(`${res.status} ${detail}`.trim())
  }
  return res.json() as Promise<T>
}

async function fetchLeaderboards(params: {
  metric: string
  state: string
  order?: string
  page?: number
  repo?: string
  author?: string
  from?: string
  to?: string
}): Promise<LeaderboardResponse> {
  const q = new URLSearchParams()
  if (params.metric) q.set('metric', params.metric)
  if (params.state) q.set('state', params.state)
  if (params.order) q.set('order', params.order)
  if (params.page !== undefined) q.set('page', String(params.page))
  if (params.repo) q.set('repo', params.repo)
  if (params.author) q.set('author', params.author)
  if (params.from) q.set('from', params.from)
  if (params.to) q.set('to', params.to)
  const qs = q.toString()
  return getJSON<LeaderboardResponse>(`/api/leaderboards${qs ? `?${qs}` : ''}`)
}

function getShame(): Promise<ShameResponse> {
  return getJSON<ShameResponse>('/api/shame')
}

function formatValue(metric: Metric, value: number): string {
  switch (metric) {
    case 'timemerge':
      return `${comma(Math.round(value))}h`
    case 'ageclose':
      return `${Math.round(value)}d`
    case 'commitsperfile':
      return value.toFixed(1)
    default:
      return comma(value)
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
  const repoParam = searchParams.get('repo') ?? 'all'
  const authorParam = searchParams.get('author') ?? 'all'
  const fromParam = searchParams.get('from') ?? ''
  const toParam = searchParams.get('to') ?? ''
  const pageParam = searchParams.get('page')
  const parsedPage = Number(pageParam)
  const page =
    pageParam !== null && Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1

  const { data, loading, error } = useApi(
    () =>
      fetchLeaderboards({
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

  const handleRepoChange = (value: string) => {
    updateParams({ repo: value === 'all' ? null : value, page: null })
  }

  const handleAuthorChange = (value: string) => {
    updateParams({ author: value === 'all' ? null : value, page: null })
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
        const res = await fetchLeaderboards({
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

      <div className="mb-4 flex flex-wrap items-center gap-2">
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
        <Select value={repoParam} onValueChange={handleRepoChange}>
          <SelectTrigger aria-label="Filter by repository" className="max-w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All repositories</SelectItem>
            {data?.repoOptions.map((repo) => (
              <SelectItem key={repo.name} value={repo.name}>
                {repo.name}
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
          className="w-40"
        />
        <Input
          type="date"
          value={toParam}
          onChange={(event) => handleToChange(event.target.value)}
          aria-label="To"
          title="Merged before this date"
          className="w-40"
        />
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
      </div>

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
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-14">Rank</TableHead>
                  <TableHead>Pull request</TableHead>
                  <TableHead>Author</TableHead>
                  <TableHead className="text-right">Additions</TableHead>
                  <TableHead className="text-right">Deletions</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Files</TableHead>
                  <TableHead className="text-right">Commits</TableHead>
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
                      <TableCell className="text-right font-mono text-green-600 tabular-nums dark:text-green-400">
                        +{comma(row.pull.additions)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-red-600 tabular-nums dark:text-red-400">
                        −{comma(row.pull.deletions)}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {formatValue(metric, row.value)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {comma(row.pull.changedFiles)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {comma(row.pull.commits)}
                      </TableCell>
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

      <div className="mt-6 grid gap-4 md:grid-cols-2">
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
