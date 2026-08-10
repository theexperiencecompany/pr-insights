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
