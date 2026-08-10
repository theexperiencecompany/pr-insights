import { cn } from '@/lib/utils'

interface StateLabelProps {
  state: 'OPEN' | 'MERGED' | 'CLOSED'
  isDraft?: boolean
  className?: string
}

export function StateLabel({ state, isDraft, className }: StateLabelProps) {
  const label = isDraft
    ? { text: 'Draft', bg: 'bg-[#59636e]' }
    : state === 'MERGED'
      ? { text: 'Merged', bg: 'bg-[#8250df]' }
      : state === 'OPEN'
        ? { text: 'Open', bg: 'bg-[#1f883d]' }
        : { text: 'Closed', bg: 'bg-[#cf222e]' }

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium text-white',
        label.bg,
        className,
      )}
    >
      {label.text}
    </span>
  )
}
