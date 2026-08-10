import { CheckCircle2, CircleDashed, CircleDot, XCircle } from 'lucide-react'

import { cn } from '@/lib/utils'

interface StateIconProps {
  state: 'OPEN' | 'MERGED' | 'CLOSED'
  isDraft?: boolean
  className?: string
}

export function StateIcon({ state, isDraft, className }: StateIconProps) {
  if (isDraft) {
    return (
      <CircleDashed
        aria-hidden
        className={cn('size-4 shrink-0 text-gray-500 dark:text-gray-400', className)}
      />
    )
  }
  switch (state) {
    case 'MERGED':
      return (
        <CheckCircle2
          aria-hidden
          className={cn(
            'size-4 shrink-0 fill-purple-600 stroke-white dark:fill-purple-400',
            className,
          )}
        />
      )
    case 'CLOSED':
      return (
        <XCircle
          aria-hidden
          className={cn('size-4 shrink-0 text-red-600 dark:text-red-400', className)}
        />
      )
    case 'OPEN':
      return (
        <CircleDot
          aria-hidden
          className={cn('size-4 shrink-0 text-green-600 dark:text-green-400', className)}
        />
      )
  }
}
