import { type FormEvent, type ReactNode, useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'

import { getPulls, getStatus } from '@/lib/api'
import { useApi } from '@/lib/use-api'

import { EmptyState } from '@/components/empty-state'
import { Loading } from '@/components/loading'
import { PageHeader } from '@/components/page-header'
import { Pager } from '@/components/pager'
import { PrRow } from '@/components/pr-row'
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
] as const

export default function PullsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { data: status } = useApi(getStatus)

  const stateParam = searchParams.get('state') ?? 'all'
  const repoParam = searchParams.get('repo') ?? 'all'
  const qParam = searchParams.get('q') ?? ''
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
      }),
    [stateParam, repoParam, qParam, page],
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
    updateParams({ state: value === 'all' ? null : value, page: null })
  }

  const handleRepoChange = (value: string) => {
    updateParams({ repo: value === 'all' ? null : value, page: null })
  }

  const handleSearch = (event: FormEvent) => {
    event.preventDefault()
    updateParams({ q: query.trim() || null, page: null })
  }

  const handlePageChange = (nextPage: number) => {
    updateParams({ page: nextPage === 1 ? null : String(nextPage) })
    window.scrollTo({ top: 0 })
  }

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
          <Card>
            {data.rows.map((pull) => (
              <PrRow key={`${pull.repo}#${pull.number}`} pull={pull} />
            ))}
          </Card>
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
        <Select value={stateParam} onValueChange={handleStateChange}>
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
