import { avatarUrl, type Pull } from '@/lib/api'
import { comma, timeAgo } from '@/lib/format'

import { StateIcon } from './state-icon'

export function PrRow({ pull }: { pull: Pull }) {
  const relative =
    pull.state === 'MERGED' && pull.mergedAt
      ? `merged ${timeAgo(pull.mergedAt)}`
      : pull.state === 'CLOSED' && pull.closedAt
        ? `closed ${timeAgo(pull.closedAt)}`
        : `opened ${timeAgo(pull.createdAt)}`

  return (
    <div className="flex items-center gap-3 border-b border-border px-4 py-2.5 hover:bg-muted/50">
      <StateIcon state={pull.state} isDraft={pull.isDraft} />
      <div className="min-w-0 flex-1">
        <div className="truncate">
          <a
            href={pull.url}
            target="_blank"
            rel="noreferrer"
            className="font-semibold hover:text-blue-600 dark:hover:text-blue-400"
          >
            {pull.title}
          </a>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <span>#{pull.number}</span>
          <span>·</span>
          <span>{pull.repo}</span>
          <span>·</span>
          <img
            src={avatarUrl(pull.author)}
            alt=""
            className="size-4 rounded-full"
            loading="lazy"
          />
          <a
            href={`https://github.com/${pull.author}`}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-foreground hover:text-blue-600 hover:underline dark:hover:text-blue-400"
          >
            {pull.author}
          </a>
          <span>·</span>
          <span>{relative}</span>
          <span>·</span>
          <span>{pull.commits} commits</span>
          <span>·</span>
          <span>{pull.changedFiles} files</span>
        </div>
      </div>
      <div className="shrink-0 text-sm font-mono tabular-nums">
        <span className="text-green-600 dark:text-green-400">
          +{comma(pull.additions)}
        </span>
        <span className="text-red-600 dark:text-red-400">
          {' '}
          −{comma(pull.deletions)}
        </span>
      </div>
    </div>
  )
}
