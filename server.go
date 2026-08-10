package main

import (
	"embed"
	"encoding/json"
	"fmt"
	"html/template"
	"io/fs"
	"log/slog"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
)

const perPage = 25

// Server wires routes to the store and syncer and renders templates.
type Server struct {
	store  *State
	syncer *Syncer
	tmpl   *template.Template
	static fs.FS
}

func NewServer(store *State, syncer *Syncer, templatesFS, staticFS embed.FS) (*Server, error) {
	tmpl, err := template.New("").Funcs(funcMap).ParseFS(templatesFS, "web/templates/*.html")
	if err != nil {
		return nil, err
	}
	static, err := fs.Sub(staticFS, "web/static")
	if err != nil {
		return nil, err
	}
	return &Server{store: store, syncer: syncer, tmpl: tmpl, static: static}, nil
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /{$}", s.handleOverview)
	mux.HandleFunc("GET /leaderboards", s.handleLeaderboards)
	mux.HandleFunc("GET /contributors", s.handleContributors)
	mux.HandleFunc("GET /repos", s.handleRepos)
	mux.HandleFunc("GET /insights", s.handleInsights)
	mux.HandleFunc("GET /pulls", s.handlePulls)
	mux.HandleFunc("POST /api/sync", s.handleSync)
	mux.HandleFunc("GET /api/status", s.handleStatus)
	mux.HandleFunc("GET /api/overview", s.handleAPIOverview)
	mux.HandleFunc("GET /api/leaderboards", s.handleAPILeaderboards)
	mux.HandleFunc("GET /api/contributors", s.handleAPIContributors)
	mux.HandleFunc("GET /api/repos", s.handleAPIRepos)
	mux.HandleFunc("GET /api/insights", s.handleAPIInsights)
	mux.HandleFunc("GET /api/pulls", s.handleAPIPulls)
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		w.Write([]byte("ok\n"))
	})
	mux.Handle("GET /static/", http.StripPrefix("/static/", http.FileServerFS(s.static)))
	return mux
}

// baseData is the data shared by every page: header, nav and sync status.
type baseData struct {
	Page             string
	Org              string
	OrgAvatarURL     string
	PullsCount       int
	OpenCount        int
	MergedCount      int
	ContributorCount int
	RepoCount        int
	HasData          bool
	Syncing          bool
	SyncedAtISO      string
	SyncedAtHuman    string
	SyncError        string
	RepoErrorCount   int
}

func (s *Server) base(page string, snap Data) baseData {
	open, merged, _ := CountState(snap.Pulls)
	b := baseData{
		Page:             page,
		Org:              snap.Org,
		OrgAvatarURL:     snap.AvatarURL,
		PullsCount:       len(snap.Pulls),
		OpenCount:        open,
		MergedCount:      merged,
		ContributorCount: len(Contributors(snap.Pulls)),
		RepoCount:        len(snap.Repos),
		HasData:          len(snap.Pulls) > 0,
		Syncing:          snap.Syncing,
		SyncError:        snap.LastError,
		RepoErrorCount:   len(snap.RepoErrs),
	}
	if snap.SyncedAt != nil {
		b.SyncedAtISO = snap.SyncedAt.UTC().Format(time.RFC3339)
		b.SyncedAtHuman = snap.SyncedAt.UTC().Format("Jan 2, 2006 15:04 MST")
	}
	return b
}

func (s *Server) render(w http.ResponseWriter, r *http.Request, page string, data any) {
	w.Header().Set("Cache-Control", "no-store")
	if err := s.tmpl.ExecuteTemplate(w, page, data); err != nil {
		slog.Error("template render failed", "page", page, "err", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
	}
}

// ---- pages ----

func (s *Server) handleOverview(w http.ResponseWriter, r *http.Request) {
	snap := s.store.Snapshot()
	b := s.base("overview", snap)

	if !b.HasData {
		s.render(w, r, "overview", struct {
			baseData
		}{b})
		return
	}

	ov := computeOverview(snap)
	monthly := ov.Monthly

	top := ov.TopContributors
	maxMerged := 0
	if len(top) > 0 {
		maxMerged = top[0].Merged
	}
	type barContributor struct {
		Contributor
		BarWidth string
	}
	bars := make([]barContributor, 0, len(top))
	for _, c := range top {
		width := "0%"
		if maxMerged > 0 {
			width = fmt.Sprintf("%.1f%%", float64(c.Merged)/float64(maxMerged)*100)
		}
		bars = append(bars, barContributor{Contributor: c, BarWidth: width})
	}

	s.render(w, r, "overview", struct {
		baseData
		Stats          overviewStats
		Monthly        []ShipBucket
		MonthlyChart   template.HTML
		StackedChart   template.HTML
		TopContributor []barContributor
		Largest        []RankedPull
		Repos          []RepoStat
		Recent         []Pull
	}{
		baseData:       b,
		Stats:          ov.Stats,
		Monthly:        monthly,
		MonthlyChart:   monthBarsSVG(monthly, func(m ShipBucket) int { return m.Merged }, "accent", "Merged pull requests by month"),
		StackedChart:   monthStackedBarsSVG(monthly),
		TopContributor: bars,
		Largest:        ov.Largest,
		Repos:          ov.Repos,
		Recent:         ov.Recent,
	})
}

func (s *Server) handleLeaderboards(w http.ResponseWriter, r *http.Request) {
	snap := s.store.Snapshot()
	b := s.base("leaderboards", snap)

	metric := Metric(r.URL.Query().Get("metric"))
	if !metric.Valid() {
		metric = MetricDiff
	}
	state := r.URL.Query().Get("state")
	if state == "" {
		state = "merged"
	}
	page := queryInt(r, "page", 1)

	rows, pg := computeLeaderboards(snap, metric, state, page)

	base := "/leaderboards"
	pg.PrevHref = queryHref(base, "metric", string(metric), "state", state, "page", strconv.Itoa(pg.Page-1))
	pg.NextHref = queryHref(base, "metric", string(metric), "state", state, "page", strconv.Itoa(pg.Page+1))

	type metricTab struct {
		Metric Metric
		Label  string
		Href   string
		Active bool
	}
	tabs := make([]metricTab, 0, 5)
	for _, m := range []Metric{MetricDiff, MetricAdditions, MetricDeletions, MetricFiles, MetricCommits} {
		tabs = append(tabs, metricTab{
			Metric: m,
			Label:  m.Label(),
			Href:   queryHref(base, "metric", string(m), "state", state, "page", "1"),
			Active: m == metric,
		})
	}

	s.render(w, r, "leaderboards", struct {
		baseData
		Metric Metric
		State  string
		Tabs   []metricTab
		Rows   []RankedPull
		Pager  pager
	}{baseData: b, Metric: metric, State: state, Tabs: tabs, Rows: rows, Pager: pg})
}

func (s *Server) handleContributors(w http.ResponseWriter, r *http.Request) {
	snap := s.store.Snapshot()
	b := s.base("contributors", snap)
	contribs := Contributors(snap.Pulls)

	top := contribs
	if len(top) > 10 {
		top = top[:10]
	}
	maxMerged := 0
	if len(top) > 0 {
		maxMerged = top[0].Merged
	}
	type barContributor struct {
		Contributor
		BarWidth string
	}
	bars := make([]barContributor, 0, len(top))
	for _, c := range top {
		width := "0%"
		if maxMerged > 0 {
			width = fmt.Sprintf("%.1f%%", float64(c.Merged)/float64(maxMerged)*100)
		}
		bars = append(bars, barContributor{Contributor: c, BarWidth: width})
	}

	s.render(w, r, "contributors", struct {
		baseData
		Rows []Contributor
		Bars []barContributor
	}{baseData: b, Rows: contribs, Bars: bars})
}

func (s *Server) handleRepos(w http.ResponseWriter, r *http.Request) {
	snap := s.store.Snapshot()
	b := s.base("repos", snap)
	repos := RepoStats(snap.Pulls, snap.Repos)
	s.render(w, r, "repos", struct {
		baseData
		Rows []RepoStat
	}{baseData: b, Rows: repos})
}

func (s *Server) handlePulls(w http.ResponseWriter, r *http.Request) {
	snap := s.store.Snapshot()
	b := s.base("pulls", snap)

	repo := r.URL.Query().Get("repo")
	state := r.URL.Query().Get("state")
	if state == "" {
		state = "all"
	}
	q := r.URL.Query().Get("q")
	page := queryInt(r, "page", 1)

	rows, pg, repoOptions := computePulls(snap, repo, state, q, page)

	base := "/pulls"
	pg.PrevHref = queryHref(base, "repo", repo, "state", state, "q", q, "page", strconv.Itoa(pg.Page-1))
	pg.NextHref = queryHref(base, "repo", repo, "state", state, "q", q, "page", strconv.Itoa(pg.Page+1))

	s.render(w, r, "pulls", struct {
		baseData
		Rows        []Pull
		Pager       pager
		Repo        string
		State       string
		Query       string
		RepoOptions []RepoInfo
	}{baseData: b, Rows: rows, Pager: pg, Repo: repo, State: state, Query: q, RepoOptions: repoOptions})
}

// handleInsights renders shipping velocity and CI charts with configurable
// repo / period / granularity filters.
func (s *Server) handleInsights(w http.ResponseWriter, r *http.Request) {
	snap := s.store.Snapshot()
	b := s.base("insights", snap)

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

	ins := computeInsights(snap, repo, period, gran)
	ship, ci, workflows := ins.Ship, ins.CI, ins.Workflows

	mergedLabels := make([]string, len(ship))
	mergedVals := make([]float64, len(ship))
	linesVals := make([]float64, len(ship))
	cycleVals := make([]float64, len(ship))
	for i, bkt := range ship {
		mergedLabels[i] = bkt.Label
		mergedVals[i] = float64(bkt.Merged)
		linesVals[i] = float64(bkt.Additions + bkt.Deletions)
		cycleVals[i] = bkt.CycleMedianDays
	}

	ciLabels := make([]string, len(ci))
	rateVals := make([]float64, len(ci))
	durVals := make([]float64, len(ci))
	for i, bkt := range ci {
		ciLabels[i] = bkt.Label
		rateVals[i] = bkt.SuccessRate
		durVals[i] = bkt.MedianDurationMin
	}

	s.render(w, r, "insights", struct {
		baseData
		Repo             string
		Period           string
		Gran             string
		RepoOptions      []RepoInfo
		MergedChart      template.HTML
		LinesChart       template.HTML
		CycleChart       template.HTML
		HasShip          bool
		RunsChart        template.HTML
		SuccessRateChart template.HTML
		DurationChart    template.HTML
		HasCI            bool
		CI               insightsStats
		Workflows        []WorkflowStat
	}{
		baseData:         b,
		Repo:             repo,
		Period:           period,
		Gran:             string(gran),
		RepoOptions:      ins.RepoOptions,
		MergedChart:      lineChartSVG(mergedLabels, mergedVals, "", "accent", "Pull requests merged over time", 0),
		LinesChart:       lineChartSVG(mergedLabels, linesVals, "", "add", "Lines merged over time", 0),
		CycleChart:       lineChartSVG(mergedLabels, cycleVals, "d", "other", "Median cycle time over time", 0),
		HasShip:          len(ship) > 0,
		RunsChart:        ciRunsBarsSVG(ci),
		SuccessRateChart: lineChartSVG(ciLabels, rateVals, "%", "add", "CI success rate over time", 100),
		DurationChart:    lineChartSVG(ciLabels, durVals, "min", "accent", "Median CI duration over time", 0),
		HasCI:            len(ci) > 0,
		CI:               ins.CIStats,
		Workflows:        workflows,
	})
}

// ---- API ----

func (s *Server) handleSync(w http.ResponseWriter, r *http.Request) {
	s.syncer.Trigger()
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	fmt.Fprint(w, `{"started":true}`)
}

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	snap := s.store.Snapshot()
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	fmt.Fprintf(w, `{"org":%q,"syncing":%t,"syncedAt":%q,"lastError":%q,"repoErrors":%d,"pulls":%d,"runs":%d,"repos":%d,"rateLimit":%s}`,
		snap.Org, snap.Syncing, isoOrEmpty(snap.SyncedAt), snap.LastError, len(snap.RepoErrs),
		len(snap.Pulls), len(snap.Runs), len(snap.Repos), rateLimitJSON(snap.RateLimit))
}

func isoOrEmpty(t *time.Time) string {
	if t == nil {
		return ""
	}
	return t.UTC().Format(time.RFC3339)
}

func rateLimitJSON(rl *RateLimitInfo) string {
	if rl == nil {
		return "null"
	}
	return fmt.Sprintf(`{"remaining":%d,"limit":%d}`, rl.Remaining, rl.Limit)
}

// ---- helpers ----

// SortPullsByMerged orders merged pulls by merge time, newest first.
func SortPullsByMerged(pulls []Pull) {
	sort.Slice(pulls, func(i, j int) bool {
		a, b := pulls[i].MergedAt, pulls[j].MergedAt
		if a == nil || b == nil {
			return a != nil
		}
		return a.After(*b)
	})
}

type pager struct {
	Total, Page, Pages, PerPage int
	From, To                    int
	HasPrev, HasNext            bool
	PrevHref, NextHref          string `json:"-"`
}

// MarshalJSON renders the pager with JSON field names for the API.
func (p pager) MarshalJSON() ([]byte, error) {
	return json.Marshal(struct {
		Total   int  `json:"total"`
		Page    int  `json:"page"`
		Pages   int  `json:"pages"`
		PerPage int  `json:"perPage"`
		From    int  `json:"from"`
		To      int  `json:"to"`
		HasPrev bool `json:"hasPrev"`
		HasNext bool `json:"hasNext"`
	}{
		Total: p.Total, Page: p.Page, Pages: p.Pages, PerPage: p.PerPage,
		From: p.From, To: p.To, HasPrev: p.HasPrev, HasNext: p.HasNext,
	})
}

func paginate(total, page, perPage int) pager {
	pages := (total + perPage - 1) / perPage
	if pages < 1 {
		pages = 1
	}
	if page < 1 {
		page = 1
	}
	if page > pages {
		page = pages
	}
	from := (page - 1) * perPage
	to := from + perPage
	if to > total {
		to = total
	}
	return pager{
		Total: total, Page: page, Pages: pages, PerPage: perPage,
		From: from, To: to,
		HasPrev: page > 1, HasNext: page < pages,
		PrevHref: "", NextHref: "",
	}
}

func queryInt(r *http.Request, key string, def int) int {
	v, err := strconv.Atoi(r.URL.Query().Get(key))
	if err != nil {
		return def
	}
	return v
}

func queryHref(base string, kv ...string) string {
	u := url.Values{}
	for i := 0; i+1 < len(kv); i += 2 {
		if kv[i+1] != "" {
			u.Set(kv[i], kv[i+1])
		}
	}
	if len(u) == 0 {
		return base
	}
	return base + "?" + u.Encode()
}

// comma renders an integer with thousands separators.
func comma(n int) string {
	neg := n < 0
	if neg {
		n = -n
	}
	s := strconv.Itoa(n)
	var b strings.Builder
	for i, c := range s {
		if i > 0 && (len(s)-i)%3 == 0 {
			b.WriteByte(',')
		}
		b.WriteRune(c)
	}
	if neg {
		return "-" + b.String()
	}
	return b.String()
}

// titleCase lowercases and capitalises the first letter ("MERGED" → "Merged").
func titleCase(s string) string {
	s = strings.ToLower(s)
	if s == "" {
		return s
	}
	return strings.ToUpper(s[:1]) + s[1:]
}

var funcMap = template.FuncMap{
	"comma":          comma,
	"compact":        compact,
	"icon":           icon,
	"date":           func(t *time.Time) string { return timeOrEmpty(t, "Jan 2, 2006") },
	"dateTime":       func(t *time.Time) string { return timeOrEmpty(t, "Jan 2, 2006 15:04") },
	"rfc3339":        func(t *time.Time) string { return isoOrEmpty(t) },
	"metricLabel":    func(m Metric) string { return m.Label() },
	"stateLabel":     func(s string) string { return titleCase(s) },
	"stateClass":     stateClass,
	"stateIcon":      stateIcon,
	"stateTime":      stateTime,
	"stateTimestamp": stateTimestamp,
	"add":            func(a, b int) int { return a + b },
	"sub":            func(a, b int) int { return a - b },
	"avatarURL": func(login string) string {
		return "https://github.com/" + login + ".png?size=40"
	},
	"authorURL": func(login string) string {
		return "https://github.com/" + login
	},
	"prURL": func(p Pull) string { return p.URL },
}

// stateClass maps a pull to its state CSS class.
func stateClass(p Pull) string {
	if p.IsDraft {
		return "draft"
	}
	switch p.State {
	case "MERGED":
		return "merged"
	case "OPEN":
		return "open"
	}
	return "closed"
}

// stateIcon renders the state icon for a pull.
func stateIcon(p Pull) template.HTML {
	if p.IsDraft {
		return icon("draft")
	}
	switch p.State {
	case "MERGED":
		return icon("merged")
	case "OPEN":
		return icon("open")
	}
	return icon("closed")
}

// stateTime returns the pull's relevant date (merged/opened/closed).
func stateTime(p Pull) string {
	switch p.State {
	case "MERGED":
		return timeOrEmpty(p.MergedAt, "Jan 2, 2006")
	case "OPEN":
		return timeOrEmpty(&p.CreatedAt, "Jan 2, 2006")
	}
	return timeOrEmpty(p.ClosedAt, "Jan 2, 2006")
}

// stateTimestamp is stateTime in RFC3339 for the relative-time JS.
func stateTimestamp(p Pull) string {
	switch p.State {
	case "MERGED":
		return isoOrEmpty(p.MergedAt)
	case "OPEN":
		return p.CreatedAt.UTC().Format(time.RFC3339)
	}
	return isoOrEmpty(p.ClosedAt)
}

func timeOrEmpty(t *time.Time, layout string) string {
	if t == nil {
		return ""
	}
	return t.UTC().Format(layout)
}

// icon renders an inline octicon-style SVG (16px, stroke-based, currentColor).
func icon(name string) template.HTML {
	const attrs = `class="octicon" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"`
	switch name {
	case "merged":
		return template.HTML(`<svg ` + attrs + `><circle cx="8" cy="8" r="6.5"/><path d="M5.4 8.4l1.7 1.7 3.4-3.9"/></svg>`)
	case "open":
		return template.HTML(`<svg ` + attrs + `><circle cx="8" cy="8" r="6.5"/><circle cx="8" cy="8" r="2.2" fill="currentColor" stroke="none"/></svg>`)
	case "closed":
		return template.HTML(`<svg ` + attrs + `><circle cx="8" cy="8" r="6.5"/><path d="M6.4 6.4l3.2 3.2m0-3.2l-3.2 3.2"/></svg>`)
	case "draft":
		return template.HTML(`<svg ` + attrs + `><circle cx="8" cy="8" r="6.5"/><circle cx="8" cy="8" r="1.6" fill="currentColor" stroke="none"/></svg>`)
	case "sync":
		return template.HTML(`<svg ` + attrs + `><path d="M13.5 8a5.5 5.5 0 0 1-9.4 3.9M2.5 8A5.5 5.5 0 0 1 11.9 4.1"/><path d="M4.1 11.9l-1.6.3.6-1.7M11.9 4.1l1.6-.3-.6 1.7"/></svg>`)
	case "sun":
		return template.HTML(`<svg ` + attrs + `><circle cx="8" cy="8" r="3.2"/><path d="M8 1.5v1.4M8 13.1v1.4M1.5 8h1.4M13.1 8h1.4M3.5 3.5l1 1M11.5 11.5l1 1M12.5 3.5l-1 1M4.5 11.5l-1 1"/></svg>`)
	case "moon":
		return template.HTML(`<svg ` + attrs + `><path d="M14.2 10.1A5.7 5.7 0 0 1 5.9 1.8 6 6 0 1 0 14.2 10.1Z"/></svg>`)
	case "lock":
		return template.HTML(`<svg ` + attrs + `><rect x="5" y="7" width="6" height="4.6" rx="1"/><path d="M6.4 7V5.4a1.6 1.6 0 0 1 3.2 0V7"/></svg>`)
	case "repo":
		return template.HTML(`<svg ` + attrs + `><rect x="2.5" y="1.5" width="9.4" height="12.4" rx="1.5"/><path d="M5 5h5M5 8h5"/></svg>`)
	case "search":
		return template.HTML(`<svg ` + attrs + `><circle cx="6.6" cy="6.6" r="4.2"/><path d="M10 10l3.6 3.6"/></svg>`)
	case "check":
		return template.HTML(`<svg ` + attrs + `><path d="M3 8.2l3.2 3.2L13 4.6"/></svg>`)
	}
	return template.HTML("")
}
