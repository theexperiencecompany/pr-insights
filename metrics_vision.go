package main

import (
	"log/slog"
	"math"
	"sort"
	"strings"
	"time"
)

// Vision metrics — shared helpers for Hero, DORA-lite, Flaky, Hybrid, Entire
// See docs/vision-*.md for spec; this file implements minimal viable pure helpers.

// ---- shared percentile / mean helpers ----

// Percentile returns the p-th percentile (0<=p<=100) of a sorted slice via linear interpolation.
// Caller must have sorted the slice ascending. Empty => 0, single => that value.
func Percentile(sorted []float64, p float64) float64 {
	n := len(sorted)
	if n == 0 {
		return 0
	}
	if n == 1 {
		return sorted[0]
	}
	if p <= 0 {
		return sorted[0]
	}
	if p >= 100 {
		return sorted[n-1]
	}
	k := p / 100 * float64(n-1)
	lo := int(math.Floor(k))
	hi := int(math.Ceil(k))
	if lo == hi {
		return sorted[lo]
	}
	if lo < 0 {
		lo = 0
	}
	if hi >= n {
		hi = n - 1
	}
	frac := k - float64(lo)
	return sorted[lo]*(1-frac) + sorted[hi]*frac
}

func meanFloat(v []float64) float64 {
	if len(v) == 0 {
		return 0
	}
	sum := 0.0
	for _, x := range v {
		sum += x
	}
	return sum / float64(len(v))
}

func sortedCopy(v []float64) []float64 {
	cp := make([]float64, len(v))
	copy(cp, v)
	sort.Float64s(cp)
	return cp
}

// ---- Hero (vision-hero.md) ----

type CycleStats struct {
	P50        float64 `json:"p50"`
	P90        float64 `json:"p90"`
	P75        float64 `json:"p75,omitempty"`
	Mean       float64 `json:"mean,omitempty"`
	Count      int     `json:"count"`
	WindowDays int     `json:"windowDays"`
}

func CycleStatsOf(pulls []Pull, since time.Time) CycleStats {
	var days []float64
	for _, p := range pulls {
		if p.State != "MERGED" || p.MergedAt == nil {
			continue
		}
		if !since.IsZero() && p.MergedAt.Before(since) {
			continue
		}
		d := p.MergedAt.Sub(p.CreatedAt).Hours() / 24
		if d < 0 {
			d = 0
		}
		days = append(days, d)
	}
	cs := CycleStats{Count: len(days), WindowDays: 90}
	if len(days) == 0 {
		return cs
	}
	sorted := sortedCopy(days)
	cs.P50 = Percentile(sorted, 50)
	cs.P90 = Percentile(sorted, 90)
	if len(sorted) >= 5 {
		cs.P75 = Percentile(sorted, 75)
	}
	cs.Mean = meanFloat(sorted)
	return cs
}

func LeadTimePercentiles(days []float64) (p50, p75, p90 float64) {
	if len(days) == 0 {
		return 0, 0, 0
	}
	sorted := sortedCopy(days)
	return Percentile(sorted, 50), Percentile(sorted, 75), Percentile(sorted, 90)
}

type CISuccess struct {
	Success    int     `json:"success"`
	Failure    int     `json:"failure"`
	Total      int     `json:"total"`
	Rate       float64 `json:"rate"`
	WindowDays int     `json:"windowDays"`
}

func CISuccessOf(runs []Run, since time.Time) CISuccess {
	cs := CISuccess{WindowDays: 30}
	for _, r := range runs {
		t := r.RunStartedAt
		if t.IsZero() {
			t = r.CreatedAt
		}
		if t.IsZero() {
			continue
		}
		if !since.IsZero() && t.Before(since) {
			continue
		}
		switch r.Conclusion {
		case "success":
			cs.Success++
		case "failure":
			cs.Failure++
		default:
			// skip cancelled/skipped/other
		}
	}
	cs.Total = cs.Success + cs.Failure
	if cs.Total > 0 {
		cs.Rate = float64(cs.Success) / float64(cs.Total) * 100
	}
	return cs
}

type Throughput struct {
	Merged     int     `json:"merged"`
	PerWeek    float64 `json:"perWeek"`
	PerDay     float64 `json:"perDay"`
	WindowDays int     `json:"windowDays"`
	PrevMerged int     `json:"prevMerged"`
	DeltaPct   float64 `json:"deltaPct"`
}

func ThroughputOf(pulls []Pull, now time.Time) Throughput {
	if now.IsZero() {
		now = time.Now().UTC()
	}
	since := now.AddDate(0, 0, -28)
	prevSince := now.AddDate(0, 0, -56)
	var cur, prev int
	for _, p := range pulls {
		if p.State != "MERGED" || p.MergedAt == nil {
			continue
		}
		if p.MergedAt.After(since) && !p.MergedAt.After(now) {
			cur++
		} else if p.MergedAt.After(prevSince) && !p.MergedAt.After(since) {
			prev++
		}
	}
	t := Throughput{Merged: cur, PrevMerged: prev, WindowDays: 28}
	t.PerWeek = float64(cur) / 4
	t.PerDay = float64(cur) / 28
	if prev > 0 {
		t.DeltaPct = float64(cur-prev) / float64(prev) * 100
	}
	return t
}

type Hero struct {
	Cycle      CycleStats `json:"cycle"`
	CI         CISuccess  `json:"ci"`
	Throughput Throughput `json:"throughput"`
	Bus        BusFactor  `json:"bus"`
	WindowNote string     `json:"windowNote,omitempty"`
}

// ---- DORA-lite (vision-dora-lite.md) ----

type TShirt string

const (
	TShirtXS  TShirt = "XS"
	TShirtS   TShirt = "S"
	TShirtM   TShirt = "M"
	TShirtL   TShirt = "L"
	TShirtXL  TShirt = "XL"
	TShirtXXL TShirt = "XXL"
)

var tshirtColors = map[TShirt]string{
	TShirtXS:  "var(--chart-2)",
	TShirtS:   "var(--chart-1)",
	TShirtM:   "#1f883d",
	TShirtL:   "#d29922",
	TShirtXL:  "#cf222e",
	TShirtXXL: "#82071e",
}

var tshirtLabels = map[TShirt]string{
	TShirtXS:  "XS · 0–10",
	TShirtS:   "S · 11–50",
	TShirtM:   "M · 51–200",
	TShirtL:   "L · 201–500",
	TShirtXL:  "XL · 501–1000",
	TShirtXXL: "XXL · 1000+",
}

var tshirtHuman = map[TShirt]string{
	TShirtXS:  "Tiny",
	TShirtS:   "Small",
	TShirtM:   "Medium",
	TShirtL:   "Large",
	TShirtXL:  "XL",
	TShirtXXL: "Massive",
}

var tshirtDesc = map[TShirt]string{
	TShirtXS:  "typo fix",
	TShirtS:   "small fix",
	TShirtM:   "feature",
	TShirtL:   "large change",
	TShirtXL:  "extra large",
	TShirtXXL: "massive — split it",
}

func TShirtFor(p Pull) TShirt {
	diff := p.Additions + p.Deletions
	switch {
	case diff <= 10:
		return TShirtXS
	case diff <= 50:
		return TShirtS
	case diff <= 200:
		return TShirtM
	case diff <= 500:
		return TShirtL
	case diff <= 1000:
		return TShirtXL
	default:
		return TShirtXXL
	}
}

type TShirtSegment struct {
	Size    TShirt  `json:"size"`
	Label   string  `json:"label"`
	Count   int     `json:"count"`
	Pct     float64 `json:"pct"`
	Color   string  `json:"color"`
	AvgDays float64 `json:"avgDays"`
	Human   string  `json:"human"`
}

func TShirtDistribution(pulls []Pull) []TShirtSegment {
	counts := map[TShirt]int{}
	sums := map[TShirt]float64{}
	total := 0
	for _, p := range pulls {
		if p.State != "MERGED" {
			continue
		}
		if p.IsBot {
			continue
		}
		s := TShirtFor(p)
		counts[s]++
		total++
		if p.MergedAt != nil {
			d := p.MergedAt.Sub(p.CreatedAt).Hours() / 24
			if d < 0 {
				d = 0
			}
			sums[s] += d
		}
	}
	order := []TShirt{TShirtXS, TShirtS, TShirtM, TShirtL, TShirtXL, TShirtXXL}
	out := make([]TShirtSegment, 0, 6)
	for _, s := range order {
		c := counts[s]
		pct := 0.0
		if total > 0 {
			pct = float64(c) / float64(total) * 100
		}
		avg := 0.0
		if c > 0 {
			avg = sums[s] / float64(c)
		}
		out = append(out, TShirtSegment{Size: s, Label: tshirtLabels[s], Count: c, Pct: pct, Color: tshirtColors[s], AvgDays: avg, Human: tshirtHuman[s]})
	}
	return out
}

type LeadTimeBucket struct {
	Key   string  `json:"key"`
	Label string  `json:"label"`
	Count int     `json:"count"`
	P50   float64 `json:"p50"`
	P75   float64 `json:"p75"`
	P90   float64 `json:"p90"`
	Mean  float64 `json:"mean"`
	Min   float64 `json:"min"`
	Max   float64 `json:"max"`
}

func LeadTimeSeries(pulls []Pull, repo string, g Granularity, since time.Time) []LeadTimeBucket {
	// bucket -> durations
	byKey := map[string][]float64{}
	labels := map[string]string{}
	for _, p := range pulls {
		if p.State != "MERGED" || p.MergedAt == nil {
			continue
		}
		if repo != "" && p.Repo != repo {
			continue
		}
		if !since.IsZero() && p.MergedAt.Before(since) {
			continue
		}
		key, label := bucketKey(*p.MergedAt, g)
		d := p.MergedAt.Sub(p.CreatedAt).Hours() / 24
		if d < 0 {
			d = 0
		}
		byKey[key] = append(byKey[key], d)
		labels[key] = label
	}
	var keys []string
	if !since.IsZero() {
		keys = continuousKeys(since, time.Now().UTC(), g)
	} else {
		for k := range byKey {
			keys = append(keys, k)
		}
		sort.Strings(keys)
	}
	if len(keys) == 0 {
		return nil
	}
	out := make([]LeadTimeBucket, 0, len(keys))
	for _, k := range keys {
		durs := byKey[k]
		b := LeadTimeBucket{Key: k, Label: labels[k]}
		if len(durs) == 0 {
			// missing label still needed
			if b.Label == "" {
				var t time.Time
				if g == GranWeek {
					t, _ = time.Parse("2006-01-02", k)
				} else {
					t, _ = time.Parse("2006-01", k)
				}
				_, lbl := bucketKey(t, g)
				b.Label = lbl
			}
			out = append(out, b)
			continue
		}
		sorted := sortedCopy(durs)
		b.Count = len(sorted)
		b.P50 = Percentile(sorted, 50)
		b.P75 = Percentile(sorted, 75)
		b.P90 = Percentile(sorted, 90)
		b.Mean = meanFloat(sorted)
		b.Min = sorted[0]
		b.Max = sorted[len(sorted)-1]
		out = append(out, b)
	}
	return out
}

func LeadTimeStats(pulls []Pull, repo string, since time.Time) LeadTimeBucket {
	var days []float64
	for _, p := range pulls {
		if p.State != "MERGED" || p.MergedAt == nil {
			continue
		}
		if repo != "" && p.Repo != repo {
			continue
		}
		if !since.IsZero() && p.MergedAt.Before(since) {
			continue
		}
		d := p.MergedAt.Sub(p.CreatedAt).Hours() / 24
		if d < 0 {
			d = 0
		}
		days = append(days, d)
	}
	if len(days) == 0 {
		return LeadTimeBucket{}
	}
	sorted := sortedCopy(days)
	return LeadTimeBucket{
		Count: len(sorted),
		P50:   Percentile(sorted, 50),
		P75:   Percentile(sorted, 75),
		P90:   Percentile(sorted, 90),
		Mean:  meanFloat(sorted),
		Min:   sorted[0],
		Max:   sorted[len(sorted)-1],
	}
}

type WIPPoint struct {
	Date string `json:"date"`
	WIP  int    `json:"wip"`
}

func WIPSeries(pulls []Pull, repo string, from, to time.Time) []WIPPoint {
	if from.IsZero() || to.IsZero() {
		// default 90d window
		to = time.Now().UTC()
		from = to.AddDate(0, 0, -90)
	}
	// Build delta map
	deltas := map[string]int{}
	for _, p := range pulls {
		if repo != "" && p.Repo != repo {
			continue
		}
		if p.IsBot {
			continue
		}
		createdDay := p.CreatedAt.UTC().Format("2006-01-02")
		// only count if created before to
		if p.CreatedAt.After(to) {
			continue
		}
		// if before from but still open at from, it contributes
		// For sweep, we need to include all pulls created <= to
		deltas[createdDay]++
		var termDay string
		if p.MergedAt != nil && !p.MergedAt.IsZero() {
			termDay = p.MergedAt.UTC().Format("2006-01-02")
		} else if p.ClosedAt != nil && !p.ClosedAt.IsZero() {
			termDay = p.ClosedAt.UTC().Format("2006-01-02")
		} else {
			continue // still open
		}
		// decrement day after terminal (WIP inclusive of created, exclusive after terminal)
		// Spec: delta[terminalDay]-- where terminalDay floor to date
		// To avoid negative on same day, handle.
		deltas[termDay]--
	}
	// Generate continuous dates
	var points []WIPPoint
	// To compute WIP over window, we need to know WIP at from: sum of all deltas before from
	// Simpler: sweep from earliest created to to, then filter to [from,to]
	// Find earliest delta date
	// Also consider pulls created before from: need cumulative initial
	// Compute initial WIP at from by simulating from far past? Instead compute cumulative from min date
	// We'll brute: for each day from earliestKnown to to, sort keys.
	cur := 0
	// Precompute sorted delta keys
	type kv struct{ date string; delta int }
	// Instead do day loop from earliest pull to to
	// Find min date from deltas
	minDateStr := ""
	for d := range deltas {
		if minDateStr == "" || d < minDateStr {
			minDateStr = d
		}
	}
	start := from
	if minDateStr != "" {
		t, _ := time.Parse("2006-01-02", minDateStr)
		if t.Before(start) {
			start = t
		}
	}
	wipByDate := map[string]int{}
	cum := 0
	for curDate := start; !curDate.After(to); curDate = curDate.AddDate(0, 0, 1) {
		ds := curDate.Format("2006-01-02")
		cum += deltas[ds]
		wipByDate[ds] = cum
	}
	for curDate := from; !curDate.After(to); curDate = curDate.AddDate(0, 0, 1) {
		ds := curDate.Format("2006-01-02")
		points = append(points, WIPPoint{Date: ds, WIP: wipByDate[ds]})
		_ = cur // avoid unused
	}
	return points
}

// LittleLaw estimates WIP (count of open PRs) via Little's Law.
// WIP = count of open PRs at a point in time. AvgWIP is the mean open PRs over WindowDays (e.g. 90 days).
// PredictedWIP ≈ throughput (merges per day) × cycle time (days to merge). ErrorPct compares predicted vs avg.
type LittleLaw struct {
	WindowDays       int        `json:"windowDays"`       // window for the average, e.g. 90 days
	AvgWIP           float64    `json:"avgWip"`           // avg PRs open in window (unit: PRs)
	ThroughputPerDay float64    `json:"throughputPerDay"` // merges per day (PRs/day)
	CycleMeanDays    float64    `json:"cycleMeanDays"`    // mean days from opened to merged
	PredictedWIP     float64    `json:"predictedWip"`     // predicted PRs open (throughput × cycle)
	ErrorPct         float64    `json:"errorPct"`         // |avg - predicted| / avg * 100
	CurrentWIP       int        `json:"currentWip"`       // PRs open now
	Points           []WIPPoint `json:"points"`           // daily WIP series (unit: PRs)
}

func LittleLawOf(pulls []Pull, repo string, windowDays int) LittleLaw {
	if windowDays <= 0 {
		windowDays = 30
	}
	to := time.Now().UTC()
	from := to.AddDate(0, 0, -windowDays)
	points := WIPSeries(pulls, repo, from, to)
	sum := 0
	for _, pt := range points {
		sum += pt.WIP
	}
	avgWIP := 0.0
	if len(points) > 0 {
		avgWIP = float64(sum) / float64(len(points))
	}
	currentWIP := 0
	if len(points) > 0 {
		currentWIP = points[len(points)-1].WIP
	}
	// throughput = merged / windowDays
	merged := 0
	var cycleDays []float64
	for _, p := range pulls {
		if p.State != "MERGED" || p.MergedAt == nil {
			continue
		}
		if repo != "" && p.Repo != repo {
			continue
		}
		if p.MergedAt.Before(from) || p.MergedAt.After(to) {
			continue
		}
		merged++
		d := p.MergedAt.Sub(p.CreatedAt).Hours() / 24
		if d < 0 {
			d = 0
		}
		cycleDays = append(cycleDays, d)
	}
	throughputPerDay := float64(merged) / float64(windowDays)
	cycleMean := meanFloat(cycleDays)
	predicted := throughputPerDay * cycleMean
	errPct := 0.0
	if avgWIP > 0 {
		errPct = math.Abs(avgWIP-predicted) / avgWIP * 100
	}
	return LittleLaw{
		WindowDays:       windowDays,
		AvgWIP:           avgWIP,
		ThroughputPerDay: throughputPerDay,
		CycleMeanDays:    cycleMean,
		PredictedWIP:     predicted,
		ErrorPct:         errPct,
		CurrentWIP:       currentWIP,
		Points:           points,
	}
}

type DonutSegment struct {
	Label string  `json:"label"`
	Count int     `json:"count"`
	Pct   float64 `json:"pct"`
	Color string  `json:"color"`
}

type Abandonment struct {
	Total         int                   `json:"total"`
	Merged        int                   `json:"merged"`
	Closed        int                   `json:"closed"`
	Open          int                   `json:"open"`
	AbandonedRate float64               `json:"abandonedRate"`
	Segments      []DonutSegment        `json:"segments"`
	BySize        map[TShirt]int        `json:"bySize,omitempty"`
}

func AbandonmentOf(pulls []Pull, repo string, since time.Time) Abandonment {
	var merged, closed, open int
	bySize := map[TShirt]int{}
	for _, p := range pulls {
		if repo != "" && p.Repo != repo {
			continue
		}
		// For window filtering: use CreatedAt? Spec says among terminated in window filtered by since
		// Use MergedAt/ClosedAt for merged/closed, CreatedAt for open window?
		// Simplify: filter by CreatedAt >= since if since non-zero; but spec says pulls filtered by since already.
		// We'll filter by CreatedAt if since !=0, else no filter, but to match period, use MergedAt/ClosedAt for terminated.
		// For simplicity include all if since zero else require relevant date within window.
		include := true
		if !since.IsZero() {
			switch p.State {
			case "MERGED":
				include = p.MergedAt != nil && !p.MergedAt.Before(since)
			case "CLOSED":
				include = p.ClosedAt != nil && !p.ClosedAt.Before(since)
			case "OPEN":
				include = !p.CreatedAt.Before(since)
			}
		}
		if !include {
			continue
		}
		switch p.State {
		case "MERGED":
			merged++
		case "CLOSED":
			closed++
			if !p.IsBot {
				bySize[TShirtFor(p)]++
			}
		case "OPEN":
			open++
		}
	}
	total := merged + closed + open
	denom := merged + closed
	rate := 0.0
	if denom > 0 {
		rate = float64(closed) / float64(denom) * 100
	}
	pctMerged := 0.0
	pctClosed := 0.0
	pctOpen := 0.0
	if total > 0 {
		pctMerged = float64(merged) / float64(total) * 100
		pctClosed = float64(closed) / float64(total) * 100
		pctOpen = float64(open) / float64(total) * 100
	}
	segs := []DonutSegment{
		{Label: "Merged (good)", Count: merged, Pct: pctMerged, Color: "var(--chart-2)"},
		{Label: "Closed without merge (wasted)", Count: closed, Pct: pctClosed, Color: "var(--chart-3)"},
		{Label: "Still open", Count: open, Pct: pctOpen, Color: "var(--chart-5)"},
	}
	return Abandonment{Total: total, Merged: merged, Closed: closed, Open: open, AbandonedRate: rate, Segments: segs, BySize: bySize}
}

// ---- Flaky (vision-flaky.md) ----

const FlakeRecoveryWindow = 24 * time.Hour
const FlakeMinRuns = 10

func FlakeScore(runs []Run) (flaky, failure int, score float64) {
	if len(runs) == 0 {
		return 0, 0, 0
	}
	// sort by CreatedAt ascending
	cp := make([]Run, len(runs))
	copy(cp, runs)
	sort.Slice(cp, func(i, j int) bool { return cp[i].CreatedAt.Before(cp[j].CreatedAt) })
	failure = 0
	flaky = 0
	for _, r := range cp {
		if r.Conclusion == "failure" {
			failure++
		}
	}
	for i, r := range cp {
		if r.Conclusion != "failure" {
			continue
		}
		if i+1 < len(cp) && cp[i+1].Conclusion == "success" {
			if cp[i+1].CreatedAt.Sub(r.CreatedAt) <= FlakeRecoveryWindow {
				flaky++
			}
		}
	}
	if failure > 0 {
		score = float64(flaky) / float64(failure) * 100
	}
	return
}

type FlakyStat struct {
	Repo            string     `json:"repo"`
	Workflow        string     `json:"workflow"`
	Runs            int        `json:"runs"`
	Failure         int        `json:"failure"`
	Success         int        `json:"success"`
	Flaky           int        `json:"flaky"`
	FlakeScore      float64    `json:"flakeScore"`
	FailureRate     float64    `json:"failureRate"`
	SuccessRate     float64    `json:"successRate"`
	P50Min          float64    `json:"p50Min"`
	P95Min          float64    `json:"p95Min"`
	MTTRMedianMin   float64    `json:"mttrMedianMin"`
	MTTRMeanMin     float64    `json:"mttrMeanMin"`
	MTTRCount       int        `json:"mttrCount"`
	WastedMinutes   int        `json:"wastedMinutes"`
	WastedPct       float64    `json:"wastedPct"`
	Trend           []float64  `json:"trend"`
	LastRunAt       *time.Time `json:"lastRunAt,omitempty"`
	LastConclusion  string     `json:"lastConclusion"`
}

func DurationPercentiles(durations []float64) (p50, p95 float64) {
	if len(durations) == 0 {
		return 0, 0
	}
	sorted := sortedCopy(durations)
	return Percentile(sorted, 50), Percentile(sorted, 95)
}

func MTTRForRuns(sortedRuns []Run) (medianMin, meanMin float64, count int) {
	if len(sortedRuns) == 0 {
		return 0, 0, 0
	}
	var rec []float64
	for i, r := range sortedRuns {
		if r.Conclusion != "failure" {
			continue
		}
		// find next success after i
		for j := i + 1; j < len(sortedRuns); j++ {
			if sortedRuns[j].Conclusion == "success" {
				d := sortedRuns[j].CreatedAt.Sub(r.CreatedAt).Minutes()
				if d > 0 {
					rec = append(rec, d)
				}
				break
			}
			// skip other, keep looking until success or end
			if sortedRuns[j].Conclusion == "failure" {
				// next is failure, but continue searching beyond? Spec says only immediate next run matters for flaky,
				// but for MTTR it's next success anywhere. So we continue past failures.
				continue
			}
		}
	}
	if len(rec) == 0 {
		return 0, 0, 0
	}
	sorted := sortedCopy(rec)
	return Percentile(sorted, 50), meanFloat(sorted), len(sorted)
}

func FlakyStats(runs []Run, repo string, since time.Time) []FlakyStat {
	// filter
	filtered := make([]Run, 0, len(runs))
	for _, r := range runs {
		if repo != "" && r.Repo != repo {
			continue
		}
		t := r.CreatedAt
		if !since.IsZero() && t.Before(since) {
			continue
		}
		filtered = append(filtered, r)
	}
	// group by workflow
	groups := map[string][]Run{}
	for _, r := range filtered {
		key := r.Repo + "/" + r.Workflow
		groups[key] = append(groups[key], r)
	}
	out := make([]FlakyStat, 0, len(groups))
	for key, grp := range groups {
		sort.Slice(grp, func(i, j int) bool { return grp[i].CreatedAt.Before(grp[j].CreatedAt) })
		// split key
		parts := strings.SplitN(key, "/", 2)
		repoName := ""
		wf := ""
		if len(parts) == 2 {
			repoName = parts[0]
			wf = parts[1]
		} else {
			wf = key
		}
		// basic counts
		var succ, fail, other int
		var durations []float64
		var totalMin, wastedMin int
		var lastAt *time.Time
		var lastConclusion string
		for _, r := range grp {
			switch r.Conclusion {
			case "success":
				succ++
				durations = append(durations, float64(r.DurationSec)/60)
				totalMin += r.DurationSec / 60
			case "failure":
				fail++
				durations = append(durations, float64(r.DurationSec)/60)
				totalMin += r.DurationSec / 60
				wastedMin += r.DurationSec / 60
			default:
				other++
			}
			if lastAt == nil || r.CreatedAt.After(*lastAt) {
				t := r.CreatedAt
				lastAt = &t
				lastConclusion = r.Conclusion
			}
		}
		flaky, _, flakeScore := FlakeScore(grp)
		// duration percentiles
		var p50, p95 float64
		if len(durations) > 0 {
			sorted := sortedCopy(durations)
			p50 = Percentile(sorted, 50)
			p95 = Percentile(sorted, 95)
		}
		medMTTR, meanMTTR, mttrCount := MTTRForRuns(grp)
		failureRate := 0.0
		successRate := 0.0
		if denom := succ + fail; denom > 0 {
			failureRate = float64(fail) / float64(denom) * 100
			successRate = float64(succ) / float64(denom) * 100
		}
		wastedPct := 0.0
		if totalMin > 0 {
			wastedPct = float64(wastedMin) / float64(totalMin) * 100
		}
		// trend:reuse WorkflowStats trend logic simplified: last 6 months success rate not needed, empty
		st := FlakyStat{
			Repo:           repoName,
			Workflow:       wf,
			Runs:           len(grp),
			Failure:        fail,
			Success:        succ,
			Flaky:          flaky,
			FlakeScore:     flakeScore,
			FailureRate:    failureRate,
			SuccessRate:    successRate,
			P50Min:         p50,
			P95Min:         p95,
			MTTRMedianMin:  medMTTR,
			MTTRMeanMin:    meanMTTR,
			MTTRCount:      mttrCount,
			WastedMinutes:  wastedMin,
			WastedPct:      wastedPct,
			LastRunAt:      lastAt,
			LastConclusion: lastConclusion,
		}
		_ = other
		out = append(out, st)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].FlakeScore != out[j].FlakeScore {
			return out[i].FlakeScore > out[j].FlakeScore
		}
		if out[i].WastedMinutes != out[j].WastedMinutes {
			return out[i].WastedMinutes > out[j].WastedMinutes
		}
		if out[i].FailureRate != out[j].FailureRate {
			return out[i].FailureRate > out[j].FailureRate
		}
		return out[i].Repo+out[i].Workflow < out[j].Repo+out[j].Workflow
	})
	return out
}

type CostPerMerge struct {
	TotalMinutes int     `json:"totalMinutes"`
	Merged       int     `json:"merged"`
	PerMergeMin  float64 `json:"perMergeMin"`
	PerMerge     string  `json:"perMerge"`
}

func CostPerMergeOf(runs []Run, pulls []Pull, repo string, since time.Time) CostPerMerge {
	totalMin := 0
	for _, r := range runs {
		if repo != "" && r.Repo != repo {
			continue
		}
		t := r.CreatedAt
		if !since.IsZero() && t.Before(since) {
			continue
		}
		if r.Conclusion == "success" || r.Conclusion == "failure" {
			totalMin += r.DurationSec / 60
		}
	}
	merged := 0
	for _, p := range pulls {
		if p.State != "MERGED" || p.MergedAt == nil {
			continue
		}
		if repo != "" && p.Repo != repo {
			continue
		}
		if !since.IsZero() && p.MergedAt.Before(since) {
			continue
		}
		merged++
	}
	per := 0.0
	if merged > 0 {
		per = float64(totalMin) / float64(merged)
	}
	// simple formatted string
	str := ""
	if per > 0 {
		if per >= 60 {
			str = strings.TrimSpace(strings.ReplaceAll(strings.ReplaceAll(time.Duration(per*float64(time.Minute)).String(), "h", "h "), "m", "m"))
		} else {
			str = strings.TrimSpace(strings.ReplaceAll(time.Duration(per*float64(time.Minute)).String(), "m", "m"))
		}
	}
	return CostPerMerge{TotalMinutes: totalMin, Merged: merged, PerMergeMin: per, PerMerge: str}
}

// ---- Hybrid (vision-hybrid.md) ----

type RunnerGroup string

const (
	RunnerHome    RunnerGroup = "home"
	RunnerGithub  RunnerGroup = "github"
	RunnerUnknown RunnerGroup = "unknown"
)

var homeSubstrings = []string{
	"lint", "test", "build", "quality", "mutation",
	"trivy", "docker", "integration", "e2e", "unit",
	"hybrid", "home",
}

func InferRunnerGroup(workflow string) RunnerGroup {
	if workflow == "" {
		return RunnerUnknown
	}
	lw := strings.ToLower(workflow)
	for _, s := range homeSubstrings {
		if strings.Contains(lw, s) {
			return RunnerHome
		}
	}
	if strings.Contains(lw, "deploy") || strings.Contains(lw, "release") {
		return RunnerGithub
	}
	return RunnerGithub
}

func RunnerGroupOf(r Run) RunnerGroup {
	if r.RunnerGroup != "" {
		return r.RunnerGroup
	}
	return InferRunnerGroup(r.Workflow)
}

const (
	P50ThresholdMin = 10
	P90ThresholdMin = 25
)

type WorkflowHybrid struct {
	Repo           string      `json:"repo"`
	Workflow       string      `json:"workflow"`
	Key            string      `json:"key"`
	Runs           int         `json:"runs"`
	Success        int         `json:"success"`
	Failure        int         `json:"failure"`
	Other          int         `json:"other"`
	SuccessRate    float64     `json:"successRate"`
	FailureRate    float64     `json:"failureRate"`
	P50Min         float64     `json:"p50Min"`
	P90Min         float64     `json:"p90Min"`
	P99Min         float64     `json:"p99Min"`
	AvgMin         float64     `json:"avgMin"`
	MinMin         float64     `json:"minMin,omitempty"`
	MaxMin         float64     `json:"maxMin,omitempty"`
	ThresholdP50   float64     `json:"thresholdP50"`
	ThresholdP90   float64     `json:"thresholdP90"`
	IsSlow         bool        `json:"isSlow"`
	IsSampleSmall  bool        `json:"isSampleSmall"`
	Hosting        RunnerGroup `json:"hosting"`
	HomeRuns       int         `json:"homeRuns"`
	GithubRuns     int         `json:"githubRuns"`
	UnknownRuns    int         `json:"unknownRuns"`
	BudgetSharePct float64     `json:"budgetSharePct"`
	QueueMedianMin float64     `json:"queueMedianMin"`
	FlakeScore     float64     `json:"flakeScore"`
	Flaky          int         `json:"flaky"`
	DeltaMin       float64     `json:"deltaMin"`
	LastRunAt      *time.Time  `json:"lastRunAt,omitempty"`
	LastConclusion string      `json:"lastConclusion"`
}

func WorkflowHybridStats(runs []Run, repo string, since time.Time) []WorkflowHybrid {
	filtered := make([]Run, 0, len(runs))
	for _, r := range runs {
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
		filtered = append(filtered, r)
	}
	// group per workflow key: durations, counts, queues, hosting split, lastRun
	type wfAgg struct {
		repo, wf string
		durations []float64
		success, failure, other int
		home, gh, unknown int
		queues []float64
		lastAt *time.Time
		lastConclusion string
		flakyRuns []Run
	}
	aggs := map[string]*wfAgg{}
	for _, r := range filtered {
		key := r.Repo + "/" + r.Workflow
		a := aggs[key]
		if a == nil {
			a = &wfAgg{repo: r.Repo, wf: r.Workflow}
			aggs[key] = a
		}
		a.durations = append(a.durations, float64(r.DurationSec)/60)
		switch r.Conclusion {
		case "success":
			a.success++
		case "failure":
			a.failure++
		default:
			a.other++
		}
		grp := RunnerGroupOf(r)
		switch grp {
		case RunnerHome:
			a.home++
		case RunnerGithub:
			a.gh++
		default:
			a.unknown++
		}
		if !r.CreatedAt.IsZero() && !r.RunStartedAt.IsZero() && r.RunStartedAt.After(r.CreatedAt) {
			q := r.RunStartedAt.Sub(r.CreatedAt).Minutes()
			if q >= 0 && q < 24*60 {
				a.queues = append(a.queues, q)
			}
		}
		if a.lastAt == nil || r.CreatedAt.After(*a.lastAt) {
			t := r.CreatedAt
			a.lastAt = &t
			a.lastConclusion = r.Conclusion
		}
		a.flakyRuns = append(a.flakyRuns, r)
	}
	// totalMinutes for budget share denominator
	totalMinutes := 0
	for _, a := range aggs {
		for _, d := range a.durations {
			totalMinutes += int(d)
		}
	}
	out := make([]WorkflowHybrid, 0, len(aggs))
	for key, a := range aggs {
		sorted := sortedCopy(a.durations)
		p50 := Percentile(sorted, 50)
		p90 := Percentile(sorted, 90)
		p99 := Percentile(sorted, 99)
		avg := meanFloat(sorted)
		min := sorted[0]
		max := sorted[len(sorted)-1]
		// success rate and failure rate
		denom := a.success + a.failure
		sr := 0.0
		fr := 0.0
		if denom > 0 {
			sr = float64(a.success) / float64(denom) * 100
			fr = float64(a.failure) / float64(denom) * 100
		}
		isSlow := p50 > P50ThresholdMin || p90 > P90ThresholdMin || sr < 85
		isSmall := len(a.durations) < 10
		hosting := InferRunnerGroup(a.wf)
		// queue median
		qMed := 0.0
		if len(a.queues) > 0 {
			sq := sortedCopy(a.queues)
			qMed = Percentile(sq, 50)
		}
		// budget share
		wfMinutes := 0
		for _, d := range a.durations {
			wfMinutes += int(d)
		}
		budget := 0.0
		if totalMinutes > 0 {
			budget = float64(wfMinutes) / float64(totalMinutes) * 100
		}
		// flake score
		flaky, _, flakeScore := FlakeScore(a.flakyRuns)
		_ = flaky
		// delta vs github/home global median placeholder - compute after global known? use 0 for now, fill later
		delta := 0.0
		out = append(out, WorkflowHybrid{
			Repo: a.repo, Workflow: a.wf, Key: key,
			Runs: len(a.durations), Success: a.success, Failure: a.failure, Other: a.other,
			SuccessRate: sr, FailureRate: fr,
			P50Min: p50, P90Min: p90, P99Min: p99, AvgMin: avg,
			MinMin: min, MaxMin: max,
			ThresholdP50: P50ThresholdMin, ThresholdP90: P90ThresholdMin,
			IsSlow: isSlow, IsSampleSmall: isSmall,
			Hosting: hosting, HomeRuns: a.home, GithubRuns: a.gh, UnknownRuns: a.unknown,
			BudgetSharePct: budget, QueueMedianMin: qMed,
			FlakeScore: flakeScore, Flaky: flaky,
			DeltaMin: delta,
			LastRunAt: a.lastAt, LastConclusion: a.lastConclusion,
		})
	}
	// compute global home vs github median for delta: median of home durations vs github durations across all filtered runs
	var homeDurs, ghDurs []float64
	for _, r := range filtered {
		d := float64(r.DurationSec) / 60
		switch RunnerGroupOf(r) {
		case RunnerHome:
			homeDurs = append(homeDurs, d)
		case RunnerGithub:
			ghDurs = append(ghDurs, d)
		}
	}
	homeP50 := 0.0
	ghP50 := 0.0
	if len(homeDurs) > 0 {
		homeP50 = Percentile(sortedCopy(homeDurs), 50)
	}
	if len(ghDurs) > 0 {
		ghP50 = Percentile(sortedCopy(ghDurs), 50)
	}
	globalDelta := homeP50 - ghP50
	// enrich each workflow's DeltaMin as workflow p50 minus opposite hosting global p50
	for i := range out {
		if out[i].Hosting == RunnerHome && ghP50 > 0 {
			out[i].DeltaMin = out[i].P50Min - ghP50
		} else if out[i].Hosting == RunnerGithub && homeP50 > 0 {
			out[i].DeltaMin = out[i].P50Min - homeP50
		} else {
			out[i].DeltaMin = globalDelta
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].IsSlow != out[j].IsSlow {
			return out[i].IsSlow
		}
		if out[i].P90Min != out[j].P90Min {
			return out[i].P90Min > out[j].P90Min
		}
		if out[i].P50Min != out[j].P50Min {
			return out[i].P50Min > out[j].P50Min
		}
		if out[i].Runs != out[j].Runs {
			return out[i].Runs > out[j].Runs
		}
		return out[i].Key < out[j].Key
	})
	return out
}

type RunnerSplit struct {
	HomeRuns       int     `json:"homeRuns"`
	GithubRuns     int     `json:"githubRuns"`
	UnknownRuns    int     `json:"unknownRuns"`
	TotalRuns      int     `json:"totalRuns"`
	HomeMinutes    int     `json:"homeMinutes"`
	GithubMinutes  int     `json:"githubMinutes"`
	UnknownMinutes int     `json:"unknownMinutes"`
	TotalMinutes   int     `json:"totalMinutes"`
	HomePctRuns    float64 `json:"homePctRuns"`
	HomePctMin     float64 `json:"homePctMinutes"`
	GithubPctRuns  float64 `json:"githubPctRuns"`
	GithubPctMin   float64 `json:"githubPctMinutes"`
	UnknownPctRuns float64 `json:"unknownPctRuns"`
	UnknownPctMin  float64 `json:"unknownPctMinutes"`
}

func RunnerSplitOf(runs []Run, repo string, since time.Time) RunnerSplit {
	var s RunnerSplit
	for _, r := range runs {
		if repo != "" && r.Repo != repo {
			continue
		}
		t := r.RunStartedAt
		if t.IsZero() {
			t = r.CreatedAt
		}
		if !since.IsZero() && t.Before(since) {
			continue
		}
		if r.Conclusion != "success" && r.Conclusion != "failure" {
			continue
		}
		grp := RunnerGroupOf(r)
		mins := r.DurationSec / 60
		switch grp {
		case RunnerHome:
			s.HomeRuns++
			s.HomeMinutes += mins
		case RunnerGithub:
			s.GithubRuns++
			s.GithubMinutes += mins
		default:
			s.UnknownRuns++
			s.UnknownMinutes += mins
		}
	}
	s.TotalRuns = s.HomeRuns + s.GithubRuns + s.UnknownRuns
	s.TotalMinutes = s.HomeMinutes + s.GithubMinutes + s.UnknownMinutes
	if s.TotalRuns > 0 {
		s.HomePctRuns = float64(s.HomeRuns) / float64(s.TotalRuns) * 100
		s.GithubPctRuns = float64(s.GithubRuns) / float64(s.TotalRuns) * 100
		s.UnknownPctRuns = float64(s.UnknownRuns) / float64(s.TotalRuns) * 100
		if float64(s.UnknownRuns)/float64(s.TotalRuns)*100 > 10 {
			slog.Warn("RunnerSplit unknown >10%", "unknown", s.UnknownRuns, "total", s.TotalRuns, "pct", s.UnknownPctRuns, "repo", repo)
		}
		// invariant: hostingCounts sum == totalRuns and homePct = home/total*100
		if s.HomeRuns+s.GithubRuns+s.UnknownRuns != s.TotalRuns {
			slog.Warn("RunnerSplit sum mismatch", "home", s.HomeRuns, "github", s.GithubRuns, "unknown", s.UnknownRuns, "total", s.TotalRuns)
		}
	}
	if s.TotalMinutes > 0 {
		s.HomePctMin = float64(s.HomeMinutes) / float64(s.TotalMinutes) * 100
		s.GithubPctMin = float64(s.GithubMinutes) / float64(s.TotalMinutes) * 100
		s.UnknownPctMin = float64(s.UnknownMinutes) / float64(s.TotalMinutes) * 100
	}
	return s
}

type ReleaseStats struct {
	P50        float64 `json:"p50"`
	P90        float64 `json:"p90"`
	Avg        float64 `json:"avg,omitempty"`
	Count      int     `json:"count"`
	WindowDays int     `json:"windowDays"`
}

func ReleaseStatsOf(pulls []Pull, repo string, since time.Time) ReleaseStats {
	var days []float64
	now := time.Now().UTC()
	windowDays := 90
	if !since.IsZero() {
		windowDays = int(now.Sub(since).Hours() / 24)
		if windowDays < 0 {
			windowDays = 0
		}
	}
	for _, p := range pulls {
		if p.State != "MERGED" || p.MergedAt == nil {
			continue
		}
		if repo != "" && p.Repo != repo {
			continue
		}
		if !since.IsZero() && p.MergedAt.Before(since) {
			continue
		}
		d := p.MergedAt.Sub(p.CreatedAt).Hours() / 24
		if d < 0 {
			d = 0
		}
		days = append(days, d)
	}
	rs := ReleaseStats{Count: len(days), WindowDays: windowDays}
	if len(days) > 0 {
		sorted := sortedCopy(days)
		rs.P50 = Percentile(sorted, 50)
		rs.P90 = Percentile(sorted, 90)
		rs.Avg = meanFloat(sorted)
	}
	return rs
}

type CIRunnerBucket struct {
	Key            string  `json:"key"`
	Label          string  `json:"label"`
	Home           int     `json:"home"`
	Github         int     `json:"github"`
	Unknown        int     `json:"unknown"`
	Total          int     `json:"total"`
	HomePct        float64 `json:"homePct"`
	GithubPct      float64 `json:"githubPct"`
	UnknownPct     float64 `json:"unknownPct"`
	HomeMinutes    int     `json:"homeMinutes"`
	GithubMinutes  int     `json:"githubMinutes"`
	UnknownMinutes int     `json:"unknownMinutes"`
	TotalMinutes   int     `json:"totalMinutes"`
}

func HybridSeries(runs []Run, repo string, gran Granularity, since time.Time) []CIRunnerBucket {
	if gran != GranWeek {
		gran = GranMonth
	}
	byKey := make(map[string]*CIRunnerBucket, 16)
	for _, r := range runs {
		if repo != "" && r.Repo != repo {
			continue
		}
		t := r.RunStartedAt
		if t.IsZero() {
			t = r.CreatedAt
		}
		if t.IsZero() {
			continue
		}
		if !since.IsZero() && t.Before(since) {
			continue
		}
		if r.Conclusion != "success" && r.Conclusion != "failure" {
			continue
		}
		key, label := bucketKey(t, gran)
		b := byKey[key]
		if b == nil {
			b = &CIRunnerBucket{Key: key, Label: label}
			byKey[key] = b
		}
		b.Total++
		mins := r.DurationSec / 60
		b.TotalMinutes += mins
		switch RunnerGroupOf(r) {
		case RunnerHome:
			b.Home++
			b.HomeMinutes += mins
		case RunnerGithub:
			b.Github++
			b.GithubMinutes += mins
		default:
			b.Unknown++
			b.UnknownMinutes += mins
		}
		// invariant: hostingCounts per bucket sum == totalRuns per bucket
		if b.Home+b.Github+b.Unknown != b.Total {
			slog.Warn("HybridSeries hosting sum mismatch", "key", key, "home", b.Home, "github", b.Github, "unknown", b.Unknown, "total", b.Total)
		}
	}
	var keys []string
	if !since.IsZero() {
		keys = continuousKeys(since, time.Now().UTC(), gran)
		// Ensure trend length matches period bucket count for month granularity:
		// continuousKeys inclusive yields N+1 for N months (e.g., 3m -> 4). Trim to N.
		// 3m->3 buckets, 6m->6, 12m->12. Handle AddDate day overflow (e.g., Aug29 -6m = Mar01 not Feb28 -> diff 5 but expected 6).
		if gran == GranMonth && len(keys) > 1 {
			sinceMonth := time.Date(since.UTC().Year(), since.UTC().Month(), 1, 0, 0, 0, 0, time.UTC)
			nowMonth := time.Date(time.Now().UTC().Year(), time.Now().UTC().Month(), 1, 0, 0, 0, 0, time.UTC)
			// Recover N (3/6/12) by finding i where now.AddDate(0,-i,0) month == sinceMonth
			// Use largest i to handle day overflow (e.g., Aug29 -6m = Mar01 and Aug29 -5m = Mar29 both map to Mar)
			expected := 0
			now := time.Now().UTC()
			for i := 1; i <= 24; i++ {
				cand := now.AddDate(0, -i, 0)
				candMonth := time.Date(cand.Year(), cand.Month(), 1, 0, 0, 0, 0, time.UTC)
				if candMonth.Equal(sinceMonth) {
					expected = i
					// do not break, keep searching for larger i that also matches (overflow duplicates)
				}
			}
			if expected == 0 {
				diffMonths := (nowMonth.Year()-sinceMonth.Year())*12 + int(nowMonth.Month()-sinceMonth.Month())
				expected = diffMonths
			}
			if expected <= 0 {
				expected = 1
			}
			if len(keys) == expected+1 {
				keys = keys[1:]
			} else if len(keys) > expected {
				keys = keys[len(keys)-expected:]
			} else if len(keys) < expected {
				// pad or keep as is; exhaustive fallback keeps keys
			}
		}
	} else {
		if len(byKey) == 0 {
			return nil
		}
		for k := range byKey {
			keys = append(keys, k)
		}
		sort.Strings(keys)
	}
	out := make([]CIRunnerBucket, 0, len(keys))
	var totalUnknown, totalRuns int
	for _, k := range keys {
		b := byKey[k]
		if b == nil {
			var t time.Time
			if gran == GranWeek {
				t, _ = time.Parse("2006-01-02", k)
			} else {
				t, _ = time.Parse("2006-01", k)
			}
			_, label := bucketKey(t, gran)
			b = &CIRunnerBucket{Key: k, Label: label}
		}
		if b.Home+b.Github+b.Unknown != b.Total {
			slog.Warn("HybridSeries bucket sum mismatch after fill", "key", k, "home", b.Home, "github", b.Github, "unknown", b.Unknown, "total", b.Total)
		}
		if b.Total > 0 {
			b.HomePct = float64(b.Home) / float64(b.Total) * 100
			b.GithubPct = float64(b.Github) / float64(b.Total) * 100
			b.UnknownPct = float64(b.Unknown) / float64(b.Total) * 100
			// verify homePct = home/total*100 correctness (already)
		}
		totalUnknown += b.Unknown
		totalRuns += b.Total
		out = append(out, *b)
	}
	if totalRuns > 0 && float64(totalUnknown)/float64(totalRuns)*100 > 10 {
		slog.Warn("HybridSeries unknown >10%", "unknown", totalUnknown, "total", totalRuns, "pct", float64(totalUnknown)/float64(totalRuns)*100, "repo", repo, "gran", string(gran))
	}
	return out
}

func OverallHybridStats(runs []Run, repo string, since time.Time) (p50, p90, avg float64, totalRuns, totalMinutes int) {
	var durs []float64
	for _, r := range runs {
		if repo != "" && r.Repo != repo {
			continue
		}
		t := r.RunStartedAt
		if t.IsZero() {
			t = r.CreatedAt
		}
		if !since.IsZero() && t.Before(since) {
			continue
		}
		if r.Conclusion != "success" && r.Conclusion != "failure" {
			continue
		}
		durs = append(durs, float64(r.DurationSec)/60)
		totalRuns++
		totalMinutes += r.DurationSec / 60
	}
	if len(durs) > 0 {
		sorted := sortedCopy(durs)
		p50 = Percentile(sorted, 50)
		p90 = Percentile(sorted, 90)
		avg = meanFloat(sorted)
	}
	return
}

// ---- Dora helper for overview shipping bucket already defined elsewhere ----

// ---- Entire join helpers (vision-entire.md minimal) ----

type RepoJoinPoint struct {
	Repo          string         `json:"repo"`
	Short         string         `json:"short"`
	Checkpoints   int            `json:"checkpoints"`
	MergedPRs     int            `json:"mergedCount"`
	Tokens        int64          `json:"tokens"`
	DominantAgent string         `json:"dominantAgent"`
	Agents        map[string]int `json:"agents"`
	AddedLines    int            `json:"addedLines"`
	BubbleSize    int            `json:"bubbleSize"`
	CpPerPR       float64        `json:"cpPerPR"`
}

func EntireRepoJoin(activity *entireActivity, recap *entireRecap, pulls []Pull, windowFrom, windowTo time.Time) []RepoJoinPoint {
	if activity == nil {
		return nil
	}
	// pulls by repo short name
	pullsByRepo := map[string]int{}
	addedByRepo := map[string]int{}
	for _, p := range pulls {
		if p.State != "MERGED" || p.MergedAt == nil {
			continue
		}
		if !windowFrom.IsZero() && p.MergedAt.Before(windowFrom) {
			continue
		}
		if !windowTo.IsZero() && !p.MergedAt.Before(windowTo) {
			continue
		}
		short := p.Repo
		if idx := strings.LastIndex(short, "/"); idx >= 0 {
			short = short[idx+1:]
		}
		pullsByRepo[short]++
		addedByRepo[short] += p.Additions
	}
	// tokens map per agent not per repo, so keep zero
	keys := map[string]bool{}
	for _, r := range activity.Repos {
		short := r.Repo
		if idx := strings.LastIndex(short, "/"); idx >= 0 {
			short = short[idx+1:]
		}
		keys[short] = true
	}
	for k := range pullsByRepo {
		keys[k] = true
	}
	out := make([]RepoJoinPoint, 0, len(keys))
	for short := range keys {
		// find activity row
		var act *entireRepoAgg
		for i := range activity.Repos {
			s := activity.Repos[i].Repo
			if idx := strings.LastIndex(s, "/"); idx >= 0 {
				s = s[idx+1:]
			}
			if strings.EqualFold(s, short) {
				act = &activity.Repos[i]
				break
			}
		}
		cp := 0
		var agents map[string]int
		dominant := ""
		maxN := -1
		if act != nil {
			cp = act.Total
			agents = act.Agents
			for ag, n := range agents {
				if n > maxN {
					maxN = n
					dominant = ag
				}
			}
		}
		merged := pullsByRepo[short]
		added := addedByRepo[short]
		cpPerPR := 0.0
		if merged > 0 {
			cpPerPR = float64(cp) / float64(merged)
		}
		if cp == 0 && merged == 0 {
			continue
		}
		bubble := cp
		if bubble == 0 {
			bubble = merged * 5
		}
		// find full repo name
		full := short
		if act != nil {
			full = act.Repo
		}
		out = append(out, RepoJoinPoint{
			Repo: full, Short: short, Checkpoints: cp, MergedPRs: merged,
			Tokens: 0, DominantAgent: dominant, Agents: agents,
			AddedLines: added, BubbleSize: bubble, CpPerPR: cpPerPR,
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Checkpoints > out[j].Checkpoints })
	return out
}

type StreakGuard struct {
	Current         int     `json:"currentStreak"`
	Lifetime        int     `json:"lifetimeStreak"`
	LifetimeCurrent int     `json:"lifetimeCurrent"`
	StreakField     int     `json:"streak"`
	LastActiveDate  string  `json:"lastActiveDate"`
	DaysSinceActive int     `json:"daysSinceActive"`
	HoursLeftUTC    float64 `json:"hoursLeftUtc"`
	State           string  `json:"state"`
	Reason          string  `json:"reason"`
	NeedToday       bool    `json:"needToday"`
	ThroughputHint  string  `json:"throughputHint"`
}

func StreakGuardOf(stats entireStats, daily []entireDaily, now time.Time) StreakGuard {
	if now.IsZero() {
		now = time.Now().UTC()
	}
	sg := StreakGuard{
		Current: stats.CurrentStreak, Lifetime: stats.LifetimeStreak, LifetimeCurrent: stats.LifetimeCurrent, StreakField: stats.Streak,
	}
	// find last active date
	last := ""
	for _, d := range daily {
		sum := 0
		for _, v := range d.Agents {
			sum += v
		}
		if sum > 0 {
			if d.Date > last {
				last = d.Date
			}
		}
	}
	sg.LastActiveDate = last
	if last != "" {
		if t, err := time.Parse("2006-01-02", last); err == nil {
			todayStr := now.UTC().Format("2006-01-02")
			today, _ := time.Parse("2006-01-02", todayStr)
			days := int(today.Sub(t).Hours() / 24)
			if days < 0 {
				days = 0
			}
			sg.DaysSinceActive = days
		}
	}
	// hours left until next UTC midnight
	nextMidnight := time.Date(now.UTC().Year(), now.UTC().Month(), now.UTC().Day()+1, 0, 0, 0, 0, time.UTC)
	sg.HoursLeftUTC = nextMidnight.Sub(now).Hours()
	todayStr := now.UTC().Format("2006-01-02")
	needToday := last != todayStr
	sg.NeedToday = needToday && sg.Current > 0
	if sg.Current == 0 {
		if last == "" {
			sg.State = "unknown"
			sg.Reason = "No streak data yet"
		} else {
			sg.State = "broken"
			sg.Reason = "Streak broken"
		}
	} else if !needToday {
		sg.State = "safe"
		sg.Reason = "Checked in today — streak safe"
	} else if sg.HoursLeftUTC < 6 {
		sg.State = "at_risk"
		sg.Reason = "Streak at risk — checkpoint needed before 00:00 UTC"
	} else {
		sg.State = "at_risk"
		sg.Reason = "Checkpoint needed today to keep streak"
	}
	sg.ThroughputHint = strings.TrimSpace(strings.ReplaceAll(time.Duration(stats.Throughput*1000).String(), "µs", ""))
	if sg.ThroughputHint == "" {
		sg.ThroughputHint = "—"
	}
	return sg
}

type TokenCoachAgent struct {
	AgentID          string  `json:"agentId"`
	AgentLabel       string  `json:"agentLabel"`
	TokensPerCP      float64 `json:"tokensPerCp"`
	TokensPerFile    float64 `json:"tokensPerFile"`
	TokensPerSession float64 `json:"tokensPerSession"`
	TranscriptRatio  float64 `json:"transcriptRatio"`
	ToolMixShellPct  float64 `json:"shellPct"`
	ToolMixMCPPct    float64 `json:"mcpPct"`
	Tier             string  `json:"tier"`
	Tips             []string `json:"tips"`
}

type TokenCoach struct {
	RollupTokensPerCP   float64           `json:"rollupTokensPerCp"`
	RollupTokensPerFile float64           `json:"rollupTokensPerFile"`
	RollupThroughput    float64           `json:"throughput"`
	ByAgent             []TokenCoachAgent `json:"byAgent"`
	SummaryTip          string            `json:"summaryTip"`
	WastedEstTokens     int64             `json:"wastedEstTokens"`
}

const (
	TokenPerCP_Efficient = 1500
	TokenPerCP_Heavy     = 4000
	TranscriptRatioWarn  = 3.0
	ShellPctWarn         = 60
	MCPPctWarn           = 40
)

func TokenCoachOf(agents map[string]entireAgent, stats entireStats) TokenCoach {
	tc := TokenCoach{RollupThroughput: stats.Throughput}
	var totalTokens int64
	var totalCP int
	var totalFiles int
	var wasted int64
	var byAgent []TokenCoachAgent
	for _, ag := range agents {
		me := ag.Me
		tpc := 0.0
		if me.Checkpoints > 0 {
			tpc = float64(me.Tokens) / float64(me.Checkpoints)
		}
		tpf := 0.0
		if me.FilesChanged > 0 {
			tpf = float64(me.Tokens) / float64(me.FilesChanged)
		}
		tps := 0.0
		if me.Sessions > 0 {
			tps = float64(me.Tokens) / float64(me.Sessions)
		}
		ratio := 0.0
		if me.Tokens > 0 {
			ratio = float64(me.TranscriptTokens) / float64(me.Tokens)
		}
		mixTotal := 0
		if me.ToolMix != nil {
			mixTotal = me.ToolMix.Shell + me.ToolMix.FileOps + me.ToolMix.Search + me.ToolMix.MCP + me.ToolMix.Agent + me.ToolMix.Other
		}
		shellPct := 0.0
		mcpPct := 0.0
		if mixTotal > 0 && me.ToolMix != nil {
			shellPct = float64(me.ToolMix.Shell) / float64(mixTotal) * 100
			mcpPct = float64(me.ToolMix.MCP) / float64(mixTotal) * 100
		}
		tier := "efficient"
		if tpc > TokenPerCP_Heavy {
			tier = "heavy"
		} else if tpc > TokenPerCP_Efficient {
			tier = "moderate"
		}
		var tips []string
		if tpc > TokenPerCP_Heavy {
			tips = append(tips, "Heavy per-checkpoint — try smaller prompts")
		}
		if ratio > TranscriptRatioWarn {
			tips = append(tips, "Transcript churn — prune history")
		}
		if shellPct > ShellPctWarn {
			tips = append(tips, "Shell-heavy — batch file reads")
		}
		if mcpPct > MCPPctWarn {
			tips = append(tips, "MCP-heavy — check server caching")
		}
		if len(tips) > 3 {
			tips = tips[:3]
		}
		byAgent = append(byAgent, TokenCoachAgent{
			AgentID: ag.AgentID, AgentLabel: ag.AgentLabel,
			TokensPerCP: tpc, TokensPerFile: tpf, TokensPerSession: tps,
			TranscriptRatio: ratio, ToolMixShellPct: shellPct, ToolMixMCPPct: mcpPct,
			Tier: tier, Tips: tips,
		})
		totalTokens += me.Tokens
		totalCP += me.Checkpoints
		totalFiles += me.FilesChanged
		if me.TranscriptTokens > me.Tokens {
			wasted += me.TranscriptTokens - me.Tokens
		}
	}
	if totalCP > 0 {
		tc.RollupTokensPerCP = float64(totalTokens) / float64(totalCP)
	}
	if totalFiles > 0 {
		tc.RollupTokensPerFile = float64(totalTokens) / float64(totalFiles)
	}
	tc.WastedEstTokens = wasted
	sort.Slice(byAgent, func(i, j int) bool { return byAgent[i].TokensPerCP > byAgent[j].TokensPerCP })
	tc.ByAgent = byAgent
	if tc.RollupTokensPerCP > TokenPerCP_Heavy {
		tc.SummaryTip = "Heavy — keep checkpoints scoped to one task"
	} else if tc.RollupTokensPerCP > TokenPerCP_Efficient {
		tc.SummaryTip = "Moderate — coach: keep checkpoints scoped"
	} else {
		tc.SummaryTip = "Efficient — lean batching"
	}
	return tc
}
