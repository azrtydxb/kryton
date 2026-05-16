// Package chartfs embeds the kryton helm chart into the operator binary.
//
// At runtime the operator reads chart files exclusively from the embedded FS,
// so the resulting image is self-contained.
//
// Integration note (WS-B): the canonical chart lives at charts/kryton/ at the
// repo root. The operator build pipeline copies that directory to
// operator/internal/chartfs/chart/ (or the build symlinks it) before
// `go build` so the //go:embed directive below picks it up. Until WS-B's
// chart exists in this worktree we embed a minimal placeholder shipped at
// operator/internal/chart-placeholder/kryton/, copied into ./chart/ by the
// Makefile target `make sync-chart`.
package chartfs

import (
	"embed"
	"errors"
	"io/fs"
)

//go:embed all:chart
var embedded embed.FS

// ChartFS wraps the embedded chart filesystem.
type ChartFS struct {
	root fs.FS
	n    int
}

// LoadEmbedded returns a ChartFS rooted at the embedded chart directory.
func LoadEmbedded() (*ChartFS, error) {
	sub, err := fs.Sub(embedded, "chart")
	if err != nil {
		return nil, err
	}
	count := 0
	err = fs.WalkDir(sub, ".", func(_ string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if !d.IsDir() {
			count++
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if count == 0 {
		return nil, errors.New("chartfs: embedded chart is empty; run `make sync-chart`")
	}
	return &ChartFS{root: sub, n: count}, nil
}

// FS returns the io/fs.FS view of the embedded chart.
func (c *ChartFS) FS() fs.FS { return c.root }

// FileCount returns the number of non-directory entries embedded.
func (c *ChartFS) FileCount() int { return c.n }
