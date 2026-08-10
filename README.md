# PR Insights

Pull request analytics for the `theexperiencecompany` GitHub organisation:
leaderboards (largest PRs by total lines, additions, deletions, files changed,
commits), contributor and repository rankings, shipping velocity and CI charts
— rendered in GitHub's Primer design language, light and dark.

- **Backend**: Go, standard library only (net/http, encoding/json, embed).
  Syncs via GitHub GraphQL v4 + REST (parallel workers, incremental CI runs),
  persists a JSON snapshot, serves the analytics as a JSON API and the built
  frontend as a single static binary.
- **Frontend**: Vite + React + TypeScript + Tailwind v4 + shadcn/ui + shadcn
  charts (Recharts) in `frontend/` — interactive charts with tooltips, hovers
  and legends.
- **UI**: Primer design tokens (from `@primer/primitives`) — same fonts,
  colours, boxes, tabs, tables, labels and pagination as GitHub itself.

## Pages

| Route | Content |
|---|---|
| `/` | Stat cards, merged-by-month chart, lines-by-month chart, top contributors, largest PRs, repositories, recently merged |
| `/leaderboards` | Ranked table with tabs for Total lines / Additions / Deletions / Files changed / Commits, state filter |
| `/contributors` | Per-author rankings: merged PRs, +/− lines, avg diff, largest PR, activity window |
| `/repos` | Per-repository aggregates |
| `/insights` | Shipping velocity (merged PRs, lines merged, cycle time) + CI health (runs, success rate, duration, workflow breakdown) — filterable by repository, period (3m/6m/12m/all) and granularity (weekly/monthly) |
| `/pulls` | Full PR list with state/repo/search filters and pagination |

## API

The frontend consumes JSON endpoints: `/api/overview`, `/api/leaderboards`,
`/api/contributors`, `/api/repos`, `/api/insights`, `/api/pulls`,
`/api/status`, `POST /api/sync`. In dev, `pnpm dev` proxies `/api` to the Go
server (default `127.0.0.1:8787`).

## Build

```bash
pnpm --dir frontend install && pnpm --dir frontend build   # builds frontend/dist
go build -o pr-insights .                                   # embeds frontend/dist
```

## Run

```bash
GITHUB_TOKEN=github_pat_xxx PR_INSIGHTS_ADDR=127.0.0.1:8787 ./pr-insights
```

| Env var | Default | Purpose |
|---|---|---|
| `GITHUB_TOKEN` | — (required) | GitHub token with `repo` read scope for the org |
| `GITHUB_ORG` | `theexperiencecompany` | Organisation to analyse |
| `PR_INSIGHTS_ADDR` | `127.0.0.1:8787` | Listen address |
| `PR_INSIGHTS_DATA_DIR` | `./data` | Snapshot location |
| `PR_INSIGHTS_SYNC_INTERVAL` | `6h` | Auto-refresh interval |

## Deploy (systemd)

```bash
./deploy.sh gaia-home-server ./pr-insights
```

`deploy.sh` copies the binary to `/opt/pr-insights/`, installs
`systemd/pr-insights.service` (user `prinsights`, data in
`/var/lib/pr-insights`), writes `/etc/pr-insights.env` (0600) and starts the
service. The GitHub token is read from the `GITHUB_TOKEN` env var, falling
back to `gh auth token`. Expose it on the tailnet with:

```bash
tailscale serve --bg --https=18443 http://127.0.0.1:8787
```

## Notes

- Only merged PRs count towards leaderboards by default; use the state filter
  to include open/closed PRs.
- CI data (workflow runs) is fetched incrementally — the full history on the
  first sync, only new runs afterwards. The runs endpoint is slow, so pages
  are fetched in parallel.
- A per-repo sync failure keeps the last synced data for that repo and shows
  a warning banner — the dashboard never degrades on transient errors.
- Charts are server-rendered SVG, styled with CSS variables, so they adapt to
  the theme automatically.
- Cycle time = median days from PR opened to merged, per bucket.
