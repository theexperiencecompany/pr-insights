import type { ReactNode } from "react"
import type { TooltipContentProps } from "recharts"
import { comma, fmtDuration } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { DefaultLegendContentProps } from "recharts"

// Unified tooltip shell — consistent rounded border, bg, shadow for all charts.
export function TipShell({ label, children }: { label?: string | number; children: ReactNode }) {
  return (
    <div className="grid min-w-36 items-start gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
      {label !== undefined && String(label) !== "" ? (
        <div className="font-medium">{String(label)}</div>
      ) : null}
      <div className="grid gap-1.5">{children}</div>
    </div>
  )
}

// One row: color swatch (solid dot or dashed line) + muted label + mono value.
// Uses p.color / p.stroke so swatch matches the line/bar color (chart-1..5).
export function TipRow({
  color,
  label,
  value,
  dashed,
}: {
  color?: string
  label: string
  value: string
  dashed?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="flex items-center gap-1.5">
        {color ? (
          dashed ? (
            <span
              className="h-0 w-3 shrink-0 border-t-2 border-dashed"
              style={{ borderColor: color }}
              aria-hidden
            />
          ) : (
            <span
              className="size-2 shrink-0 rounded-[2px]"
              style={{ backgroundColor: color }}
              aria-hidden
            />
          )
        ) : null}
        <span className="text-muted-foreground">{label}</span>
      </span>
      <span className="font-mono font-medium text-foreground tabular-nums">{value}</span>
    </div>
  )
}

export function getPayloadColor(entry: unknown): string | undefined {
  if (!entry || typeof entry !== "object") return undefined
  const obj = entry as Record<string, unknown>
  const color = obj.color as string | undefined
  const stroke = obj.stroke as string | undefined
  const fill = (obj.fill as string | undefined)
  const payload = obj.payload as Record<string, unknown> | undefined
  const payloadFill = payload?.fill as string | undefined
  return color ?? stroke ?? fill ?? payloadFill
}

// --- Generic tips for reuse ---

// Single-value tip (Area/Line with one series).
export function SingleTip({
  active,
  payload,
  label,
  labelText,
  format,
  color,
  dashed,
}: Partial<TooltipContentProps<number, string>> & {
  labelText: string
  format: (v: number) => string
  color: string
  dashed?: boolean
}) {
  if (!active || !payload?.length) return null
  const entry = payload[0]
  const val = entry?.value
  if (val == null || typeof val !== "number" || !Number.isFinite(val)) return null
  const col = (getPayloadColor(entry) ?? color) as string
  return (
    <TipShell label={label}>
      <TipRow color={col} label={labelText} value={format(val)} dashed={dashed} />
    </TipShell>
  )
}

// Stacked bar tip: per-segment rows + Total footer. Hides filtered series.
export function StackedBarTip({
  active,
  payload,
  label,
  hidden,
  formatters,
  totalLabel = "Total",
}: Partial<TooltipContentProps<number, string>> & {
  hidden?: Record<string, boolean>
  formatters: Record<string, (v: number) => string>
  totalLabel?: string
}) {
  if (!active || !payload?.length) return null
  const rows = payload.filter((e) => !hidden?.[String(e.dataKey)])
  if (!rows.length) return null
  const total = rows.reduce((s, e) => s + Number(e.value ?? 0), 0)
  return (
    <TipShell label={label}>
      {rows.map((entry) => {
        const key = String(entry.dataKey)
        const col = getPayloadColor(entry)
        const fmt = formatters[key] ?? ((v: number) => comma(Math.round(v)))
        return (
          <TipRow
            key={key}
            color={col}
            label={String(entry.name ?? key)}
            value={fmt(Number(entry.value ?? 0))}
          />
        )
      })}
      <div className="flex items-center justify-between gap-4 border-t border-border/50 pt-1.5">
        <span className="text-muted-foreground">{totalLabel}</span>
        <span className="font-mono font-medium tabular-nums">
          {rows.length === 1
            ? (formatters[String(rows[0].dataKey)] ?? ((v:number)=>comma(Math.round(v))))(total)
            : comma(Math.round(total))}
        </span>
      </div>
    </TipShell>
  )
}

// Simple bar/area single metric tip without stacked total.
export function SimpleBarTip({
  active,
  payload,
  label,
  labelText,
  format,
}: Partial<TooltipContentProps<number, string>> & {
  labelText: string
  format: (v: number) => string
}) {
  if (!active || !payload?.length) return null
  const entry = payload[0]
  if (entry?.value == null) return null
  return (
    <TipShell label={label}>
      <TipRow
        color={getPayloadColor(entry)}
        label={labelText}
        value={format(Number(entry.value))}
      />
    </TipShell>
  )
}

// Duration tip (minutes -> "3.2 min" via fmtDuration, with color dot).
export function MinutesTip({
  active,
  payload,
  label,
}: Partial<TooltipContentProps<number, string>>) {
  if (!active || !payload?.length) return null
  const v = Number(payload[0]?.value ?? 0)
  if (!Number.isFinite(v)) return null
  return (
    <TipShell label={label}>
      <TipRow
        color={getPayloadColor(payload[0]) ?? "var(--chart-1)"}
        label="Duration"
        value={fmtDuration(v)}
      />
    </TipShell>
  )
}

// Rate tip (0..100 with 1 decimal + dot).
export function RateTipGeneric({
  active,
  payload,
  label,
}: Partial<TooltipContentProps<number, string>>) {
  if (!active || !payload?.length) return null
  const v = Number(payload[0]?.value ?? 0)
  if (!Number.isFinite(v)) return null
  return (
    <TipShell label={label}>
      <TipRow
        color={getPayloadColor(payload[0]) ?? "var(--chart-2)"}
        label="Success rate"
        value={`${v.toFixed(1)}%`}
      />
    </TipShell>
  )
}

// ToggleLegend: clickable legend where hiddenSeries entries are dimmed; dashed swatches for dashed keys.

export function ToggleLegend({
  payload,
  hiddenSeries,
  onToggleSeries,
}: DefaultLegendContentProps & {
  hiddenSeries: Record<string, boolean>
  onToggleSeries: (key: string) => void
}) {
  if (!payload?.length) return null
  return (
    <div className="flex flex-wrap items-center justify-center gap-4 pt-3">
      {payload
        .filter((item) => item.type !== "none")
        .map((item) => {
          const key = String(item.dataKey)
          const inactive = Boolean(hiddenSeries[key])
          const isDashed = key === "prev" || key === "forecast" || key === "ma" || key === "p75" || key === "p90"
          const isDimmed = key === "forecast"
          return (
            <button
              key={key}
              type="button"
              onClick={() => onToggleSeries(key)}
              aria-pressed={!inactive}
              className={cn(
                "flex cursor-pointer items-center gap-1.5 text-xs transition-opacity",
                inactive && "opacity-50",
              )}
            >
              {isDashed ? (
                <span
                  className="h-0 w-3 shrink-0 border-t-2 border-dashed"
                  style={{
                    borderColor: item.color as string,
                    opacity: isDimmed ? 0.6 : 1,
                  }}
                  aria-hidden
                />
              ) : (
                <span
                  className="size-2 shrink-0 rounded-[2px]"
                  style={{ backgroundColor: item.color as string, opacity: isDimmed ? 0.6 : 1 }}
                  aria-hidden
                />
              )}
              <span className="text-muted-foreground">{String(item.value)}</span>
            </button>
          )
        })}
    </div>
  )
}
