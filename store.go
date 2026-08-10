package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// RepoInfo is the minimal repository metadata captured from the org.
type RepoInfo struct {
	Name          string `json:"name"`
	Private       bool   `json:"private"`
	Archived      bool   `json:"archived"`
	Description   string `json:"description"`
	DefaultBranch string `json:"defaultBranch"`
}

// Pull is one pull request with all metrics needed for the leaderboards.
// State is one of OPEN, CLOSED, MERGED (as returned by the GitHub API).
type Pull struct {
	Number       int        `json:"number"`
	Title        string     `json:"title"`
	State        string     `json:"state"`
	IsDraft      bool       `json:"isDraft"`
	Repo         string     `json:"repo"`
	Author       string     `json:"author"`
	CreatedAt    time.Time  `json:"createdAt"`
	UpdatedAt    time.Time  `json:"updatedAt"`
	MergedAt     *time.Time `json:"mergedAt,omitempty"`
	ClosedAt     *time.Time `json:"closedAt,omitempty"`
	Additions    int        `json:"additions"`
	Deletions    int        `json:"deletions"`
	ChangedFiles int        `json:"changedFiles"`
	Commits      int        `json:"commits"`
	BaseRef      string     `json:"baseRef"`
	HeadRef      string     `json:"headRef"`
	URL          string     `json:"url"`
	IsBot        bool       `json:"isBot"`
}

// Run is one GitHub Actions workflow run.
type Run struct {
	ID           int64     `json:"id"`
	Repo         string    `json:"repo"`
	Workflow     string    `json:"workflow"`
	Branch       string    `json:"branch"`
	Event        string    `json:"event"`
	Conclusion   string    `json:"conclusion"`
	Status       string    `json:"status"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
	RunStartedAt time.Time `json:"runStartedAt"`
	DurationSec  int       `json:"durationSec"`
}

// RateLimitInfo is the last known GitHub API rate-limit state.
type RateLimitInfo struct {
	Remaining int `json:"remaining"`
	Limit     int `json:"limit"`
}

// RepoError records a per-repo sync failure (other repos still succeeded).
// Phase is "pulls" or "ci"; the previous data for that repo/phase is kept.
type RepoError struct {
	Repo  string `json:"repo"`
	Phase string `json:"phase"`
	Error string `json:"error"`
}

// Data is the whole dataset: repos, pulls and sync metadata. It is lock-free
// by design; Pulls/Repos are replaced wholesale on every sync and never
// mutated in place, so readers can iterate a copied Data safely.
//
// Syncing is intentionally not persisted: it describes the runtime state of
// the current process, and Save() runs at the end of a sync while the sync is
// still marked in progress. Persisting it would make every restart look like
// a stuck sync.
type Data struct {
	Org       string         `json:"org"`
	AvatarURL string         `json:"avatarUrl"`
	Repos     []RepoInfo     `json:"repos"`
	Pulls     []Pull         `json:"pulls"`
	Runs      []Run          `json:"runs,omitempty"`
	RepoErrs  []RepoError    `json:"repoErrors,omitempty"`
	SyncedAt  *time.Time     `json:"syncedAt,omitempty"`
	Syncing   bool           `json:"-"`
	LastError string         `json:"lastError,omitempty"`
	RateLimit *RateLimitInfo `json:"rateLimit,omitempty"`
}

// State guards Data with a mutex and persists it to disk.
type State struct {
	mu   sync.RWMutex
	data Data
	path string
}

func NewStore(dataDir string) (*State, error) {
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return nil, fmt.Errorf("create data dir: %w", err)
	}
	return &State{path: filepath.Join(dataDir, "state.json")}, nil
}

// Load restores a previously persisted snapshot. Missing file is not an error.
func (s *State) Load() error {
	raw, err := os.ReadFile(s.path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("read snapshot: %w", err)
	}
	var d Data
	if err := json.Unmarshal(raw, &d); err != nil {
		return fmt.Errorf("parse snapshot: %w", err)
	}
	s.mu.Lock()
	s.data = d
	s.mu.Unlock()
	return nil
}

// Save persists the snapshot atomically (temp file + rename).
func (s *State) Save() error {
	s.mu.RLock()
	raw, err := json.Marshal(s.data)
	s.mu.RUnlock()
	if err != nil {
		return fmt.Errorf("marshal snapshot: %w", err)
	}
	tmp, err := os.CreateTemp(filepath.Dir(s.path), "state-*.json.tmp")
	if err != nil {
		return fmt.Errorf("create temp snapshot: %w", err)
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	if _, err := tmp.Write(raw); err != nil {
		tmp.Close()
		return fmt.Errorf("write temp snapshot: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("close temp snapshot: %w", err)
	}
	if err := os.Chmod(tmpName, 0o644); err != nil {
		return fmt.Errorf("chmod temp snapshot: %w", err)
	}
	if err := os.Rename(tmpName, s.path); err != nil {
		return fmt.Errorf("rename snapshot into place: %w", err)
	}
	return nil
}

// Snapshot returns a copy of the data. Pulls/Repos are shared by reference
// but immutable-by-convention (wholesale replacement only), so this is
// race-free.
func (s *State) Snapshot() Data {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.data
}

// syncResult carries everything a completed sync wants to commit.
type syncResult struct {
	org       string
	avatarURL string
	repos     []RepoInfo
	pulls     []Pull
	runs      []Run
	repoErrs  []RepoError
	rl        *RateLimitInfo
	syncedAt  time.Time
}

// Replace commits a completed sync.
func (s *State) Replace(res syncResult) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.data.Org = res.org
	s.data.AvatarURL = res.avatarURL
	s.data.Repos = res.repos
	s.data.Pulls = res.pulls
	s.data.Runs = res.runs
	s.data.RepoErrs = res.repoErrs
	s.data.SyncedAt = &res.syncedAt
	s.data.LastError = ""
	s.data.RateLimit = res.rl
}

func (s *State) markSyncing(on bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.data.Syncing = on
}

func (s *State) setError(err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.data.LastError = err.Error()
}

func (s *State) clearSyncedAt() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.data.SyncedAt = nil
}

// Stale reports whether the snapshot is older than the given duration.
func (s *State) Stale(olderThan time.Duration) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.data.SyncedAt == nil {
		return true
	}
	return time.Since(*s.data.SyncedAt) > olderThan
}
