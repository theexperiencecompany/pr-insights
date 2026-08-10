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
  label: string
  merged: number
  additions: number
  deletions: number
  cycleMedianDays: number
  cycleCount: number
}

export interface CIBucket {
  label: string
  total: number
  success: number
  failure: number
  other: number
  successRate: number
  medianDurationMin: number
}

export interface WorkflowStat {
  repo: string
  workflow: string
  runs: number
  success: number
  successRate: number
  medianDurationMin: number
  lastRunAt: string | null
  lastConclusion: string
}

export interface Status {
  org: string
  syncing: boolean
  syncedAt: string
  lastError: string
  repoErrors: number
  pulls: number
  runs: number
  repos: number
  rateLimit: { remaining: number; limit: number } | null
}

export interface OverviewData {
  org: string
  avatarUrl: string
  syncedAt: string | null
  lastError: string
  repoErrorCount: number
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
  repos: RepoStat[]
  recent: Pull[]
}

export interface LeaderboardData {
  metric: string
  state: string
  rows: RankedPull[]
  pager: Pager
}

export interface ContributorsData {
  rows: Contributor[]
}

export interface ReposData {
  rows: RepoStat[]
}

export interface PullsData {
  rows: Pull[]
  pager: Pager
  repoOptions: RepoInfo[]
}

export interface InsightsData {
  ship: ShipBucket[]
  ci: CIBucket[]
  workflows: WorkflowStat[]
  ciStats: {
    totalRuns: number
    successRate: number
    medianDuration: number
    workflows: number
  }
  repoOptions: RepoInfo[]
}

async function getJSON<T>(path: string): Promise<T> {
  let res: Response
  try {
    res = await fetch(path)
  } catch {
    throw new Error('Network error — is the server reachable?')
  }
  if (!res.ok) {
    let detail = res.statusText
    try {
      const body = await res.json()
      if (body && typeof body.error === 'string') detail = body.error
    } catch {
      // non-JSON error body; keep status text
    }
    throw new Error(`${res.status} ${detail}`.trim())
  }
  return res.json() as Promise<T>
}

export function avatarUrl(login: string): string {
  return `https://github.com/${login}.png?size=40`
}

export function getStatus(): Promise<Status> {
  return getJSON<Status>('/api/status')
}

export function getOverview(): Promise<OverviewData> {
  return getJSON<OverviewData>('/api/overview')
}

export function getLeaderboards(params: {
  metric?: string
  state?: string
  page?: number
} = {}): Promise<LeaderboardData> {
  const q = new URLSearchParams()
  if (params.metric) q.set('metric', params.metric)
  if (params.state) q.set('state', params.state)
  if (params.page !== undefined) q.set('page', String(params.page))
  const qs = q.toString()
  return getJSON<LeaderboardData>(`/api/leaderboards${qs ? `?${qs}` : ''}`)
}

export function getContributors(): Promise<ContributorsData> {
  return getJSON<ContributorsData>('/api/contributors')
}

export function getRepos(): Promise<ReposData> {
  return getJSON<ReposData>('/api/repos')
}

export function getPulls(params: {
  repo?: string
  state?: string
  q?: string
  page?: number
} = {}): Promise<PullsData> {
  const q = new URLSearchParams()
  if (params.repo) q.set('repo', params.repo)
  if (params.state) q.set('state', params.state)
  if (params.q) q.set('q', params.q)
  if (params.page !== undefined) q.set('page', String(params.page))
  const qs = q.toString()
  return getJSON<PullsData>(`/api/pulls${qs ? `?${qs}` : ''}`)
}

export function getInsights(params: {
  repo?: string
  period?: '3m' | '6m' | '12m' | 'all'
  gran?: 'week' | 'month'
} = {}): Promise<InsightsData> {
  const q = new URLSearchParams()
  if (params.repo) q.set('repo', params.repo)
  if (params.period) q.set('period', params.period)
  if (params.gran) q.set('gran', params.gran)
  const qs = q.toString()
  return getJSON<InsightsData>(`/api/insights${qs ? `?${qs}` : ''}`)
}

export async function triggerSync(): Promise<void> {
  let res: Response
  try {
    res = await fetch('/api/sync', { method: 'POST' })
  } catch {
    throw new Error('Network error — is the server reachable?')
  }
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}`.trim())
  }
  await res.json()
}
