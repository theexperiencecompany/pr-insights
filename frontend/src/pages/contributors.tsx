import { Flame } from 'lucide-react'
import { Link } from 'react-router-dom'

import { ContributorBar } from '@/components/contributor-bar'
import { EmptyState } from '@/components/empty-state'
import { Heatmap } from '@/components/heatmap'
import { Loading } from '@/components/loading'
import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { avatarUrl, getContributors, getOverview } from '@/lib/api'
import { comma, formatDate } from '@/lib/format'
import { useApi } from '@/lib/use-api'
import { cn } from '@/lib/utils'

function SectionTitle({ children }: { children: string }) {
  return <div className="text-sm font-semibold">{children}</div>
}

const RANK_CLASS = ['text-amber-500', 'text-zinc-400', 'text-orange-700 dark:text-orange-400']

export default function ContributorsPage() {
  const { data, loading, error } = useApi(getContributors, [])
  const { data: overview } = useApi(getOverview, [])

  if (loading) return <Loading />
  if (error) return <EmptyState text={error} />
  if (!data) return null

  const rows = data.rows
  const totalMerged = rows.reduce((s, c) => s + c.merged, 0)
  const top3 = rows.slice(0, 3)
  const top3Share = totalMerged > 0 ? (top3.reduce((s, c) => s + c.merged, 0) / totalMerged) * 100 : 0
  const top10 = rows.slice(0, 10)
  const maxMerged = Math.max(1, ...top10.map((c) => c.merged))

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Contributors" description="Ranked by merged pull requests." />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <SectionTitle>Top contributors</SectionTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-1.5">
              {top10.map((c) => (
                <ContributorBar key={c.login} contributor={c} maxMerged={maxMerged} />
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <SectionTitle>Bus factor</SectionTitle>
          </CardHeader>
          <CardContent className="flex h-full flex-col justify-center gap-3">
            <div className="flex -space-x-2">
              {top3.map((c) => (
                <img
                  key={c.login}
                  src={avatarUrl(c.login)}
                  alt=""
                  className="size-7 rounded-full ring-2 ring-card"
                  loading="lazy"
                />
              ))}
            </div>
            <p className="text-sm text-muted-foreground">
              Top 3 authors ship{' '}
              <span className="font-semibold text-foreground">{top3Share.toFixed(0)}%</span> of all
              merges.
            </p>
            <p className="text-xs text-muted-foreground">
              {top3.map((c) => c.login).join(', ')} — a single contributor leaving would be hard to
              replace.
            </p>
          </CardContent>
        </Card>
      </div>

      {overview && (
        <Card>
          <CardHeader>
            <SectionTitle>Ship activity — last 365 days</SectionTitle>
          </CardHeader>
          <CardContent>
            <Heatmap dates={overview.heatmap} />
          </CardContent>
        </Card>
      )}

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-14">Rank</TableHead>
              <TableHead>Contributor</TableHead>
              <TableHead className="text-right">Merged PRs</TableHead>
              <TableHead className="text-right">Additions</TableHead>
              <TableHead className="text-right">Deletions</TableHead>
              <TableHead className="text-right">Avg diff</TableHead>
              <TableHead>Largest PR</TableHead>
              <TableHead className="text-right">Repos</TableHead>
              <TableHead className="text-right">Streak</TableHead>
              <TableHead className="text-right">Longest</TableHead>
              <TableHead>First merged</TableHead>
              <TableHead>Last merged</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((c, i) => (
              <TableRow key={c.login}>
                <TableCell
                  className={cn(
                    'tabular-nums text-muted-foreground',
                    i < 3 && cn('font-semibold', RANK_CLASS[i]),
                  )}
                >
                  {i + 1}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <img
                      src={avatarUrl(c.login)}
                      alt=""
                      className="size-6 rounded-full"
                      loading="lazy"
                    />
                    <Link
                      to={`/contributors/${c.login}`}
                      className="font-medium hover:text-blue-600 hover:underline dark:hover:text-blue-400"
                    >
                      {c.login}
                    </Link>
                    {c.isBot && <Badge variant="secondary">bot</Badge>}
                  </div>
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums">
                  {comma(c.merged)}
                </TableCell>
                <TableCell className="text-right font-mono text-green-600 tabular-nums dark:text-green-400">
                  +{comma(c.additions)}
                </TableCell>
                <TableCell className="text-right font-mono text-red-600 tabular-nums dark:text-red-400">
                  −{comma(c.deletions)}
                </TableCell>
                <TableCell className="text-right tabular-nums">{comma(c.avgDiff)}</TableCell>
                <TableCell className="max-w-[260px]">
                  {c.largest && (
                    <span className="flex items-baseline gap-1">
                      <a
                        href={c.largest.url}
                        target="_blank"
                        rel="noreferrer"
                        className="truncate font-medium text-foreground hover:text-blue-600 dark:hover:text-blue-400"
                      >
                        {c.largest.title}
                      </a>
                      <span className="shrink-0 text-muted-foreground">
                        · {c.largest.repo}#{c.largest.number}
                      </span>
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">{comma(c.reposCount)}</TableCell>
                <TableCell className="text-right">
                  {c.currentStreak >= 2 ? (
                    <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-amber-600 dark:text-amber-400">
                      <Flame className="size-3" />
                      {c.currentStreak}w
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {c.longestStreak > 0 ? `${c.longestStreak}w` : '—'}
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {formatDate(c.first)}
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {formatDate(c.last)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  )
}
