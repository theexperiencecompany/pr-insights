import { Flame } from 'lucide-react'
import { Link } from 'react-router-dom'

import { avatarUrl, type Contributor } from '@/lib/api'
import { comma } from '@/lib/format'

interface ContributorBarProps {
  contributor: Contributor
  maxMerged: number
}

// One contributor row: avatar · login · proportional bar · "N merged" with
// optional streak chip and bot chip — all on a single line, no wrapping.
export function ContributorBar({ contributor: c, maxMerged }: ContributorBarProps) {
  return (
    <div className="flex items-center gap-3">
      <img
        src={avatarUrl(c.login)}
        alt=""
        className="size-5 shrink-0 rounded-full"
        loading="lazy"
      />
      <Link
        to={`/contributors/${c.login}`}
        className="w-32 shrink-0 truncate font-semibold text-blue-600 hover:underline dark:text-blue-400"
      >
        {c.login}
      </Link>
      <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-[var(--chart-1)]"
          style={{ width: `${(c.merged / maxMerged) * 100}%` }}
        />
      </div>
      <span className="flex w-44 shrink-0 items-center justify-end gap-1.5 whitespace-nowrap text-xs tabular-nums text-muted-foreground">
        {comma(c.merged)} merged
        {c.currentStreak >= 2 && (
          <span
            className="inline-flex h-4 shrink-0 items-center gap-0.5 rounded-full bg-amber-100 px-1.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-400/15 dark:text-amber-400"
            title={`${c.currentStreak} week shipping streak`}
          >
            <Flame className="size-3" />
            {c.currentStreak}w
          </span>
        )}
        {c.isBot && (
          <span className="inline-flex h-4 shrink-0 items-center rounded-full bg-muted px-1.5 text-[10px] font-semibold text-muted-foreground">
            bot
          </span>
        )}
      </span>
    </div>
  )
}
