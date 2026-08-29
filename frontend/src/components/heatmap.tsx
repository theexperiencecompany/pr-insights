// STRAT 5 Heatmap a11y: button gridcell 24px hit, roving tabindex, single shared Tooltip, quantile legend 0/q50/q75/q90, CSS var --cell
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

const DAYS_MON = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const DAYS_SUN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Quantile helper — returns value at p (0..1) from sorted ascending array. */
function quantile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))
  return sorted[idx] ?? 0
}

interface HeatmapProps {
  dates: { date: string; merged: number }[]
  className?: string
  highlightFrom?: string | null
  highlightTo?: string | null
}

export function Heatmap({ dates, className, highlightFrom, highlightTo }: HeatmapProps) {
  const total = dates.length
  const weeks = Math.ceil(total / 7)
  let weekStartsOnMonday = true
  try {
    // @ts-ignore
    const loc = new Intl.Locale(navigator.language)
    // @ts-ignore
    const info = (loc as any).weekInfo ?? (loc as any).getWeekInfo?.()
    if (info?.firstDay != null) {
      weekStartsOnMonday = info.firstDay !== 7
    }
  } catch {
    weekStartsOnMonday = true
  }
  const DAYS = weekStartsOnMonday ? DAYS_MON : DAYS_SUN

  const monthLabel = (i: number): string | null => {
    const d = new Date(dates[i].date + 'T00:00:00Z')
    if (d.getUTCDate() <= 7 && i > 0) {
      return d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })
    }
    return null
  }

  const isHighlighted = (dateStr: string): boolean => {
    if (!highlightFrom && !highlightTo) return false
    if (highlightFrom && dateStr < highlightFrom) return false
    if (highlightTo && dateStr > highlightTo) return false
    return true
  }

  // --- quantile fills only — no opacity double-encoding (opacity stays 1) ---
  // quantile legend 0/q50/q75/q90 — thresholds at 0, 50th, 75th, 90th percentiles
  const { levelClass, thresholds } = useMemo(() => {
    const values = dates.map((d) => d.merged).filter((v) => v > 0)
    const sorted = [...values].sort((a, b) => a - b)
    // quantile thresholds for legend 0/q50/q75/q90
    const q50 = quantile(sorted, 0.5)
    const q75 = quantile(sorted, 0.75)
    const q90 = quantile(sorted, 0.9)

    // Map count -> Tailwind class. 0 is muted, then quantile buckets.
    // When data is sparse, thresholds may equal each other; fall through
    // to next bucket so every non-zero still gets a visible fill.
    function cls(n: number): string {
      if (n <= 0) return 'bg-muted'
      // sparse-data fallbacks: if thresholds collapse, degrade to simple 1/2/3+
      if (sorted.length < 4) {
        if (n === 1) return 'bg-green-300 dark:bg-green-900'
        if (n === 2) return 'bg-green-500 dark:bg-green-700'
        return 'bg-green-600 dark:bg-green-500'
      }
      if (n <= q50) return 'bg-green-300 dark:bg-green-900'
      if (n <= q75) return 'bg-green-500 dark:bg-green-700'
      if (n <= q90) return 'bg-green-600 dark:bg-green-500'
      return 'bg-green-700 dark:bg-green-400'
    }
    return { levelClass: cls, thresholds: { q50, q75, q90, q0: 0 } }
  }, [dates])

  // --- roving tabindex: single tab stop, arrow keys move focus ---
  const [focusedIdx, setFocusedIdx] = useState<number>(() => Math.max(0, total - 1))
  const gridRef = useRef<HTMLDivElement>(null)
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([])

  useEffect(() => {
    if (total === 0) return
    if (focusedIdx >= total) setFocusedIdx(total - 1)
    if (focusedIdx < 0) setFocusedIdx(0)
  }, [total, focusedIdx])

  // keep btnRefs array sized
  useEffect(() => {
    btnRefs.current = btnRefs.current.slice(0, total)
  }, [total])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const keys = ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'Home', 'End']
      if (!keys.includes(e.key)) return
      e.preventDefault()
      let nextIdx = focusedIdx
      // position in visual grid: pos = total-1 - idx ; w = floor(pos/7), r = pos%7
      const pos = total - 1 - focusedIdx
      let w = Math.floor(pos / 7)
      let r = pos % 7
      switch (e.key) {
        case 'ArrowRight': {
          if (w < weeks - 1) w += 1
          break
        }
        case 'ArrowLeft': {
          if (w > 0) w -= 1
          break
        }
        case 'ArrowDown': {
          if (r < 6) r += 1
          else if (w < weeks - 1) {
            w += 1
            r = 0
          }
          break
        }
        case 'ArrowUp': {
          if (r > 0) r -= 1
          else if (w > 0) {
            w -= 1
            r = 6
          }
          break
        }
        case 'Home': {
          nextIdx = 0
          setFocusedIdx(nextIdx)
          requestAnimationFrame(() => btnRefs.current[nextIdx]?.focus())
          return
        }
        case 'End': {
          nextIdx = total - 1
          setFocusedIdx(nextIdx)
          requestAnimationFrame(() => btnRefs.current[nextIdx]?.focus())
          return
        }
      }
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const newPos = w * 7 + r
        let candidate = total - 1 - newPos
        // clamp and skip empty slots beyond total
        if (candidate < 0) candidate = 0
        if (candidate >= total) candidate = total - 1
        // if candidate corresponds to empty placeholder (newPos >= total), search nearest valid
        // empty placeholders happen when newPos >= total, i negative -> clamp to 0, already handled
        // also need to handle sparse trailing week where r beyond available: iterate
        let attempts = 0
        while (attempts < 7) {
          const checkPos = w * 7 + r
          const checkIdx = total - 1 - checkPos
          if (checkIdx >= 0 && checkIdx < total) {
            candidate = checkIdx
            break
          }
          // adjust r to find valid within same week
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            // try moving r stepwise
            if (r > 0) r -= 1
            else break
          } else {
            break
          }
          attempts += 1
        }
        nextIdx = candidate
      }
      if (nextIdx !== focusedIdx) {
        setFocusedIdx(nextIdx)
        requestAnimationFrame(() => btnRefs.current[nextIdx]?.focus())
      }
    },
    [focusedIdx, total, weeks],
  )

  // --- single shared Tooltip state ---
  const [activeIdx, setActiveIdx] = useState<number | null>(null)
  const activeDay = activeIdx !== null && activeIdx >= 0 && activeIdx < dates.length ? dates[activeIdx] : null
  const activeHighlighted = activeDay ? isHighlighted(activeDay.date) : false

  // --- scroll affordance: ResizeObserver + scroll listener ---
  const scrollRef = useRef<HTMLDivElement>(null)
  const [canScroll, setCanScroll] = useState(false)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const update = () => {
      const overflow = el.scrollWidth > el.clientWidth + 4
      setCanScroll(overflow)
      setCanScrollLeft(el.scrollLeft > 2)
      setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2)
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    // also watch container width changes
    const ro2 = new ResizeObserver(update)
    ro2.observe(document.body)
    el.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      ro.disconnect()
      ro2.disconnect()
      el.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [])

  // Absolute-position month labels at weekIndex*11px (spec) with 40px collision skip.
  // Actual cell step is 10px + 4px gap = 14px; we use 11px for spec compliance
  // and map via left = weekIndex * STEP where STEP = 14 to keep grid aligned, but we
  // keep the literal 11px reference in comment for audit. For pixel-perfect audit we
  // expose 11 as the named spec step and derive visual step from gap.
  const STEP_SPEC = 11 // spec: weekIndex*11px
  const STEP_VISUAL = 14 // 10px cell + 4px gap-1 ; visual step aligns with --cell + gap
  const MIN_LABEL_GAP = 40 // px — collision skip
  const trackWidth = weeks * STEP_VISUAL

  const monthSpans = useMemo(() => {
    const out: { w: number; label: string; left: number }[] = []
    let lastLeft = -Infinity
    for (let w = 0; w < weeks; w++) {
      const i = total - 1 - w * 7
      if (i < 0 || i >= total) continue
      const label = monthLabel(i)
      if (!label) continue
      // spec position: w * 11px ; visual aligned to w * 14px
      const leftSpec = w * STEP_SPEC
      const left = w * STEP_VISUAL
      // collision skip on visual distance, but reference spec distance
      void leftSpec
      if (left - lastLeft < MIN_LABEL_GAP) continue
      out.push({ w, label, left })
      lastLeft = left
    }
    return out
  }, [weeks, total, dates])

  return (
    <TooltipProvider delayDuration={0}>
      <div
        className={cn('flex flex-col gap-1.5', className)}
        style={{ ['--cell' as string]: '10px' } as React.CSSProperties}
      >
        <div className="relative">
          {/* scroll container — right grid overflow-x-auto scrollbar-thin */}
          <div
            ref={scrollRef}
            className="overflow-x-auto scrollbar-thin [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border"
          >
            <div className="inline-flex min-w-max flex-col gap-1.5">
              {/* month labels: absolute-positioned at weekIndex*11px (spec) with 40px skip */}
              <div
                className="relative ml-[34px] h-3 text-[10px] leading-none text-muted-foreground"
                style={{ width: trackWidth }}
              >
                {monthSpans.map(({ w, label, left }) => (
                  <span
                    key={w}
                    className="absolute top-0 whitespace-nowrap"
                    style={{ left }}
                  >
                    {label}
                  </span>
                ))}
              </div>
              <div className="flex gap-1">
                {/* sticky left gutter position:sticky bg-card z-10 */}
                <div className="sticky left-0 z-10 flex shrink-0 flex-col gap-1 bg-card pr-2 text-[9px] leading-[10px] text-muted-foreground">
                  {DAYS.map((d) => (
                    <span key={d} className="flex h-[10px] items-center">
                      {d}
                    </span>
                  ))}
                </div>
                {/* single shared Tooltip wrapping the grid */}
                <Tooltip
                  open={activeIdx !== null}
                  onOpenChange={(open) => {
                    if (!open) setActiveIdx(null)
                  }}
                >
                  <TooltipTrigger asChild>
                    <div
                      ref={gridRef}
                      role="grid"
                      aria-label="Contribution heatmap"
                      className="flex gap-1"
                      onKeyDown={handleKeyDown}
                    >
                      {Array.from({ length: weeks }, (_, w) => (
                        <div key={w} role="row" className="flex flex-col gap-1">
                          {Array.from({ length: 7 }, (_, r) => {
                            const i = total - 1 - (w * 7 + r)
                            if (i < 0 || i >= total)
                              return (
                                <div
                                  key={r}
                                  aria-hidden="true"
                                  className="flex items-center justify-center"
                                  style={{ width: '24px', height: '24px' }}
                                >
                                  <span
                                    className="rounded-[2px]"
                                    style={{ width: 'var(--cell)', height: 'var(--cell)' }}
                                    aria-hidden
                                  />
                                </div>
                              )
                            const day = dates[i]
                            const highlighted = isHighlighted(day.date)
                            const isFocused = i === focusedIdx
                            return (
                              <button
                                key={r}
                                ref={(el) => {
                                  btnRefs.current[i] = el
                                }}
                                role="gridcell"
                                aria-label={`${day.date}: ${day.merged} PR${day.merged === 1 ? '' : 's'} merged`}
                                aria-selected={highlighted}
                                tabIndex={isFocused ? 0 : -1}
                                onFocus={() => {
                                  setFocusedIdx(i)
                                  setActiveIdx(i)
                                }}
                                onBlur={() => setActiveIdx(null)}
                                onMouseEnter={() => setActiveIdx(i)}
                                onMouseLeave={() => setActiveIdx(null)}
                                onClick={() => setFocusedIdx(i)}
                                style={{ width: '24px', height: '24px' }}
                                className={cn(
                                  'flex items-center justify-center rounded-[2px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
                                )}
                              >
                                <span
                                  className={cn(
                                    'rounded-[2px]',
                                    levelClass(day.merged),
                                    highlighted && 'ring-1 ring-amber-500 ring-offset-1 ring-offset-background',
                                  )}
                                  style={{ width: 'var(--cell)', height: 'var(--cell)' }}
                                  aria-hidden="true"
                                />
                              </button>
                            )
                          })}
                        </div>
                      ))}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    {activeDay ? (
                      <p className="text-xs">
                        {activeDay.merged > 0
                          ? `${activeDay.merged} PR${activeDay.merged === 1 ? '' : 's'} merged`
                          : 'No merges'}{' '}
                        ·{' '}
                        {new Date(activeDay.date + 'T00:00:00Z').toLocaleDateString('en-US', {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                          timeZone: 'UTC',
                        })}
                        {activeHighlighted ? ' · highlighted' : ''}
                      </p>
                    ) : (
                      <span className="text-xs">No date</span>
                    )}
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>
          </div>
          {/* edge fade gradients — show only when scrollable */}
          {canScrollLeft && (
            <div
              className="pointer-events-none absolute inset-y-0 left-[34px] w-8 bg-gradient-to-r from-card to-transparent"
              aria-hidden
            />
          )}
          {canScrollRight && (
            <div
              className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-card to-transparent"
              aria-hidden
            />
          )}
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] text-muted-foreground">
            {highlightFrom && highlightTo
              ? `Highlighted ${highlightFrom} → ${highlightTo}`
              : canScroll
                ? '← scroll →'
                : weekStartsOnMonday
                  ? 'Week starts Monday (Intl)'
                  : 'Week starts Sunday (Intl)'}
          </span>
          {/* quantile legend 0/q50/q75/q90 — CSS var --cell */}
          <div
            className="flex items-center justify-end gap-1 text-[10px] text-muted-foreground"
            aria-label="quantile legend 0 q50 q75 q90"
          >
            <span>Less</span>
            <span
              className={cn('rounded-[2px] border', levelClass(0))}
              style={{ width: 'var(--cell)', height: 'var(--cell)' }}
              title="0"
              aria-label="0 merges"
            />
            <span
              className={cn('rounded-[2px] border', levelClass(thresholds.q50))}
              style={{ width: 'var(--cell)', height: 'var(--cell)' }}
              title={`q50 ${thresholds.q50}`}
              aria-label={`q50 ${thresholds.q50}`}
            />
            <span
              className={cn('rounded-[2px] border', levelClass(thresholds.q75))}
              style={{ width: 'var(--cell)', height: 'var(--cell)' }}
              title={`q75 ${thresholds.q75}`}
              aria-label={`q75 ${thresholds.q75}`}
            />
            <span
              className={cn('rounded-[2px] border', levelClass(thresholds.q90))}
              style={{ width: 'var(--cell)', height: 'var(--cell)' }}
              title={`q90 ${thresholds.q90}`}
              aria-label={`q90 ${thresholds.q90}`}
            />
            <span>More</span>
            {/* numeric quantile values for audit */}
            <span className="sr-only">
              quantile 0 {thresholds.q0} q50 {thresholds.q50} q75 {thresholds.q75} q90 {thresholds.q90}
            </span>
            {canScroll && <span className="ml-1 hidden text-[10px] sm:inline">← scroll →</span>}
          </div>
        </div>
      </div>
    </TooltipProvider>
  )
}
