import type { ReactNode } from 'react'
import { BookOpen, Lock } from 'lucide-react'

import { getRepos, getStatus } from '@/lib/api'
import { comma, formatDate } from '@/lib/format'
import { useApi } from '@/lib/use-api'

import { EmptyState } from '@/components/empty-state'
import { Loading } from '@/components/loading'
import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export default function ReposPage() {
  const { data: status } = useApi(getStatus)
  const { data, loading, error } = useApi(getRepos)

  const org = status?.org ?? ''

  let content: ReactNode
  if (error) {
    content = <EmptyState text={error} />
  } else if (loading || !data) {
    content = <Loading />
  } else if (data.rows.length === 0) {
    content = <EmptyState text="No repositories." />
  } else {
    content = (
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Repository</TableHead>
              <TableHead className="text-right tabular-nums">Pull requests</TableHead>
              <TableHead className="text-right tabular-nums">Merged</TableHead>
              <TableHead className="text-right tabular-nums">Open</TableHead>
              <TableHead className="text-right tabular-nums">Closed</TableHead>
              <TableHead className="text-right tabular-nums">Additions</TableHead>
              <TableHead className="text-right tabular-nums">Deletions</TableHead>
              <TableHead className="text-right tabular-nums">Avg diff</TableHead>
              <TableHead>Largest PR</TableHead>
              <TableHead className="text-right tabular-nums">Contributors</TableHead>
              <TableHead>First merged</TableHead>
              <TableHead>Last merged</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.rows.map((repo) => (
              <TableRow key={repo.name}>
                <TableCell>
                  <span className="flex items-center gap-2">
                    {repo.private ? (
                      <Lock aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <BookOpen aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                    )}
                    <a
                      href={`https://github.com/${org}/${repo.name}`}
                      target="_blank"
                      rel="noreferrer"
                      className="font-semibold hover:text-blue-600 dark:hover:text-blue-400"
                    >
                      {repo.name}
                    </a>
                    {repo.archived ? <Badge variant="secondary">archived</Badge> : null}
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums">{comma(repo.total)}</TableCell>
                <TableCell className="text-right tabular-nums">{comma(repo.merged)}</TableCell>
                <TableCell className="text-right tabular-nums">{comma(repo.open)}</TableCell>
                <TableCell className="text-right tabular-nums">{comma(repo.closed)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  <span className="font-mono text-green-600 dark:text-green-400">
                    +{comma(repo.additions)}
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  <span className="font-mono text-red-600 dark:text-red-400">
                    −{comma(repo.deletions)}
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums">{comma(repo.avgDiff)}</TableCell>
                <TableCell>
                  {repo.largest ? (
                    <span className="flex items-center gap-1">
                      <a
                        href={repo.largest.url}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium hover:text-blue-600 dark:hover:text-blue-400"
                      >
                        {repo.largest.title}
                      </a>
                      <span className="text-muted-foreground">· #{repo.largest.number}</span>
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="text-right tabular-nums">{comma(repo.contributors)}</TableCell>
                <TableCell className="text-muted-foreground">{formatDate(repo.first)}</TableCell>
                <TableCell className="text-muted-foreground">{formatDate(repo.last)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    )
  }

  return (
    <>
      <PageHeader
        title="Repositories"
        description={
          org
            ? `Pull request activity per repository in ${org}.`
            : 'Pull request activity per repository.'
        }
      />
      {content}
    </>
  )
}
