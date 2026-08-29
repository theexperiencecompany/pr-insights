package main

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"sort"
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
	Org             string           `json:"org"`
	AvatarURL       string           `json:"avatarUrl"`
	SyncedAt        *time.Time       `json:"syncedAt,omitempty"`
	LastError       string           `json:"lastError,omitempty"`
	RepoErrorCount  int              `json:"repoErrorCount"`
	Gran            string           `json:"gran"`
	Stats           overviewStats    `json:"stats"`
	Contributors    int              `json:"contributors"`
	Monthly         []ShipBucket     `json:"monthly"`
	TopContributors []Contributor    `json:"topContributors"`
	Largest         []RankedPull     `json:"largest"`
	Velocity        []VelocityDelta  `json:"velocity"`
	Bot             BotSplit         `json:"bot"`
	ShipDist        ShipDistribution `json:"shipDist"`
	Bus             BusFactor        `json:"bus"`
	Heatmap         []DayCount       `json:"heatmap"`
	Semantic        SemanticOverview `json:"semantic"`
	Hero            Hero             `json:"hero"`
}

type apiInsights struct {
	Repo        string         `json:"repo"`
	Period      string         `json:"period"`
	Gran        string         `json:"gran"`
	RepoOptions []RepoInfo     `json:"repoOptions"`
	Ship        []ShipBucket   `json:"ship"`
	ShipPrev    []ShipBucket   `json:"shipPrev,omitempty"` // prior-year series when period=12m
	CI          []CIBucket     `json:"ci"`
	CIStats     insightsStats  `json:"ciStats"`
	Workflows   []WorkflowStat `json:"workflows"`
	// Vision extensions — DORA-lite, Flaky, Hybrid (all derived from snapshot, no new sync)
	TShirt         []TShirtSegment  `json:"tshirt"`
	LeadTime       []LeadTimeBucket `json:"leadTime"`
	LeadOverall    LeadTimeBucket   `json:"leadOverall"`
	WIP            LittleLaw        `json:"wip"`
	Abandon        Abandonment      `json:"abandon"`
	Flaky          []FlakyStat      `json:"flakyWorkflows"`
	Cost           CostPerMerge     `json:"costPerMerge"`
	NeedsAttention []FlakyStat      `json:"needsAttention"`
	Hybrid         HybridStats      `json:"hybrid"`
}

type insightsStats struct {
	TotalRuns      int     `json:"totalRuns"`
	SuccessRate    float64 `json:"successRate"`
	MedianDuration float64 `json:"medianDuration"`
	Workflows      int     `json:"workflows"`
}

type HybridStats struct {
	Period      string           `json:"period"`
	Gran        string           `json:"gran"`
	Repo        string           `json:"repo"`
	Split       RunnerSplit      `json:"split"`
	Workflows   []WorkflowHybrid `json:"workflows"`
	Release     ReleaseStats     `json:"release"`
	Thresholds  map[string]float64 `json:"thresholds"`
	RepoOptions []RepoInfo       `json:"repoOptions"`
	Trend       []CIRunnerBucket `json:"trend"`
	OverallP50  float64          `json:"overallP50"`
	OverallP90  float64          `json:"overallP90"`
	OverallAvg  float64          `json:"overallAvg"`
	TotalRuns   int              `json:"totalRuns"`
	TotalMinutes int             `json:"totalMinutes"`
	HomeP50     float64          `json:"homeP50"`
	GithubP50   float64          `json:"githubP50"`
	DeltaHomeVsGithub float64    `json:"deltaHomeVsGithub"`
}

func periodToSince(period string) time.Time {
	switch period {
	case "3m":
		return time.Now().UTC().AddDate(0, -3, 0)
	case "6m":
		return time.Now().UTC().AddDate(0, -6, 0)
	case "12m":
		return time.Now().UTC().AddDate(0, -12, 0)
	default:
		return time.Time{}
	}
}

func computeHybrid(snap Data, repo, period string, gran Granularity) HybridStats {
	since := periodToSince(period)
	split := RunnerSplitOf(snap.Runs, repo, since)
	workflows := WorkflowHybridStats(snap.Runs, repo, since)
	release := ReleaseStatsOf(snap.Pulls, repo, since)
	trend := HybridSeries(snap.Runs, repo, gran, since)
	overallP50, overallP90, overallAvg, totalRuns, totalMinutes := OverallHybridStats(snap.Runs, repo, since)
	// home vs github p50 for delta
	var homeDurs, ghDurs []float64
	for _, r := range snap.Runs {
		if repo != "" && r.Repo != repo {
			continue
		}
		t := r.CreatedAt
		if t.IsZero() {
			t = r.RunStartedAt
		}
		if !since.IsZero() && t.Before(since) {
			continue
		}
		if r.Conclusion != "success" && r.Conclusion != "failure" {
			continue
		}
		d := float64(r.DurationSec) / 60
		switch RunnerGroupOf(r) {
		case RunnerHome:
			homeDurs = append(homeDurs, d)
		case RunnerGithub:
			ghDurs = append(ghDurs, d)
		}
	}
	homeP50 := 0.0
	githubP50 := 0.0
	if len(homeDurs) > 0 {
		sd := sortedCopy(homeDurs)
		homeP50 = Percentile(sd, 50)
	}
	if len(ghDurs) > 0 {
		sd := sortedCopy(ghDurs)
		githubP50 = Percentile(sd, 50)
	}
	delta := 0.0
	if homeP50 > 0 && githubP50 > 0 {
		delta = homeP50 - githubP50
	}
	return HybridStats{
		Period: period, Gran: string(gran), Repo: repo,
		Split: split, Workflows: workflows, Release: release,
		Thresholds: map[string]float64{"p50": P50ThresholdMin, "p90": P90ThresholdMin},
		RepoOptions: repoOptionsWithPulls(snap),
		Trend: trend,
		OverallP50: overallP50, OverallP90: overallP90, OverallAvg: overallAvg,
		TotalRuns: totalRuns, TotalMinutes: totalMinutes,
		HomeP50: homeP50, GithubP50: githubP50, DeltaHomeVsGithub: delta,
	}
}

// ---- builders (shared with the HTML handlers until they are removed) ----

func computeOverview(snap Data, largestN int, gran Granularity) apiOverview {
	return computeOverviewVersion(snap, largestN, gran, 0)
}

func computeOverviewVersion(snap Data, largestN int, gran Granularity, ver uint64) apiOverview {
	open, merged, closed := CountState(snap.Pulls)
	contribs := Contributors(snap.Pulls)
	if gran != GranWeek {
		gran = GranMonth
	}
	monthly := cachedShipping(snap.Pulls, "", gran, time.Time{}, ver)

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

	largest := Rank(PullsByState(snap.Pulls, "MERGED"), MetricDiff, false)
	if len(largest) > largestN {
		largest = largest[:largestN]
	}

	top := contribs
	if len(top) > 10 {
		top = top[:10]
	}

	// Hero: 90d window for cycle/throughput/bus, 30d for CI
	now := time.Now().UTC()
	since90 := now.AddDate(0, 0, -90)
	since30 := now.AddDate(0, 0, -30)
	cycle := CycleStatsOf(snap.Pulls, since90)
	// fallback to all-time if window empty but org has merges
	if cycle.Count == 0 {
		all := CycleStatsOf(snap.Pulls, time.Time{})
		if all.Count > 0 {
			cycle = all
			cycle.WindowDays = 0 // marker for all-time fallback (frontend shows pill)
		}
	}
	ciSucc := CISuccessOf(snap.Runs, since30)
	thr := ThroughputOf(snap.Pulls, now)
	// hero bus uses same 90d window
	windowPulls90 := make([]Pull, 0, len(snap.Pulls))
	for _, p := range snap.Pulls {
		if p.State != "MERGED" || p.MergedAt == nil {
			continue
		}
		if p.MergedAt.Before(since90) {
			continue
		}
		windowPulls90 = append(windowPulls90, p)
	}
	heroBus := BusFactorOf(contribs, merged)
	if len(windowPulls90) > 0 {
		windowContribs := Contributors(windowPulls90)
		merged90 := 0
		for _, p := range windowPulls90 {
			if p.State == "MERGED" {
				merged90++
			}
		}
		heroBus = BusFactorOf(windowContribs, merged90)
	}
	heroNote := "90d window"
	if cycle.WindowDays == 0 {
		heroNote = "all-time fallback"
	}
	return apiOverview{
		Org:            snap.Org,
		AvatarURL:      snap.AvatarURL,
		SyncedAt:       snap.SyncedAt,
		LastError:      snap.LastError,
		RepoErrorCount: len(snap.RepoErrs),
		Gran:           string(gran),
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
		Velocity:        VelocityDeltas(snap.Pulls),
		Bot:             BotSplitOf(snap.Pulls),
		ShipDist:        ShipDistributionOf(snap.Pulls),
		Bus:             BusFactorOf(contribs, merged),
		Heatmap:         Heatmap(snap.Pulls, "", 365),
		Semantic: SemanticOverview{
			ByType:   SemanticBreakdown(snap.Pulls),
			Timeline: SemanticTimeline(snap.Pulls, gran),
		},
		Hero: Hero{Cycle: cycle, CI: ciSucc, Throughput: thr, Bus: heroBus, WindowNote: heroNote},
	}
}

// computeLeaderboards ranks pulls with optional filters: order direction,
// repo, author and a merged-date window (from/to as YYYY-MM-DD).
func computeLeaderboards(snap Data, metric Metric, state string, page int, asc bool, repo, author, from, to string) (rows []RankedPull, pg pager) {
	pulls := PullsByState(snap.Pulls, state)
	if repo != "" {
		filtered := make([]Pull, 0, len(pulls))
		for _, p := range pulls {
			if p.Repo == repo {
				filtered = append(filtered, p)
			}
		}
		pulls = filtered
	}
	if author != "" {
		filtered := make([]Pull, 0, len(pulls))
		for _, p := range pulls {
			if p.Author == author {
				filtered = append(filtered, p)
			}
		}
		pulls = filtered
	}
	var fromT, toT time.Time
	if from != "" {
		fromT, _ = time.Parse("2006-01-02", from)
	}
	if to != "" {
		toT, _ = time.Parse("2006-01-02", to)
		toT = toT.AddDate(0, 0, 1) // inclusive end of day
	}
	if !fromT.IsZero() || !toT.IsZero() {
		filtered := make([]Pull, 0, len(pulls))
		for _, p := range pulls {
			t := p.MergedAt
			if t == nil {
				continue
			}
			if !fromT.IsZero() && t.Before(fromT) {
				continue
			}
			if !toT.IsZero() && !t.Before(toT) {
				continue
			}
			filtered = append(filtered, p)
		}
		pulls = filtered
	}
	ranked := Rank(pulls, metric, asc)
	pg = paginate(len(ranked), page, perPage)
	return ranked[pg.From:pg.To], pg
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

// ShameList is the "hall of shame": oldest open PRs, slowest merges and the
// biggest closed-without-merge ones.
type ShameList struct {
	LongestOpen    []ShameEntry `json:"longestOpen"`    // days open
	LongestToMerge []ShameEntry `json:"longestToMerge"` // days from open to merge
	BiggestClosed  []ShameEntry `json:"biggestClosed"`  // total lines
}

// ShameEntry is one hall-of-shame row with a human-readable value.
type ShameEntry struct {
	Pull  Pull    `json:"pull"`
	Value float64 `json:"value"` // days open (longestOpen) or total lines (biggestClosed)
}

func computeShame(snap Data) ShameList {
	open := PullsByState(snap.Pulls, "OPEN")
	sort.Slice(open, func(i, j int) bool {
		if !open[i].CreatedAt.Equal(open[j].CreatedAt) {
			return open[i].CreatedAt.Before(open[j].CreatedAt)
		}
		return open[i].Number < open[j].Number
	})
	longest := make([]ShameEntry, 0, 5)
	for _, p := range open {
		if len(longest) == 5 {
			break
		}
		longest = append(longest, ShameEntry{Pull: p, Value: time.Since(p.CreatedAt).Hours() / 24})
	}

	merged := PullsByState(snap.Pulls, "MERGED")
	sort.Slice(merged, func(i, j int) bool {
		di, dj := 0.0, 0.0
		if merged[i].MergedAt != nil {
			di = merged[i].MergedAt.Sub(merged[i].CreatedAt).Hours()
		}
		if merged[j].MergedAt != nil {
			dj = merged[j].MergedAt.Sub(merged[j].CreatedAt).Hours()
		}
		if di != dj {
			return di > dj
		}
		return merged[i].Number > merged[j].Number
	})
	slowest := make([]ShameEntry, 0, 5)
	for _, p := range merged {
		if len(slowest) == 5 {
			break
		}
		if p.MergedAt == nil {
			continue
		}
		slowest = append(slowest, ShameEntry{Pull: p, Value: p.MergedAt.Sub(p.CreatedAt).Hours() / 24})
	}

	closed := PullsByState(snap.Pulls, "CLOSED")
	sort.Slice(closed, func(i, j int) bool {
		di := closed[i].Additions + closed[i].Deletions
		dj := closed[j].Additions + closed[j].Deletions
		if di != dj {
			return di > dj
		}
		return closed[i].Number > closed[j].Number
	})
	biggest := make([]ShameEntry, 0, 5)
	for _, p := range closed {
		if len(biggest) == 5 {
			break
		}
		biggest = append(biggest, ShameEntry{Pull: p, Value: float64(p.Additions + p.Deletions)})
	}
	return ShameList{LongestOpen: longest, LongestToMerge: slowest, BiggestClosed: biggest}
}

func computeInsights(snap Data, repo, period string, gran Granularity) apiInsights {
	return computeInsightsVersion(snap, repo, period, gran, 0)
}

func computeInsightsVersion(snap Data, repo, period string, gran Granularity, ver uint64) apiInsights {
	var since time.Time
	switch period {
	case "3m":
		since = time.Now().UTC().AddDate(0, -3, 0)
	case "6m":
		since = time.Now().UTC().AddDate(0, -6, 0)
	case "12m":
		since = time.Now().UTC().AddDate(0, -12, 0)
	}

	ship := cachedShipping(snap.Pulls, repo, gran, since, ver)
	var shipPrev []ShipBucket
	if period == "12m" {
		prevSince := since.AddDate(0, -12, 0)
		shipPrev = cachedShippingSeries(snap.Pulls, repo, gran, prevSince, since, ver)
	}
	ci := CISeries(snap.Runs, repo, gran, since)
	workflows := WorkflowStats(snap.Runs, repo, since)

	var ciTotal, ciSuccess, ciFailure, ciWorkflows int
	var ciDur []float64
	for _, wf := range workflows {
		ciTotal += wf.Runs
		ciSuccess += wf.Success
		ciFailure += wf.Failure
		ciWorkflows++
		ciDur = append(ciDur, wf.MedianDurationMin)
	}
	ciRate := 0.0
	if denom := ciSuccess + ciFailure; denom > 0 {
		ciRate = float64(ciSuccess) / float64(denom) * 100
	}

	// Vision: DORA-lite (TShirt, LeadTime, WIP, Abandon), Flaky, Hybrid — all derived from same since window
	tshirt := TShirtDistribution(snap.Pulls)
	leadTime := LeadTimeSeries(snap.Pulls, repo, gran, since)
	leadOverall := LeadTimeStats(snap.Pulls, repo, since)
	wip := LittleLawOf(snap.Pulls, repo, 30)
	if period == "3m" {
		wip = LittleLawOf(snap.Pulls, repo, 90)
	}
	abandon := AbandonmentOf(snap.Pulls, repo, since)
	flaky := FlakyStats(snap.Runs, repo, since)
	cost := CostPerMergeOf(snap.Runs, snap.Pulls, repo, since)
	needs := make([]FlakyStat, 0, 5)
	for _, f := range flaky {
		if f.Runs < FlakeMinRuns {
			continue
		}
		if f.FlakeScore >= 15 || f.FailureRate >= 20 || f.MTTRMedianMin >= 120 || f.WastedPct >= 25 {
			needs = append(needs, f)
			if len(needs) >= 5 {
				break
			}
		}
	}
	hybrid := computeHybrid(snap, repo, period, gran)
	return apiInsights{
		Repo:        repo,
		Period:      period,
		Gran:        string(gran),
		RepoOptions: repoOptionsWithPulls(snap),
		Ship:        ship,
		ShipPrev:    shipPrev,
		CI:          ci,
		CIStats: insightsStats{
			TotalRuns:      ciTotal,
			SuccessRate:    ciRate,
			MedianDuration: medianFloat(ciDur),
			Workflows:      ciWorkflows,
		},
		Workflows: workflows,
		TShirt: tshirt,
		LeadTime: leadTime,
		LeadOverall: leadOverall,
		WIP: wip,
		Abandon: abandon,
		Flaky: flaky,
		Cost: cost,
		NeedsAttention: needs,
		Hybrid: hybrid,
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
	largestN := queryInt(r, "largest", 5)
	if largestN < 1 || largestN > 50 {
		largestN = 5
	}
	gran := Granularity(r.URL.Query().Get("gran"))
	if gran != GranWeek {
		gran = GranMonth
	}
	snap, ver := s.store.SnapshotWithVersion()
	// ETag based on snapshot version + query params
	etag := fmt.Sprintf(`W/"%d-%s-%d"`, ver, gran, largestN)
	if match := r.Header.Get("If-None-Match"); match != "" && match == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	w.Header().Set("ETag", etag)
	writeJSON(w, computeOverviewVersion(snap, largestN, gran, ver))
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
	asc := r.URL.Query().Get("order") == "asc"
	page := queryInt(r, "page", 1)
	snap := s.store.Snapshot()
	rows, pg := computeLeaderboards(snap, metric, state, page, asc,
		r.URL.Query().Get("repo"), r.URL.Query().Get("author"),
		r.URL.Query().Get("from"), r.URL.Query().Get("to"))
	writeJSON(w, struct {
		Metric      string       `json:"metric"`
		State       string       `json:"state"`
		Order       string       `json:"order"`
		Rows        []RankedPull `json:"rows"`
		Pager       pager        `json:"pager"`
		RepoOptions []RepoInfo   `json:"repoOptions"`
	}{string(metric), state, r.URL.Query().Get("order"), rows, pg, repoOptionsWithPulls(snap)})
}

func (s *Server) handleAPIShame(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, computeShame(s.store.Snapshot()))
}

func (s *Server) handleAPIContributors(w http.ResponseWriter, r *http.Request) {
	snap := s.store.Snapshot()
	repo := r.URL.Query().Get("repo")
	q := r.URL.Query().Get("q")
	fromStr := r.URL.Query().Get("from")
	toStr := r.URL.Query().Get("to")
	page := queryInt(r, "page", 1)

	// Filter pulls by repo and date range before aggregating.
	pulls := snap.Pulls
	if repo != "" {
		filtered := make([]Pull, 0, len(pulls))
		for _, p := range pulls {
			if p.Repo == repo {
				filtered = append(filtered, p)
			}
		}
		pulls = filtered
	}
	var fromT, toT time.Time
	if fromStr != "" {
		fromT, _ = time.Parse("2006-01-02", fromStr)
	}
	if toStr != "" {
		toT, _ = time.Parse("2006-01-02", toStr)
		toT = toT.AddDate(0, 0, 1)
	}
	if !fromT.IsZero() || !toT.IsZero() {
		filtered := make([]Pull, 0, len(pulls))
		for _, p := range pulls {
			t := p.MergedAt
			if t == nil {
				continue
			}
			if !fromT.IsZero() && t.Before(fromT) {
				continue
			}
			if !toT.IsZero() && !t.Before(toT) {
				continue
			}
			filtered = append(filtered, p)
		}
		pulls = filtered
	}

	contribs := Contributors(pulls)

	// Text search by login (case-insensitive substring).
	if q != "" {
		qlower := q
		// case-insensitive: compare lowercased
		filtered := make([]Contributor, 0)
		for _, c := range contribs {
			if len(q) > len(c.Login) {
				// still check lower
			}
			if containsFold(c.Login, qlower) {
				filtered = append(filtered, c)
			}
		}
		contribs = filtered
	}

	pg := paginate(len(contribs), page, perPage)
	rows := contribs[pg.From:pg.To]
	writeJSON(w, struct {
		Rows        []Contributor `json:"rows"`
		Pager       pager        `json:"pager"`
		RepoOptions []RepoInfo   `json:"repoOptions"`
	}{rows, pg, repoOptionsWithPulls(snap)})
}

// containsFold reports whether s contains substr case-insensitively.
func containsFold(s, substr string) bool {
	// small helper without importing strings for fold
	// Use simple lowercasing — logins are ASCII.
	if len(substr) == 0 {
		return true
	}
	if len(substr) > len(s) {
		return false
	}
	// lower both
	ls := toLowerASCII(s)
	lsub := toLowerASCII(substr)
	return containsASCII(ls, lsub)
}

func toLowerASCII(s string) string {
	b := make([]byte, len(s))
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c >= 'A' && c <= 'Z' {
			c += 'a' - 'A'
		}
		b[i] = c
	}
	return string(b)
}

func containsASCII(s, substr string) bool {
	if len(substr) == 0 {
		return true
	}
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}

// handleAPIContributor serves the drill-down view for one author.
func (s *Server) handleAPIContributor(w http.ResponseWriter, r *http.Request) {
	login := r.URL.Query().Get("login")
	if login == "" {
		http.Error(w, "missing login", http.StatusBadRequest)
		return
	}
	gran := Granularity(r.URL.Query().Get("gran"))
	if gran != GranWeek {
		gran = GranMonth
	}
	writeJSON(w, ContributorDetailOfGran(s.store.Snapshot().Pulls, login, gran))
}

func (s *Server) handleAPIPulls(w http.ResponseWriter, r *http.Request) {
	repo := r.URL.Query().Get("repo")
	state := r.URL.Query().Get("state")
	if state == "" {
		state = "all"
	}
	q := r.URL.Query().Get("q")
	page := queryInt(r, "page", 1)
	order := r.URL.Query().Get("order")
	sortMetric := Metric(r.URL.Query().Get("sort"))
	if sortMetric == "created" {
		sortMetric = ""
	} else if r.URL.Query().Get("sort") != "" && !sortMetric.Valid() {
		sortMetric = ""
	}
	snap := s.store.Snapshot()
	pulls := SearchPulls(snap.Pulls, repo, state, q)
	switch r.URL.Query().Get("bot") {
	case "1", "true":
		filtered := make([]Pull, 0, len(pulls))
		for _, p := range pulls {
			if p.IsBot {
				filtered = append(filtered, p)
			}
		}
		pulls = filtered
	case "0", "false":
		filtered := make([]Pull, 0, len(pulls))
		for _, p := range pulls {
			if !p.IsBot {
				filtered = append(filtered, p)
			}
		}
		pulls = filtered
	}
	if sortMetric == "" {
		sort.Slice(pulls, func(i, j int) bool {
			a, b := pulls[i], pulls[j]
			if r.URL.Query().Get("sort") == "created" {
				if !a.CreatedAt.Equal(b.CreatedAt) {
					if order == "asc" {
						return a.CreatedAt.Before(b.CreatedAt)
					}
					return a.CreatedAt.After(b.CreatedAt)
				}
				return a.Number > b.Number
			}
			if !a.UpdatedAt.Equal(b.UpdatedAt) {
				return a.UpdatedAt.After(b.UpdatedAt)
			}
			return a.Number > b.Number
		})
	} else {
		SortPulls(pulls, sortMetric)
	}
	pg := paginate(len(pulls), page, perPage)
	writeJSON(w, struct {
		Rows        []Pull     `json:"rows"`
		Pager       pager      `json:"pager"`
		RepoOptions []RepoInfo `json:"repoOptions"`
	}{pulls[pg.From:pg.To], pg, repoOptionsWithPulls(snap)})
}

func (s *Server) handleAPIHybrid(w http.ResponseWriter, r *http.Request) {
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
	snap, ver := s.store.SnapshotWithVersion()
	etag := fmt.Sprintf(`W/"%d-hybrid-%s-%s-%s"`, ver, repo, period, gran)
	if match := r.Header.Get("If-None-Match"); match != "" && match == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	w.Header().Set("ETag", etag)
	writeJSON(w, computeHybrid(snap, repo, period, gran))
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
	snap, ver := s.store.SnapshotWithVersion()
	etag := fmt.Sprintf(`W/"%d-%s-%s-%s"`, ver, repo, period, gran)
	if match := r.Header.Get("If-None-Match"); match != "" && match == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	w.Header().Set("ETag", etag)
	writeJSON(w, computeInsightsVersion(snap, repo, period, gran, ver))
}
