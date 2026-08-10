import { avatarUrl, getContributors } from '@/lib/api'
import { comma, formatDate } from '@/lib/format'
import { useApi } from '@/lib/use-api'

import { EmptyState } from '@/components/empty-state'
import { Loading } from '@/components/loading'
import { PageHeader } from '@/components/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export default function ContributorsPage() {
  const { data, loading, error } = useApi(getContributors)

  const rows = data?.rows ?? []
  const top = rows.slice(0, 10)
  const maxMerged = Math.max(...top.map((c) => c.merged), 1)

  return (
    <>
      <PageHeader
        title="Contributors"
        description="Top contributors by merged pull requests"
      />
      {loading ? (
        <Loading />
      ) : error ? (
        <EmptyState text={error} />
      ) : rows.length === 0 ? (
        <EmptyState text="No contributors yet." />
      ) : (
        <div className="flex flex-col gap-6">
          <Card size="sm">
            <CardHeader className="border-b">
              <CardTitle>Top contributors</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col">
                {top.map((c) => (
                  <div key={c.login} className="flex items-center gap-3 py-1.5">
                    <img
                      src={avatarUrl(c.login)}
                      alt=""
                      className="size-5 rounded-full"
                      loading="lazy"
                    />
                    <a
                      href={`https://github.com/${c.login}`}
                      target="_blank"
                      rel="noreferrer"
                      className="w-40 shrink-0 truncate font-semibold text-blue-600 hover:underline dark:text-blue-400"
                    >
                      {c.login}
                    </a>
                    <div className="flex-1">
                      <div
                        className="h-3.5 rounded bg-[var(--chart-1)]"
                        style={{ width: `${(c.merged / maxMerged) * 100}%` }}
                      />
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {comma(c.merged)} merged
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card size="sm" className="overflow-hidden">
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
                  <TableHead className="text-right">First merged</TableHead>
                  <TableHead className="text-right">Last merged</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((c, i) => (
                  <TableRow key={c.login}>
                    <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <img
                          src={avatarUrl(c.login)}
                          alt=""
                          className="size-6 rounded-full"
                          loading="lazy"
                        />
                        <a
                          href={`https://github.com/${c.login}`}
                          target="_blank"
                          rel="noreferrer"
                          className="font-medium text-foreground hover:text-blue-600 hover:underline dark:hover:text-blue-400"
                        >
                          {c.login}
                        </a>
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
                    <TableCell className="text-right tabular-nums">
                      {comma(c.avgDiff)}
                    </TableCell>
                    <TableCell>
                      {c.largest ? (
                        <>
                          <a
                            href={c.largest.url}
                            target="_blank"
                            rel="noreferrer"
                            className="font-semibold hover:text-blue-600 dark:hover:text-blue-400"
                          >
                            {c.largest.title}
                          </a>
                          <span className="text-muted-foreground">
                            {' '}
                            · {c.largest.repo}#{c.largest.number}
                          </span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {comma(c.reposCount)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right text-muted-foreground">
                      {formatDate(c.first)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right text-muted-foreground">
                      {formatDate(c.last)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </div>
      )}
    </>
  )
}
