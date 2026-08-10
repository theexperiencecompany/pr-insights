package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"sync"
	"time"
)

const (
	apiBase         = "https://api.github.com"
	graphQLURL      = "https://api.github.com/graphql"
	userAgent       = "pr-insights/1.0"
	workers         = 5
	runsPageWorkers = 8
)

const pullsQuery = `
query Pulls($owner: String!, $repo: String!, $cursor: String) {
  repository(owner: $owner, name: $repo) {
    pullRequests(first: 100, after: $cursor, orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes {
        number
        title
        state
        isDraft
        createdAt
        mergedAt
        closedAt
        updatedAt
        additions
        deletions
        changedFiles
        commits { totalCount }
        author { login }
        baseRefName
        headRefName
        url
      }
      pageInfo { hasNextPage endCursor }
    }
  }
  rateLimit { remaining cost }
}`

type graphQLPull struct {
	Number       int        `json:"number"`
	Title        string     `json:"title"`
	State        string     `json:"state"`
	IsDraft      bool       `json:"isDraft"`
	CreatedAt    time.Time  `json:"createdAt"`
	MergedAt     *time.Time `json:"mergedAt"`
	ClosedAt     *time.Time `json:"closedAt"`
	UpdatedAt    time.Time  `json:"updatedAt"`
	Additions    int        `json:"additions"`
	Deletions    int        `json:"deletions"`
	ChangedFiles int        `json:"changedFiles"`
	Commits      struct {
		TotalCount int `json:"totalCount"`
	} `json:"commits"`
	Author      *struct{ Login string } `json:"author"`
	BaseRefName string                  `json:"baseRefName"`
	HeadRefName string                  `json:"headRefName"`
	URL         string                  `json:"url"`
}

type graphQLResponse struct {
	Data struct {
		Repository struct {
			PullRequests struct {
				Nodes    []graphQLPull `json:"nodes"`
				PageInfo struct {
					HasNextPage bool   `json:"hasNextPage"`
					EndCursor   string `json:"endCursor"`
				} `json:"pageInfo"`
			} `json:"pullRequests"`
		} `json:"repository"`
	} `json:"data"`
	Errors []struct {
		Message string `json:"message"`
		Type    string `json:"type"`
	} `json:"errors"`
	Extensions struct {
		RateLimit struct {
			Remaining int `json:"remaining"`
			Cost      int `json:"cost"`
		} `json:"rateLimit"`
	} `json:"extensions"`
}

// Syncer fetches org repos + all pull requests from the GitHub API.
type Syncer struct {
	org    string
	token  string
	store  *State
	client *http.Client
	mu     sync.Mutex
}

func NewSyncer(org, token string, store *State) *Syncer {
	return &Syncer{
		org:   org,
		token: token,
		store: store,
		client: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// Run starts the periodic sync loop. It syncs immediately when the stored
// snapshot is missing or stale, then on every interval.
func (s *Syncer) Run(ctx context.Context, interval time.Duration) {
	if s.store.Stale(interval) {
		s.Trigger()
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.Trigger()
		}
	}
}

// Trigger starts a sync in the background if one is not already running.
func (s *Syncer) Trigger() {
	go s.syncOnce()
}

func (s *Syncer) syncOnce() {
	if !s.mu.TryLock() {
		slog.Info("sync already running, skipping")
		return
	}
	defer s.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()

	s.store.markSyncing(true)
	defer s.store.markSyncing(false)

	repos, avatarURL, rl, err := s.fetchRepos(ctx)
	if err != nil {
		slog.Error("sync failed: fetching org repos", "err", err)
		s.store.setError(err)
		return
	}

	// Previous data per repo is kept when a repo fails this sync, so a
	// transient error never degrades the dashboard (a banner flags it).
	prev := s.store.Snapshot()
	prevPullsByRepo := make(map[string][]Pull, len(prev.Pulls))
	for _, p := range prev.Pulls {
		prevPullsByRepo[p.Repo] = append(prevPullsByRepo[p.Repo], p)
	}
	prevRunsByRepo := make(map[string][]Run, len(prev.Runs))
	lastRunByRepo := make(map[string]*time.Time)
	for i := range prev.Runs {
		r := &prev.Runs[i]
		prevRunsByRepo[r.Repo] = append(prevRunsByRepo[r.Repo], *r)
		if lastRunByRepo[r.Repo] == nil || r.CreatedAt.After(*lastRunByRepo[r.Repo]) {
			t := r.CreatedAt
			lastRunByRepo[r.Repo] = &t
		}
	}

	pullsByRepo := make([][]Pull, len(repos))
	runsByRepo := make([][]Run, len(repos))
	repoErrs := make([]RepoError, 0)
	var rlMu sync.Mutex

	var wg sync.WaitGroup
	jobCh := make(chan int)
	for range workers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := range jobCh {
				repo := repos[i]

				pulls, perr := s.fetchRepoPulls(ctx, repo.Name)
				if perr != nil {
					pulls = prevPullsByRepo[repo.Name]
					rlMu.Lock()
					repoErrs = append(repoErrs, RepoError{Repo: repo.Name, Phase: "pulls", Error: perr.Error()})
					rlMu.Unlock()
					slog.Warn("sync: pulls fetch failed, keeping previous data", "repo", repo.Name, "err", perr, "kept", len(pulls))
				}
				pullsByRepo[i] = pulls

				runs, rerr := s.fetchRepoRuns(ctx, repo.Name, lastRunByRepo[repo.Name])
				if rerr != nil {
					runs = prevRunsByRepo[repo.Name]
					rlMu.Lock()
					repoErrs = append(repoErrs, RepoError{Repo: repo.Name, Phase: "ci", Error: rerr.Error()})
					rlMu.Unlock()
					slog.Warn("sync: runs fetch failed, keeping previous data", "repo", repo.Name, "err", rerr, "kept", len(runs))
				} else if lastRunByRepo[repo.Name] != nil {
					// Incremental fetch returned only new runs; merge them
					// with the previous history (deduped by run ID).
					seen := make(map[int64]bool, len(prevRunsByRepo[repo.Name])+len(runs))
					merged := make([]Run, 0, len(prevRunsByRepo[repo.Name])+len(runs))
					for _, r := range prevRunsByRepo[repo.Name] {
						seen[r.ID] = true
						merged = append(merged, r)
					}
					for _, r := range runs {
						if !seen[r.ID] {
							seen[r.ID] = true
							merged = append(merged, r)
						}
					}
					runs = merged
				}
				runsByRepo[i] = runs
			}
		}()
	}
dispatch:
	for i := range repos {
		select {
		case jobCh <- i:
		case <-ctx.Done():
			break dispatch
		}
	}
	close(jobCh)
	wg.Wait()

	if ctx.Err() != nil {
		err := ctx.Err()
		slog.Error("sync aborted", "err", err)
		s.store.setError(err)
		return
	}

	pulls := make([]Pull, 0)
	for _, batch := range pullsByRepo {
		pulls = append(pulls, batch...)
	}
	runs := make([]Run, 0)
	for _, batch := range runsByRepo {
		runs = append(runs, batch...)
	}
	slog.Info("sync complete",
		"repos", len(repos), "pulls", len(pulls), "runs", len(runs), "repo_errors", len(repoErrs),
		"rate_limit_remaining", rl.remaining)
	s.store.Replace(syncResult{
		org: s.org, avatarURL: avatarURL,
		repos: repos, pulls: pulls, runs: runs,
		repoErrs: repoErrs, rl: rl.info(), syncedAt: time.Now().UTC(),
	})
	if err := s.store.Save(); err != nil {
		slog.Error("failed to persist snapshot", "err", err)
	}
}

type rateLimit struct {
	remaining int
	limit     int
}

func (r *rateLimit) info() *RateLimitInfo {
	if r == nil || r.limit == 0 {
		return nil
	}
	return &RateLimitInfo{Remaining: r.remaining, Limit: r.limit}
}

// fetchRepos lists the org's repositories via REST.
func (s *Syncer) fetchRepos(ctx context.Context) ([]RepoInfo, string, *rateLimit, error) {
	type orgRepo struct {
		Name          string `json:"name"`
		Private       bool   `json:"private"`
		Archived      bool   `json:"archived"`
		Description   string `json:"description"`
		DefaultBranch string `json:"defaultBranch"`
	}
	type orgInfo struct {
		AvatarURL string `json:"avatar_url"`
	}

	var org orgInfo
	if err := s.doREST(ctx, "GET", "/orgs/"+s.org, nil, &org, nil); err != nil {
		return nil, "", nil, fmt.Errorf("fetch org: %w", err)
	}

	var rl rateLimit
	all := make([]orgRepo, 0)
	page := 1
	for {
		var batch []orgRepo
		if err := s.doREST(ctx, "GET", fmt.Sprintf("/orgs/%s/repos?per_page=100&page=%d&type=all", s.org, page), nil, &batch, &rl); err != nil {
			return nil, "", nil, fmt.Errorf("fetch repos: %w", err)
		}
		all = append(all, batch...)
		if len(batch) < 100 {
			break
		}
		page++
	}

	repos := make([]RepoInfo, 0, len(all))
	for _, r := range all {
		repos = append(repos, RepoInfo{
			Name:          r.Name,
			Private:       r.Private,
			Archived:      r.Archived,
			Description:   r.Description,
			DefaultBranch: r.DefaultBranch,
		})
	}
	return repos, org.AvatarURL, &rl, nil
}

// fetchRepoPulls walks the GraphQL pagination for a single repository.
func (s *Syncer) fetchRepoPulls(ctx context.Context, repo string) ([]Pull, error) {
	pulls := make([]Pull, 0)
	var cursor *string
	for {
		resp, err := s.doGraphQL(ctx, s.org, repo, cursor)
		if err != nil {
			return nil, err
		}
		if len(resp.Errors) > 0 {
			return nil, fmt.Errorf("graphql errors: %s", resp.Errors[0].Message)
		}
		prs := resp.Data.Repository.PullRequests
		for _, gp := range prs.Nodes {
			pulls = append(pulls, Pull{
				Number:       gp.Number,
				Title:        gp.Title,
				State:        gp.State,
				IsDraft:      gp.IsDraft,
				Repo:         repo,
				Author:       authorLogin(gp.Author),
				CreatedAt:    gp.CreatedAt,
				UpdatedAt:    gp.UpdatedAt,
				MergedAt:     gp.MergedAt,
				ClosedAt:     gp.ClosedAt,
				Additions:    gp.Additions,
				Deletions:    gp.Deletions,
				ChangedFiles: gp.ChangedFiles,
				Commits:      gp.Commits.TotalCount,
				BaseRef:      gp.BaseRefName,
				HeadRef:      gp.HeadRefName,
				URL:          gp.URL,
				IsBot:        IsBot(authorLogin(gp.Author)),
			})
		}
		if !prs.PageInfo.HasNextPage {
			break
		}
		c := prs.PageInfo.EndCursor
		cursor = &c
	}
	return pulls, nil
}

func authorLogin(a *struct{ Login string }) string {
	if a == nil || a.Login == "" {
		return "ghost"
	}
	return a.Login
}

type apiRun struct {
	ID           int64     `json:"id"`
	Name         string    `json:"name"`
	HeadBranch   string    `json:"head_branch"`
	Event        string    `json:"event"`
	Conclusion   string    `json:"conclusion"`
	Status       string    `json:"status"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
	RunStartedAt time.Time `json:"run_started_at"`
}

type apiRunsResponse struct {
	TotalCount   int      `json:"total_count"`
	WorkflowRuns []apiRun `json:"workflow_runs"`
}

// fetchRepoRuns walks the workflow-runs pagination for one repository,
// fetching pages in parallel (REST pages are independent). When since is
// non-nil only runs created after it are fetched (incremental sync);
// otherwise the full history is fetched.
func (s *Syncer) fetchRepoRuns(ctx context.Context, repo string, since *time.Time) ([]Run, error) {
	first, err := s.fetchRunsPage(ctx, repo, 1, since)
	if err != nil {
		return nil, err
	}
	runs := make([]Run, 0, first.totalCount)
	for _, ar := range first.runs {
		runs = append(runs, ar)
	}
	pages := (first.totalCount + 99) / 100
	if pages <= 1 {
		return runs, nil
	}

	remaining := pages - 1
	results := make([][]Run, remaining)
	errs := make([]error, remaining)
	var wg sync.WaitGroup
	pageCh := make(chan int, remaining)
	for range runsPageWorkers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for p := range pageCh {
				pr, perr := s.fetchRunsPage(ctx, repo, p, since)
				results[p-2] = pr.runs
				errs[p-2] = perr
			}
		}()
	}
	for p := 2; p <= pages; p++ {
		pageCh <- p
	}
	close(pageCh)
	wg.Wait()

	for p, perr := range errs {
		if perr != nil {
			return nil, fmt.Errorf("workflow runs page %d: %w", p+2, perr)
		}
	}
	for _, pr := range results {
		runs = append(runs, pr...)
	}
	return runs, nil
}

type runsPage struct {
	runs       []Run
	totalCount int
}

func (s *Syncer) fetchRunsPage(ctx context.Context, repo string, page int, since *time.Time) (runsPage, error) {
	path := fmt.Sprintf("/repos/%s/%s/actions/runs?per_page=100&page=%d", s.org, repo, page)
	if since != nil {
		path += "&created=>=" + since.UTC().Format("2006-01-02T15:04:05Z")
	}
	var resp apiRunsResponse
	if err := s.doREST(ctx, "GET", path, nil, &resp, nil); err != nil {
		return runsPage{}, err
	}
	// Local guard against clock skew: the server-side filter should exclude
	// older runs, but drop any stragglers so the merge stays clean.
	runs := make([]Run, 0, len(resp.WorkflowRuns))
	for _, ar := range resp.WorkflowRuns {
		if since != nil && ar.CreatedAt.Before(*since) {
			continue
		}
		duration := 0
		if ar.Status == "completed" && !ar.RunStartedAt.IsZero() && ar.UpdatedAt.After(ar.RunStartedAt) {
			duration = int(ar.UpdatedAt.Sub(ar.RunStartedAt).Seconds())
		}
		runs = append(runs, Run{
			ID:           ar.ID,
			Repo:         repo,
			Workflow:     ar.Name,
			Branch:       ar.HeadBranch,
			Event:        ar.Event,
			Conclusion:   ar.Conclusion,
			Status:       ar.Status,
			CreatedAt:    ar.CreatedAt,
			UpdatedAt:    ar.UpdatedAt,
			RunStartedAt: ar.RunStartedAt,
			DurationSec:  duration,
		})
	}
	return runsPage{runs: runs, totalCount: resp.TotalCount}, nil
}

func (s *Syncer) doGraphQL(ctx context.Context, owner, repo string, cursor *string) (*graphQLResponse, error) {
	body, err := json.Marshal(map[string]any{
		"query": pullsQuery,
		"variables": map[string]any{
			"owner":  owner,
			"repo":   repo,
			"cursor": cursor,
		},
	})
	if err != nil {
		return nil, err
	}

	var out graphQLResponse
	if err := s.doREST(ctx, "POST", "/graphql", body, &out, nil); err != nil {
		return nil, err
	}
	return &out, nil
}

// doREST issues one authenticated request, with bounded retries on transient
// failures. rateLimit, when non-nil, is filled from the response headers.
func (s *Syncer) doREST(ctx context.Context, method, path string, body []byte, out any, rl *rateLimit) error {
	url := graphQLURL
	if path != "/graphql" {
		url = apiBase + path
	}

	var attemptErr error
	for attempt := 0; attempt < 3; attempt++ {
		if attempt > 0 {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(time.Duration(1<<attempt) * time.Second):
			}
		}

		var reader io.Reader
		if body != nil {
			reader = bytes.NewReader(body)
		}
		req, err := http.NewRequestWithContext(ctx, method, url, reader)
		if err != nil {
			return err
		}
		req.Header.Set("Authorization", "Bearer "+s.token)
		req.Header.Set("Accept", "application/vnd.github+json")
		req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
		req.Header.Set("User-Agent", userAgent)
		if body != nil {
			req.Header.Set("Content-Type", "application/json")
		}

		resp, err := s.client.Do(req)
		if err != nil {
			attemptErr = fmt.Errorf("%s %s: %w", method, path, err)
			continue
		}
		respBody, readErr := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
		resp.Body.Close()
		if readErr != nil {
			attemptErr = fmt.Errorf("%s %s: read body: %w", method, path, readErr)
			continue
		}

		if rl != nil {
			if v := resp.Header.Get("X-RateLimit-Remaining"); v != "" {
				rl.remaining, _ = strconv.Atoi(v)
			}
			if v := resp.Header.Get("X-RateLimit-Limit"); v != "" {
				rl.limit, _ = strconv.Atoi(v)
			}
		}

		switch {
		case resp.StatusCode >= 200 && resp.StatusCode < 300:
			if out != nil {
				if err := json.Unmarshal(respBody, out); err != nil {
					// A truncated body usually means the connection dropped
					// mid-response; retry rather than treating it as final.
					attemptErr = fmt.Errorf("%s %s: decode response: %w", method, path, err)
					continue
				}
			}
			return nil
		case resp.StatusCode == 401:
			return fmt.Errorf("%s %s: unauthorized (check GITHUB_TOKEN)", method, path)
		case resp.StatusCode == 403:
			if rl != nil && rl.remaining <= 0 {
				return fmt.Errorf("%s %s: API rate limit exhausted", method, path)
			}
			return fmt.Errorf("%s %s: forbidden (HTTP %d): %s", method, path, resp.StatusCode, truncate(string(respBody), 200))
		case resp.StatusCode == 404:
			return fmt.Errorf("%s %s: not found", method, path)
		case resp.StatusCode >= 500:
			attemptErr = fmt.Errorf("%s %s: server error (HTTP %d)", method, path, resp.StatusCode)
			continue
		default:
			return fmt.Errorf("%s %s: unexpected status %d: %s", method, path, resp.StatusCode, truncate(string(respBody), 200))
		}
	}
	return attemptErr
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
