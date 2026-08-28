package main

// Entire integration: agent checkpoint analytics from the entire.io cloud
// (us.auth.entire.io). The installed `entire` CLI is the client — it plumbs
// auth and dials the right cell host, so the backend only shells out to
//
//	entire api --to cell /api/v1/me/activity?timezone=UTC
//	entire api --to cell /api/v1/me/recap
//
// and caches the JSON into a snapshot file (data/entire.json), following the
// same pattern as the GitHub state store. No local checkpoint parsing.

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// ---- entire.io cell API payloads (subset of what the page uses) ----

type entireStats struct {
	Tasks           int     `json:"tasks"`
	Orchestration   int     `json:"orchestration"`
	Iteration       float64 `json:"iteration"`
	Throughput      float64 `json:"throughput"`
	ContinuityHours float64 `json:"continuity_hours"`
	Streak          int     `json:"streak"`
	CurrentStreak   int     `json:"current_streak"`
	LifetimeStreak  int     `json:"lifetime_streak"`
	LifetimeCurrent int     `json:"lifetime_current_streak"`
}

type entireDaily struct {
	Date   string         `json:"date"`
	Agents map[string]int `json:"agents"`
}

type entireHourly struct {
	Date  string `json:"date"`
	Hour  int    `json:"hour"`
	Agent string `json:"agent"`
	Value int    `json:"value"`
}

type entireRepoAgg struct {
	Repo   string         `json:"repo"`
	Total  int            `json:"total"`
	Agents map[string]int `json:"agents"`
}

type entireActivity struct {
	Stats     entireStats      `json:"stats"`
	Daily     []entireDaily    `json:"daily_contributions"`
	Hourly    []entireHourly   `json:"hourly_contributions"`
	Repos     []entireRepoAgg  `json:"repos"`
}

type entireSkill struct {
	Skill string `json:"skill"`
	Count int    `json:"count"`
}

type entireMcpServer struct {
	Name  string `json:"name"`
	Count int    `json:"count"`
}

type entireToolMix struct {
	Shell   int `json:"shell"`
	FileOps int `json:"fileOps"`
	Search  int `json:"search"`
	MCP     int `json:"mcp"`
	Agent   int `json:"agent"`
	Other   int `json:"other"`
}

type entireAgentMe struct {
	Sessions         int               `json:"sessions"`
	Checkpoints      int               `json:"checkpoints"`
	Tokens           int64             `json:"tokens"`
	TranscriptTokens int64             `json:"transcriptTokens"`
	FilesChanged     int               `json:"filesChanged"`
	Labels           []string          `json:"labels"`
	Skills           []entireSkill     `json:"skills"`
	McpServers       []entireMcpServer `json:"mcpServers"`
	ToolMix          *entireToolMix    `json:"toolMix"`
}

type entireAgent struct {
	AgentID    string       `json:"agentId"`
	AgentLabel string       `json:"agentLabel"`
	Me         entireAgentMe `json:"me"`
}

type entireRecap struct {
	Timeframe string                `json:"timeframe"`
	Repos     []string              `json:"repos"`
	Since     string                `json:"since"`
	Until     string                `json:"until"`
	Summary   entireRecapSummary    `json:"summary"`
	Agents    map[string]entireAgent `json:"agents"`
	Daily     []entireRecapDay      `json:"daily"`
}

type entireRecapSummary struct {
	Me struct {
		Sessions    int   `json:"sessions"`
		Checkpoints int   `json:"checkpoints"`
		Tokens      int64 `json:"tokens"`
	} `json:"me"`
	RepoCount int `json:"repoCount"`
	ActiveDays int `json:"activeDays"`
}

type entireRecapDay struct {
	Date  string `json:"date"`
	Count int    `json:"count"`
}

// entireUser is the account identity surfaced by --to core /api/v1/me.
type entireUser struct {
	Handle           string `json:"handle"`
	AccountID        string `json:"accountId"`
	HomeJurisdiction string `json:"homeJurisdiction"`
	AvatarURL        string `json:"avatarUrl"`
	DisplayName      string `json:"displayName,omitempty"`
	Email            string `json:"email,omitempty"`
	Company          string `json:"company,omitempty"`
	Bio              string `json:"bio,omitempty"`
}

// entireUserResponse is the GetMeOutputBody payload (we only need a subset).
type entireUserResponse struct {
	Global struct {
		AccountID        string `json:"accountId"`
		Handle           string `json:"handle"`
		HomeJurisdiction string `json:"homeJurisdiction"`
		AvatarURL        string `json:"avatarUrl"`
	} `json:"global"`
	Regional struct {
		DisplayName string `json:"displayName"`
		Email       string `json:"email"`
		Company     string `json:"company"`
		Bio         string `json:"bio"`
	} `json:"regional"`
}

// entireSnapshot is the persisted cache of the last successful fetch.
type entireSnapshot struct {
	FetchedAt *time.Time      `json:"fetchedAt,omitempty"`
	LastError string          `json:"lastError,omitempty"`
	User      *entireUser     `json:"user,omitempty"`
	Activity  *entireActivity `json:"activity,omitempty"`
	Recap     *entireRecap    `json:"recap,omitempty"`
}

// EntireClient fetches and caches the entire.io analytics. Lock-free by
// convention: snapshots are replaced wholesale.
type EntireClient struct {
	bin    string // entire binary (ENTIRE_BIN, default "entire")
	home   string // optional HOME override for the CLI's config/token
	mu     sync.RWMutex
	snap   entireSnapshot
	path   string
	busy   bool
}

func NewEntireClient(dataDir string) *EntireClient {
	bin := envOr("ENTIRE_BIN", "entire")
	home := os.Getenv("ENTIRE_HOME")
	if home == "" {
		// Convention: a pre-created dir inside the data dir isolates the
		// service's entire login from other users (and keeps the systemd
		// ProtectHome hardening intact).
		candidate := filepath.Join(dataDir, "entire-home")
		if st, err := os.Stat(candidate); err == nil && st.IsDir() {
			home = candidate
		}
	}
	return &EntireClient{bin: bin, home: home, path: filepath.Join(dataDir, "entire.json")}
}

// Load restores a previously persisted snapshot. Missing file is not an error.
func (e *EntireClient) Load() error {
	raw, err := os.ReadFile(e.path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("read entire snapshot: %w", err)
	}
	var snap entireSnapshot
	if err := json.Unmarshal(raw, &snap); err != nil {
		return fmt.Errorf("parse entire snapshot: %w", err)
	}
	e.mu.Lock()
	e.snap = snap
	e.mu.Unlock()
	return nil
}

// Save persists the snapshot atomically (temp file + rename).
func (e *EntireClient) Save() error {
	e.mu.RLock()
	raw, err := json.Marshal(e.snap)
	e.mu.RUnlock()
	if err != nil {
		return fmt.Errorf("marshal entire snapshot: %w", err)
	}
	tmp, err := os.CreateTemp(filepath.Dir(e.path), "entire-*.json.tmp")
	if err != nil {
		return fmt.Errorf("create temp entire snapshot: %w", err)
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	if _, err := tmp.Write(raw); err != nil {
		tmp.Close()
		return fmt.Errorf("write temp entire snapshot: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("close temp entire snapshot: %w", err)
	}
	if err := os.Chmod(tmpName, 0o644); err != nil {
		return fmt.Errorf("chmod temp entire snapshot: %w", err)
	}
	if err := os.Rename(tmpName, e.path); err != nil {
		return fmt.Errorf("rename entire snapshot into place: %w", err)
	}
	return nil
}

// Snapshot returns a copy of the cached analytics.
func (e *EntireClient) Snapshot() entireSnapshot {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.snap
}

// Stale reports whether the cache is older than the given duration.
func (e *EntireClient) Stale(olderThan time.Duration) bool {
	e.mu.RLock()
	defer e.mu.RUnlock()
	if e.snap.FetchedAt == nil {
		return true
	}
	return time.Since(*e.snap.FetchedAt) > olderThan
}

// Run refreshes on start when stale and then on the given interval. It is
// self-healing: a failed sync schedules the next attempt after a short
// backoff instead of waiting for the full interval.
func (e *EntireClient) Run(ctx context.Context, interval time.Duration) {
	if e.Stale(interval) {
		if err := e.syncNow(); err != nil {
			slog.Warn("entire initial sync failed, will retry", "err", err)
		}
	}
	next := interval
	timer := time.NewTimer(next)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
			if err := e.syncNow(); err != nil {
				slog.Warn("entire sync failed, retrying in 1m", "err", err)
				next = time.Minute
			} else {
				next = interval
			}
			timer.Reset(next)
		}
	}
}

// Trigger kicks off a background refresh (no-op while one is in flight).
func (e *EntireClient) Trigger() {
	go func() {
		if err := e.syncNow(); err != nil {
			slog.Warn("entire sync failed", "err", err)
		}
	}()
}

// syncNow performs the fetch with retries, guarded against concurrent runs.
func (e *EntireClient) syncNow() error {
	e.mu.Lock()
	if e.busy {
		e.mu.Unlock()
		return nil // already in progress; nothing to do
	}
	e.busy = true
	e.mu.Unlock()
	defer func() {
		e.mu.Lock()
		e.busy = false
		e.mu.Unlock()
	}()

	var lastErr error
	for attempt := 0; attempt < 3; attempt++ {
		if attempt > 0 {
			time.Sleep(3 * time.Second)
		}
		if err := e.fetch(); err != nil {
			lastErr = err
			slog.Warn("entire sync attempt failed", "attempt", attempt+1, "err", err)
			continue
		}
		return nil
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("entire sync failed")
	}
	e.setError(lastErr)
	return lastErr
}

// fetch pulls all three payloads and commits the snapshot on success.
func (e *EntireClient) fetch() error {
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()

	actRaw, err := e.api(ctx, "--to", "cell", "/api/v1/me/activity?timezone=UTC")
	if err == nil {
		err = entireErrBody(actRaw)
	}
	var act entireActivity
	if err == nil {
		if uerr := json.Unmarshal(actRaw, &act); uerr != nil {
			err = fmt.Errorf("parse activity payload: %w", uerr)
		}
	}

	recRaw, errRec := e.api(ctx, "--to", "cell", "/api/v1/me/recap")
	if errRec == nil {
		errRec = entireErrBody(recRaw)
	}
	var rec entireRecap
	if errRec == nil {
		if uerr := json.Unmarshal(recRaw, &rec); uerr != nil {
			errRec = fmt.Errorf("parse recap payload: %w", uerr)
		}
	}

	meRaw, errMe := e.api(ctx, "--to", "core", "/api/v1/me")
	if errMe == nil {
		errMe = entireErrBody(meRaw)
	}
	var user *entireUser
	if errMe == nil {
		var ur entireUserResponse
		if uerr := json.Unmarshal(meRaw, &ur); uerr != nil {
			errMe = fmt.Errorf("parse user payload: %w", uerr)
		} else {
			user = &entireUser{
				Handle:           ur.Global.Handle,
				AccountID:        ur.Global.AccountID,
				HomeJurisdiction: ur.Global.HomeJurisdiction,
				AvatarURL:        ur.Global.AvatarURL,
				DisplayName:      ur.Regional.DisplayName,
				Email:            ur.Regional.Email,
				Company:          ur.Regional.Company,
				Bio:              ur.Regional.Bio,
			}
		}
	}

	if err != nil {
		return fmt.Errorf("activity: %w", err)
	}
	if errRec != nil {
		return fmt.Errorf("recap: %w", errRec)
	}
	if errMe != nil {
		return fmt.Errorf("user: %w", errMe)
	}

	snap := entireSnapshot{
		Activity: &act,
		Recap:    &rec,
		User:     user,
	}
	now := time.Now().UTC()
	snap.FetchedAt = &now

	// Keep the last good data if a payload was missing.
	prev := e.Snapshot()
	if snap.Activity == nil {
		snap.Activity = prev.Activity
	}
	if snap.Recap == nil {
		snap.Recap = prev.Recap
	}
	if snap.User == nil {
		snap.User = prev.User
	}
	if snap.FetchedAt == nil && prev.FetchedAt != nil {
		snap.FetchedAt = prev.FetchedAt
	}

	e.mu.Lock()
	e.snap = snap
	e.mu.Unlock()
	if err := e.Save(); err != nil {
		slog.Warn("entire snapshot save failed", "err", err)
	}
	slog.Info("entire synced", "user", user.Handle)
	return nil
}

// setError records the failure in the snapshot (data stays cached).
func (e *EntireClient) setError(err error) {
	snap := e.Snapshot()
	snap.LastError = err.Error()
	e.mu.Lock()
	e.snap = snap
	e.mu.Unlock()
	if serr := e.Save(); serr != nil {
		slog.Warn("entire snapshot save failed", "err", serr)
	}
}

// entireErrBody detects the cell API's {"error": "..."} payloads, which the
// CLI can print with a zero exit code.
func entireErrBody(raw []byte) error {
	var body struct {
		Error string `json:"error"`
	}
	if err := json.Unmarshal(raw, &body); err == nil && body.Error != "" {
		return fmt.Errorf("entire api: %s", body.Error)
	}
	return nil
}

// api runs `entire api <args...>` and returns the raw JSON payload.
func (e *EntireClient) api(ctx context.Context, args ...string) ([]byte, error) {
	full := append([]string{"api"}, args...)
	cmd := exec.CommandContext(ctx, e.bin, full...)
	if e.home != "" {
		cmd.Env = append(os.Environ(), "HOME="+e.home)
	}
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = err.Error()
		}
		return nil, fmt.Errorf("entire %s: %s", strings.Join(full, " "), msg)
	}
	return stdout.Bytes(), nil
}
