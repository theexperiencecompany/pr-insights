package main

import (
	"fmt"
	"testing"
	"time"
)

// synthetic pulls generator for benchmarks
func benchPulls(n int) []Pull {
	pulls := make([]Pull, n)
	base := time.Date(2025, 1, 6, 12, 0, 0, 0, time.UTC) // Monday
	for i := 0; i < n; i++ {
		merged := base.AddDate(0, 0, (i*3)%365)
		created := merged.AddDate(0, 0, -((i % 7) + 1))
		closed := merged
		pulls[i] = Pull{
			Number:       1000 + i,
			Title:        fmt.Sprintf("feat: bench pull %d", i),
			State:        "MERGED",
			Repo:         "gaia",
			Author:       fmt.Sprintf("user%d", i%20),
			CreatedAt:    created,
			UpdatedAt:    merged,
			MergedAt:     &merged,
			ClosedAt:     &closed,
			Additions:    (i*13)%500 + 10,
			Deletions:    (i*7)%200 + 5,
			ChangedFiles: (i % 10) + 1,
			Commits:      (i % 5) + 1,
			URL:          fmt.Sprintf("https://github.com/theexperiencecompany/gaia/pull/%d", 1000+i),
			IsBot:        i%10 == 0,
		}
	}
	return pulls
}

func BenchmarkShippingSeries(b *testing.B) {
	pulls := benchPulls(2000)
	gran := GranMonth
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = ShippingSeries(pulls, "", gran, time.Time{})
	}
}

func BenchmarkShippingSeriesCached(b *testing.B) {
	pulls := benchPulls(2000)
	gran := GranMonth
	ver := uint64(1)
	// warm cache
	_ = cachedShipping(pulls, "", gran, time.Time{}, ver)
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = cachedShipping(pulls, "", gran, time.Time{}, ver)
	}
}

func BenchmarkContributors(b *testing.B) {
	pulls := benchPulls(2000)
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = Contributors(pulls)
	}
}

func BenchmarkRepoStats(b *testing.B) {
	pulls := benchPulls(2000)
	repos := []RepoInfo{{Name: "gaia"}, {Name: "other"}}
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = RepoStats(pulls, repos)
	}
}

func BenchmarkHeatmap(b *testing.B) {
	pulls := benchPulls(2000)
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = Heatmap(pulls, "", 365)
	}
}

func BenchmarkMedianFloat(b *testing.B) {
	v := make([]float64, 100)
	for i := range v {
		v[i] = float64(i) * 1.1
	}
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = medianFloat(v)
	}
}

func BenchmarkMedianFloatPooled(b *testing.B) {
	// same as above but ensures pool path
	v := make([]float64, 64)
	for i := range v {
		v[i] = float64(i%30) + 0.5
	}
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = medianFloat(v)
	}
}

func BenchmarkCISeries(b *testing.B) {
	runs := make([]Run, 2000)
	base := time.Now().UTC().AddDate(0, -6, 0)
	for i := range runs {
		runs[i] = Run{
			ID:           int64(i + 1),
			Repo:         "gaia",
			Workflow:     "ci",
			Conclusion:   "success",
			CreatedAt:    base.Add(time.Duration(i) * time.Hour),
			RunStartedAt: base.Add(time.Duration(i)*time.Hour + time.Minute),
			DurationSec:  120 + i%300,
		}
	}
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = CISeries(runs, "", GranMonth, time.Time{})
	}
}

func BenchmarkSemanticBreakdown(b *testing.B) {
	pulls := benchPulls(2000)
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = SemanticBreakdown(pulls)
	}
}
