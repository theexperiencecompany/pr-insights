import { useState } from 'react'

import { avatarUrl, getLeaderboards } from '@/lib/api'
import { comma, formatDate } from '@/lib/format'
import { useApi } from '@/lib/use-api'
import { cn } from '@/lib/utils'

import { EmptyState } from '@/components/empty-state'
import { Loading } from '@/components/loading'
import { PageHeader } from '@/components/page-header'
import { Pager } from '@/components/pager'
import { Card } from '@/components/ui/card'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

type Metric = 'diff' | 'additions' | 'deletions' | 'files' | 'commits'
type State = 'merged' | 'open' | 'closed' | 'all'

const METRICS: { value: Metric; label: string }[] = [
  { value: 'diff', label: 'Total lines' },
  { value: 'additions', label: 'Additions' },
  { value: 'deletions', label: 'Deletions' },
  { value: 'files', label: 'Files changed' },
  { value: 'commits', label: 'Commits' },
]

const STATES: { value: State; label: string }[] = [
  { value: 'merged', label: 'Merged' },
  { value: 'open', label: 'Open' },
  { value: 'closed', label: 'Closed' },
  { value: 'all', label: 'All' },
]

export default function LeaderboardsPage() {
  const [metric, setMetric] = useState<Metric>('diff')
  const [state, setState] = useState<State>('merged')
  const [page, setPage] = useState(1)

  const { data, loading, error } = useApi(
    () => getLeaderboards({ metric, state, page }),
    [metric, state, page],
  )

  const handleMetricChange = (value: string) => {
    setMetric(value as Metric)
    setPage(1)
  }

  const handleStateChange = (value: string) => {
    setState(value as State)
    setPage(1)
  }

  return (
    <>
      <PageHeader
        title="Leaderboards"
        description="Biggest and most active pull requests"
      >
        <Select value={state} onValueChange={handleStateChange}>
          <SelectTrigger size="sm" className="w-32" aria-label="Pull request state">
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
      </PageHeader>

      <Tabs value={metric} onValueChange={handleMetricChange}>
        <TabsList>
          {METRICS.map((m) => (
            <TabsTrigger key={m.value} value={m.value}>
              {m.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value={metric}>
          <Card size="sm" className="overflow-hidden">
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
                          <TableCell
                            className={cn(
                              'text-muted-foreground',
                              rank <= 3 &&
                                'font-semibold text-blue-600 dark:text-blue-400',
                            )}
                          >
                            {rank}
                          </TableCell>
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
                            {comma(row.value)}
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
                <Pager pager={data.pager} onPage={setPage} />
              </>
            )}
          </Card>
        </TabsContent>
      </Tabs>
    </>
  )
}
