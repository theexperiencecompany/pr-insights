export interface RepoInfo {
  name: string
  private: boolean
  archived: boolean
  description: string
  defaultBranch: string
}

export interface Pull {
  number: number
  title: string
  state: 'OPEN' | 'MERGED' | 'CLOSED'
  isDraft: boolean
  repo: string
  author: string
  isBot: boolean
  createdAt: string
  updatedAt: string
  mergedAt: string | null
  closedAt: string | null
  additions: number
  deletions: number
  changedFiles: number
  commits: number
  baseRef: string
  headRef: string
  url: string
}

export interface Pager {
  total: number
  page: number
  pages: number
  perPage: number
  from: number
  to: number
  hasPrev: boolean
  hasNext: boolean
}

export interface RankedPull {
  value: number
  pull: Pull
}

export interface Contributor {
  login: string
  merged: number
  additions: number
  deletions: number
  files: number
  commits: number
  avgDiff: number
  reposCount: number
  first: string | null
  last: string | null
  largest: Pull | null
  currentStreak: number
  longestStreak: number
  isBot: boolean
}

export interface RepoStat extends RepoInfo {
  total: number
  merged: number
  open: number
  closed: number
  additions: number
  deletions: number
  avgDiff: number
  contributors: number
  first: string | null
  last: string | null
  largest: Pull | null
}

export interface ShipBucket {
  key: string
  label: string
  merged: number
  additions: number
  deletions: number
  cycleMedianDays: number
  cycleCount: number
}

export interface CIBucket {
  key: string
  label: string
  total: number
  success: number
  failure: number
  other: number
  successRate: number
  medianDurationMin: number
  totalMinutes: number
}

export interface WorkflowStat {
  repo: string
  workflow: string
  runs: number
  success: number
  successRate: number
  medianDurationMin: number
  longestDurationMin: number
  trend: number[]
  lastRunAt: string | null
  lastConclusion: string
}

export interface WorkflowRun {
  id: number
  repo: string
  workflow: string
  branch: string
  event: string
  conclusion: string
  status: string
  createdAt: string
  updatedAt: string
  runStartedAt: string
  durationSec: number
  runnerGroup?: RunnerGroup
}

export const getWorkflowRuns = (params: { workflow: string; repo?: string; limit?: number }): Promise<WorkflowRun[]> =>
  fetch(`/api/workflow-runs${qs(params)}`).then(json<WorkflowRun[]>)

export interface Status {
  org: string
  repo: string
  syncing: boolean
  syncedAt: string
  lastError: string
  repoErrors: number
  pulls: number
  runs: number
  repos: number
  rateLimit: { remaining: number; limit: number } | null
}

// Vision Hero types (docs/vision-hero.md)
export interface HeroCycle { p50: number; p90: number; p75?: number; mean?: number; count: number; windowDays: number }
export interface HeroCI { success: number; failure: number; total: number; rate: number; windowDays: number }
export interface HeroThroughput { merged: number; perWeek: number; perDay: number; windowDays: number; prevMerged: number; deltaPct: number }
export interface Hero { cycle: HeroCycle; ci: HeroCI; throughput: HeroThroughput; bus: { top3Share: number; top: Contributor[] }; windowNote?: string }

export interface OverviewData {
  org: string
  avatarUrl: string
  syncedAt: string | null
  lastError: string
  repoErrorCount: number
  gran: string
  stats: {
    total: number
    merged: number
    open: number
    closed: number
    additions: number
    deletions: number
    files: number
    commits: number
    avgDiff: number
    avgFiles: number
  }
  contributors: number
  monthly: ShipBucket[]
  topContributors: Contributor[]
  largest: RankedPull[]
  velocity: {
    label: string
    current: number
    previous: number
    deltaPct: number
    currentFrom?: string
    currentTo?: string
    previousFrom?: string
    previousTo?: string
    currentRange?: string
    previousRange?: string
  }[]
  bot: { botMerged: number; humanMerged: number; botPct: number; bots: string[] }
  shipDist: { zone: string; weekday: number[]; weekdayLabels: string[]; hour: number[] }
  bus: { top3Share: number; top: Contributor[] }
  heatmap: { date: string; merged: number }[]
  semantic: {
    byType: { type: string; count: number; percent: number }[]
    timeline: { key: string; label: string; total: number; counts: Record<string, number> }[]
  }
  hero: Hero
}

export interface LeaderboardData {
  metric: string
  state: string
  order: string
  rows: RankedPull[]
  pager: Pager
  repoOptions: RepoInfo[]
}

export interface ContributorsData {
  rows: Contributor[]
  pager?: Pager
  repoOptions?: RepoInfo[]
}

export interface ContributorDetail {
  login: string
  isBot: boolean
  contributor: Contributor
  merged: Pull[]
  monthly: ShipBucket[]
  heatmap: { date: string; merged: number }[]
}

export interface ShameData {
  longestOpen: { pull: Pull; value: number }[]
  longestToMerge: { pull: Pull; value: number }[]
  biggestClosed: { pull: Pull; value: number }[]
}

export interface PullsData {
  rows: Pull[]
  pager: Pager
  repoOptions: RepoInfo[]
}

export interface TShirtSegment { size: string; label: string; count: number; pct: number; color: string; avgDays: number; human: string }
export interface LeadTimeBucket { key: string; label: string; count: number; p50: number; p75: number; p90: number; mean: number; min: number; max: number }
export interface WIPPoint { date: string; wip: number }
export interface LittleLaw { windowDays: number; avgWip: number; throughputPerDay: number; cycleMeanDays: number; predictedWip: number; errorPct: number; currentWip: number; points: WIPPoint[] }
export interface DonutSegment { label: string; count: number; pct: number; color: string }
export interface Abandonment { total: number; merged: number; closed: number; open: number; abandonedRate: number; segments: DonutSegment[]; bySize?: Record<string, number> }
export interface FlakyStat {
  repo: string; workflow: string;
  runs: number; success: number; failure: number; flaky: number;
  flakeScore: number; failureRate: number; successRate: number;
  p50Min: number; p95Min: number;
  mttrMedianMin: number; mttrMeanMin: number; mttrCount: number;
  wastedMinutes: number; wastedPct: number;
  trend?: number[]; lastRunAt: string | null; lastConclusion: string;
}
export interface CostPerMerge { totalMinutes: number; merged: number; perMergeMin: number; perMerge: string }
export type RunnerGroup = 'home' | 'github' | 'unknown'
export interface RunnerSplit {
  homeRuns: number; githubRuns: number; unknownRuns: number; totalRuns: number
  homeMinutes: number; githubMinutes: number; unknownMinutes: number; totalMinutes: number
  homePctRuns: number; homePctMinutes: number; githubPctRuns: number; githubPctMinutes: number; unknownPctRuns: number; unknownPctMinutes: number
}
export interface WorkflowHybrid {
  repo: string; workflow: string; key: string
  runs: number
  success: number; failure: number; other: number
  successRate: number; failureRate: number
  p50Min: number; p90Min: number; p99Min: number; avgMin: number
  minMin?: number; maxMin?: number
  thresholdP50: number; thresholdP90: number
  isSlow: boolean; isSampleSmall: boolean
  hosting: RunnerGroup
  homeRuns: number; githubRuns: number; unknownRuns: number
  budgetSharePct: number
  queueMedianMin: number
  flakeScore: number; flaky: number
  deltaMin: number
  lastRunAt: string | null
  lastConclusion: string
}
export interface ReleaseStats { p50: number; p90: number; avg?: number; count: number; windowDays: number }
export interface CIRunnerBucket {
  key: string; label: string
  home: number; github: number; unknown: number; total: number
  homePct: number; githubPct: number; unknownPct: number
  homeMinutes: number; githubMinutes: number; unknownMinutes: number; totalMinutes: number
}
export interface HybridData {
  period: string; gran: string; repo: string
  split: RunnerSplit
  workflows: WorkflowHybrid[]
  release: ReleaseStats
  thresholds: { p50: number; p90: number }
  repoOptions: RepoInfo[]
  trend: CIRunnerBucket[]
  overallP50: number; overallP90: number; overallAvg: number
  totalRuns: number; totalMinutes: number
  homeP50: number; githubP50: number; deltaHomeVsGithub: number
}

export interface InsightsData {
  ship: ShipBucket[]
  shipPrev?: ShipBucket[] // present when period=12m — same window one year earlier
  ci: CIBucket[]
  workflows: WorkflowStat[]
  ciStats: {
    totalRuns: number
    successRate: number
    medianDuration: number
    workflows: number
  }
  repoOptions: RepoInfo[]
  // Vision DORA-lite (docs/vision-dora-lite.md)
  tshirt: TShirtSegment[]
  leadTime: LeadTimeBucket[]
  leadOverall: LeadTimeBucket
  wip: LittleLaw
  abandon: Abandonment
  // Vision Flaky (docs/vision-flaky.md)
  flakyWorkflows: FlakyStat[]
  costPerMerge: CostPerMerge
  needsAttention: FlakyStat[]
  // Vision Hybrid (docs/vision-hybrid.md)
  hybrid: HybridData
}

const json = async <T>(res: Response): Promise<T> => {
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return (await res.json()) as T
}

const qs = (params: Record<string, string | number | undefined>): string => {
  const u = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '' && v !== null) u.set(k, String(v))
  }
  const s = u.toString()
  return s ? `?${s}` : ''
}

export const getStatus = (): Promise<Status> => fetch('/api/status', { cache: 'no-store' }).then(json<Status>)
export const getOverview = (params: { largest?: number; gran?: string } = {}): Promise<OverviewData> =>
  fetch(`/api/overview${qs(params)}`).then(json<OverviewData>)
export const getContributors = (params: { repo?: string; q?: string; page?: number; from?: string; to?: string } = {}): Promise<ContributorsData> => fetch(`/api/contributors${qs(params)}`).then(json<ContributorsData>)
export const getContributor = (login: string, params: { gran?: string } = {}): Promise<ContributorDetail> =>
  fetch(`/api/contributor${qs({ login, gran: params.gran })}`).then(json<ContributorDetail>)
export const getShame = (): Promise<ShameData> => fetch('/api/shame').then(json<ShameData>)

export const getLeaderboards = (params: {
  metric?: string
  state?: string
  page?: number
  order?: string
  repo?: string
  author?: string
  from?: string
  to?: string
} = {}): Promise<LeaderboardData> => fetch(`/api/leaderboards${qs(params)}`).then(json<LeaderboardData>)

export const getPulls = (params: {
  repo?: string
  state?: string
  q?: string
  page?: number
  sort?: string
  order?: string
  bot?: string
} = {}): Promise<PullsData> => fetch(`/api/pulls${qs(params)}`).then(json<PullsData>)

export const getInsights = (params: {
  repo?: string
  period?: string
  gran?: string
} = {}): Promise<InsightsData> => fetch(`/api/insights${qs(params)}`).then(json<InsightsData>)

export const getHybrid = (params: {
  repo?: string
  period?: string
  gran?: string
} = {}): Promise<HybridData> => fetch(`/api/hybrid${qs(params)}`).then(json<HybridData>)

export const getCI = getHybrid

export const getRepos = (): Promise<RepoStat[]> => fetch('/api/repos', { cache: 'no-store' }).then(json<RepoStat[]>)

// ---- Entire (agent checkpoint analytics) ----

export interface EntireSkill {
  skill: string
  count: number
}

export interface EntireAgent {
  agentId: string
  agentLabel: string
  me: {
    sessions: number
    checkpoints: number
    tokens: number
    transcriptTokens: number
    filesChanged: number
    labels: string[]
    skills: EntireSkill[]
    mcpServers: { name: string; count: number }[]
    toolMix: {
      shell: number
      fileOps: number
      search: number
      mcp: number
      agent: number
      other: number
    } | null
  }
}

export interface RepoJoinPoint {
  repo: string; short: string;
  checkpoints: number; mergedCount: number;
  tokens: number; dominantAgent: string;
  agents: Record<string, number>;
  addedLines: number; bubbleSize: number; cpPerPR: number;
}
export interface StreakGuard {
  currentStreak: number; lifetimeStreak: number; lifetimeCurrent: number;
  streak: number;
  lastActiveDate: string; daysSinceActive: number;
  hoursLeftUtc: number; state: 'safe'|'at_risk'|'broken'|'unknown';
  reason: string; needToday: boolean; throughputHint: string;
}
export interface TokenCoachAgent {
  agentId: string; agentLabel: string;
  tokensPerCp: number; tokensPerFile: number; tokensPerSession: number;
  transcriptRatio: number; shellPct: number; mcpPct: number;
  tier: 'efficient'|'moderate'|'heavy'; tips: string[];
}
export interface TokenCoach {
  rollupTokensPerCp: number; rollupTokensPerFile: number;
  throughput: number; byAgent: TokenCoachAgent[];
  summaryTip: string; wastedEstTokens: number;
}
export interface EntireData {
  fetchedAt: string | null
  lastError: string
  user: {
    handle: string
    accountId: string
    homeJurisdiction: string
    avatarUrl: string
    displayName: string
    email: string
    company: string
    bio: string
  } | null
  activity: {
    stats: {
      tasks: number
      orchestration: number
      iteration: number
      throughput: number
      continuity_hours: number
      streak: number
      current_streak: number
      lifetime_streak: number
      lifetime_current_streak: number
    }
    daily_contributions: { date: string; agents: Record<string, number> }[]
    hourly_contributions: { date: string; hour: number; agent: string; value: number }[]
    repos: { repo: string; total: number; agents: Record<string, number> }[]
  } | null
  recap: {
    timeframe: string
    since: string
    until: string
    summary: {
      me: { sessions: number; checkpoints: number; tokens: number }
      repoCount: number
      activeDays: number
    }
    agents: Record<string, EntireAgent>
    daily: { date: string; count: number }[]
  } | null
  // Vision Entire (docs/vision-entire.md) — derived join
  repoJoin?: RepoJoinPoint[]
  guard?: StreakGuard
  coach?: TokenCoach
  brushMeta?: { minDate: string; maxDate: string; from?: string; to?: string }
}

export const getEntire = (): Promise<EntireData> => fetch('/api/entire', { cache: 'no-store' }).then(json<EntireData>)

export const triggerEntireSync = (): Promise<void> =>
  fetch('/api/entire/sync', { method: 'POST' }).then(() => undefined)

export const triggerSync = async (): Promise<void> => {
  const res = await fetch('/api/sync', { method: 'POST' })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
}

export const avatarUrl = (login: string): string => `https://github.com/${login}.png?size=40`
