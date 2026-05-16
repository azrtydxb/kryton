package helm

import (
	"testing"

	"github.com/azrtydxb/kryton/operator/internal/chartfs"
)

// TestLoadChartFromEmbedded sanity-checks that the embedded chart FS
// (whatever `make sync-chart` populated) is a valid helm chart from the
// loader's perspective. This catches packaging regressions early.
func TestLoadChartFromEmbedded(t *testing.T) {
	cfs, err := chartfs.LoadEmbedded()
	if err != nil {
		t.Fatalf("LoadEmbedded: %v", err)
	}
	c, err := loadChartFromFS(cfs)
	if err != nil {
		// Placeholder chart used by sync-chart is also a valid helm chart;
		// only fail on actual loader errors.
		t.Fatalf("loadChartFromFS: %v", err)
	}
	if c == nil || c.Metadata == nil || c.Metadata.Name == "" {
		t.Fatalf("loaded chart has no metadata: %+v", c)
	}
}
