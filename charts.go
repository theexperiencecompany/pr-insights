package main

import (
	"fmt"
	"html/template"
	"math"
	"strings"
)

// Chart rendering is done server-side as inline SVG so the dashboard has zero
// JS chart dependencies. Colours reference CSS variables and therefore adapt
// to light/dark mode automatically.

const (
	chartW = 640
	chartH = 240
	padL   = 42
	padR   = 8
	padT   = 14
	padB   = 26
)

// niceCeiling rounds n up to the nearest "nice" number (1/2/5 × 10^k).
func niceCeiling(n int) int {
	if n <= 0 {
		return 1
	}
	exp := int(math.Floor(math.Log10(float64(n))))
	base := int(math.Pow10(exp))
	unit := float64(n) / float64(base)
	switch {
	case unit <= 1:
		return base
	case unit <= 2:
		return 2 * base
	case unit <= 5:
		return 5 * base
	default:
		return 10 * base
	}
}

// niceCeilingF rounds v up to the nearest "nice" number (1/2/5 × 10^k).
func niceCeilingF(v float64) float64 {
	if v <= 0 {
		return 1
	}
	exp := math.Floor(math.Log10(v))
	base := math.Pow10(int(exp))
	unit := v / base
	switch {
	case unit <= 1:
		return base
	case unit <= 2:
		return 2 * base
	case unit <= 5:
		return 5 * base
	default:
		return 10 * base
	}
}

// fmtValue renders a chart value with an optional unit ("12", "12%", "2.4d").
func fmtValue(v float64, unit string) string {
	if unit == "d" && v < 10 {
		return fmt.Sprintf("%.1fd", v)
	}
	return fmt.Sprintf("%s%s", compact(int(math.Round(v))), unit)
}

// lineChartSVG renders a line/area chart. color is a CSS class suffix
// ("accent", "add", "del", "other"); yMax <= 0 means auto-scale.
func lineChartSVG(labels []string, values []float64, unit, color, title string, yMax float64) template.HTML {
	if len(labels) == 0 || len(labels) != len(values) {
		return template.HTML("")
	}
	max := yMax
	if max <= 0 {
		for _, v := range values {
			if v > max {
				max = v
			}
		}
	}
	ceiling := niceCeilingF(max)

	plotW := chartW - padL - padR
	plotH := chartH - padT - padB
	slot := float64(plotW) / float64(len(labels))

	var b strings.Builder
	fmt.Fprintf(&b, `<svg class="chart" viewBox="0 0 %d %d" role="img" aria-label="%s">`, chartW, chartH, title)

	for i := 0; i <= 4; i++ {
		y := padT + float64(i)*float64(plotH)/4
		val := ceiling - float64(i)*ceiling/4
		fmt.Fprintf(&b, `<line class="chart-gridline" x1="%d" y1="%.1f" x2="%d" y2="%.1f"/>`, padL, y, chartW-padR, y)
		fmt.Fprintf(&b, `<text class="chart-ytick" x="%d" y="%.1f">%s</text>`, padL-6, y+4, fmtValue(val, unit))
	}
	fmt.Fprintf(&b, `<line class="chart-baseline" x1="%d" y1="%.1f" x2="%d" y2="%.1f"/>`, padL, float64(padT+plotH), chartW-padR, float64(padT+plotH))

	pts := make([][2]float64, len(values))
	for i, v := range values {
		x := padL + float64(i)*slot + slot/2
		y := float64(padT+plotH) - v/ceiling*float64(plotH)
		pts[i] = [2]float64{x, y}
	}

	// area fill
	area := fmt.Sprintf(`M%.1f %.1f`, pts[0][0], float64(padT+plotH))
	for _, p := range pts {
		area += fmt.Sprintf(` L%.1f %.1f`, p[0], p[1])
	}
	area += fmt.Sprintf(` L%.1f %.1f Z`, pts[len(pts)-1][0], float64(padT+plotH))
	fmt.Fprintf(&b, `<path class="chart-area chart-area-%s" d="%s"/>`, color, area)

	// line
	line := fmt.Sprintf(`M%.1f %.1f`, pts[0][0], pts[0][1])
	for _, p := range pts[1:] {
		line += fmt.Sprintf(` L%.1f %.1f`, p[0], p[1])
	}
	fmt.Fprintf(&b, `<path class="chart-line chart-line-%s" d="%s"/>`, color, line)

	// dots + labels
	labelEvery := 1
	if len(labels) > 16 {
		labelEvery = 2
	}
	for i, p := range pts {
		fmt.Fprintf(&b, `<circle class="chart-dot chart-dot-%s" cx="%.1f" cy="%.1f" r="2.5"><title>%s — %s</title></circle>`,
			color, p[0], p[1], labels[i], fmtValue(values[i], unit))
		if labelEvery == 1 || i%2 == 0 {
			fmt.Fprintf(&b, `<text class="chart-xlabel" x="%.1f" y="%.1f" text-anchor="middle">%s</text>`, p[0], float64(chartH-8), labels[i])
		}
	}
	b.WriteString(`</svg>`)
	return template.HTML(b.String())
}

// ciRunsBarsSVG renders workflow runs per bucket as stacked bars
// (success / failure / other).
func ciRunsBarsSVG(buckets []CIBucket) template.HTML {
	if len(buckets) == 0 {
		return template.HTML("")
	}
	max := 0
	for _, b := range buckets {
		if b.Total > max {
			max = b.Total
		}
	}
	ceiling := niceCeiling(max)

	plotW := chartW - padL - padR
	plotH := chartH - padT - padB
	slot := float64(plotW) / float64(len(buckets))
	barW := slot * 0.62

	var b strings.Builder
	b.WriteString(`<svg class="chart" viewBox="0 0 640 240" role="img" aria-label="Workflow runs by time bucket">`)

	for i := 0; i <= 4; i++ {
		y := padT + float64(i)*float64(plotH)/4
		val := ceiling - i*ceiling/4
		fmt.Fprintf(&b, `<line class="chart-gridline" x1="%d" y1="%.1f" x2="%d" y2="%.1f"/>`, padL, y, chartW-padR, y)
		fmt.Fprintf(&b, `<text class="chart-ytick" x="%d" y="%.1f">%s</text>`, padL-6, y+4, compact(val))
	}
	fmt.Fprintf(&b, `<line class="chart-baseline" x1="%d" y1="%.1f" x2="%d" y2="%.1f"/>`, padL, float64(padT+plotH), chartW-padR, float64(padT+plotH))

	labelEvery := 1
	if len(buckets) > 16 {
		labelEvery = 2
	}
	type seg struct {
		class string
		n     int
	}
	for i, cb := range buckets {
		baseY := float64(padT + plotH)
		x := padL + float64(i)*slot + (slot-barW)/2
		segments := []seg{{"chart-bar-success", cb.Success}, {"chart-bar-failure", cb.Failure}, {"chart-bar-other", cb.Other}}
		tooltip := fmt.Sprintf("%s — %d runs, %d ok, %d failed", cb.Label, cb.Total, cb.Success, cb.Failure)
		for _, s := range segments {
			if s.n == 0 {
				continue
			}
			h := float64(s.n) / float64(ceiling) * float64(plotH)
			topY := baseY - h
			fmt.Fprintf(&b, `<rect class="%s" x="%.1f" y="%.1f" width="%.1f" height="%.1f" rx="2"><title>%s</title></rect>`,
				s.class, x, topY, barW, h, tooltip)
			baseY = topY
		}
		if cb.Total > 0 {
			fmt.Fprintf(&b, `<text class="chart-vlabel" x="%.1f" y="%.1f" text-anchor="middle">%s</text>`, x+barW/2, baseY-3, compact(cb.Total))
		}
		if labelEvery == 1 || i%2 == 0 {
			fmt.Fprintf(&b, `<text class="chart-xlabel" x="%.1f" y="%.1f" text-anchor="middle">%s</text>`, x+barW/2, float64(chartH-8), cb.Label)
		}
	}
	b.WriteString(`</svg>`)
	return template.HTML(b.String())
}

// compact renders 12345 as "12.3k" and 1234567 as "1.2M".
func compact(n int) string {
	abs := n
	if abs < 0 {
		abs = -abs
	}
	switch {
	case abs >= 1_000_000:
		return fmt.Sprintf("%.1fM", float64(n)/1_000_000)
	case abs >= 10_000:
		return fmt.Sprintf("%.1fk", float64(n)/1_000)
	default:
		return comma(n)
	}
}

// monthBarsSVG renders a vertical bar chart of monthly values.
func monthBarsSVG(series []MonthStat, value func(MonthStat) int, accent string, title string) template.HTML {
	if len(series) == 0 {
		return template.HTML("")
	}
	max := 0
	for _, m := range series {
		if v := value(m); v > max {
			max = v
		}
	}
	ceiling := niceCeiling(max)

	plotW := chartW - padL - padR
	plotH := chartH - padT - padB
	slot := float64(plotW) / float64(len(series))
	barW := slot * 0.62

	var b strings.Builder
	fmt.Fprintf(&b, `<svg class="chart" viewBox="0 0 %d %d" role="img" aria-label="%s">`, chartW, chartH, title)

	// gridlines + y labels
	for i := 0; i <= 4; i++ {
		y := padT + float64(i)*float64(plotH)/4
		val := ceiling - i*ceiling/4
		fmt.Fprintf(&b, `<line class="chart-gridline" x1="%d" y1="%.1f" x2="%d" y2="%.1f"/>`, padL, y, chartW-padR, y)
		fmt.Fprintf(&b, `<text class="chart-ytick" x="%d" y="%.1f">%s</text>`, padL-6, y+4, compact(val))
	}

	// baseline
	fmt.Fprintf(&b, `<line class="chart-baseline" x1="%d" y1="%.1f" x2="%d" y2="%.1f"/>`, padL, float64(padT+plotH), chartW-padR, float64(padT+plotH))

	// bars
	labelEvery := 1
	if len(series) > 16 {
		labelEvery = 2
	}
	for i, m := range series {
		v := value(m)
		h := 0.0
		if v > 0 {
			h = float64(v) / float64(ceiling) * float64(plotH)
		}
		x := padL + float64(i)*slot + (slot-barW)/2
		y := float64(padT+plotH) - h
		fmt.Fprintf(&b, `<rect class="chart-bar chart-bar-%s" x="%.1f" y="%.1f" width="%.1f" height="%.1f" rx="2"><title>%s — %s</title></rect>`,
			accent, x, y, barW, h, m.Label, comma(v))
		if v > 0 {
			fmt.Fprintf(&b, `<text class="chart-vlabel" x="%.1f" y="%.1f" text-anchor="middle">%s</text>`, x+barW/2, y-3, compact(v))
		}
		if labelEvery == 1 || i%2 == 0 {
			fmt.Fprintf(&b, `<text class="chart-xlabel" x="%.1f" y="%.1f" text-anchor="middle">%s</text>`, x+barW/2, float64(chartH-8), m.Label)
		}
	}
	b.WriteString(`</svg>`)
	return template.HTML(b.String())
}

// monthStackedBarsSVG renders monthly additions + deletions as stacked bars.
func monthStackedBarsSVG(series []MonthStat) template.HTML {
	if len(series) == 0 {
		return template.HTML("")
	}
	max := 0
	for _, m := range series {
		if v := m.Additions + m.Deletions; v > max {
			max = v
		}
	}
	ceiling := niceCeiling(max)

	plotW := chartW - padL - padR
	plotH := chartH - padT - padB
	slot := float64(plotW) / float64(len(series))
	barW := slot * 0.62

	var b strings.Builder
	b.WriteString(`<svg class="chart" viewBox="0 0 640 240" role="img" aria-label="Lines changed by month">`)

	for i := 0; i <= 4; i++ {
		y := padT + float64(i)*float64(plotH)/4
		val := ceiling - i*ceiling/4
		fmt.Fprintf(&b, `<line class="chart-gridline" x1="%d" y1="%.1f" x2="%d" y2="%.1f"/>`, padL, y, chartW-padR, y)
		fmt.Fprintf(&b, `<text class="chart-ytick" x="%d" y="%.1f">%s</text>`, padL-6, y+4, compact(val))
	}
	fmt.Fprintf(&b, `<line class="chart-baseline" x1="%d" y1="%.1f" x2="%d" y2="%.1f"/>`, padL, float64(padT+plotH), chartW-padR, float64(padT+plotH))

	labelEvery := 1
	if len(series) > 16 {
		labelEvery = 2
	}
	for i, m := range series {
		baseY := float64(padT + plotH)
		x := padL + float64(i)*slot + (slot-barW)/2

		addH := 0.0
		if m.Additions > 0 {
			addH = float64(m.Additions) / float64(ceiling) * float64(plotH)
		}
		delH := 0.0
		if m.Deletions > 0 {
			delH = float64(m.Deletions) / float64(ceiling) * float64(plotH)
		}

		addY := baseY - addH
		delY := addY - delH
		total := m.Additions + m.Deletions

		fmt.Fprintf(&b, `<rect class="chart-bar chart-bar-add" x="%.1f" y="%.1f" width="%.1f" height="%.1f" rx="2"><title>%s — +%s added</title></rect>`,
			x, addY, barW, addH, m.Label, comma(m.Additions))
		fmt.Fprintf(&b, `<rect class="chart-bar chart-bar-del" x="%.1f" y="%.1f" width="%.1f" height="%.1f" rx="2"><title>%s — %s deleted</title></rect>`,
			x, delY, barW, delH, m.Label, comma(m.Deletions))
		if total > 0 {
			fmt.Fprintf(&b, `<text class="chart-vlabel" x="%.1f" y="%.1f" text-anchor="middle">%s</text>`, x+barW/2, delY-3, compact(total))
		}
		if labelEvery == 1 || i%2 == 0 {
			fmt.Fprintf(&b, `<text class="chart-xlabel" x="%.1f" y="%.1f" text-anchor="middle">%s</text>`, x+barW/2, float64(chartH-8), m.Label)
		}
	}
	b.WriteString(`</svg>`)
	return template.HTML(b.String())
}
