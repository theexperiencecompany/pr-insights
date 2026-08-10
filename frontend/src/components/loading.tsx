import { Loader2 } from 'lucide-react'

import { cn } from '@/lib/utils'

interface LoadingProps {
  text?: string
  className?: string
}

export function Loading({ text = 'Loading…', className }: LoadingProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 py-16 text-sm text-muted-foreground',
        className,
      )}
    >
      <Loader2 className="size-5 animate-spin" />
      <span>{text}</span>
    </div>
  )
}
