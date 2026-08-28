import { cn } from '@/lib/utils'

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

// GitHub-style contribution grid: 7 day-rows × ~53 week-columns.
// dates: [{date: "YYYY-MM-DD", merged}], oldest first, must cover ~365 days.

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function levelClass(n: number): string {
  if (n <= 0) return 'bg-muted'
  if (n === 1) return 'bg-green-300 dark:bg-green-900'
  if (n === 2) return 'bg-green-500 dark:bg-green-700'
  return 'bg-green-600 dark:bg-green-500'
}

interface HeatmapProps {
  dates: { date: string; merged: number }[]
  className?: string
}

export function Heatmap({ dates, className }: HeatmapProps) {
  const total = dates.length
  const weeks = Math.ceil(total / 7)

  const monthLabel = (i: number): string | null => {
    const d = new Date(dates[i].date + 'T00:00:00Z')
    if (d.getUTCDate() <= 7 && i > 0) {
      return d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })
    }
    return null
  }

  const max = Math.max(1, ...dates.map((d) => d.merged))

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="overflow-x-auto">
        <div className="inline-flex flex-col gap-1.5 min-w-max">
          <div className="flex gap-1 ml-[34px] text-[10px] leading-none text-muted-foreground">
            {Array.from({ length: weeks }, (_, w) => {
              const i = total - 1 - w * 7
              const label = i >= 0 ? monthLabel(i) : null
              return (
                <div key={w} className="w-[10px] shrink-0">
                  {label ? <span className="whitespace-nowrap">{label}</span> : null}
                </div>
              )
            })}
          </div>
          <div className="flex gap-1">
            <div className="flex flex-col gap-1 pr-2 text-[9px] leading-[10px] text-muted-foreground shrink-0">
              {DAYS.map((d) => (
                <span key={d} className="h-[10px]">
                  {d}
                </span>
              ))}
            </div>
            <div className="flex gap-1">
          {Array.from({ length: weeks }, (_, w) => (
            <div key={w} className="flex flex-col gap-1">
              {Array.from({ length: 7 }, (_, r) => {
                const i = total - 1 - (w * 7 + r)
                if (i < 0 || i >= total) return <div key={r} className="size-[10px]" />
                const day = dates[i]
                return (
                  <Tooltip key={r}>
                    <TooltipTrigger asChild>
                      <div
                        className={cn('size-[10px] rounded-[2px]', levelClass(day.merged))}
                        style={{ opacity: day.merged > 0 ? 0.55 + 0.45 * (day.merged / max) : 1 }}
                      />
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      <p className="text-xs">
                        {day.merged > 0 ? `${day.merged} PR${day.merged === 1 ? '' : 's'} merged` : 'No merges'} ·{' '}
                        {new Date(day.date + 'T00:00:00Z').toLocaleDateString('en-US', {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                          timeZone: 'UTC',
                        })}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                )
              })}
            </div>
          ))}
        </div>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-end gap-1 text-[10px] text-muted-foreground">
        Less
        {[0, 1, 2, 3].map((n) => (
          <span key={n} className={cn('size-[10px] rounded-[2px]', levelClass(n))} />
        ))}
        More
      </div>
    </div>
  )
}
