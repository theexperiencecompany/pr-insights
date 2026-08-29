// VISION v-entire — see docs/vision-entire.md
// Planned: scatter checkpoints→PRs bubble, unified timeline brush (syncId+Brush+?from=&to=), streak guard, token coach.
// This header is vision-pointer only; implementation lands in next phases (entire.go -> api.go -> api.ts -> entire.tsx).
import { useMemo, useState } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { Activity, Flame, RefreshCw, Zap } from 'lucide-react'

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
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
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

// Canonical agent ids reported by the entire.io cell API, in display order.
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

function agentMixTotal(agent: EntireAgent): number {
  const mix = agent.me.toolMix
  if (!mix) return 0
  return mix.shell + mix.fileOps + mix.search + mix.mcp + mix.agent + mix.other
}

export default function EntirePage() {
  const { data, loading, refetch } = useApi(getEntire)
  const repos = useApi(getRepos)
  const [syncing, setSyncing] = useState(false)

  const activity = data?.activity ?? null
  const recap = data?.recap ?? null

  // Agents that actually contributed anything (for charts + legend).
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
    return cfg
  }, [activeAgents])

  const dailyRows = useMemo(
    () =>
      (activity?.daily_contributions ?? []).map((day) => {
        const row: Record<string, string | number> = { date: shortDate(day.date) }
        for (const id of activeAgents) row[id] = day.agents[id] ?? 0
        return row
      }),
    [activity, activeAgents],
  )

  const hourlyRows = useMemo(() => {
    const byHour = new Map<number, Record<string, number>>()
    for (const h of activity?.hourly_contributions ?? []) {
      if (h.value <= 0) continue
      const row = byHour.get(h.hour) ?? {}
      row[h.agent] = (row[h.agent] ?? 0) + h.value
      byHour.set(h.hour, row)
    }
    const rows: Record<string, string | number>[] = []
    for (let h = 0; h < 24; h++) {
      const row: Record<string, string | number> = { hour: `${h}h` }
      for (const id of activeAgents) row[id] = byHour.get(h)?.[id] ?? 0
      rows.push(row)
    }
    return rows
  }, [activity, activeAgents])

  const recapDailyRows = useMemo(
    () => (recap?.daily ?? []).map((d) => ({ date: shortDate(d.date), count: d.count })),
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

  // Aggregated tool mix + MCP servers across all agents.
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

  if (loading && !data) return <Loading />

  if (!data || (!data.activity && !data.lastError)) {
    return (
      <div className="mx-auto max-w-4xl">
        <PageHeader title="Entire" description="Agent checkpoint analytics from entire.io" />
        <EmptyState text="No Entire data yet.">
          <p className="mx-auto mt-2 max-w-xl text-xs leading-relaxed">
            Install the entire CLI on the host, log in once (<code className="font-mono">entire login --device</code>)
            and either set <code className="font-mono">ENTIRE_HOME</code> or create the{' '}
            <code className="font-mono">entire-home</code> dir inside the data dir. The backend shells out to{' '}
            <code className="font-mono">entire api --to cell /api/v1/me/activity</code> and{' '}
            <code className="font-mono">/api/v1/me/recap</code> every{' '}
            <code className="font-mono">ENTIRE_SYNC_INTERVAL</code> (default 15m) and caches the JSON.
          </p>
        </EmptyState>
      </div>
    )
  }

  const lastError = data?.lastError ?? ''

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Entire"
        description="Agent checkpoint analytics from entire.io — every tracked agent (Claude Code, pi, Codex, …)"
      >
        {data.user ? (
          <span className="flex items-center gap-2 rounded-full border border-border bg-background py-1 pl-1 pr-3 text-xs">
            <img src={data.user.avatarUrl} alt="" className="size-5 rounded-full" loading="lazy" />
            <span className="font-medium">{data.user.displayName || data.user.handle}</span>
            <span className="text-muted-foreground">@{data.user.handle}</span>
          </span>
        ) : null}
        {data?.fetchedAt ? (
          <span className="text-xs text-muted-foreground">Synced {timeAgo(data.fetchedAt)}</span>
        ) : null}
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

      {stats ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
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

      {activity && dailyRows.length > 0 ? (
        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <Activity className="size-4 text-muted-foreground" />
                Checkpoints per day, by agent
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ChartContainer config={chartConfig} className="aspect-auto h-56">
                <BarChart data={dailyRows} margin={{ left: 0, right: 8, top: 4 }}>
                  <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
                  <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} />
                  <YAxis tickLine={false} axisLine={false} width={28} fontSize={11} allowDecimals={false} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <ChartLegend className="mt-2" />
                  {activeAgents.map((id) => (
                    <Bar key={id} dataKey={id} stackId="cp" fill={agentColor(id)} />
                  ))}
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <Zap className="size-4 text-muted-foreground" />
                Checkpoints by hour of day
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ChartContainer config={chartConfig} className="aspect-auto h-56">
                <BarChart data={hourlyRows} margin={{ left: 0, right: 8, top: 4 }}>
                  <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
                  <XAxis dataKey="hour" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} interval={2} />
                  <YAxis tickLine={false} axisLine={false} width={28} fontSize={11} allowDecimals={false} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  {activeAgents.map((id) => (
                    <Bar key={id} dataKey={id} stackId="hr" fill={agentColor(id)} />
                  ))}
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {recapDailyRows.length > 0 ? (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-sm font-semibold">
              Checkpoint activity — last 6 months ({recap?.timeframe ?? ''})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={{ count: { label: 'Checkpoints', color: 'var(--chart-1)' } }} className="aspect-auto h-48">
              <AreaChart data={recapDailyRows} margin={{ left: 0, right: 8, top: 4 }}>
                <defs>
                  <linearGradient id="fillCount" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} interval={10} />
                <YAxis tickLine={false} axisLine={false} width={28} fontSize={11} allowDecimals={false} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Area dataKey="count" type="monotone" stroke="var(--chart-1)" fill="url(#fillCount)" strokeWidth={1.5} />
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>
      ) : null}

      {activity && activity.repos.length > 0 ? (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <Flame className="size-4 text-muted-foreground" />
              Checkpoints by repository
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Repository</TableHead>
                  <TableHead className="text-right">Checkpoints</TableHead>
                  <TableHead className="text-right">Share</TableHead>
                  <TableHead>Agents</TableHead>
                  <TableHead className="text-right">Merged PRs</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activity.repos.map((rep) => {
                  const short = rep.repo.split('/').pop() ?? rep.repo
                  const merged = repos.data?.find((r) => r.name === short)?.merged ?? 0
                  const topAgents = Object.entries(rep.agents)
                    .filter(([, n]) => n > 0)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 4)
                  const total = activity.repos.reduce((s, r) => s + r.total, 0)
                  const share = total > 0 ? ((rep.total / total) * 100).toFixed(0) : '0'
                  return (
                    <TableRow key={rep.repo}>
                      <TableCell className="font-medium">{short}</TableCell>
                      <TableCell className="text-right tabular-nums">{comma(rep.total)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{share}%</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {topAgents.length === 0 ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            topAgents.map(([id, n]) => (
                              <Badge key={id} variant="secondary" className="gap-1">
                                <span className="size-1.5 rounded-full" style={{ backgroundColor: agentColor(id) }} />
                                {agentLabel(id)} {comma(n)}
                              </Badge>
                            ))
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {merged > 0 || repos.data ? comma(merged) : '—'}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
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
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {compact(a.me.transcriptTokens)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {comma(a.me.filesChanged)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {comma(agentMixTotal(a))}
                        </TableCell>
                        <TableCell className="max-w-56 truncate text-muted-foreground">
                          {topSkill ? `${topSkill.skill} ×${topSkill.count}` : '—'}
                        </TableCell>
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
                          <div
                            key={r.key}
                            className="h-full"
                            style={{ width: `${(r.value / total) * 100}%`, backgroundColor: r.color }}
                            title={`${r.label}: ${comma(r.value)}`}
                          />
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
        Data comes from your entire.io account (cell API). Team and organisation views appear automatically once this
        account is part of an Entire org — no code changes needed.
      </p>
    </div>
  )
}
