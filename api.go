package main

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"time"
)

// This file exposes the computed analytics as JSON for the React frontend.
// The computation lives in the shared builders below, used by both the API
// handlers and (until the migration lands) the server-rendered pages.

// ---- payloads ----

type overviewStats struct {
	Total     int `json:"total"`
	Merged    int `json:"merged"`
	Open      int `json:"open"`
	Closed    int `json:"closed"`
	Additions int `json:"additions"`
	Deletions int `json:"deletions"`
	Files     int `json:"files"`
	Commits   int `json:"commits"`
	AvgDiff   int `json:"avgDiff"`
	AvgFiles  int `json:"avgFiles"`
}

type apiOverview struct {
	Org             string        `json:"org"`
	AvatarURL       string        `json:"avatarUrl"`
	SyncedAt        *time.Time    `json:"syncedAt,omitempty"`
	LastError       string        `json:"lastError,omitempty"`
	RepoErrorCount  int           `json:"repoErrorCount"`
	Stats           overviewStats `json:"stats"`
	Contributors    int           `json:"contributors"`
	Monthly         []ShipBucket  `json:"monthly"`
	TopContributors []Contributor `json:"topContributors"`
	Largest         []RankedPull  `json:"largest"`
	Repos           []RepoStat    `json:"repos"`
	Recent          []Pull        `json:"recent"`
}

type apiInsights struct {
	Repo        string         `json:"repo"`
	Period      string         `json:"period"`
	Gran        string         `json:"gran"`
	RepoOptions []RepoInfo     `json:"repoOptions"`
	Ship        []ShipBucket   `json:"ship"`
	CI          []CIBucket     `json:"ci"`
	CIStats     insightsStats  `json:"ciStats"`
	Workflows   []WorkflowStat `json:"workflows"`
}

type insightsStats struct {
	TotalRuns      int     `json:"totalRuns"`
	SuccessRate    float64 `json:"successRate"`
	MedianDuration float64 `json:"medianDuration"`
	Workflows      int     `json:"workflows"`
}

// ---- builders (shared with the HTML handlers until they are removed) ----

func computeOverview(snap Data) apiOverview {
	open, merged, closed := CountState(snap.Pulls)
	contribs := Contributors(snap.Pulls)
	repos := RepoStats(snap.Pulls, snap.Repos)
	monthly := MonthlySeries(snap.Pulls)

	var additions, deletions, files, commits int
	for _, p := range snap.Pulls {
		if p.State != "MERGED" {
			continue
		}
		additions += p.Additions
		deletions += p.Deletions
		files += p.ChangedFiles
		commits += p.Commits
	}
	avgDiff, avgFiles := 0, 0
	if merged > 0 {
		avgDiff = (additions + deletions) / merged
		avgFiles = files / merged
	}

	largest := Rank(PullsByState(snap.Pulls, "MERGED"), MetricDiff)
	if len(largest) > 5 {
		largest = largest[:5]
	}

	recent := make([]Pull, 0)
	for _, p := range PullsByState(snap.Pulls, "MERGED") {
		if p.MergedAt != nil {
			recent = append(recent, p)
		}
	}
	SortPullsByMerged(recent)
	if len(recent) > 10 {
		recent = recent[:10]
	}

	top := contribs
	if len(top) > 10 {
		top = top[:10]
	}

	return apiOverview{
		Org:            snap.Org,
		AvatarURL:      snap.AvatarURL,
		SyncedAt:       snap.SyncedAt,
		LastError:      snap.LastError,
		RepoErrorCount: len(snap.RepoErrs),
		Stats: overviewStats{
			Total: len(snap.Pulls), Merged: merged, Open: open, Closed: closed,
			Additions: additions, Deletions: deletions,
			Files: files, Commits: commits,
			AvgDiff: avgDiff, AvgFiles: avgFiles,
		},
		Contributors:    len(contribs),
		Monthly:         monthly,
		TopContributors: top,
		Largest:         largest,
		Repos:           repos,
		Recent:          recent,
	}
}

func computeLeaderboards(snap Data, metric Metric, state string, page int) (rows []RankedPull, pg pager) {
	ranked := Rank(PullsByState(snap.Pulls, state), metric)
	pg = paginate(len(ranked), page, perPage)
	return ranked[pg.From:pg.To], pg
}

func computePulls(snap Data, repo, state, q string, page int) (rows []Pull, pg pager, repoOptions []RepoInfo) {
	pulls := SearchPulls(snap.Pulls, repo, state, q)
	SortPulls(pulls, "")
	pg = paginate(len(pulls), page, perPage)
	return pulls[pg.From:pg.To], pg, repoOptionsWithPulls(snap)
}

// repoOptionsWithPulls lists repos that have at least one pull.
func repoOptionsWithPulls(snap Data) []RepoInfo {
	out := make([]RepoInfo, 0)
	for _, rs := range RepoStats(snap.Pulls, snap.Repos) {
		if rs.Total > 0 {
			out = append(out, rs.RepoInfo)
		}
	}
	return out
}

func computeInsights(snap Data, repo, period string, gran Granularity) apiInsights {
	var since time.Time
	switch period {
	case "3m":
		since = time.Now().UTC().AddDate(0, -3, 0)
	case "6m":
		since = time.Now().UTC().AddDate(0, -6, 0)
	case "12m":
		since = time.Now().UTC().AddDate(0, -12, 0)
	}

	ship := ShippingSeries(snap.Pulls, repo, gran, since)
	ci := CISeries(snap.Runs, repo, gran, since)
	workflows := WorkflowStats(snap.Runs, repo, since)

	var ciTotal, ciSuccess, ciWorkflows int
	var ciDur []float64
	for _, wf := range workflows {
		ciTotal += wf.Runs
		ciSuccess += wf.Success
		ciWorkflows++
		ciDur = append(ciDur, wf.MedianDurationMin)
	}
	ciRate := 0.0
	if ciTotal > 0 {
		ciRate = float64(ciSuccess) / float64(ciTotal) * 100
	}

	return apiInsights{
		Repo:        repo,
		Period:      period,
		Gran:        string(gran),
		RepoOptions: repoOptionsWithPulls(snap),
		Ship:        ship,
		CI:          ci,
		CIStats: insightsStats{
			TotalRuns:      ciTotal,
			SuccessRate:    ciRate,
			MedianDuration: medianFloat(ciDur),
			Workflows:      ciWorkflows,
		},
		Workflows: workflows,
	}
}

// ---- JSON handlers ----

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	if err := json.NewEncoder(w).Encode(v); err != nil {
		slog.Error("json encode failed", "err", err)
	}
}

func (s *Server) handleAPIOverview(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, computeOverview(s.store.Snapshot()))
}

func (s *Server) handleAPILeaderboards(w http.ResponseWriter, r *http.Request) {
	metric := Metric(r.URL.Query().Get("metric"))
	if !metric.Valid() {
		metric = MetricDiff
	}
	state := r.URL.Query().Get("state")
	if state == "" {
		state = "merged"
	}
	page := queryInt(r, "page", 1)
	rows, pg := computeLeaderboards(s.store.Snapshot(), metric, state, page)
	writeJSON(w, struct {
		Metric string       `json:"metric"`
		State  string       `json:"state"`
		Rows   []RankedPull `json:"rows"`
		Pager  pager        `json:"pager"`
	}{string(metric), state, rows, pg})
}

func (s *Server) handleAPIContributors(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, struct {
		Rows []Contributor `json:"rows"`
	}{Contributors(s.store.Snapshot().Pulls)})
}

func (s *Server) handleAPIRepos(w http.ResponseWriter, r *http.Request) {
	snap := s.store.Snapshot()
	writeJSON(w, struct {
		Rows []RepoStat `json:"rows"`
	}{RepoStats(snap.Pulls, snap.Repos)})
}

func (s *Server) handleAPIPulls(w http.ResponseWriter, r *http.Request) {
	repo := r.URL.Query().Get("repo")
	state := r.URL.Query().Get("state")
	if state == "" {
		state = "all"
	}
	q := r.URL.Query().Get("q")
	page := queryInt(r, "page", 1)
	rows, pg, repoOptions := computePulls(s.store.Snapshot(), repo, state, q, page)
	writeJSON(w, struct {
		Rows        []Pull     `json:"rows"`
		Pager       pager      `json:"pager"`
		RepoOptions []RepoInfo `json:"repoOptions"`
	}{rows, pg, repoOptions})
}

func (s *Server) handleAPIInsights(w http.ResponseWriter, r *http.Request) {
	repo := r.URL.Query().Get("repo")
	period := r.URL.Query().Get("period")
	switch period {
	case "3m", "6m", "12m", "all":
	default:
		period = "6m"
	}
	gran := Granularity(r.URL.Query().Get("gran"))
	if gran != GranWeek {
		gran = GranMonth
	}
	writeJSON(w, computeInsights(s.store.Snapshot(), repo, period, gran))
}
