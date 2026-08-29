package main

import (
	"sort"
	"strings"
	"sync"
	"time"
)

// pools for features.go
var heatmapPool = sync.Pool{
	New: func() any {
		m := make(map[string]int, 365)
		return &m
	},
}

var velocityPool = sync.Pool{
	New: func() any {
		s := make([]VelocityDelta, 0, 3)
		return &s
	},
}

// Additional analytics: velocity deltas, bot split, shipping distribution,
// streaks, bus factor, activity heatmaps, CI cost/trend extras. All derived
// from the pulls + runs already synced — no new API data needed.

// ---- velocity deltas ----

// VelocityDelta compares merged PRs in a period against the period before it.
type VelocityDelta struct {
	Label         string  `json:"label"` // "This week", "This month", "This year"
	Current       int     `json:"current"`
	Previous      int     `json:"previous"`
	DeltaPct      float64 `json:"deltaPct"` // percent change; 0 when previous was 0 (use IsNew badge instead of 100%)
	CurrentFrom   string  `json:"currentFrom"`   // YYYY-MM-DD inclusive start (UTC)
	CurrentTo     string  `json:"currentTo"`     // YYYY-MM-DD inclusive end (UTC)
	PreviousFrom  string  `json:"previousFrom"`  // YYYY-MM-DD inclusive start (UTC)
	PreviousTo    string  `json:"previousTo"`    // YYYY-MM-DD inclusive end (UTC)
	CurrentRange  string  `json:"currentRange"`  // human readable e.g. "Aug 25–29, 2026"
	PreviousRange string  `json:"previousRange"` // human readable
}

// IsNew reports whether this delta is a "new" signal (no previous merges).
func (v VelocityDelta) IsNew() bool {
	return v.Previous == 0 && v.Current > 0
}

func startOfWeekUTC(t time.Time) time.Time {
	utc := t.UTC()
	wd := (int(utc.Weekday()) + 6) % 7 // Monday = 0
	return time.Date(utc.Year(), utc.Month(), utc.Day(), 0, 0, 0, 0, time.UTC).AddDate(0, 0, -wd)
}

func countMergedBetween(pulls []Pull, from, to time.Time) int {
	n := 0
	for i := range pulls {
		if pulls[i].State != "MERGED" || pulls[i].MergedAt == nil {
			continue
		}
		t := *pulls[i].MergedAt
		if !t.Before(from) && t.Before(to) {
			n++
		}
	}
	return n
}

func isoDate(t time.Time) string {
	return t.UTC().Format("2006-01-02")
}

// humanRange formats [from, toExclusive) as a human-readable inclusive range.
// Examples: "Aug 25, 2026" (single day), "Aug 25–29, 2026" (same month), "Aug 25 – Sep 2, 2026" (cross month), "Dec 30, 2024 – Jan 5, 2025" (cross year).
func humanRange(from, toExclusive time.Time) string {
	if from.IsZero() || toExclusive.IsZero() {
		return ""
	}
	fromUTC := from.UTC()
	// inclusive end is the last instant before toExclusive
	toInclusive := toExclusive.Add(-time.Nanosecond).UTC()
	fromDate := time.Date(fromUTC.Year(), fromUTC.Month(), fromUTC.Day(), 0, 0, 0, 0, time.UTC)
	toDate := time.Date(toInclusive.Year(), toInclusive.Month(), toInclusive.Day(), 0, 0, 0, 0, time.UTC)
	if toDate.Before(fromDate) {
		return fromDate.Format("Jan 2, 2006")
	}
	if fromDate.Equal(toDate) {
		return fromDate.Format("Jan 2, 2006")
	}
	if fromDate.Year() == toDate.Year() && fromDate.Month() == toDate.Month() {
		return fromDate.Format("Jan 2") + "–" + toDate.Format("2, 2006")
	}
	if fromDate.Year() == toDate.Year() {
		return fromDate.Format("Jan 2") + " – " + toDate.Format("Jan 2, 2006")
	}
	return fromDate.Format("Jan 2, 2006") + " – " + toDate.Format("Jan 2, 2006")
}

// VelocityDeltas compares the current week/month/year against the previous
// one, based on merged-PR counts. DeltaPct is 0 when previous was 0 —
// callers should render a "New" badge via VelocityDelta.IsNew() instead of
// fabricating 100%.
func VelocityDeltas(pulls []Pull) []VelocityDelta {
	now := time.Now().UTC()
	weekStart := startOfWeekUTC(now)
	monthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
	yearStart := time.Date(now.Year(), 1, 1, 0, 0, 0, 0, time.UTC)
	periods := []struct {
		label string
		cur   time.Time
		prev  time.Time
	}{
		{"This week", weekStart, weekStart.AddDate(0, 0, -7)},
		{"This month", monthStart, monthStart.AddDate(0, -1, 0)},
		{"This year", yearStart, yearStart.AddDate(-1, 0, 0)},
	}
	out := make([]VelocityDelta, 0, len(periods))
	for _, p := range periods {
		cur := countMergedBetween(pulls, p.cur, now)
		prev := countMergedBetween(pulls, p.prev, p.cur)
		pct := 0.0
		if prev > 0 {
			pct = float64(cur-prev) / float64(prev) * 100
		}
		// Inclusive dates for tooltip
		currentFrom := isoDate(p.cur)
		// currentTo is last included day (now - 1ns)
		currentTo := ""
		previousFrom := isoDate(p.prev)
		previousTo := ""
		currentRange := ""
		previousRange := ""
		if !p.cur.IsZero() && !now.IsZero() {
			toInc := now.Add(-time.Nanosecond)
			// if now is at 00:00 exactly, toInc is previous day; isoDate will reflect that
			currentTo = isoDate(toInc)
			currentRange = humanRange(p.cur, now)
		}
		if !p.prev.IsZero() && !p.cur.IsZero() {
			previousTo = isoDate(p.cur.Add(-time.Nanosecond))
			previousRange = humanRange(p.prev, p.cur)
		}
		out = append(out, VelocityDelta{
			Label:         p.label,
			Current:       cur,
			Previous:      prev,
			DeltaPct:      pct,
			CurrentFrom:   currentFrom,
			CurrentTo:     currentTo,
			PreviousFrom:  previousFrom,
			PreviousTo:    previousTo,
			CurrentRange:  currentRange,
			PreviousRange: previousRange,
		})
	}
	return out
}

// ---- bot split ----

var knownBotLogins = map[string]bool{
	// core package managers / CI
	"dependabot": true, "dependabot[bot]": true, "renovate": true, "renovate[bot]": true,
	"github-actions": true, "github-actions[bot]": true, "app/renovate": true,
	// deployment / docs
	"mintlify": true, "vercel": true, "vercel[bot]": true, "netlify": true, "netlify[bot]": true,
	"posthog": true, "sentry": true, "blacksmith-sh": true,
	// code quality / coverage
	"snyk": true, "snyk-bot": true, "codecov": true, "codecov[bot]": true, "codecov-commenter": true,
	"sonarqube": true, "sonarcloud": true, "sonarcloud[bot]": true, "sonarqube[bot]": true,
	"codacy-bot": true, "codacy": true, "deepsource": true, "coveralls": true, "coveralls[bot]": true,
	"lgtm-com": true, "lgtm[bot]": true,
	// i18n / automation
	"crowdin": true, "weblate": true, "release-please": true, "release-please[bot]": true,
	"semantic-release-bot": true, "stale[bot]": true, "allcontributors[bot]": true,
	"all-contributors[bot]": true, "imgbot": true, "imgbot[bot]": true,
	// AI / review bots prevalent in the org and ecosystem
	"copilot-swe-agent": true, "coderabbitai": true, "coderabbitai[bot]": true, "open-swe": true,
	"greptile-apps": true, "greptile": true, "sweep[bot]": true, "sweep": true,
	"cursor[bot]": true, "codex-bot": true,
	// merge / bors
	"bors[bot]": true, "bors": true, "mergify": true, "mergify[bot]": true, "kodiak[bot]": true,
	// GitHub built-ins / cloud
	"github-advanced-security[bot]": true, "github-code-scanning[bot]": true,
	"cloudflare-pages[bot]": true, "cloudflare": true,
}

// IsBot classifies an author as automation: known bot logins plus the common
// "-bot"/"[bot]"/"_bot" login suffixes and well-known AI/review bot name patterns.
func IsBot(login string) bool {
	if knownBotLogins[login] {
		return true
	}
	l := strings.ToLower(login)
	if strings.HasSuffix(l, "-bot") || strings.HasSuffix(l, "[bot]") || strings.HasSuffix(l, "_bot") {
		return true
	}
	// AI / review assistants that don't follow the *-bot convention
	if strings.Contains(l, "coderabbit") || strings.Contains(l, "copilot") || strings.Contains(l, "greptile") || strings.Contains(l, "swe-agent") || strings.Contains(l, "open-swe") || strings.Contains(l, "cursor") || strings.Contains(l, "codex") {
		return true
	}
	return false
}

// BotSplit splits merged PRs into automation and human contributions.
type BotSplit struct {
	BotMerged   int      `json:"botMerged"`
	HumanMerged int      `json:"humanMerged"`
	BotPct      float64  `json:"botPct"`
	Bots        []string `json:"bots"`
}

func BotSplitOf(pulls []Pull) BotSplit {
	var out BotSplit
	seen := make(map[string]bool, 16)
	for i := range pulls {
		p := &pulls[i]
		if p.State != "MERGED" {
			continue
		}
		if IsBot(p.Author) {
			out.BotMerged++
			if !seen[p.Author] {
				seen[p.Author] = true
				out.Bots = append(out.Bots, p.Author)
			}
		} else {
			out.HumanMerged++
		}
	}
	total := out.BotMerged + out.HumanMerged
	if total > 0 {
		out.BotPct = float64(out.BotMerged) / float64(total) * 100
	}
	sort.Strings(out.Bots)
	return out
}

// ---- when do we ship ----

// ShipDistribution buckets merged PRs by local weekday and hour.
type ShipDistribution struct {
	Zone          string   `json:"zone"`
	Weekday       []int    `json:"weekday"` // Mon..Sun
	WeekdayLabels []string `json:"weekdayLabels"`
	Hour          []int    `json:"hour"` // 0..23
}

func ShipDistributionOf(pulls []Pull) ShipDistribution {
	out := ShipDistribution{
		Weekday:       make([]int, 7),
		Hour:          make([]int, 24),
		WeekdayLabels: []string{"Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"},
	}
	out.Zone = "UTC"
	for i := range pulls {
		p := &pulls[i]
		if p.State != "MERGED" || p.MergedAt == nil {
			continue
		}
		t := p.MergedAt.UTC()
		wd := (int(t.Weekday()) + 6) % 7 // Monday = 0
		out.Weekday[wd]++
		out.Hour[t.Hour()]++
	}
	return out
}

// ---- streaks ----

// WeeklyStreaks computes current and longest consecutive-week shipping
// streaks from a sorted list of "2006-01-02" ISO-week keys.
func WeeklyStreaks(weekKeys []string) (current, longest int) {
	if len(weekKeys) == 0 {
		return 0, 0
	}
	weeks := make(map[string]bool, len(weekKeys))
	for _, k := range weekKeys {
		weeks[k] = true
	}
	// Current streak: consecutive weeks ending at this week's key.
	thisWeek := startOfWeekUTC(time.Now()).Format("2006-01-02")
	if weeks[thisWeek] {
		current = 1
		for t := startOfWeekUTC(time.Now()).AddDate(0, 0, -7); weeks[t.Format("2006-01-02")]; t = t.AddDate(0, 0, -7) {
			current++
		}
	}
	// Longest streak: walk the sorted unique keys.
	unique := make([]string, 0, len(weeks))
	for k := range weeks {
		unique = append(unique, k)
	}
	sort.Strings(unique)
	run, best := 1, 1
	for i := 1; i < len(unique); i++ {
		a, _ := time.Parse("2006-01-02", unique[i-1])
		b, _ := time.Parse("2006-01-02", unique[i])
		if b.Sub(a) == 7*24*time.Hour {
			run++
		} else {
			run = 1
		}
		if run > best {
			best = run
		}
	}
	return current, best
}

// ---- bus factor ----

// BusFactor is the top-3 contributors' share of all merged PRs.
type BusFactor struct {
	Top3Share      float64       `json:"top3Share"`
	Top            []Contributor `json:"top"`
	PerRepoMax     float64       `json:"perRepoMax,omitempty"`
	PerRepoMaxRepo string        `json:"perRepoMaxRepo,omitempty"`
	TrendPct       float64       `json:"trendPct,omitempty"`
	PrevTop3Share  float64       `json:"prevTop3Share,omitempty"`
}

func BusFactorOf(contribs []Contributor, totalMerged int) BusFactor {
	top := contribs
	if len(top) > 3 {
		top = top[:3]
	}
	share := 0.0
	if totalMerged > 0 {
		sum := 0
		for _, c := range top {
			sum += c.Merged
		}
		share = float64(sum) / float64(totalMerged) * 100
	}
	return BusFactor{Top3Share: share, Top: top}
}

// ---- activity heatmap ----

// DayCount is one day's merged-PR count.
type DayCount struct {
	Date   string `json:"date"` // 2006-01-02 (UTC)
	Merged int    `json:"merged"`
}

// Heatmap returns per-day merged counts for the last `days` days
// (login "" = everyone).
func Heatmap(pulls []Pull, login string, days int) []DayCount {
	if days <= 0 {
		days = 365
	}
	byDay := make(map[string]int, days)
	for i := range pulls {
		p := &pulls[i]
		if p.State != "MERGED" || p.MergedAt == nil {
			continue
		}
		if login != "" && p.Author != login {
			continue
		}
		byDay[p.MergedAt.UTC().Format("2006-01-02")]++
	}
	out := make([]DayCount, 0, days)
	today := time.Now().UTC()
	for i := days - 1; i >= 0; i-- {
		d := today.AddDate(0, 0, -i).Format("2006-01-02")
		out = append(out, DayCount{Date: d, Merged: byDay[d]})
	}
	return out
}

// ---- contributor drill-down ----

// ContributorDetail is everything the drill-down view needs for one author.
type ContributorDetail struct {
	Login       string       `json:"login"`
	IsBot       bool         `json:"isBot"`
	Contributor Contributor  `json:"contributor"`
	Merged      []Pull       `json:"merged"` // newest first
	Monthly     []ShipBucket `json:"monthly"`
	Heatmap     []DayCount   `json:"heatmap"`
}

func ContributorDetailOf(pulls []Pull, login string) ContributorDetail {
	return ContributorDetailOfGran(pulls, login, GranMonth)
}

func ContributorDetailOfGran(pulls []Pull, login string, gran Granularity) ContributorDetail {
	detail := ContributorDetail{Login: login, IsBot: IsBot(login)}
	mine := make([]Pull, 0, 16)
	for _, p := range pulls {
		if p.Author == login {
			mine = append(mine, p)
		}
	}
	contribs := Contributors(mine)
	if len(contribs) > 0 {
		detail.Contributor = contribs[0]
	}
	merged := PullsByState(mine, "MERGED")
	SortPullsByMerged(merged)
	detail.Merged = merged
	if gran != GranWeek {
		gran = GranMonth
	}
	detail.Monthly = ShippingSeries(mine, "", gran, time.Time{})
	detail.Heatmap = Heatmap(mine, login, 365)
	return detail
}
