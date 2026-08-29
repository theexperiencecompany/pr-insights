import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface FilterBarProps {
  children: ReactNode
  className?: string
}

/**
 * Unified sticky FilterBar — wraps all list-page filters (Repo/Author/State/From-To + presets).
 * Sticky below the header, with blurred background, consistent spacing and responsive wrapping.
 * Used by leaderboards, pulls, contributors/people and insights.
 */
export function FilterBar({ children, className }: FilterBarProps) {
  return (
    <div
      className={cn(
        'sticky top-0 z-20 -mx-6 px-6 py-3 mb-4 flex flex-wrap items-center gap-2 border-y bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80',
        className,
      )}
    >
      {children}
    </div>
  )
}

interface DatePresetsProps {
  from: string
  to: string
  onFromChange: (v: string) => void
  onToChange: (v: string) => void
}

function isoToday(): string {
  return new Date().toISOString().slice(0, 10)
}

function isoDaysAgo(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

export function DatePresets({ from, to, onFromChange, onToChange }: DatePresetsProps) {
  const today = isoToday()
  const handlePreset = (preset: string) => {
    switch (preset) {
      case '7d':
        onFromChange(isoDaysAgo(7))
        onToChange(today)
        break
      case '30d':
        onFromChange(isoDaysAgo(30))
        onToChange(today)
        break
      case '90d':
        onFromChange(isoDaysAgo(90))
        onToChange(today)
        break
      case 'thisMonth': {
        const now = new Date()
        const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
        onFromChange(first.toISOString().slice(0, 10))
        onToChange(today)
        break
      }
      case 'clear':
        onFromChange('')
        onToChange('')
        break
      default:
        break
    }
  }

  const isActive = (preset: string): boolean => {
    if (preset === 'clear') return !from && !to
    if (!from || !to) return false
    const expectedFrom =
      preset === '7d'
        ? isoDaysAgo(7)
        : preset === '30d'
          ? isoDaysAgo(30)
          : preset === '90d'
            ? isoDaysAgo(90)
            : null
    if (expectedFrom) return from === expectedFrom && to === today
    if (preset === 'thisMonth') {
      const now = new Date()
      const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
        .toISOString()
        .slice(0, 10)
      return from === first && to === today
    }
    return false
  }

  const presets: { key: string; label: string }[] = [
    { key: '7d', label: 'Last 7d' },
    { key: '30d', label: 'Last 30d' },
    { key: '90d', label: 'Last 90d' },
    { key: 'thisMonth', label: 'This month' },
  ]

  return (
    <div className="flex items-center gap-1">
      {presets.map((p) => (
        <Button
          key={p.key}
          variant={isActive(p.key) ? 'secondary' : 'ghost'}
          size="xs"
          onClick={() => handlePreset(p.key)}
          aria-pressed={isActive(p.key)}
        >
          {p.label}
        </Button>
      ))}
      {(from || to) && (
        <Button variant="ghost" size="xs" onClick={() => handlePreset('clear')}>
          Clear
        </Button>
      )}
    </div>
  )
}

interface FilterBarClearProps {
  hasFilters: boolean
  onClear: () => void
}

export function FilterBarClear({ hasFilters, onClear }: FilterBarClearProps) {
  if (!hasFilters) return null
  return (
    <Button variant="ghost" size="sm" onClick={onClear} className="ml-auto">
      Clear filters
    </Button>
  )
}
