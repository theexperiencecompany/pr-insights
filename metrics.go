package main

import (
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Metric is a leaderboard ranking dimension.
type Metric string

const (
	MetricDiff           Metric = "diff" // additions + deletions
	MetricAdditions      Metric = "additions"
	MetricDeletions      Metric = "deletions"
	MetricFiles          Metric = "files"
	MetricCommits        Metric = "commits"
	MetricTimeToMerge    Metric = "timemerge" // hours open until merged
	MetricCommitsPerFile Metric = "commitsperfile"
	MetricAgeAtClose     Metric = "ageclose" // days until closed (unmerged)
)

func (m Metric) Valid() bool {
	switch m {
	case MetricDiff, MetricAdditions, MetricDeletions, MetricFiles, MetricCommits,
		MetricTimeToMerge, MetricCommitsPerFile, MetricAgeAtClose:
		return true
	}
	return false
}

func (m Metric) Label() string {
	switch m {
	case MetricDiff:
		return "Total lines"
	case MetricAdditions:
		return "Additions"
	case MetricDeletions:
		return "Deletions"
	case MetricFiles:
		return "Files changed"
	case MetricCommits:
		return "Commits"
	case MetricTimeToMerge:
		return "Time to merge"
	case MetricCommitsPerFile:
		return "Commits per file"
	case MetricAgeAtClose:
		return "Age when closed"
	}
	return string(m)
}

// Value returns the metric value for a pull. Time metrics are hours or days;
// commitsperfile is a ratio.
func (m Metric) Value(p Pull) float64 {
	switch m {
	case MetricDiff:
		return float64(p.Additions + p.Deletions)
	case MetricAdditions:
		return float64(p.Additions)
	case MetricDeletions:
		return float64(p.Deletions)
	case MetricFiles:
		return float64(p.ChangedFiles)
	case MetricCommits:
		return float64(p.Commits)
	case MetricTimeToMerge:
		if p.MergedAt != nil {
			return p.MergedAt.Sub(p.CreatedAt).Hours()
		}
		return 0
	case MetricCommitsPerFile:
		if p.ChangedFiles > 0 {
			return float64(p.Commits) / float64(p.ChangedFiles)
		}
		return 0
	case MetricAgeAtClose:
		if p.State == "CLOSED" && p.ClosedAt != nil {
			return p.ClosedAt.Sub(p.CreatedAt).Hours() / 24
		}
		return 0
	}
	return 0
}

// RankedPull is a pull annotated with its leaderboard value.
type RankedPull struct {
	Pull  Pull    `json:"pull"`
	Value float64 `json:"value"`
}

// Rank returns pulls sorted by the metric (asc=true for ascending order).
func Rank(pulls []Pull, m Metric, asc bool) []RankedPull {
	out := make([]RankedPull, 0, len(pulls))
	for _, p := range pulls {
		out = append(out, RankedPull{Pull: p, Value: m.Value(p)})
	}
	sort.Slice(out, func(i, j int) bool {
		a, b := out[i], out[j]
		if a.Value != b.Value {
			if asc {
				return a.Value < b.Value
			}
			return a.Value > b.Value
		}
		am, bm := a.Pull.MergedAt, b.Pull.MergedAt
		if am != nil && bm != nil && !am.Equal(*bm) {
			return am.After(*bm)
		}
		return a.Pull.Number > b.Pull.Number
	})
	return out
}

// Contributor aggregates all metrics for one author.
type Contributor struct {
	Login         string     `json:"login"`
	Merged        int        `json:"merged"`
	Additions     int        `json:"additions"`
	Deletions     int        `json:"deletions"`
	Files         int        `json:"files"`
	Commits       int        `json:"commits"`
	AvgDiff       int        `json:"avgDiff"`
	Largest       *Pull      `json:"largest,omitempty"`
	ReposCount    int        `json:"reposCount"`
	First         *time.Time `json:"first,omitempty"`
	Last          *time.Time `json:"last,omitempty"`
	CurrentStreak int        `json:"currentStreak"` // consecutive weeks with a merge, ending now
	LongestStreak int        `json:"longestStreak"`
	IsBot         bool       `json:"isBot"`
}

// Contributors aggregates merged pulls per author, ranked by merge count.
func Contributors(pulls []Pull) []Contributor {
	byLogin := make(map[string]*Contributor)
	reposByLogin := make(map[string]map[string]bool)
	weeksByLogin := make(map[string][]string)
	for i := range pulls {
		p := &pulls[i]
		if p.State != "MERGED" {
			continue
		}
		c := byLogin[p.Author]
		if c == nil {
			c = &Contributor{Login: p.Author}
			byLogin[p.Author] = c
			reposByLogin[p.Author] = make(map[string]bool)
		}
		c.Merged++
		c.Additions += p.Additions
		c.Deletions += p.Deletions
		c.Files += p.ChangedFiles
		c.Commits += p.Commits
		reposByLogin[p.Author][p.Repo] = true
		if p.MergedAt != nil {
			weeksByLogin[p.Author] = append(weeksByLogin[p.Author], startOfWeekUTC(*p.MergedAt).Format("2006-01-02"))
			if c.First == nil || p.MergedAt.Before(*c.First) {
				t := *p.MergedAt
				c.First = &t
			}
			if c.Last == nil || p.MergedAt.After(*c.Last) {
				t := *p.MergedAt
				c.Last = &t
			}
		}
		if c.Largest == nil || p.Additions+p.Deletions > c.Largest.Additions+c.Largest.Deletions {
			c.Largest = p
		}
	}
	out := make([]Contributor, 0, len(byLogin))
	for _, c := range byLogin {
		if c.Merged > 0 {
			c.AvgDiff = (c.Additions + c.Deletions) / c.Merged
			c.ReposCount = len(reposByLogin[c.Login])
			c.CurrentStreak, c.LongestStreak = WeeklyStreaks(weeksByLogin[c.Login])
			c.IsBot = IsBot(c.Login)
			out = append(out, *c)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Merged != out[j].Merged {
			return out[i].Merged > out[j].Merged
		}
		if out[i].Additions+out[i].Deletions != out[j].Additions+out[j].Deletions {
			return out[i].Additions+out[i].Deletions > out[j].Additions+out[j].Deletions
		}
		return out[i].Login < out[j].Login
	})
	return out
}

// RepoStat aggregates all pull activity per repository.
type RepoStat struct {
	RepoInfo
	Total        int        `json:"total"`
	Merged       int        `json:"merged"`
	Open         int        `json:"open"`
	Closed       int        `json:"closed"`
	Additions    int        `json:"additions"`
	Deletions    int        `json:"deletions"`
	AvgDiff      int        `json:"avgDiff"`
	Largest      *Pull      `json:"largest,omitempty"`
	Contributors int        `json:"contributors"`
	First        *time.Time `json:"first,omitempty"`
	Last         *time.Time `json:"last,omitempty"`
}

// RepoStats aggregates per-repo metrics, ranked by total PR count.
func RepoStats(pulls []Pull, repos []RepoInfo) []RepoStat {
	idx := make(map[string]*RepoStat, len(repos))
	for i := range repos {
		r := &repos[i]
		idx[r.Name] = &RepoStat{RepoInfo: *r}
	}
	contribByRepo := make(map[string]map[string]bool)
	for i := range pulls {
		p := &pulls[i]
		st := idx[p.Repo]
		if st == nil {
			st = &RepoStat{RepoInfo: RepoInfo{Name: p.Repo}}
			idx[p.Repo] = st
		}
		st.Total++
		switch p.State {
		case "MERGED":
			st.Merged++
			if p.MergedAt != nil {
				if st.First == nil || p.MergedAt.Before(*st.First) {
					t := *p.MergedAt
					st.First = &t
				}
				if st.Last == nil || p.MergedAt.After(*st.Last) {
					t := *p.MergedAt
					st.Last = &t
				}
			}
		case "OPEN":
			st.Open++
		case "CLOSED":
			st.Closed++
		}
		if p.State == "MERGED" {
			st.Additions += p.Additions
			st.Deletions += p.Deletions
			if st.Largest == nil || p.Additions+p.Deletions > st.Largest.Additions+st.Largest.Deletions {
				st.Largest = p
			}
		}
		cb := contribByRepo[p.Repo]
		if cb == nil {
			cb = make(map[string]bool)
			contribByRepo[p.Repo] = cb
		}
		cb[p.Author] = true
	}
	out := make([]RepoStat, 0, len(idx))
	for _, st := range idx {
		if st.Merged > 0 {
			st.AvgDiff = (st.Additions + st.Deletions) / st.Merged
		}
		st.Contributors = len(contribByRepo[st.Name])
		out = append(out, *st)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Total != out[j].Total {
			return out[i].Total > out[j].Total
		}
		return out[i].Name < out[j].Name
	})
	return out
}

// MonthStat is one month's pull activity (merged in that month).
type MonthStat struct {
	Month     string // "2006-01"
	Label     string // "Jan 26"
	Merged    int
	Additions int
	Deletions int
}

// MonthlySeries buckets merged pulls by merge month, oldest first.
func MonthlySeries(pulls []Pull) []ShipBucket {
	byMonth := make(map[string]*ShipBucket)
	order := make([]string, 0)

	for i := range pulls {
		p := &pulls[i]
		if p.State != "MERGED" || p.MergedAt == nil {
			continue
		}
		key := p.MergedAt.UTC().Format("2006-01")
		st := byMonth[key]
		if st == nil {
			st = &ShipBucket{Key: key, Label: p.MergedAt.UTC().Format("Jan 06")}
			byMonth[key] = st
			order = append(order, key)
		}
		st.Merged++
		st.Additions += p.Additions
		st.Deletions += p.Deletions
	}
	sort.Strings(order)
	out := make([]ShipBucket, 0, len(order))
	for _, k := range order {
		out = append(out, *byMonth[k])
	}
	return out
}

// PullsByState filters pulls by state ("" = all).
func PullsByState(pulls []Pull, state string) []Pull {
	if state == "" || state == "all" {
		return pulls
	}
	out := make([]Pull, 0, len(pulls))
	for _, p := range pulls {
		if strings.EqualFold(p.State, state) {
			out = append(out, p)
		}
	}
	return out
}

// SearchPulls filters by repo, state and a title/number search term.
func SearchPulls(pulls []Pull, repo, state, q string) []Pull {
	out := make([]Pull, 0, len(pulls))
	ql := strings.ToLower(strings.TrimSpace(q))
	for _, p := range pulls {
		if repo != "" && p.Repo != repo {
			continue
		}
		if state != "" && state != "all" && !strings.EqualFold(p.State, state) {
			continue
		}
		if ql != "" {
			if strings.Contains(strings.ToLower(p.Title), ql) {
				// match
			} else if num, err := strconv.Atoi(ql); err == nil && p.Number == num {
				// match
			} else {
				continue
			}
		}
		out = append(out, p)
	}
	return out
}

// SortPulls orders pulls by a leaderboard metric or, for metric == "",
// by last-updated time, descending.
func SortPulls(pulls []Pull, metric Metric) {
	sort.Slice(pulls, func(i, j int) bool {
		a, b := pulls[i], pulls[j]
		if metric == "" {
			if !a.UpdatedAt.Equal(b.UpdatedAt) {
				return a.UpdatedAt.After(b.UpdatedAt)
			}
			return a.Number > b.Number
		}
		av, bv := metric.Value(a), metric.Value(b)
		if av != bv {
			return av > bv
		}
		return a.Number > b.Number
	})
}

// CountState tallies pull states. Counts are returned as (open, merged, closed).
func CountState(pulls []Pull) (open, merged, closed int) {
	for _, p := range pulls {
		switch p.State {
		case "OPEN":
			open++
		case "MERGED":
			merged++
		case "CLOSED":
			closed++
		}
	}
	return
}

// Granularity is the time bucket used by the insight series.
type Granularity string

const (
	GranWeek  Granularity = "week"
	GranMonth Granularity = "month"
)

// bucketKey maps a time to its bucket key and label.
// Week buckets start on Mondays; labels are "Jan 6" / "Aug '26".
func bucketKey(t time.Time, g Granularity) (key, label string) {
	utc := t.UTC()
	if g == GranWeek {
		// Monday of the ISO week.
		wd := (int(utc.Weekday()) + 6) % 7
		monday := utc.AddDate(0, 0, -wd)
		m := time.Date(monday.Year(), monday.Month(), monday.Day(), 0, 0, 0, 0, time.UTC)
		return m.Format("2006-01-02"), m.Format("Jan 2")
	}
	return utc.Format("2006-01"), utc.Format("Jan 06")
}

// ShipBucket is one time bucket of merged-PR shipping activity.
type ShipBucket struct {
	Key             string  `json:"key"`
	Label           string  `json:"label"`
	Merged          int     `json:"merged"`
	Additions       int     `json:"additions"`
	Deletions       int     `json:"deletions"`
	CycleMedianDays float64 `json:"cycleMedianDays"`
	CycleCount      int     `json:"cycleCount"`
}

// ShippingSeries buckets merged pulls by merge time. repo filters to one
// repository ("" = all); since excludes older buckets (zero = all time).
func ShippingSeries(pulls []Pull, repo string, g Granularity, since time.Time) []ShipBucket {
	return ShippingSeriesRange(pulls, repo, g, since, time.Time{})
}

// ShippingSeriesRange is ShippingSeries with an optional upper bound.
func ShippingSeriesRange(pulls []Pull, repo string, g Granularity, from, to time.Time) []ShipBucket {
	byKey := make(map[string]*ShipBucket)
	cycles := make(map[string][]float64)
	floorKey := ""
	if !from.IsZero() {
		floorKey = bucketKeyFloor(from, g)
	}
	ceilKey := ""
	if !to.IsZero() {
		ceilKey = bucketKeyFloor(to, g)
	}

	for i := range pulls {
		p := &pulls[i]
		if p.State != "MERGED" || p.MergedAt == nil {
			continue
		}
		if repo != "" && p.Repo != repo {
			continue
		}
		key, label := bucketKey(*p.MergedAt, g)
		if floorKey != "" && key < floorKey {
			continue
		}
		if ceilKey != "" && key > ceilKey {
			continue
		}
		b := byKey[key]
		if b == nil {
			b = &ShipBucket{Key: key, Label: label}
			byKey[key] = b
		}
		b.Merged++
		b.Additions += p.Additions
		b.Deletions += p.Deletions
		cycles[key] = append(cycles[key], p.MergedAt.Sub(p.CreatedAt).Hours()/24)
	}

	// Build continuous bucket list zero-filling missing with Label via bucketKey.
	var keys []string
	if !from.IsZero() && !to.IsZero() {
		keys = continuousKeys(from, to, g)
	} else if !from.IsZero() && to.IsZero() {
		keys = continuousKeys(from, time.Now().UTC(), g)
	} else if from.IsZero() && !to.IsZero() {
		if len(byKey) > 0 {
			var minKey string
			for k := range byKey {
				if minKey == "" || k < minKey {
					minKey = k
				}
			}
			var minTime time.Time
			if g == GranWeek {
				minTime, _ = time.Parse("2006-01-02", minKey)
			} else {
				minTime, _ = time.Parse("2006-01", minKey)
			}
			keys = continuousKeys(minTime, to, g)
		}
	} else {
		if len(byKey) == 0 {
			return nil
		}
		var minKey, maxKey string
		for k := range byKey {
			if minKey == "" || k < minKey {
				minKey = k
			}
			if maxKey == "" || k > maxKey {
				maxKey = k
			}
		}
		var minTime, maxTime time.Time
		if g == GranWeek {
			minTime, _ = time.Parse("2006-01-02", minKey)
			maxTime, _ = time.Parse("2006-01-02", maxKey)
		} else {
			minTime, _ = time.Parse("2006-01", minKey)
			maxTime, _ = time.Parse("2006-01", maxKey)
		}
		keys = continuousKeys(minTime, maxTime, g)
	}
	if len(keys) == 0 {
		keys = make([]string, 0, len(byKey))
		for k := range byKey {
			keys = append(keys, k)
		}
		sort.Strings(keys)
	}
	out := make([]ShipBucket, 0, len(keys))
	for _, k := range keys {
		b := byKey[k]
		if b == nil {
			var t time.Time
			if g == GranWeek {
				t, _ = time.Parse("2006-01-02", k)
			} else {
				t, _ = time.Parse("2006-01", k)
			}
			_, label := bucketKey(t, g)
			b = &ShipBucket{Key: k, Label: label}
		}
		if c := cycles[k]; len(c) > 0 {
			b.CycleMedianDays = medianFloat(c)
			b.CycleCount = len(c)
		}
		out = append(out, *b)
	}
	return out
}

// bucketKeyFloor returns the earliest bucket key that must be kept.
func bucketKeyFloor(since time.Time, g Granularity) string {
	if g == GranWeek {
		key, _ := bucketKey(since, GranWeek)
		return key
	}
	return since.UTC().Format("2006-01")
}

// continuousKeys generates all bucket keys between from and to inclusive.
// Week keys are Mondays formatted as "2006-01-02", month keys as "2006-01".
func continuousKeys(from, to time.Time, g Granularity) []string {
	if from.IsZero() || to.IsZero() {
		return nil
	}
	fromUTC := from.UTC()
	toUTC := to.UTC()
	if g == GranWeek {
		startKey, _ := bucketKey(fromUTC, GranWeek)
		endKey, _ := bucketKey(toUTC, GranWeek)
		start, err1 := time.Parse("2006-01-02", startKey)
		end, err2 := time.Parse("2006-01-02", endKey)
		if err1 != nil || err2 != nil || start.After(end) {
			return nil
		}
		var keys []string
		for cur := start; !cur.After(end); cur = cur.AddDate(0, 0, 7) {
			keys = append(keys, cur.Format("2006-01-02"))
		}
		return keys
	}
	// month
	startKey := fromUTC.Format("2006-01")
	endKey := toUTC.Format("2006-01")
	start, err1 := time.Parse("2006-01", startKey)
	end, err2 := time.Parse("2006-01", endKey)
	if err1 != nil || err2 != nil || start.After(end) {
		return nil
	}
	var keys []string
	for cur := start; !cur.After(end); cur = cur.AddDate(0, 1, 0) {
		keys = append(keys, cur.Format("2006-01"))
	}
	return keys
}

// CIBucket is one time bucket of workflow-run activity.
type CIBucket struct {
	Key               string  `json:"key"`
	Label             string  `json:"label"`
	Total             int     `json:"total"`
	Success           int     `json:"success"`
	Failure           int     `json:"failure"`
	Other             int     `json:"other"`
	SuccessRate       float64 `json:"successRate"`
	MedianDurationMin float64 `json:"medianDurationMin"`
	TotalMinutes      int     `json:"totalMinutes"`
}

// CISeries buckets workflow runs by run start time.
func CISeries(runs []Run, repo string, g Granularity, since time.Time) []CIBucket {
	byKey := make(map[string]*CIBucket)
	durations := make(map[string][]float64)

	for i := range runs {
		r := &runs[i]
		if r.RunStartedAt.IsZero() {
			continue
		}
		if repo != "" && r.Repo != repo {
			continue
		}
		key, label := bucketKey(r.RunStartedAt, g)
		if !since.IsZero() && key < bucketKeyFloor(since, g) {
			continue
		}
		b := byKey[key]
		if b == nil {
			b = &CIBucket{Key: key, Label: label}
			byKey[key] = b
		}
		b.Total++
		switch r.Conclusion {
		case "success":
			b.Success++
		case "failure":
			b.Failure++
		default:
			b.Other++
		}
		if r.Conclusion == "success" || r.Conclusion == "failure" {
			durations[key] = append(durations[key], float64(r.DurationSec)/60)
		}
		b.TotalMinutes += r.DurationSec / 60
	}

	var keys []string
	if !since.IsZero() {
		keys = continuousKeys(since, time.Now().UTC(), g)
	} else {
		if len(byKey) == 0 {
			return nil
		}
		var minKey, maxKey string
		for k := range byKey {
			if minKey == "" || k < minKey {
				minKey = k
			}
			if maxKey == "" || k > maxKey {
				maxKey = k
			}
		}
		var minTime, maxTime time.Time
		if g == GranWeek {
			minTime, _ = time.Parse("2006-01-02", minKey)
			maxTime, _ = time.Parse("2006-01-02", maxKey)
		} else {
			minTime, _ = time.Parse("2006-01", minKey)
			maxTime, _ = time.Parse("2006-01", maxKey)
		}
		keys = continuousKeys(minTime, maxTime, g)
	}
	if len(keys) == 0 {
		keys = make([]string, 0, len(byKey))
		for k := range byKey {
			keys = append(keys, k)
		}
		sort.Strings(keys)
	}
	out := make([]CIBucket, 0, len(keys))
	for _, k := range keys {
		b := byKey[k]
		if b == nil {
			var t time.Time
			if g == GranWeek {
				t, _ = time.Parse("2006-01-02", k)
			} else {
				t, _ = time.Parse("2006-01", k)
			}
			_, label := bucketKey(t, g)
			b = &CIBucket{Key: k, Label: label}
		}
		if denom := b.Success + b.Failure; denom > 0 {
			b.SuccessRate = float64(b.Success) / float64(denom) * 100
		}
		if d := durations[k]; len(d) > 0 {
			b.MedianDurationMin = medianFloat(d)
		}
		out = append(out, *b)
	}
	return out
}

// WorkflowStat aggregates CI stats per workflow.
type WorkflowStat struct {
	Repo               string     `json:"repo"`
	Workflow           string     `json:"workflow"`
	Runs               int        `json:"runs"`
	Success            int        `json:"success"`
	Failure            int        `json:"failure"`
	Other              int        `json:"other"`
	SuccessRate        float64    `json:"successRate"`
	MedianDurationMin  float64    `json:"medianDurationMin"`
	LongestDurationMin float64    `json:"longestDurationMin"`
	Trend              []float64  `json:"trend"` // monthly success-rate %, oldest first (last 6 months)
	LastRunAt          *time.Time `json:"lastRunAt,omitempty"`
	LastConclusion     string     `json:"lastConclusion"`
}

// WorkflowStats aggregates runs per workflow, ranked by run count.
func WorkflowStats(runs []Run, repo string, since time.Time) []WorkflowStat {
	idx := make(map[string]*WorkflowStat)
	durations := make(map[string][]float64)
	order := make([]string, 0)

	type monthly struct {
		total   int
		success int
		failure int
	}
	monthlyByWF := make(map[string]map[string]*monthly)

	for i := range runs {
		r := &runs[i]
		if repo != "" && r.Repo != repo {
			continue
		}
		if !since.IsZero() && r.CreatedAt.Before(since) {
			continue
		}
		key := r.Repo + "/" + r.Workflow
		st := idx[key]
		if st == nil {
			st = &WorkflowStat{Repo: r.Repo, Workflow: r.Workflow}
			idx[key] = st
			order = append(order, key)
		}
		st.Runs++
		switch r.Conclusion {
		case "success":
			st.Success++
		case "failure":
			st.Failure++
		default:
			st.Other++
		}
		if r.Conclusion == "success" || r.Conclusion == "failure" {
			durations[key] = append(durations[key], float64(r.DurationSec)/60)
		}
		if r.Conclusion == "success" || r.Conclusion == "failure" {
			if r.DurationSec > int(st.LongestDurationMin*60) {
				st.LongestDurationMin = float64(r.DurationSec) / 60
			}
		}
		if st.LastRunAt == nil || r.CreatedAt.After(*st.LastRunAt) {
			t := r.CreatedAt
			st.LastRunAt = &t
			st.LastConclusion = r.Conclusion
		}
		// monthly trend (last 6 months)
		monthKey := r.CreatedAt.UTC().Format("2006-01")
		mb := monthlyByWF[key]
		if mb == nil {
			mb = make(map[string]*monthly)
			monthlyByWF[key] = mb
		}
		m := mb[monthKey]
		if m == nil {
			m = &monthly{}
			mb[monthKey] = m
		}
		m.total++
		switch r.Conclusion {
		case "success":
			m.success++
		case "failure":
			m.failure++
		}
	}

	out := make([]WorkflowStat, 0, len(idx))
	for _, k := range order {
		st := idx[k]
		if denom := st.Success + st.Failure; denom > 0 {
			st.SuccessRate = float64(st.Success) / float64(denom) * 100
		}
		if d := durations[k]; len(d) > 0 {
			st.MedianDurationMin = medianFloat(d)
		}
		// trend: last 6 month keys, oldest first
		now := time.Now().UTC()
		mb := monthlyByWF[k]
		for i := 5; i >= 0; i-- {
			mk := now.AddDate(0, -i, 0).Format("2006-01")
			if m := mb[mk]; m != nil {
				if denom := m.success + m.failure; denom > 0 {
					st.Trend = append(st.Trend, float64(m.success)/float64(denom)*100)
				} else {
					st.Trend = append(st.Trend, -1)
				}
			} else {
				st.Trend = append(st.Trend, -1) // no runs that month
			}
		}
		out = append(out, *st)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Runs != out[j].Runs {
			return out[i].Runs > out[j].Runs
		}
		return out[i].Repo+"|"+out[i].Workflow < out[j].Repo+"|"+out[j].Workflow
	})
	return out
}



// ---- semantic PR types ----

// semanticRe matches conventional commit prefixes: feat, fix, chore, docs, style,
// refactor, perf, test, build, ci, revert with optional scope and optional breaking !
// Examples: "feat: add login", "fix(api)!: handle edge", "chore(deps): bump foo"
var semanticRe = regexp.MustCompile(`^(feat|fix|chore|docs|style|refactor|perf|test|build|ci|revert)(\([^)]+\))?!?:\s`)

// SemanticTypes is the canonical ordered list of semantic types plus "other".
var SemanticTypes = []string{"feat", "fix", "chore", "docs", "style", "refactor", "perf", "test", "build", "ci", "revert", "other"}

// PRTypeOf classifies a PR title into its conventional-commit type or "other".
// It uses the regex ^(feat|fix|chore|...)(\([^)]+\))?!?:\s with case-insensitive matching
// via lowercasing. Titles that do not match are classified as "other".
func PRTypeOf(title string) string {
	t := strings.TrimSpace(strings.ToLower(title))
	m := semanticRe.FindStringSubmatch(t)
	if m == nil {
		return "other"
	}
	return m[1]
}

// SemanticSlice is one slice of the semantic pie: count and share of a type.
type SemanticSlice struct {
	Type    string  `json:"type"`
	Count   int     `json:"count"`
	Percent float64 `json:"percent"`
}

// SemanticBucket is one time bucket's semantic distribution for the stacked area.
type SemanticBucket struct {
	Key    string         `json:"key"`
	Label  string         `json:"label"`
	Total  int            `json:"total"`
	Counts map[string]int `json:"counts"`
}

// SemanticOverview bundles the pie and the stacked timeline, exposed via OverviewData.
type SemanticOverview struct {
	ByType   []SemanticSlice  `json:"byType"`
	Timeline []SemanticBucket `json:"timeline"`
}

// SemanticBreakdown counts all pulls per semantic type, sorted by count desc.
// Percent is share of total pulls (0-100). Only types with count>0 are returned.
func SemanticBreakdown(pulls []Pull) []SemanticSlice {
	counts := make(map[string]int, len(SemanticTypes))
	for i := range pulls {
		t := PRTypeOf(pulls[i].Title)
		counts[t]++
	}
	total := len(pulls)
	out := make([]SemanticSlice, 0, len(SemanticTypes))
	for _, typ := range SemanticTypes {
		c := counts[typ]
		if c == 0 {
			continue
		}
		pct := 0.0
		if total > 0 {
			pct = float64(c) / float64(total) * 100
		}
		out = append(out, SemanticSlice{Type: typ, Count: c, Percent: pct})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Count != out[j].Count {
			return out[i].Count > out[j].Count
		}
		return out[i].Type < out[j].Type
	})
	return out
}

// SemanticTimeline buckets pulls by CreatedAt into continuous weekly or monthly
// buckets (zero-filled) and counts semantic types per bucket. The timeline
// total across all buckets always equals len(pulls), which lets the stacked
// 100% area represent evolution of type share over time.
func SemanticTimeline(pulls []Pull, gran Granularity) []SemanticBucket {
	if len(pulls) == 0 {
		return nil
	}
	if gran != GranWeek {
		gran = GranMonth
	}
	byKey := make(map[string]*SemanticBucket)
	var minTime, maxTime time.Time
	for i := range pulls {
		p := &pulls[i]
		key, label := bucketKey(p.CreatedAt, gran)
		b := byKey[key]
		if b == nil {
			b = &SemanticBucket{Key: key, Label: label, Counts: make(map[string]int)}
			byKey[key] = b
		}
		typ := PRTypeOf(p.Title)
		b.Counts[typ]++
		b.Total++
		if minTime.IsZero() || p.CreatedAt.Before(minTime) {
			minTime = p.CreatedAt
		}
		if maxTime.IsZero() || p.CreatedAt.After(maxTime) {
			maxTime = p.CreatedAt
		}
	}
	keys := continuousKeys(minTime, maxTime, gran)
	if len(keys) == 0 {
		// Fallback: sorted keys of observed buckets
		keys = make([]string, 0, len(byKey))
		for k := range byKey {
			keys = append(keys, k)
		}
		sort.Strings(keys)
	}
	out := make([]SemanticBucket, 0, len(keys))
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
			b = &SemanticBucket{Key: k, Label: label, Counts: make(map[string]int)}
		}
		// Ensure every type key exists in Counts for stable stacked rendering
		// (Recharts expects missing series to be 0, but explicit 0 helps tooltip).
		// We keep map sparse to save JSON size — frontend treats missing as 0.
		out = append(out, *b)
	}
	return out
}

// medianFloat returns the median of a numeric slice (0 for empty).
func medianFloat(v []float64) float64 {
	if len(v) == 0 {
		return 0
	}
	sorted := make([]float64, len(v))
	copy(sorted, v)
	sort.Float64s(sorted)
	mid := len(sorted) / 2
	if len(sorted)%2 == 1 {
		return sorted[mid]
	}
	return (sorted[mid-1] + sorted[mid]) / 2
}
