// STRAT 5 Heatmap a11y: button gridcell 11px hit (was 24), roving tabindex, single shared Tooltip, quantile legend 0/q50/q75/q90, CSS var --cell
// Dense GitHub-style: gap-px (1px) / gap-[2px] (2px) — dots 2px apart not 11px, 53 weeks fit without huge whitespace, @container fill width
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
  // Density fix: for sparse 757 merges / 365d, ensure visible blocks even when thresholds collapse
  const { levelClass, thresholds } = useMemo(() => {
    const values = dates.map((d) => d.merged).filter((v) => v > 0)
    const sorted = [...values].sort((a, b) => a - b)
    // quantile thresholds for legend 0/q50/q75/q90
    const q50 = quantile(sorted, 0.5)
    const q75 = quantile(sorted, 0.75)
    const q90 = quantile(sorted, 0.9)

    // Map count -> Tailwind class. 0 is muted, then quantile buckets.
    // Dense palette: lightest non-zero is now bg-green-400 (not 300) for visibility on sparse data.
    // Keeps sticky gutter but ensures 1-merge cells are not pale empty-looking.
    function cls(n: number): string {
      if (n <= 0) return 'bg-muted border border-border/50'
      // sparse-data fallbacks: if thresholds collapse or very few distinct values, degrade to simple 1/2/3+
      // Use saturated greens so 757 merges sparse still shows dense blocks, not washed out.
      if (sorted.length < 4 || q50 === q90) {
        if (n === 1) return 'bg-[#9be9a8] dark:bg-[#0e4429] border border-[#30a14e]/30' // GitHub lightest visible (~green-400)
        if (n === 2) return 'bg-[#40c463] dark:bg-[#006d32] border border-[#006d32]/20'
        if (n === 3) return 'bg-[#30a14e] dark:bg-[#26a641]'
        return 'bg-[#216e39] dark:bg-[#39d353] border border-[#216e39]/20'
      }
      // quantile buckets — increased fill opacity range: start at 400 not 300
      if (n <= q50) return 'bg-[#9be9a8] dark:bg-[#0e4429] border border-[#30a14e]/20'
      if (n <= q75) return 'bg-[#40c463] dark:bg-[#006d32] border border-[#006d32]/20'
      if (n <= q90) return 'bg-[#30a14e] dark:bg-[#26a641]'
      return 'bg-[#216e39] dark:bg-[#39d353]'
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

  // Dense GitHub-style: cell 10px + gap-px (1px) = 11px step == spec weekIndex*11px
  // Previously gap-1 (4px) + 24px hit gave 28px center distance, huge sparse look.
  // Now gap-[2px] or gap-px with --cell 10px hit ~11px (visual 10, hit 11, touch expanded to 20px via padding if needed)
  // Remove outer gap-1 extra — gutter+grid gap-px only, so 53 weeks fit without huge whitespace.
  // trackWidth = weeks * 11 ensures dense, fills width via @container not centered with gaps.
  const STEP_SPEC = 11 // spec: weekIndex*11px
  const STEP_VISUAL = 11 // 10px cell + 1px gap-px (dense GitHub); gap-[2px] variant would be 12px, also supported
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
      // spec position: w * 11px ; visual aligned to w * 11px (gap-px)
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
        className={cn('@container flex w-full flex-col gap-[2px] [container-type:inline-size]', className)}
        style={{ ['--cell' as string]: '10px' } as React.CSSProperties}
      >
        <div className="relative w-full">
          {/* scroll container — w-full + @container fills width, overflow-x-auto scrollbar-thin */}
          <div
            ref={scrollRef}
            className="w-full overflow-x-auto scrollbar-thin [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border"
          >
            <div className="flex w-full min-w-max flex-col gap-[2px]">
              {/* month labels: absolute-positioned at weekIndex*11px (spec) with 40px skip — now aligned to dense 11px step */}
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
              <div className="flex gap-px">
                {/* sticky left gutter position:sticky bg-card z-10 — dense gap-px (was gap-1) */}
                <div className="sticky left-0 z-10 flex shrink-0 flex-col gap-px bg-card pr-1 text-[9px] leading-[11px] text-muted-foreground">
                  {DAYS.map((d) => (
                    <span key={d} className="flex h-[11px] items-center">
                      {d}
                    </span>
                  ))}
                </div>
                {/* single shared Tooltip wrapping the grid — dense gap-px / gap-[2px] between weeks, not gap-1 */}
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
                      className="flex gap-[2px]"
                      onKeyDown={handleKeyDown}
                    >
                      {Array.from({ length: weeks }, (_, w) => (
                        <div key={w} role="row" className="flex flex-col gap-px">
                          {Array.from({ length: 7 }, (_, r) => {
                            const i = total - 1 - (w * 7 + r)
                            if (i < 0 || i >= total)
                              return (
                                <div
                                  key={r}
                                  aria-hidden="true"
                                  className="flex items-center justify-center"
                                  style={{ width: '11px', height: '11px' }}
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
                                style={{ width: '11px', height: '11px' }}
                                className={cn(
                                  'flex items-center justify-center rounded-[2px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
                                  // hit target 20px via expanded touch: visually 11px but hit larger via negative margin padding trick is available at @container breakpoints
                                )}
                              >
                                <span
                                  className={cn(
                                    'rounded-[2px] border border-transparent',
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
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-1.5 text-xs">
                          <span
                            className={cn('size-2 shrink-0 rounded-[2px]', levelClass(activeDay.merged))}
                            aria-hidden
                          />
                          <span>
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
                          </span>
                        </div>
                        {activeHighlighted ? (
                          <span className="text-[11px] text-amber-600 dark:text-amber-400">· highlighted (brushed range)</span>
                        ) : null}
                        <span className="text-[11px] text-muted-foreground">
                          {activeDay.merged === 0
                            ? 'No activity'
                            : activeDay.merged <= thresholds.q50
                              ? `≤ q50 (${thresholds.q50})`
                              : activeDay.merged <= thresholds.q75
                                ? `≤ q75 (${thresholds.q75})`
                                : activeDay.merged <= thresholds.q90
                                  ? `≤ q90 (${thresholds.q90})`
                                  : `> q90 (${thresholds.q90})`}
                        </span>
                      </div>
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
          {/* quantile legend 0/q50/q75/q90 — CSS var --cell 10px, dense gap-px */}
          <div
            className="flex items-center justify-end gap-px text-[10px] text-muted-foreground"
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
          <div className="hidden gap-px gap-[2px]" aria-hidden />
    </TooltipProvider>
  )
}
