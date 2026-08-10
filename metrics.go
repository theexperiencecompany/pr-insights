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
