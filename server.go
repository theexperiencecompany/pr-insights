package main

import (
	"bytes"
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"net/http"
	"sort"
	"strconv"
	"time"
)

const perPage = 25

// Server wires routes to the store and syncer and serves the embedded
// frontend (a Vite/React SPA) with an index.html fallback.
type Server struct {
	store  *State
	syncer *Syncer
	web    fs.FS
}

func NewServer(store *State, syncer *Syncer, webFS embed.FS) (*Server, error) {
	web, err := fs.Sub(webFS, "frontend/dist")
	if err != nil {
		return nil, fmt.Errorf("embedded frontend missing (run pnpm --dir frontend build first): %w", err)
	}
	return &Server{store: store, syncer: syncer, web: web}, nil
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/status", s.handleStatus)
	mux.HandleFunc("POST /api/sync", s.handleSync)
	mux.HandleFunc("GET /api/overview", s.handleAPIOverview)
	mux.HandleFunc("GET /api/leaderboards", s.handleAPILeaderboards)
	mux.HandleFunc("GET /api/shame", s.handleAPIShame)
	mux.HandleFunc("GET /api/contributors", s.handleAPIContributors)
	mux.HandleFunc("GET /api/contributor", s.handleAPIContributor)
	mux.HandleFunc("GET /api/insights", s.handleAPIInsights)
	mux.HandleFunc("GET /api/pulls", s.handleAPIPulls)
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		w.Write([]byte("ok\n"))
	})
	mux.HandleFunc("/", s.handleSPA)
	return mux
}

// handleSPA serves the built frontend from the embedded FS, falling back to
// index.html for client-side routes.
func (s *Server) handleSPA(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
	if path == "/" {
		path = "/index.html"
	}
	content, err := fs.ReadFile(s.web, path[1:])
	if err != nil {
		content, err = fs.ReadFile(s.web, "index.html")
		if err != nil {
			http.Error(w, "frontend not built", http.StatusNotFound)
			return
		}
	}
	w.Header().Set("Cache-Control", "no-store")
	http.ServeContent(w, r, path, time.Time{}, bytes.NewReader(content))
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
	fmt.Fprintf(w, `{"org":%q,"repo":%q,"syncing":%t,"syncedAt":%q,"lastError":%q,"repoErrors":%d,"pulls":%d,"runs":%d,"repos":%d,"rateLimit":%s}`,
		snap.Org, s.syncer.repo, snap.Syncing, isoOrEmpty(snap.SyncedAt), snap.LastError, len(snap.RepoErrs),
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
	}
}

func queryInt(r *http.Request, key string, def int) int {
	v, err := strconv.Atoi(r.URL.Query().Get(key))
	if err != nil {
		return def
	}
	return v
}
