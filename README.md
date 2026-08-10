# PR Insights

Pull request analytics for the `theexperiencecompany` GitHub organisation:
leaderboards (largest PRs by total lines, additions, deletions, files changed,
commits), contributor and repository rankings, and minimal charts (merged PRs
by month, lines changed by month, top contributors) — rendered in GitHub's
Primer design language, light and dark.

- **Language**: Go, standard library only (net/http, html/template, embed).
  Ships as a single static binary with no runtime dependencies.
- **Data**: GitHub GraphQL v4, fetched per repo in parallel (5 workers),
  persisted as a JSON snapshot. Refreshes on start (if stale) and every 6h;
  a "Sync" button in the header forces a refresh.
- **UI**: Primer design tokens (from `@primer/primitives`) — same fonts,
  colours, boxes, tabs, tables, labels and pagination as GitHub itself.

## Pages

| Route | Content |
|---|---|
| `/` | Stat cards, merged-by-month chart, lines-by-month chart, top contributors, largest PRs, repositories, recently merged |
| `/leaderboards` | Ranked table with tabs for Total lines / Additions / Deletions / Files changed / Commits, state filter |
| `/contributors` | Per-author rankings: merged PRs, +/− lines, avg diff, largest PR, activity window |
| `/repos` | Per-repository aggregates |
| `/pulls` | Full PR list with state/repo/search filters and pagination |
| `/api/status` | Sync status as JSON |
| `POST /api/sync` | Trigger a refresh |

## Build

```bash
go build -o pr-insights .
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
- A per-repo sync failure keeps the last synced data for that repo and shows
  a warning banner — the dashboard never degrades on transient errors.
- Charts are server-rendered SVG, styled with CSS variables, so they adapt to
  the theme automatically.
