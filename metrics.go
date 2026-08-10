package main

import (
	"sort"
	"strconv"
	"strings"
	"time"
)

// Metric is a leaderboard ranking dimension.
type Metric string

const (
	MetricDiff      Metric = "diff" // additions + deletions
	MetricAdditions Metric = "additions"
	MetricDeletions Metric = "deletions"
	MetricFiles     Metric = "files"
	MetricCommits   Metric = "commits"
)

func (m Metric) Valid() bool {
	switch m {
	case MetricDiff, MetricAdditions, MetricDeletions, MetricFiles, MetricCommits:
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
	}
	return string(m)
}

func (m Metric) Value(p Pull) int {
	switch m {
	case MetricDiff:
		return p.Additions + p.Deletions
	case MetricAdditions:
		return p.Additions
	case MetricDeletions:
		return p.Deletions
	case MetricFiles:
		return p.ChangedFiles
	case MetricCommits:
		return p.Commits
	}
	return 0
}

// RankedPull is a pull annotated with its leaderboard value.
type RankedPull struct {
	Pull  Pull
	Value int
}

// Rank returns pulls sorted by the metric, descending.
func Rank(pulls []Pull, m Metric) []RankedPull {
	out := make([]RankedPull, 0, len(pulls))
	for _, p := range pulls {
		out = append(out, RankedPull{Pull: p, Value: m.Value(p)})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Value != out[j].Value {
			return out[i].Value > out[j].Value
		}
		a, b := out[i].Pull, out[j].Pull
		if a.MergedAt != nil && b.MergedAt != nil && !a.MergedAt.Equal(*b.MergedAt) {
			return a.MergedAt.After(*b.MergedAt)
		}
		return a.Number > b.Number
	})
	return out
}

// Contributor aggregates all metrics for one author.
type Contributor struct {
	Login      string
	Merged     int
	Additions  int
	Deletions  int
	Files      int
	Commits    int
	AvgDiff    int
	Largest    *Pull
	ReposCount int
	First      *time.Time
	Last       *time.Time
}

// Contributors aggregates merged pulls per author, ranked by merge count.
func Contributors(pulls []Pull) []Contributor {
	byLogin := make(map[string]*Contributor)
	for i := range pulls {
		p := &pulls[i]
		if p.State != "MERGED" {
			continue
		}
		c := byLogin[p.Author]
		if c == nil {
			c = &Contributor{Login: p.Author}
			byLogin[p.Author] = c
		}
		c.Merged++
		c.Additions += p.Additions
		c.Deletions += p.Deletions
		c.Files += p.ChangedFiles
		c.Commits += p.Commits
		if p.MergedAt != nil {
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
	Total        int
	Merged       int
	Open         int
	Closed       int
	Additions    int
	Deletions    int
	AvgDiff      int
	Largest      *Pull
	Contributors int
	First        *time.Time
	Last         *time.Time
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
func MonthlySeries(pulls []Pull) []MonthStat {
	byMonth := make(map[string]*MonthStat)
	order := make([]string, 0)
	for i := range pulls {
		p := &pulls[i]
		if p.State != "MERGED" || p.MergedAt == nil {
			continue
		}
		key := p.MergedAt.UTC().Format("2006-01")
		st := byMonth[key]
		if st == nil {
			st = &MonthStat{Month: key, Label: p.MergedAt.UTC().Format("Jan 06")}
			byMonth[key] = st
			order = append(order, key)
		}
		st.Merged++
		st.Additions += p.Additions
		st.Deletions += p.Deletions
	}
	sort.Strings(order)
	out := make([]MonthStat, 0, len(order))
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

// SortPulls orders pulls by a leaderboard metric or a time field, descending.
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
	Label           string
	Merged          int
	Additions       int
	Deletions       int
	CycleMedianDays float64
	CycleCount      int
}

// ShippingSeries buckets merged pulls by merge time. repo filters to one
// repository ("" = all); since excludes older buckets (zero = all time).
func ShippingSeries(pulls []Pull, repo string, g Granularity, since time.Time) []ShipBucket {
	order := make([]string, 0)
	byKey := make(map[string]*ShipBucket)
	cycles := make(map[string][]float64)

	for i := range pulls {
		p := &pulls[i]
		if p.State != "MERGED" || p.MergedAt == nil {
			continue
		}
		if repo != "" && p.Repo != repo {
			continue
		}
		key, label := bucketKey(*p.MergedAt, g)
		if !since.IsZero() && key < bucketKeyFloor(since, g) {
			continue
		}
		b := byKey[key]
		if b == nil {
			b = &ShipBucket{Label: label}
			byKey[key] = b
			order = append(order, key)
		}
		b.Merged++
		b.Additions += p.Additions
		b.Deletions += p.Deletions
		cycles[key] = append(cycles[key], p.MergedAt.Sub(p.CreatedAt).Hours()/24)
	}

	sort.Strings(order)
	out := make([]ShipBucket, 0, len(order))
	for _, k := range order {
		b := byKey[k]
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

// CIBucket is one time bucket of workflow-run activity.
type CIBucket struct {
	Label             string
	Total             int
	Success           int
	Failure           int
	Other             int
	SuccessRate       float64
	MedianDurationMin float64
}

// CISeries buckets workflow runs by run start time.
func CISeries(runs []Run, repo string, g Granularity, since time.Time) []CIBucket {
	order := make([]string, 0)
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
			b = &CIBucket{Label: label}
			byKey[key] = b
			order = append(order, key)
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
	}

	sort.Strings(order)
	out := make([]CIBucket, 0, len(order))
	for _, k := range order {
		b := byKey[k]
		if b.Total > 0 {
			b.SuccessRate = float64(b.Success) / float64(b.Total) * 100
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
	Repo              string
	Workflow          string
	Runs              int
	Success           int
	SuccessRate       float64
	MedianDurationMin float64
	LastRunAt         *time.Time
	LastConclusion    string
}

// WorkflowStats aggregates runs per workflow, ranked by run count.
func WorkflowStats(runs []Run, repo string, since time.Time) []WorkflowStat {
	idx := make(map[string]*WorkflowStat)
	durations := make(map[string][]float64)
	order := make([]string, 0)

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
		if r.Conclusion == "success" {
			st.Success++
		}
		if r.Conclusion == "success" || r.Conclusion == "failure" {
			durations[key] = append(durations[key], float64(r.DurationSec)/60)
		}
		if st.LastRunAt == nil || r.CreatedAt.After(*st.LastRunAt) {
			t := r.CreatedAt
			st.LastRunAt = &t
			st.LastConclusion = r.Conclusion
		}
	}

	out := make([]WorkflowStat, 0, len(idx))
	for _, k := range order {
		st := idx[k]
		if st.Runs > 0 {
			st.SuccessRate = float64(st.Success) / float64(st.Runs) * 100
		}
		if d := durations[k]; len(d) > 0 {
			st.MedianDurationMin = medianFloat(d)
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
