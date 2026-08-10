import { type FormEvent, type ReactNode, useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'

import { getPulls, getStatus, type Pull } from '@/lib/api'
import { comma } from '@/lib/format'
import { useApi } from '@/lib/use-api'

import { EmptyState } from '@/components/empty-state'
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

const STATE_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'merged', label: 'Merged' },
  { value: 'open', label: 'Open' },
  { value: 'closed', label: 'Closed' },
  { value: 'bot', label: 'Bots only' },
  { value: 'human', label: 'Humans only' },
] as const

const SORT_OPTIONS = [
  { value: 'updated', label: 'Recently updated' },
  { value: 'created-asc', label: 'Oldest first' },
  { value: 'created', label: 'Newest first' },
  { value: 'diff', label: 'Diff size' },
  { value: 'files', label: 'Files' },
  { value: 'commits', label: 'Commits' },
  { value: 'timemerge', label: 'Time to merge' },
] as const

const SORT_VALUES = ['diff', 'files', 'commits', 'timemerge']

const SIZE_CLASSES: { label: string; className: string }[] = [
  { label: 'XS', className: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400' },
  { label: 'S', className: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400' },
  { label: 'M', className: 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-400' },
  { label: 'L', className: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400' },
  { label: 'XL', className: 'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-400' },
  { label: 'XXL', className: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400' },
]

function sizeClass(size: number) {
  if (size < 10) return SIZE_CLASSES[0]
  if (size < 50) return SIZE_CLASSES[1]
  if (size < 100) return SIZE_CLASSES[2]
  if (size < 500) return SIZE_CLASSES[3]
  if (size < 1000) return SIZE_CLASSES[4]
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

  const { data, loading, error } = useApi(
    () =>
      getPulls({
        state: stateParam === 'all' ? undefined : stateParam,
        repo: repoParam === 'all' ? undefined : repoParam,
        q: qParam || undefined,
        page: page === 1 ? undefined : page,
        sort: sortParam || undefined,
        order: orderParam || undefined,
        bot: botParam || undefined,
      }),
    [stateParam, repoParam, qParam, page, sortParam, orderParam, botParam],
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

  const handleSortChange = (value: string) => {
    const next: Record<string, string | null> = { page: null }
    if (value === 'updated') {
      next.sort = null
      next.order = null
    } else if (value === 'created-asc') {
      next.sort = 'created'
      next.order = 'asc'
    } else if (value === 'created') {
      next.sort = 'created'
      next.order = null
    } else {
      next.sort = value
      next.order = null
    }
    updateParams(next)
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
  const sortValue =
    sortParam === 'created'
      ? orderParam === 'asc'
        ? 'created-asc'
        : 'created'
      : SORT_VALUES.includes(sortParam)
        ? sortParam
        : 'updated'

  const org = status?.org ?? ''

  let content: ReactNode
  if (error) {
    content = <EmptyState text={error} />
  } else if (loading || !data) {
    content = <Loading />
  } else {
    content = (
      <>
        {data.rows.length === 0 ? (
          <EmptyState text="No pull requests match this filter." />
        ) : (
          <>
            <SummaryStrip rows={data.rows} />
            <Card>
              {data.rows.map((pull) => {
                const size = pull.additions + pull.deletions
                const sizeInfo = sizeClass(size)
                const cycle = cycleDays(pull)
                return (
                  <div key={`${pull.repo}#${pull.number}`} className="border-b border-border">
                    <PrRow pull={pull} />
                    <div className="flex flex-wrap items-center gap-2 px-4 pb-2.5 text-xs text-muted-foreground">
                      <Badge data-testid="size-chip" className={sizeInfo.className}>
                        {sizeInfo.label}
                      </Badge>
                      {cycle ? <span className="tabular-nums">{cycle}</span> : null}
                      {pull.isBot ? <Badge variant="secondary">bot</Badge> : null}
                      {pull.isDraft ? <Badge variant="outline">draft</Badge> : null}
                    </div>
                  </div>
                )
              })}
            </Card>
          </>
        )}
        {data.pager.total > 0 ? <Pager pager={data.pager} onPage={handlePageChange} /> : null}
      </>
    )
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
      <form onSubmit={handleSearch} className="mb-4 flex flex-wrap items-center gap-2">
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
        <Select value={repoParam} onValueChange={handleRepoChange}>
          <SelectTrigger aria-label="Filter by repository" className="max-w-60">
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
        <Select value={sortValue} onValueChange={handleSortChange}>
          <SelectTrigger aria-label="Sort by">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
      {content}
    </>
  )
}
