import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Search } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { useVirtualizer } from '@tanstack/react-virtual'

import { avatarUrl, getPulls, getStatus, type Pull } from '@/lib/api'
import { comma, formatDate } from '@/lib/format'
import { useApi } from '@/lib/use-api'
import { cn } from '@/lib/utils'

import { EmptyState } from '@/components/empty-state'
import { FilterBar } from '@/components/filter-bar'
import { Loading } from '@/components/loading'
import { PageHeader } from '@/components/page-header'
import { Pager } from '@/components/pager'
import { PrRow } from '@/components/pr-row'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
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

const STATE_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'merged', label: 'Merged' },
  { value: 'open', label: 'Open' },
  { value: 'closed', label: 'Closed' },
  { value: 'bot', label: 'Bots only' },
  { value: 'human', label: 'Humans only' },
] as const

const SORT_TABS = [
  { value: 'recent', label: 'Recent' },
  { value: 'diff', label: 'Largest' },
  { value: 'files', label: 'Files' },
  { value: 'commits', label: 'Commits' },
  { value: 'timemerge', label: 'Time to merge' },
] as const

const SORT_VALUES = ['diff', 'files', 'commits', 'timemerge'] as const

const SIZE_CLASSES: { label: string; className: string; title: string }[] = [
  { label: 'XS', className: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400', title: 'Tiny — 10 lines or fewer' },
  { label: 'S', className: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400', title: 'Small — 11 to 50 lines' },
  { label: 'M', className: 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-400', title: 'Medium — 51 to 200 lines' },
  { label: 'L', className: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400', title: 'Large — 201 to 500 lines' },
  { label: 'XL', className: 'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-400', title: 'XL — 501 to 1000 lines' },
  { label: 'XXL', className: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400', title: 'Massive — over 1000 lines, consider splitting' },
]

// Thresholds mirror TShirtFor in metrics_vision.go (diff = additions + deletions).
function sizeClass(size: number) {
  if (size <= 10) return SIZE_CLASSES[0]
  if (size <= 50) return SIZE_CLASSES[1]
  if (size <= 200) return SIZE_CLASSES[2]
  if (size <= 500) return SIZE_CLASSES[3]
  if (size <= 1000) return SIZE_CLASSES[4]
  return SIZE_CLASSES[5]
}

function cycleDays(pull: Pull): string | null {
  if (pull.state !== 'MERGED' || !pull.mergedAt) return null
  const ms = new Date(pull.mergedAt).getTime() - new Date(pull.createdAt).getTime()
  if (!Number.isFinite(ms) || ms < 0) return null
  const days = ms / 86_400_000
  const value = days >= 10 ? Math.round(days) : Math.round(days * 10) / 10
  return `cycle ${value}d`
}

function formatValue(metric: string, value: number): string {
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

function metricLabel(metric: string): string {
  switch (metric) {
    case 'diff':
      return 'Total lines'
    case 'files':
      return 'Files changed'
    case 'commits':
      return 'Commits'
    case 'timemerge':
      return 'Time to merge'
    default:
      return metric
  }
}

function metricValue(pull: Pull, metric: string): number {
  switch (metric) {
    case 'diff':
      return pull.additions + pull.deletions
    case 'files':
      return pull.changedFiles
    case 'commits':
      return pull.commits
    case 'timemerge': {
      if (!pull.mergedAt) return 0
      return (new Date(pull.mergedAt).getTime() - new Date(pull.createdAt).getTime()) / 3_600_000
    }
    default:
      return 0
  }
}

function metricCell(pull: Pull, metric: string): ReactNode {
  const v = metricValue(pull, metric)
  switch (metric) {
    case 'diff':
      return <span className="font-semibold">{comma(v)}</span>
    case 'timemerge':
      return formatValue('timemerge', v)
    default:
      return comma(v)
  }
}

function VirtualizedPullList({ pulls }: { pulls: Pull[] }) {
  const parentRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: pulls.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 72,
    overscan: 5,
  })
  const items = virtualizer.getVirtualItems()
  return (
    <div ref={parentRef} style={{ maxHeight: 600, overflow: 'auto' }}>
      <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative', width: '100%' }}>
        {items.map((vr) => {
          const pull = pulls[vr.index]
          const size = pull.additions + pull.deletions
          const sizeInfo = sizeClass(size)
          const cycle = cycleDays(pull)
          return (
            <div
              key={`${pull.repo}#${pull.number}`}
              data-index={vr.index}
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${vr.start}px)`,
              }}
            >
              <PrRow
                pull={pull}
                extras={
                  <>
                    <span className="flex items-center gap-1.5">
                      <span
                        data-testid="size-chip"
                        title={sizeInfo.title}
                        className={cn(
                          'inline-flex h-4 items-center rounded-full px-1.5 text-[10px] font-semibold',
                          sizeInfo.className,
                        )}
                      >
                        {sizeInfo.label}
                      </span>
                      {cycle ? <span className="tabular-nums">{cycle}</span> : null}
                      {pull.isBot ? (
                        <span className="inline-flex h-4 items-center rounded-full bg-muted px-1.5 text-[10px] font-semibold text-muted-foreground">
                          bot
                        </span>
                      ) : null}
                      {pull.isDraft ? (
                        <span className="inline-flex h-4 items-center rounded-full border border-border px-1.5 text-[10px] font-semibold text-muted-foreground">
                          draft
                        </span>
                      ) : null}
                    </span>
                  </>
                }
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

function SummaryStrip({ rows }: { rows: Pull[] }) {
  let merged = 0
  let open = 0
  let closed = 0
  let additions = 0
  let deletions = 0
  let biggest: Pull | null = null
  let biggestSize = -1

  for (const pull of rows) {
    if (pull.state === 'MERGED') merged++
    else if (pull.state === 'OPEN') open++
    else closed++
    additions += pull.additions
    deletions += pull.deletions
    const size = pull.additions + pull.deletions
    if (size > biggestSize) {
      biggestSize = size
      biggest = pull
    }
  }

  const biggestInfo = biggest ? sizeClass(biggestSize) : null

  return (
    <div
      data-testid="pulls-summary"
      className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-xs text-muted-foreground"
    >
      <span className="font-semibold text-foreground">This page</span>
      <span>
        <span className="font-semibold text-green-600 dark:text-green-400">{merged}</span> merged
      </span>
      <span>
        <span className="font-semibold text-green-600 dark:text-green-400">{open}</span> open
      </span>
      <span>
        <span className="font-semibold text-red-600 dark:text-red-400">{closed}</span> closed
      </span>
      <span className="font-mono tabular-nums">
        <span className="text-green-600 dark:text-green-400">+{comma(additions)}</span>{' '}
        <span className="text-red-600 dark:text-red-400">−{comma(deletions)}</span>
      </span>
      {biggest && biggestInfo ? (
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="font-semibold text-foreground">Biggest</span>
          <a
            href={biggest.url}
            target="_blank"
            rel="noreferrer"
            className="max-w-64 truncate font-medium text-foreground hover:text-blue-600 hover:underline dark:hover:text-blue-400"
          >
            {biggest.title}
          </a>
          <Badge className={biggestInfo.className}>{biggestInfo.label}</Badge>
        </span>
      ) : null}
    </div>
  )
}

export default function PullsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { data: status } = useApi(getStatus)

  const stateParam = searchParams.get('state') ?? 'all'
  const repoParam = searchParams.get('repo') ?? 'all'
  const qParam = searchParams.get('q') ?? ''
  const sortParam = searchParams.get('sort') ?? ''
  const orderParam = searchParams.get('order') ?? ''
  const botParam = searchParams.get('bot')
  const pageParam = searchParams.get('page')
  const parsedPage = Number(pageParam)
  const page =
    pageParam !== null && Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1

  const [query, setQuery] = useState(qParam)

  useEffect(() => {
    setQuery(qParam)
  }, [qParam])

  const activeTab = SORT_TABS.some((t) => t.value === sortParam) ? sortParam : sortParam === '' ? 'recent' : SORT_VALUES.includes(sortParam as any) ? sortParam : 'recent'
  const apiSort = activeTab === 'recent' ? undefined : activeTab

  const { data, loading, error } = useApi(
    () =>
      getPulls({
        state: stateParam === 'all' ? undefined : stateParam,
        repo: repoParam === 'all' ? undefined : repoParam,
        q: qParam || undefined,
        page: page === 1 ? undefined : page,
        sort: apiSort || undefined,
        order: orderParam || undefined,
        bot: botParam || undefined,
      }),
    [stateParam, repoParam, qParam, page, apiSort, orderParam, botParam],
  )

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

  const handleStateChange = (value: string) => {
    const next: Record<string, string | null> = { page: null }
    if (value === 'all') {
      next.state = null
      next.bot = null
    } else if (value === 'bot' || value === 'human') {
      next.state = null
      next.bot = value === 'bot' ? '1' : '0'
    } else {
      next.state = value
      next.bot = null
    }
    updateParams(next)
  }

  const handleRepoChange = (value: string) => {
    updateParams({ repo: value === 'all' ? null : value, page: null })
  }

  const handleClearFilters = () => {
    updateParams({ repo: null, state: null, bot: null, q: null, order: null, page: null })
    setQuery('')
  }

  const handleTabChange = (value: string) => {
    updateParams({ sort: value === 'recent' ? null : value, order: null, page: null })
  }

  const handleOrderToggle = () => {
    updateParams({ order: orderParam === 'asc' ? null : 'asc', page: null })
  }

  const handleSearch = (event: FormEvent) => {
    event.preventDefault()
    updateParams({ q: query.trim() || null, page: null })
  }

  const handlePageChange = (nextPage: number) => {
    updateParams({ page: nextPage === 1 ? null : String(nextPage) })
    window.scrollTo({ top: 0 })
  }

  const stateValue = botParam === '1' || botParam === '0' ? (botParam === '1' ? 'bot' : 'human') : stateParam

  // Ranked views show the state-relevant date (merged / closed / opened).
  const dateHeader =
    stateValue === 'merged' ? 'Merged' : stateValue === 'closed' ? 'Closed' : stateValue === 'open' ? 'Opened' : 'Decided'
  const rowDate = (pull: Pull) => pull.mergedAt ?? pull.closedAt ?? pull.createdAt

  const org = status?.org ?? ''

  let content: ReactNode
  if (error) {
    content = <EmptyState text={error} />
  } else if (loading || !data) {
    content = <Loading />
  } else {
    if (data.rows.length === 0) {
      content = <EmptyState text="No pull requests match this filter." />
    } else if (activeTab !== 'recent') {
      const rankClass = (rank: number) =>
        rank === 1
          ? 'font-bold text-amber-500'
          : rank === 2
            ? 'font-bold text-zinc-400'
            : rank === 3
              ? 'font-bold text-orange-700 dark:text-orange-400'
              : 'text-muted-foreground'
      content = (
        <>
          <Card className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-14">Rank</TableHead>
                  <TableHead>Pull request</TableHead>
                  <TableHead>Author</TableHead>
                  <TableHead className="text-right">Additions</TableHead>
                  <TableHead className="text-right">Deletions</TableHead>
                  <TableHead className="text-right bg-muted">{metricLabel(activeTab)}</TableHead>
                  {activeTab !== 'files' && <TableHead className="text-right">Files</TableHead>}
                  {activeTab !== 'commits' && <TableHead className="text-right">Commits</TableHead>}
                  <TableHead className="text-right">{dateHeader}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rows.map((pull, i) => {
                  const rank = data.pager.from + i + 1
                  return (
                    <TableRow key={`${pull.repo}#${pull.number}`}>
                      <TableCell className={cn(rankClass(rank))}>{rank}</TableCell>
                      <TableCell>
                        <a
                          href={pull.url}
                          target="_blank"
                          rel="noreferrer"
                          className="font-semibold hover:text-blue-600 dark:hover:text-blue-400"
                        >
                          {pull.title}
                        </a>
                        <span className="text-muted-foreground">
                          {' '}
                          · {pull.repo}#{pull.number}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <img
                            src={avatarUrl(pull.author)}
                            alt=""
                            className="size-5 rounded-full"
                            loading="lazy"
                          />
                          <Link
                            to={`/people/${pull.author}`}
                            className="font-medium text-foreground hover:text-blue-600 hover:underline dark:hover:text-blue-400"
                          >
                            {pull.author}
                          </Link>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono text-green-600 tabular-nums dark:text-green-400">
                        +{comma(pull.additions)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-red-600 tabular-nums dark:text-red-400">
                        −{comma(pull.deletions)}
                      </TableCell>
                      <TableCell className="text-right bg-muted font-semibold tabular-nums">
                        {metricCell(pull, activeTab)}
                      </TableCell>
                      {activeTab !== 'files' && (
                        <TableCell className="text-right tabular-nums">
                          {comma(pull.changedFiles)}
                        </TableCell>
                      )}
                      {activeTab !== 'commits' && (
                        <TableCell className="text-right tabular-nums">
                          {comma(pull.commits)}
                        </TableCell>
                      )}
                      <TableCell className="whitespace-nowrap text-right text-muted-foreground">
                        {formatDate(rowDate(pull))}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            <Pager pager={data.pager} onPage={handlePageChange} />
          </Card>
        </>
      )
    } else {
      content = (
        <>
          <SummaryStrip rows={data.rows} />
          <Card className="overflow-hidden">
            {data.rows.length > 50 ? (
              <VirtualizedPullList pulls={data.rows} />
            ) : (
              data.rows.map((pull) => {
                const size = pull.additions + pull.deletions
                const sizeInfo = sizeClass(size)
                const cycle = cycleDays(pull)
                return (
                  <PrRow
                    key={`${pull.repo}#${pull.number}`}
                    pull={pull}
                    extras={
                      <>
                        <span className="flex items-center gap-1.5">
                          <span
                            data-testid="size-chip"
                            title={sizeInfo.title}
                            className={cn(
                              'inline-flex h-4 items-center rounded-full px-1.5 text-[10px] font-semibold',
                              sizeInfo.className,
                            )}
                          >
                            {sizeInfo.label}
                          </span>
                          {cycle ? <span className="tabular-nums">{cycle}</span> : null}
                          {pull.isBot ? (
                            <span className="inline-flex h-4 items-center rounded-full bg-muted px-1.5 text-[10px] font-semibold text-muted-foreground">
                              bot
                            </span>
                          ) : null}
                          {pull.isDraft ? (
                            <span className="inline-flex h-4 items-center rounded-full border border-border px-1.5 text-[10px] font-semibold text-muted-foreground">
                              draft
                            </span>
                          ) : null}
                        </span>
                      </>
                    }
                  />
                )
              })
            )}
            {data.pager.total > 0 ? <Pager pager={data.pager} onPage={handlePageChange} /> : null}
          </Card>
        </>
      )
    }
  }

  return (
    <>
      <PageHeader
        title="Pull requests"
        description={
          org
            ? `All pull requests across ${org}, most recently updated first.`
            : 'All pull requests across the organization, most recently updated first.'
        }
      />
      <Tabs value={activeTab} onValueChange={handleTabChange} className="mb-4">
        <TabsList className="w-full justify-start overflow-x-auto">
          {SORT_TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value} className="flex-none px-3">
              {t.label}
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
        <Select value={stateValue} onValueChange={handleStateChange}>
          <SelectTrigger aria-label="Filter by state">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATE_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <form onSubmit={handleSearch} className="flex items-center gap-2">
          <div className="relative">
            <Search
              aria-hidden
              className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by title or number"
              aria-label="Search pull requests"
              className="w-64 pl-8"
            />
          </div>
          <Button type="submit">Search</Button>
        </form>
        {(repoParam !== 'all' || stateValue !== 'all' || qParam) && (
          <Button variant="ghost" size="sm" onClick={handleClearFilters} className="ml-auto">
            Clear
          </Button>
        )}
        <Button
          variant="outline"
          size="icon-sm"
          onClick={handleOrderToggle}
          aria-label="Toggle sort order"
          title={orderParam === 'asc' ? 'Ascending — click for descending' : 'Descending — click for ascending'}
        >
          {orderParam === 'asc' ? <ArrowUp /> : <ArrowDown />}
        </Button>
      </FilterBar>
      {content}
    </>
  )
}
