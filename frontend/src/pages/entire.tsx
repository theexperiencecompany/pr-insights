// VISION v-entire — see docs/vision-entire.md
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Brush,
  CartesianGrid,
  ReferenceLine,
  Scatter,
  ScatterChart,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts'
import { Activity, Flame, RefreshCw, Zap, ArrowUpDown } from 'lucide-react'

import { EmptyState } from '@/components/empty-state'
import { Loading } from '@/components/loading'
import { PageHeader } from '@/components/page-header'
import { StatCard } from '@/components/stat-card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  ChartContainer,
  ChartLegend,
  ChartTooltip,
  type ChartConfig,
} from '@/components/ui/chart'
import { TipShell, TipRow, getPayloadColor, ToggleLegend } from '@/components/chart-tips'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { getEntire, getRepos, triggerEntireSync, type EntireAgent } from '@/lib/api'
import { comma, compact, timeAgo } from '@/lib/format'
import { useApi } from '@/lib/use-api'
import { cn } from '@/lib/utils'

const AGENT_ORDER = [
  'claude',
  'pi',
  'codex',
  'copilot',
  'cursor',
  'gemini',
  'opencode',
  'droid',
  'kiro',
  'antigravity',
  'goose',
  'amp',
  'unknown',
] as const

const AGENT_COLORS: Record<string, string> = {
  claude: '#d97706',
  pi: '#6366f1',
  codex: '#10b981',
  copilot: '#06b6d4',
  cursor: '#8b5cf6',
  gemini: '#3b82f6',
  opencode: '#84cc16',
  droid: '#f43f5e',
  kiro: '#ec4899',
  antigravity: '#14b8a6',
  goose: '#a3e635',
  amp: '#f97316',
  unknown: '#9ca3af',
}

const AGENT_LABELS: Record<string, string> = {
  claude: 'Claude Code',
  pi: 'pi',
  codex: 'Codex',
  copilot: 'Copilot CLI',
  cursor: 'Cursor',
  gemini: 'Gemini CLI',
  opencode: 'OpenCode',
  droid: 'Factory Droid',
  kiro: 'Kiro',
  antigravity: 'Antigravity',
  goose: 'Goose',
  amp: 'AMP',
  unknown: 'Unknown',
}

function agentLabel(id: string): string {
  return AGENT_LABELS[id] ?? id
}
function agentColor(id: string): string {
  return AGENT_COLORS[id] ?? 'var(--chart-1)'
}
function shortDate(iso: string): string {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}
function StackedAgentTip({ active, payload, label, hidden }: Partial<import('recharts').TooltipContentProps<number, string>> & { hidden?: Record<string, boolean> }) {
  if (!active || !payload?.length) return null
  const rows = payload.filter((e) => !hidden?.[String(e.dataKey)])
  if (!rows.length) return null
  const total = rows.reduce((s, e) => s + Number(e.value ?? 0), 0)
  const hasMultiple = rows.length > 1
  return (
    <TipShell label={label}>
      {rows
        .filter((e) => Number(e.value ?? 0) > 0)
        .sort((a, b) => Number(b.value ?? 0) - Number(a.value ?? 0))
        .map((entry) => {
          const key = String(entry.dataKey)
          const col = getPayloadColor(entry) ?? agentColor(key)
          return (
            <TipRow key={key} color={col as string} label={agentLabel(key)} value={`${comma(Number(entry.value ?? 0))} cps`} />
          )
        })}
      {hasMultiple ? (
        <div className="flex items-center justify-between gap-4 border-t border-border/50 pt-1.5">
          <span className="text-muted-foreground">Total</span>
          <span className="font-mono font-medium tabular-nums">{comma(total)} checkpoints</span>
        </div>
      ) : null}
    </TipShell>
  )
}
function CountTip({ active, payload, label }: Partial<import('recharts').TooltipContentProps<number, string>>) {
  if (!active || !payload?.length) return null
  const v = Number(payload[0]?.value ?? 0)
  if (!Number.isFinite(v)) return null
  const col = getPayloadColor(payload[0]) ?? 'var(--chart-1)'
  return (
    <TipShell label={label}>
      <TipRow color={col as string} label="Checkpoints" value={`${comma(v)}`} />
    </TipShell>
  )
}
function ScatterTip({ active, payload }: Partial<import('recharts').TooltipContentProps<number, string>>) {
  if (!active || !payload?.length) return null
  const datum: any = (payload[0] as any)?.payload ?? payload[0]
  if (!datum) return null
  const repo = datum.repo ?? datum.short ?? 'Repo'
  const cps = datum.checkpoints ?? datum.bubbleSize ?? 0
  const prs = datum.mergedCount ?? 0
  const agent = datum.dominantAgent ?? 'unknown'
  const col = agentColor(agent) ?? 'var(--chart-1)'
  return (
    <TipShell label={repo}>
      <TipRow color={col as string} label={agentLabel(agent)} value={`${comma(cps)} cps`} />
      <TipRow color={col as string} label="Merged PRs" value={`${comma(prs)}`} />
      {typeof datum.cpPerPR === 'number' ? (
        <div className="text-[11px] text-muted-foreground">{datum.cpPerPR.toFixed(1)} cp/PR · bubble = checkpoints · 1 PR per 8 CP guide diagonal</div>
      ) : null}
    </TipShell>
  )
}

function agentMixTotal(agent: EntireAgent): number {
  const mix = agent.me.toolMix
  if (!mix) return 0
  return mix.shell + mix.fileOps + mix.search + mix.mcp + mix.agent + mix.other
}

export default function EntirePage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const from = searchParams.get('from') ?? ''
  const to = searchParams.get('to') ?? ''
  const repoFilter = searchParams.get('repo') ?? ''

  const { data, loading, refetch } = useApi(() => getEntire({ from: from || undefined, to: to || undefined, repo: repoFilter || undefined }), [from, to, repoFilter])
  const repos = useApi(getRepos)
  const [syncing, setSyncing] = useState(false)
  const [timelineMode, setTimelineMode] = useState<'total' | 'byAgent'>('total')
  const [repoSort, setRepoSort] = useState<{ key: 'cpPerPR' | 'checkpoints' | 'mergedCount'; dir: 'asc' | 'desc' }>({ key: 'cpPerPR', dir: 'desc' })
  const [hiddenAgents, setHiddenAgents] = useState<Record<string, boolean>>({})
  const toggleAgent = (key: string) => setHiddenAgents((h) => ({ ...h, [key]: !h[key] }))

  const activity = data?.activity ?? null
  const recap = data?.recap ?? null

  // live tick for guard hoursLeft
  const [nowTick, setNowTick] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  const activeAgents = useMemo(() => {
    const seen = new Set<string>()
    for (const day of activity?.daily_contributions ?? []) {
      for (const [id, n] of Object.entries(day.agents)) if (n > 0) seen.add(id)
    }
    for (const rep of activity?.repos ?? []) {
      for (const [id, n] of Object.entries(rep.agents)) if (n > 0) seen.add(id)
    }
    const known = AGENT_ORDER.filter((id) => seen.has(id))
    const extra = [...seen].filter((id) => !(AGENT_ORDER as readonly string[]).includes(id)).sort()
    return [...known, ...extra]
  }, [activity])

  const chartConfig = useMemo(() => {
    const cfg: ChartConfig = {}
    for (const id of activeAgents) cfg[id] = { label: agentLabel(id), color: agentColor(id) }
    cfg['total'] = { label: 'Checkpoints', color: 'var(--chart-1)' }
    cfg['count'] = { label: 'Checkpoints', color: 'var(--chart-1)' }
    return cfg
  }, [activeAgents])

  // unified timeline rows: combine daily_contributions total + per-agent
  const allTimelineRows = useMemo(() => {
    const rows: Array<Record<string, string | number> & { rawDate: string; total: number }> = []
    for (const day of activity?.daily_contributions ?? []) {
      const total = Object.values(day.agents).reduce((a, b) => a + b, 0)
      const row: Record<string, string | number> & { rawDate: string; total: number } = {
        rawDate: day.date,
        date: shortDate(day.date),
        total,
      } as any
      for (const id of activeAgents) row[id] = day.agents[id] ?? 0
      rows.push(row)
    }
    // Ensure sorted by date
    rows.sort((a, b) => String(a.rawDate).localeCompare(String(b.rawDate)))
    return rows
  }, [activity, activeAgents])

  const filteredTimelineRows = useMemo(() => {
    if (!from && !to) return allTimelineRows
    return allTimelineRows.filter((r) => {
      const d = String(r.rawDate)
      if (from && d < from) return false
      if (to && d >= to) return false
      return true
    })
  }, [allTimelineRows, from, to])

  const displayRows = filteredTimelineRows.length > 0 ? filteredTimelineRows : allTimelineRows

  // hourly aggregated but filtered by brush window dates
  const hourlyRows = useMemo(() => {
    const byHour = new Map<number, Record<string, number>>()
    const allowedDates = new Set(filteredTimelineRows.map((r) => String(r.rawDate)))
    const useFilter = allowedDates.size > 0 && (from || to)
    for (const h of activity?.hourly_contributions ?? []) {
      if (h.value <= 0) continue
      if (useFilter && !allowedDates.has(h.date)) continue
      const row = byHour.get(h.hour) ?? {}
      row[h.agent] = (row[h.agent] ?? 0) + h.value
      byHour.set(h.hour, row)
    }
    const rows: Record<string, string | number>[] = []
    for (let hh = 0; hh < 24; hh++) {
      const row: Record<string, string | number> = { hour: `${hh}h` }
      for (const id of activeAgents) row[id] = byHour.get(hh)?.[id] ?? 0
      rows.push(row)
    }
    return rows
  }, [activity, activeAgents, filteredTimelineRows, from, to])

  const recapDailyRows = useMemo(
    () => (recap?.daily ?? []).map((d) => ({ date: shortDate(d.date), rawDate: d.date, count: d.count })),
    [recap],
  )

  const totalCheckpoints = useMemo(
    () =>
      (activity?.daily_contributions ?? []).reduce(
        (sum, d) => sum + Object.values(d.agents).reduce((a, b) => a + b, 0),
        0,
      ),
    [activity],
  )

  const toolMixTotals = useMemo(() => {
    const t = { shell: 0, fileOps: 0, search: 0, mcp: 0, agent: 0, other: 0 }
    for (const a of Object.values(recap?.agents ?? {})) {
      const m = a.me.toolMix
      if (!m) continue
      t.shell += m.shell
      t.fileOps += m.fileOps
      t.search += m.search
      t.mcp += m.mcp
      t.agent += m.agent
      t.other += m.other
    }
    return t
  }, [recap])

  const mcpTotals = useMemo(() => {
    const map = new Map<string, number>()
    for (const a of Object.values(recap?.agents ?? {})) {
      for (const m of a.me.mcpServers ?? []) map.set(m.name, (map.get(m.name) ?? 0) + m.count)
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1])
  }, [recap])

  const agents = useMemo(
    () => Object.values(recap?.agents ?? {}).sort((a, b) => b.me.checkpoints - a.me.checkpoints),
    [recap],
  )

  const stats = activity?.stats ?? null

  const handleRefresh = async () => {
    setSyncing(true)
    try {
      await triggerEntireSync()
      setTimeout(() => refetch(), 2500)
    } finally {
      setTimeout(() => setSyncing(false), 2500)
    }
  }

  const handleBrushChange = (range: any) => {
    if (!range) return
    const { startIndex, endIndex } = range
    if (startIndex == null || endIndex == null) return
    const rows = allTimelineRows
    if (!rows.length) return
    if (startIndex === 0 && endIndex === rows.length - 1) {
      const next = new URLSearchParams(searchParams)
      next.delete('from')
      next.delete('to')
      setSearchParams(next, { replace: true })
      return
    }
    const fromRow = rows[startIndex]
    const toRow = rows[endIndex]
    const fromKey = String((fromRow as any).rawDate)
    const toExclusive = (() => {
      const d = new Date(toRow.rawDate + 'T00:00:00Z')
      d.setUTCDate(d.getUTCDate() + 1)
      return d.toISOString().slice(0, 10)
    })()
    const next = new URLSearchParams(searchParams)
    if (fromKey) next.set('from', fromKey)
    if (toExclusive) next.set('to', toExclusive)
    setSearchParams(next, { replace: true })
  }

  const clearBrush = () => {
    const next = new URLSearchParams(searchParams)
    next.delete('from')
    next.delete('to')
    setSearchParams(next, { replace: true })
  }

  // Scatter quadrant + diagonal analysis
  const scatterMeta = useMemo(() => {
    const pts: any[] = (data?.repoJoin ?? []) as any[]
    if (!pts.length) return null
    const cps = pts.map((p) => p.checkpoints).sort((a: number, b: number) => a - b)
    const prs = pts.map((p) => p.mergedCount).sort((a: number, b: number) => a - b)
    const median = (arr: number[]) => {
      if (!arr.length) return 0
      const mid = Math.floor(arr.length / 2)
      if (arr.length % 2 === 1) return arr[mid]
      return (arr[mid - 1] + arr[mid]) / 2
    }
    const medianCp = median(cps)
    const medianPr = median(prs)
    const maxCp = Math.max(...cps, 1)
    const maxPr = Math.max(...prs, 1)
    // diagonal guide 1 PR per 8 CP : y = x/8
    const diagonalEnd = { x: maxCp, y: maxCp / 8 }
    // quadrants
    let efficient = 0,
      busy = 0,
      highBoth = 0,
      lowBoth = 0
    for (const p of pts) {
      const left = p.checkpoints < medianCp
      const top = p.mergedCount > medianPr
      if (left && top) efficient++
      else if (!left && !top) busy++ // note busy = high cp low pr => cp > median && pr < median
      else if (!left && top) highBoth++
      else lowBoth++
    }
    // more precise busy definition per spec: busy lower-right = many cps few PRs => cp > median && pr < median
    // efficient upper-left = many PRs few cps => cp < median && pr > median
    // recount correctly
    efficient = pts.filter((p) => p.checkpoints < medianCp && p.mergedCount > medianPr).length
    busy = pts.filter((p) => p.checkpoints > medianCp && p.mergedCount < medianPr).length
    highBoth = pts.filter((p) => p.checkpoints >= medianCp && p.mergedCount >= medianPr).length
    lowBoth = pts.filter((p) => p.checkpoints <= medianCp && p.mergedCount <= medianPr).length
    let emptyQuadrant: string | null = null
    let cta = ''
    if (efficient === 0) {
      emptyQuadrant = 'efficient'
      cta = 'No repos in efficient quadrant (low checkpoints, high PRs). Try smaller checkpoint batches to ship faster — or add conversion CTA: break work into PR-sized tasks.'
    } else if (busy === 0) {
      emptyQuadrant = 'busy'
      cta = 'No busy repos — all converting efficiently. Keep checkpoint discipline!'
    } else if (lowBoth === 0) {
      emptyQuadrant = 'lowBoth'
      cta = 'No low-activity repos — every repo is active. Consider archiving stale repos.'
    } else if (highBoth === 0) {
      emptyQuadrant = 'highBoth'
      cta = 'No high-throughput repos — scale checkpointing where PRs are high.'
    }
    return { medianCp, medianPr, maxCp, maxPr, diagonalEnd, efficient, busy, highBoth, lowBoth, emptyQuadrant, cta }
  }, [data?.repoJoin])

  // Repo table rows derived from repoJoin (already window-filtered server-side) or fallback to activity.repos
  const repoTableRows = useMemo(() => {
    const join = (data?.repoJoin ?? []) as any[]
    if (join.length > 0) {
      // already filtered by repo query, but also ensure filteredTimeline? join already windowed
      return join.map((pt: any) => ({
        repo: pt.repo,
        short: pt.short,
        checkpoints: pt.checkpoints,
        mergedCount: pt.mergedCount,
        cpPerPR: pt.cpPerPR,
        dominantAgent: pt.dominantAgent,
        agents: pt.agents ?? {},
      }))
    }
    // fallback client-side join using activity.repos + repos.data merged counts
    const mapped = (activity?.repos ?? []).map((rep) => {
      const short = rep.repo.split('/').pop() ?? rep.repo
      const merged = repos.data?.find((r) => r.name === short)?.merged ?? 0
      const cpPerPR = merged > 0 ? rep.total / merged : rep.total > 0 ? rep.total : 0
      const dominant = Object.entries(rep.agents).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'unknown'
      return {
        repo: rep.repo,
        short,
        checkpoints: rep.total,
        mergedCount: merged,
        cpPerPR,
        dominantAgent: dominant,
        agents: rep.agents,
      }
    })
    if (repoFilter) return mapped.filter((r) => r.short === repoFilter || r.repo === repoFilter)
    return mapped
  }, [data?.repoJoin, activity, repos.data, repoFilter])

  const sortedRepoRows = useMemo(() => {
    const copy = [...repoTableRows]
    const { key, dir } = repoSort
    copy.sort((a: any, b: any) => {
      const av = a[key] ?? 0
      const bv = b[key] ?? 0
      if (av === bv) return a.short.localeCompare(b.short)
      return dir === 'asc' ? av - bv : bv - av
    })
    return copy
  }, [repoTableRows, repoSort])

  const toggleRepoSort = (key: typeof repoSort.key) => {
    setRepoSort((prev) => (prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }))
  }

  // streak guard live hours left recompute (for display)
  const liveGuard = useMemo(() => {
    if (!data?.guard) return null
    // recompute hoursLeft based on nowTick to make countdown live
    const g = data.guard
    // we keep server's hoursLeft but nudge down by elapsed since fetch? simple: use server value minus elapsed minutes /60
    // Instead approximate: compute from nowTick's UTC midnight
    const now = new Date(nowTick)
    const nextMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0)
    const hoursLeft = (nextMidnight - now.getTime()) / 3600000
    return { ...g, hoursLeftUtc: Math.max(0, Math.min(24, hoursLeft)) }
  }, [data?.guard, nowTick])

  if (loading && !data) return <Loading />

  if (!data || (!data.activity && !data.lastError)) {
    return (
      <div className="mx-auto max-w-4xl">
        <PageHeader title="Entire" description="Agent checkpoint analytics from entire.io" />
        <EmptyState text="No Entire data yet.">
          <p className="mx-auto mt-2 max-w-xl text-xs leading-relaxed">
            Install the entire CLI on the host, log in once (<code className="font-mono">entire login --device</code>) and either set{' '}
            <code className="font-mono">ENTIRE_HOME</code> or create the <code className="font-mono">entire-home</code> dir inside the data dir. The backend shells
            out to <code className="font-mono">entire api --to cell /api/v1/me/activity</code> and{' '}
            <code className="font-mono">/api/v1/me/recap</code> every <code className="font-mono">ENTIRE_SYNC_INTERVAL</code> (default 15m) and caches the JSON.
          </p>
        </EmptyState>
      </div>
    )
  }

  const lastError = data?.lastError ?? ''

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title="Entire" description="Agent checkpoint analytics from entire.io — every tracked agent (Claude Code, pi, Codex, …)">
        {data.user ? (
          <span className="flex items-center gap-2 rounded-full border border-border bg-background py-1 pl-1 pr-3 text-xs">
            <img src={data.user.avatarUrl} alt="" className="size-5 rounded-full" loading="lazy" />
            <span className="font-medium">{data.user.displayName || data.user.handle}</span>
            <span className="text-muted-foreground">@{data.user.handle}</span>
          </span>
        ) : null}
        {data?.fetchedAt ? <span className="text-xs text-muted-foreground">Synced {timeAgo(data.fetchedAt)}</span> : null}
        <Button variant="outline" size="sm" onClick={handleRefresh} disabled={syncing}>
          <RefreshCw className={cn('size-3.5', syncing && 'animate-spin')} />
          Refresh
        </Button>
      </PageHeader>

      {lastError ? (
        <div className="mb-4 rounded-[6px] border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          <span className="font-semibold">Entire sync problem:</span> {lastError} — showing the last cached data.{' '}
          <span className="text-muted-foreground">Retrying automatically (3 attempts, then every minute until it recovers).</span>
        </div>
      ) : null}

      {(liveGuard || data?.coach) ? (
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {liveGuard ? (
            <Card
              role="region"
              aria-label="Streak guard"
              className={
                liveGuard.state === 'at_risk'
                  ? 'border-amber-200 bg-amber-50/50 dark:bg-amber-950/20'
                  : liveGuard.state === 'safe'
                    ? 'border-green-200'
                    : ''
              }
            >
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                  <Flame className={'size-4 ' + (liveGuard.state === 'safe' ? 'text-green-600' : liveGuard.state === 'at_risk' ? 'text-amber-600' : 'text-muted-foreground')} />
                  Streak Guard{' '}
                  <Badge
                    variant={liveGuard.state === 'safe' ? 'secondary' : liveGuard.state === 'at_risk' ? 'destructive' : 'outline'}
                    className={liveGuard.state === 'safe' ? 'bg-green-100 text-green-700' : ''}
                  >
                    {liveGuard.state}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-xs" aria-live="polite">
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <div className="text-base font-semibold tabular-nums">{liveGuard.currentStreak}d</div>
                    <div className="text-muted-foreground">current</div>
                  </div>
                  <div>
                    <div className="text-base font-semibold tabular-nums">{liveGuard.lifetimeStreak}d</div>
                    <div className="text-muted-foreground">lifetime</div>
                  </div>
                  <div>
                    <div className="text-base font-semibold tabular-nums">{liveGuard.hoursLeftUtc.toFixed(1)}h</div>
                    <div className="text-muted-foreground">left UTC</div>
                  </div>
                </div>
                <div className="text-muted-foreground">
                  Last active {liveGuard.lastActiveDate || '—'} · {liveGuard.daysSinceActive}d ago ·{' '}
                  {liveGuard.needToday ? 'need 1 checkpoint today' : 'checked in today'}
                </div>
                <div className="font-medium">{liveGuard.reason}</div>
                <div className="text-[11px] text-muted-foreground">
                  Throughput {liveGuard.throughputHint} · state {liveGuard.state} at 00:00 UTC · streak guard protects daily UTC window
                </div>
              </CardContent>
            </Card>
          ) : null}
          {data.coach ? (
            <Card role="region" aria-label="Token coach">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                  <Zap className="size-4 text-muted-foreground" />
                  Token Coach{' '}
                  <Badge
                    variant={
                      data.coach.byAgent.some((a: any) => a.tier === 'heavy')
                        ? 'destructive'
                        : data.coach.byAgent.some((a: any) => a.tier === 'moderate')
                          ? 'secondary'
                          : 'outline'
                    }
                    className={
                      data.coach.rollupTokensPerCp > 4000
                        ? ''
                        : data.coach.rollupTokensPerCp > 1500
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-green-100 text-green-700'
                    }
                  >
                    {data.coach.rollupTokensPerCp > 4000 ? 'Heavy' : data.coach.rollupTokensPerCp > 1500 ? 'Moderate' : 'Efficient'} ·{' '}
                    {Math.round(data.coach.rollupTokensPerCp)} tok/cp
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-xs">
                <div className="grid grid-cols-4 gap-2">
                  <div>
                    <div className="text-base font-semibold tabular-nums">{Math.round(data.coach.rollupTokensPerCp)}</div>
                    <div className="text-muted-foreground">tok/cp</div>
                  </div>
                  <div>
                    <div className="text-base font-semibold tabular-nums">{Math.round(data.coach.rollupTokensPerFile)}</div>
                    <div className="text-muted-foreground">tok/file</div>
                  </div>
                  <div>
                    <div className="text-base font-semibold tabular-nums">{(data.coach.throughput * 1000).toFixed(0)}</div>
                    <div className="text-muted-foreground">throughput</div>
                  </div>
                  <div>
                    <div className="text-base font-semibold tabular-nums">{comma(data.coach.wastedEstTokens)}</div>
                    <div className="text-muted-foreground">overhead</div>
                  </div>
                </div>
                <div className="text-[11px] text-muted-foreground">{data.coach.summaryTip} · Tok/CP = tokens ÷ checkpoints</div>
                <div className="space-y-1 max-h-[160px] overflow-auto">
                  {data.coach.byAgent.slice(0, 6).map((a: any) => (
                    <div key={a.agentId} className="flex items-center justify-between rounded border px-2 py-1">
                      <span className="flex items-center gap-1.5 font-medium">
                        <span className="size-2 rounded-full" style={{ background: agentColor(a.agentId) }} />
                        {a.agentLabel} <span className="font-mono text-[11px] text-muted-foreground">{Math.round(a.tokensPerCp)} tok/cp</span>
                        {a.tips?.[0] ? <span className="hidden text-[11px] text-muted-foreground lg:inline">· {a.tips[0]}</span> : null}
                      </span>
                      <Badge variant={a.tier === 'heavy' ? 'destructive' : a.tier === 'moderate' ? 'secondary' : 'outline'} className="px-1.5 py-0 text-[10px]">
                        {a.tier}
                      </Badge>
                    </div>
                  ))}
                </div>
                {data.coach.byAgent.some((a: any) => a.tips.length > 0) ? (
                  <div className="text-[11px] text-muted-foreground">
                    Tips: {data.coach.byAgent.flatMap((a: any) => a.tips).slice(0, 2).join(' · ') || '—'}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
        </div>
      ) : null}

      {data?.repoJoin && data.repoJoin.length > 0 ? (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-sm font-semibold">
              Ship conversion — checkpoints → merged PRs · {data.repoJoin.length} repos · bubble = checkpoints · color = dominant agent ·
              diagonal 1 PR per 8 CP guide
            </CardTitle>
            <p className="text-xs text-muted-foreground">Click bubble to filter repo table · median quadrants · empty quadrant CTA below</p>
          </CardHeader>
          <CardContent>
            <ChartContainer
              config={activeAgents.reduce((acc: any, id: string) => {
                acc[id] = { label: agentLabel(id), color: agentColor(id) }
                return acc
              }, {} as any)}
              className="h-[360px] w-full"
            >
              <ScatterChart margin={{ left: 12, right: 24, top: 8, bottom: 24 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  type="number"
                  dataKey="checkpoints"
                  name="Checkpoints"
                  tickFormatter={compact}
                  label={{ value: 'Checkpoints', position: 'insideBottom', offset: -10 }}
                  domain={['auto', 'auto']}
                />
                <YAxis type="number" dataKey="mergedCount" name="PRs" allowDecimals={false} label={{ value: 'Merged PRs', angle: -90, position: 'insideLeft' }} />
                <ZAxis type="number" dataKey="bubbleSize" range={[60, 420]} />
                <ChartTooltip content={<ScatterTip />} />
                {scatterMeta ? (
                  <>
                    <ReferenceLine x={scatterMeta.medianCp} stroke="var(--border)" strokeDasharray="4 4" />
                    <ReferenceLine y={scatterMeta.medianPr} stroke="var(--border)" strokeDasharray="4 4" />
                    <ReferenceLine
                      segment={[
                        { x: 0, y: 0 },
                        { x: scatterMeta.diagonalEnd.x, y: scatterMeta.diagonalEnd.y },
                      ]}
                      stroke="var(--chart-5)"
                      strokeDasharray="2 6"
                      ifOverflow="extendDomain"
                      label={{ value: '1 PR / 8 CP', position: 'insideTopRight', fill: 'var(--muted-foreground)', fontSize: 10 }}
                    />
                  </>
                ) : null}
                <Scatter
                  data={(data.repoJoin as any[]).map((d: any) => ({ ...d, fill: agentColor(d.dominantAgent) }))}
                  fill="var(--chart-1)"
                  onClick={(payload: any) => {
                    const short = payload?.payload?.short ?? payload?.short
                    if (!short) return
                    const next = new URLSearchParams(searchParams)
                    if (repoFilter === short) next.delete('repo')
                    else next.set('repo', short)
                    setSearchParams(next, { replace: true })
                  }}
                />
              </ScatterChart>
            </ChartContainer>
            {scatterMeta?.emptyQuadrant ? (
              <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                <span className="font-semibold">Empty quadrant ({scatterMeta.emptyQuadrant}):</span> {scatterMeta.cta}{' '}
                {repoFilter ? (
                  <Button variant="ghost" size="sm" className="ml-2 h-6 px-2 text-xs" onClick={() => { const n = new URLSearchParams(searchParams); n.delete('repo'); setSearchParams(n, {replace:true}) }}>
                    Clear repo filter
                  </Button>
                ) : (
                  <span className="text-muted-foreground">· Add checkpoints/PRs to populate all quadrants.</span>
                )}
              </div>
            ) : null}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(data.repoJoin as any[]).slice(0, 6).map((pt: any) => (
                <button
                  key={pt.repo}
                  onClick={() => {
                    const next = new URLSearchParams(searchParams)
                    if (repoFilter === pt.short) next.delete('repo')
                    else next.set('repo', pt.short)
                    setSearchParams(next, { replace: true })
                  }}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] hover:bg-muted',
                    repoFilter === pt.short && 'bg-muted border-foreground/20',
                  )}
                >
                  <span className="size-2 rounded-full" style={{ background: agentColor(pt.dominantAgent) }} />
                  {pt.short} {pt.checkpoints}cps · {pt.mergedCount}PRs · {pt.cpPerPR.toFixed(1)} cp/PR
                </button>
              ))}
            </div>
            <p className="mt-1 text-center text-[11px] text-muted-foreground">All-time cps vs window PRs · efficient upper-left (few cps many PRs) · busy lower-right · diagonal = 1 PR per 8 checkpoints guide</p>
          </CardContent>
        </Card>
      ) : data?.repoJoin && data.repoJoin.length === 0 && (from || to) ? (
        <Card className="mt-6 border-dashed">
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No repos in selected window — try broadening the brush or <button className="underline" onClick={clearBrush}>clear filter</button> to see all-time conversion.
          </CardContent>
        </Card>
      ) : null}

      {stats ? (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard label="Avg tokens / checkpoint" value={compact(Math.round(stats.throughput * 1000))} />
          <StatCard label="Current streak" value={`${stats.current_streak}d`} />
          <StatCard label="Lifetime streak" value={`${stats.lifetime_streak}d`} />
          <StatCard label="Tasks" value={comma(stats.tasks)} />
          <StatCard label="Orchestration" value={comma(stats.orchestration)} />
          <StatCard label="Iteration" value={`${stats.iteration.toFixed(1)}×`} />
          <StatCard label="Continuity" value={`${stats.continuity_hours}h`} />
          <StatCard label="Checkpoints" value={comma(totalCheckpoints)} />
          <StatCard label="Sessions" value={comma(recap?.summary.me.sessions ?? 0)} />
          <StatCard label="Active days" value={comma(recap?.summary.activeDays ?? 0)} />
          <StatCard label="Repos" value={comma(recap?.summary.repoCount ?? 0)} />
          <StatCard label="Tokens (6 mo)" value={compact(recap?.summary.me.tokens ?? 0)} />
        </div>
      ) : null}

      {/* Unified timeline single Area/Bar Total vs By agent with brush */}
      {allTimelineRows.length > 0 ? (
        <Card className="mt-6">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <Activity className="size-4 text-muted-foreground" />
              Timeline — checkpoints per day
              <span className="text-xs font-normal text-muted-foreground">
                {timelineMode === 'total' ? 'Total' : 'By agent'} · brush to filter · syncId entireTimeline
              </span>
            </CardTitle>
            <div className="flex items-center gap-1 rounded-md border bg-muted p-1">
              <Button variant={timelineMode === 'total' ? 'secondary' : 'ghost'} size="sm" className="h-7 px-3 text-xs" onClick={() => setTimelineMode('total')}>
                Total
              </Button>
              <Button variant={timelineMode === 'byAgent' ? 'secondary' : 'ghost'} size="sm" className="h-7 px-3 text-xs" onClick={() => setTimelineMode('byAgent')}>
                By agent
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[280px] w-full">
              {timelineMode === 'total' ? (
                <AreaChart data={displayRows} syncId="entireTimeline" margin={{ left: 0, right: 8, top: 4, bottom: 24 }}>
                  <defs>
                    <linearGradient id="fillTotal" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
                  <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} minTickGap={24} />
                  <YAxis tickLine={false} axisLine={false} width={28} fontSize={11} allowDecimals={false} />
                  <ChartTooltip content={<CountTip />} />
                  <Area dataKey="total" name="Checkpoints" type="monotone" stroke="var(--chart-1)" fill="url(#fillTotal)" strokeWidth={1.5} />
                  <Brush dataKey="date" height={24} stroke="var(--chart-1)" travellerWidth={10} onChange={handleBrushChange} />
                </AreaChart>
              ) : (
                <BarChart data={displayRows} syncId="entireTimeline" margin={{ left: 0, right: 8, top: 4, bottom: 24 }}>
                  <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
                  <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} minTickGap={24} />
                  <YAxis tickLine={false} axisLine={false} width={28} fontSize={11} allowDecimals={false} />
                  <ChartTooltip content={<StackedAgentTip hidden={hiddenAgents} />} />
                  <ChartLegend content={<ToggleLegend hiddenSeries={hiddenAgents} onToggleSeries={toggleAgent} />} className="mt-2" />
                  {activeAgents.map((id) => (
                    <Bar key={id} dataKey={id} stackId="cp" fill={agentColor(id)} hide={Boolean(hiddenAgents[id])} />
                  ))}
                  <Brush dataKey="date" height={24} stroke="var(--chart-1)" travellerWidth={10} onChange={handleBrushChange} />
                </BarChart>
              )}
            </ChartContainer>
            {(from || to) && (
              <div className="mt-2 flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2 text-xs">
                <span className="text-muted-foreground">
                  Filtering {from || '—'} → {to || '—'} · {displayRows.length} days · {displayRows.reduce((s, r: any) => s + (r.total ?? 0), 0)} checkpoints in window
                </span>
                <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={clearBrush}>
                  Clear
                </Button>
              </div>
            )}
            <p className="mt-1 text-center text-[11px] text-muted-foreground">Single timeline Area/Bar Total vs By agent · brush controls ship conversion, repo table, and hourly view · syncId entireTimeline</p>
          </CardContent>
        </Card>
      ) : null}

      {/* Hourly remains but filtered by brush window */}
      {hourlyRows.length > 0 ? (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <Zap className="size-4 text-muted-foreground" />
              Checkpoints by hour of day {from || to ? <span className="text-xs font-normal text-muted-foreground">(brushed window)</span> : null}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="aspect-auto h-56">
              <BarChart data={hourlyRows} syncId="entireTimeline" margin={{ left: 0, right: 8, top: 4 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis dataKey="hour" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} interval={2} />
                <YAxis tickLine={false} axisLine={false} width={28} fontSize={11} allowDecimals={false} />
                <ChartTooltip content={<StackedAgentTip hidden={hiddenAgents} />} />
                <ChartLegend content={<ToggleLegend hiddenSeries={hiddenAgents} onToggleSeries={toggleAgent} />} />
                {activeAgents.map((id) => (
                  <Bar key={id} dataKey={id} stackId="hr" fill={agentColor(id)} hide={Boolean(hiddenAgents[id])} />
                ))}
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      ) : null}

      {recapDailyRows.length > 0 && timelineMode === 'total' ? (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-sm font-semibold">Checkpoint activity — last 6 months ({recap?.timeframe ?? ''}) {from || to ? <span className="text-xs font-normal text-muted-foreground">(full history, brush above filters hourly/repo)</span> : null}</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={{ count: { label: 'Checkpoints', color: 'var(--chart-1)' } }} className="aspect-auto h-48">
              <AreaChart data={recapDailyRows} syncId="entireTimeline" margin={{ left: 0, right: 8, top: 4 }}>
                <defs>
                  <linearGradient id="fillCount2" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} interval={10} />
                <YAxis tickLine={false} axisLine={false} width={28} fontSize={11} allowDecimals={false} />
                <ChartTooltip content={<CountTip />} />
                <Area dataKey="count" name="Checkpoints" type="monotone" stroke="var(--chart-1)" fill="url(#fillCount2)" strokeWidth={1.5} />
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>
      ) : null}

      {sortedRepoRows.length > 0 ? (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <Flame className="size-4 text-muted-foreground" />
              Checkpoints by repository {repoFilter ? <Badge variant="outline">{repoFilter}</Badge> : null} · CP/PR sortable
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Repository</TableHead>
                  <TableHead className="text-right">
                    <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => toggleRepoSort('checkpoints')}>
                      Checkpoints <ArrowUpDown className="size-3" />
                    </button>
                  </TableHead>
                  <TableHead className="text-right">Share</TableHead>
                  <TableHead>Agents</TableHead>
                  <TableHead className="text-right">
                    <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => toggleRepoSort('mergedCount')}>
                      Merged PRs <ArrowUpDown className="size-3" />
                    </button>
                  </TableHead>
                  <TableHead className="text-right">
                    <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => toggleRepoSort('cpPerPR')}>
                      CP/PR <ArrowUpDown className="size-3" />
                    </button>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedRepoRows.map((rep: any) => {
                  const short = rep.short
                  const total = sortedRepoRows.reduce((s: number, r: any) => s + r.checkpoints, 0)
                  const share = total > 0 ? ((rep.checkpoints / total) * 100).toFixed(0) : '0'
                  const topAgents = Object.entries(rep.agents ?? {})
                    .filter(([, n]: any) => n > 0)
                    .sort((a: any, b: any) => b[1] - a[1])
                    .slice(0, 4) as any[]
                  const isFiltered = repoFilter === short
                  return (
                    <TableRow
                      key={rep.repo}
                      className={cn(isFiltered && 'bg-muted/40')}
                      onClick={() => {
                        const next = new URLSearchParams(searchParams)
                        if (isFiltered) next.delete('repo')
                        else next.set('repo', short)
                        setSearchParams(next, { replace: true })
                      }}
                    >
                      <TableCell className="font-medium">{short}</TableCell>
                      <TableCell className="text-right tabular-nums">{comma(rep.checkpoints)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{share}%</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {topAgents.length === 0 ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            topAgents.map(([id, n]: any) => (
                              <Badge key={id} variant="secondary" className="gap-1">
                                <span className="size-1.5 rounded-full" style={{ backgroundColor: agentColor(id) }} />
                                {agentLabel(id)} {comma(Number(n))}
                              </Badge>
                            ))
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{comma(rep.mergedCount)}</TableCell>
                      <TableCell className="text-right tabular-nums font-mono">{rep.cpPerPR.toFixed(1)}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            {repoFilter ? (
              <div className="border-t px-3 py-2 text-xs text-muted-foreground">
                Filtering by repo {repoFilter} · <button className="underline" onClick={() => { const n = new URLSearchParams(searchParams); n.delete('repo'); setSearchParams(n,{replace:true})}}>Clear</button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {agents.length > 0 ? (
        <>
          <Card className="mt-6">
            <CardHeader>
              <CardTitle className="text-sm font-semibold">Agent comparison</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Agent</TableHead>
                    <TableHead className="text-right">Sessions</TableHead>
                    <TableHead className="text-right">Checkpoints</TableHead>
                    <TableHead className="text-right">Tokens</TableHead>
                    <TableHead className="text-right">Transcript</TableHead>
                    <TableHead className="text-right">Files</TableHead>
                    <TableHead className="text-right">Tool calls</TableHead>
                    <TableHead>Top skill</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {agents.map((a) => {
                    const topSkill = a.me.skills.slice().sort((x, y) => y.count - x.count)[0]
                    return (
                      <TableRow key={a.agentId}>
                        <TableCell>
                          <span className="flex items-center gap-2 font-medium">
                            <span className="size-2.5 rounded-full" style={{ backgroundColor: agentColor(a.agentId) }} />
                            {a.agentLabel}
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{comma(a.me.sessions)}</TableCell>
                        <TableCell className="text-right tabular-nums">{comma(a.me.checkpoints)}</TableCell>
                        <TableCell className="text-right tabular-nums">{compact(a.me.tokens)}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">{compact(a.me.transcriptTokens)}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">{comma(a.me.filesChanged)}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">{comma(agentMixTotal(a))}</TableCell>
                        <TableCell className="max-w-56 truncate text-muted-foreground">{topSkill ? `${topSkill.skill} ×${topSkill.count}` : '—'}</TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold">Tool mix (all agents)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {(() => {
                  const total = Object.values(toolMixTotals).reduce((a, b) => a + b, 0)
                  const rows = [
                    { key: 'shell', label: 'Shell', value: toolMixTotals.shell, color: '#3b82f6' },
                    { key: 'fileOps', label: 'File ops', value: toolMixTotals.fileOps, color: '#10b981' },
                    { key: 'mcp', label: 'MCP calls', value: toolMixTotals.mcp, color: '#8b5cf6' },
                    { key: 'agent', label: 'Sub-agents', value: toolMixTotals.agent, color: '#f97316' },
                    { key: 'search', label: 'Search', value: toolMixTotals.search, color: '#06b6d4' },
                    { key: 'other', label: 'Other', value: toolMixTotals.other, color: '#9ca3af' },
                  ].filter((r) => r.value > 0)
                  if (total === 0) return <p className="text-xs text-muted-foreground">No tool data.</p>
                  return (
                    <>
                      <div className="flex h-3 w-full gap-px overflow-hidden rounded-full bg-muted">
                        {rows.map((r) => (
                          <div key={r.key} className="h-full" style={{ width: `${(r.value / total) * 100}%`, backgroundColor: r.color }} title={`${r.label}: ${comma(r.value)}`} />
                        ))}
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                        {rows.map((r) => (
                          <span key={r.key} className="flex items-center gap-1.5 text-muted-foreground">
                            <span className="size-2 rounded-full" style={{ backgroundColor: r.color }} />
                            {r.label} <span className="font-mono font-medium text-foreground tabular-nums">{comma(r.value)}</span>
                          </span>
                        ))}
                      </div>
                    </>
                  )
                })()}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold">MCP servers</CardTitle>
              </CardHeader>
              <CardContent>
                {mcpTotals.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No MCP activity.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {mcpTotals.slice(0, 12).map(([name, count]) => (
                      <Badge key={name} variant="outline" className="font-mono">
                        {name} {comma(count)}
                      </Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="mt-6">
            <h2 className="mb-3 text-base font-semibold">Agent recap — {recap?.timeframe ?? ''}</h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {agents.map((agent) => {
                const mix = agent.me.toolMix
                const mixRows = mix
                  ? [
                      { key: 'shell', label: 'Shell', value: mix.shell },
                      { key: 'fileOps', label: 'File ops', value: mix.fileOps },
                      { key: 'mcp', label: 'MCP', value: mix.mcp },
                      { key: 'agent', label: 'Agents', value: mix.agent },
                      { key: 'other', label: 'Other', value: mix.other },
                    ]
                  : []
                const mixTotal = mixRows.reduce((s, r) => s + r.value, 0)
                const coachTip = data?.coach?.byAgent.find((c: any) => c.agentId === agent.agentId)
                return (
                  <Card key={agent.agentId}>
                    <CardHeader>
                      <CardTitle className="flex items-center justify-between text-sm font-semibold">
                        <span className="flex items-center gap-2">
                          <span className="size-2.5 rounded-full" style={{ backgroundColor: agentColor(agent.agentId) }} />
                          {agent.agentLabel}
                        </span>
                        <Badge variant="secondary" className="font-mono">
                          {compact(agent.me.tokens)} tokens
                        </Badge>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3 text-xs">
                      <div className="grid grid-cols-4 gap-2">
                        <div>
                          <div className="text-base font-semibold tabular-nums">{comma(agent.me.sessions)}</div>
                          <div className="text-muted-foreground">sessions</div>
                        </div>
                        <div>
                          <div className="text-base font-semibold tabular-nums">{comma(agent.me.checkpoints)}</div>
                          <div className="text-muted-foreground">checkpoints</div>
                        </div>
                        <div>
                          <div className="text-base font-semibold tabular-nums">{comma(agent.me.filesChanged)}</div>
                          <div className="text-muted-foreground">files</div>
                        </div>
                        <div>
                          <div className="text-base font-semibold tabular-nums">{comma(agent.me.transcriptTokens)}</div>
                          <div className="text-muted-foreground">transcript</div>
                        </div>
                      </div>
                      {coachTip && coachTip.tier !== 'efficient' ? (
                        <div className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] dark:border-amber-900 dark:bg-amber-950/20">
                          Coach: {coachTip.tier} — {coachTip.tips.slice(0, 2).join(' · ') || coachTip.tier}
                        </div>
                      ) : null}
                      {mixTotal > 0 ? (
                        <div>
                          <div className="mb-1 flex justify-between text-muted-foreground">
                            <span>Tool mix</span>
                            <span>{comma(mixTotal)} calls</span>
                          </div>
                          <div className="flex h-2 w-full gap-px overflow-hidden rounded-full bg-muted">
                            {mixRows
                              .filter((r) => r.value > 0)
                              .map((r) => (
                                <div
                                  key={r.key}
                                  className="h-full"
                                  style={{
                                    width: `${(r.value / mixTotal) * 100}%`,
                                    backgroundColor: agentColor(agent.agentId),
                                    opacity: 0.45 + 0.5 * (r.value / mixTotal),
                                  }}
                                  title={`${r.label}: ${comma(r.value)}`}
                                />
                              ))}
                          </div>
                        </div>
                      ) : null}
                      {agent.me.skills.length > 0 ? (
                        <div>
                          <div className="mb-1 text-muted-foreground">Skills</div>
                          <div className="flex flex-wrap gap-1">
                            {agent.me.skills
                              .slice()
                              .sort((a, b) => b.count - a.count)
                              .slice(0, 8)
                              .map((s) => (
                                <Badge key={s.skill} variant="secondary">
                                  {s.skill} ×{s.count}
                                </Badge>
                              ))}
                          </div>
                        </div>
                      ) : null}
                      {agent.me.mcpServers.length > 0 ? (
                        <div>
                          <div className="mb-1 text-muted-foreground">MCP servers</div>
                          <div className="flex flex-wrap gap-1">
                            {agent.me.mcpServers.slice(0, 6).map((m) => (
                              <Badge key={m.name} variant="outline">
                                {m.name} {comma(m.count)}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          </div>
        </>
      ) : null}

      <p className="mt-6 text-center text-[11px] text-muted-foreground">
        Data comes from your entire.io account (cell API). Team and organisation views appear automatically once this account is part of an Entire org — no code
        changes needed.
      </p>
    </div>
  )
}
