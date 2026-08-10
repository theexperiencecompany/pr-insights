import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

interface EmptyStateProps {
  text: string
  className?: string
  children?: ReactNode
}

export function EmptyState({ text, className, children }: EmptyStateProps) {
  return (
    <div className={cn('py-16 text-center text-sm text-muted-foreground', className)}>
      <p>{text}</p>
      {children}
    </div>
  )
}
