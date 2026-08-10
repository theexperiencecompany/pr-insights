package main

import (
	"context"
	"embed"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"time"
)

//go:embed all:frontend/dist
var webFS embed.FS

type Config struct {
	Org          string
	Addr         string
	DataDir      string
	SyncInterval time.Duration
}

func main() {
	token := os.Getenv("GITHUB_TOKEN")
	if token == "" {
		slog.Error("GITHUB_TOKEN environment variable is required")
		os.Exit(1)
	}

	cfg := Config{
		Org:          envOr("GITHUB_ORG", "theexperiencecompany"),
		Addr:         envOr("PR_INSIGHTS_ADDR", "127.0.0.1:8787"),
		DataDir:      envOr("PR_INSIGHTS_DATA_DIR", "./data"),
		SyncInterval: envDurOr("PR_INSIGHTS_SYNC_INTERVAL", 6*time.Hour),
	}

	store, err := NewStore(cfg.DataDir)
	if err != nil {
		slog.Error("failed to initialise store", "err", err)
		os.Exit(1)
	}
	if err := store.Load(); err != nil {
		slog.Error("failed to load state snapshot", "err", err)
		os.Exit(1)
	}
	// Guard against clock skew: a stored timestamp in the future would
	// suppress the next sync indefinitely.
	if snap := store.Snapshot(); snap.SyncedAt != nil && time.Since(*snap.SyncedAt) < 0 {
		slog.Warn("stored sync timestamp is in the future; ignoring", "syncedAt", snap.SyncedAt)
		store.clearSyncedAt()
	}

	syncer := NewSyncer(cfg.Org, token, store)

	srv, err := NewServer(store, syncer, webFS)
	if err != nil {
		slog.Error("failed to initialise server", "err", err)
		os.Exit(1)
	}

	httpSrv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go syncer.Run(ctx, cfg.SyncInterval)

	slog.Info("pr-insights listening", "addr", cfg.Addr, "org", cfg.Org, "data_dir", cfg.DataDir)
	if err := httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		slog.Error("server failed", "err", err)
		os.Exit(1)
	}
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envDurOr(key string, fallback time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		if d, err := time.ParseDuration(v); err == nil && d > 0 {
			return d
		}
		slog.Warn("invalid duration in env, using default", "key", key, "value", v, "fallback", fallback)
	}
	return fallback
}
