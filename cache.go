package main

import (
	"fmt"
	"sync"
	"time"

	"golang.org/x/sync/singleflight"
)

// shippingMemoKey uniquely identifies a ShippingSeries computation.
// It is versioned by the snapshot version so cache entries are automatically
// scoped to a fresh dataset; old versions are naturally abandoned.
type shippingMemoKey struct {
	version uint64
	repo    string
	gran    Granularity
	from    int64 // unix nanos, 0 = zero time
	to      int64
}

var (
	shippingCache sync.Map // map[shippingMemoKey][]ShipBucket
	shippingGroup singleflight.Group
)

// cachedShippingSeries memoizes ShippingSeries per snapshotVersion+gran with singleflight.
// The pulls slice is expected to belong to snapshot version `ver`; the cache key
// includes ver so stale pulls are never returned.
func cachedShippingSeries(pulls []Pull, repo string, g Granularity, from, to time.Time, ver uint64) []ShipBucket {
	if g != GranWeek {
		g = GranMonth
	}
	var fromNanos, toNanos int64
	if !from.IsZero() {
		fromNanos = from.UnixNano()
	}
	if !to.IsZero() {
		toNanos = to.UnixNano()
	}
	key := shippingMemoKey{version: ver, repo: repo, gran: g, from: fromNanos, to: toNanos}

	if v, ok := shippingCache.Load(key); ok {
		if cached, ok := v.([]ShipBucket); ok {
			// Return a copy to preserve immutability of cached slice
			out := make([]ShipBucket, len(cached))
			copy(out, cached)
			return out
		}
	}

	// Use singleflight to coalesce concurrent callers computing the same key.
	flightKey := fmt.Sprintf("%d|%s|%s|%d|%d", ver, repo, g, fromNanos, toNanos)
	val, _, _ := shippingGroup.Do(flightKey, func() (any, error) {
		// Double-check after acquiring flight
		if v, ok := shippingCache.Load(key); ok {
			if cached, ok := v.([]ShipBucket); ok {
				return cached, nil
			}
		}
		res := ShippingSeriesRange(pulls, repo, g, from, to)
		// Store copy
		stored := make([]ShipBucket, len(res))
		copy(stored, res)
		shippingCache.Store(key, stored)
		// Opportunistic cleanup: if cache grows large, drop old versions.
		// Keep at most 64 entries; simple heuristic to avoid unbounded growth.
		count := 0
		shippingCache.Range(func(k, v any) bool {
			count++
			return true
		})
		if count > 64 {
			// Remove entries from other versions lazily.
			shippingCache.Range(func(k, v any) bool {
				if mk, ok := k.(shippingMemoKey); ok && mk.version != ver {
					shippingCache.Delete(k)
				}
				return true
			})
		}
		return stored, nil
	})

	if cached, ok := val.([]ShipBucket); ok {
		out := make([]ShipBucket, len(cached))
		copy(out, cached)
		return out
	}
	// Fallback: compute directly
	return ShippingSeriesRange(pulls, repo, g, from, to)
}

// cachedShipping wraps ShippingSeries (from = since, to = zero) with memoization.
func cachedShipping(pulls []Pull, repo string, g Granularity, since time.Time, ver uint64) []ShipBucket {
	return cachedShippingSeries(pulls, repo, g, since, time.Time{}, ver)
}
