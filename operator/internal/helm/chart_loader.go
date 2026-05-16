package helm

import (
	"io/fs"

	"github.com/azrtydxb/kryton/operator/internal/chartfs"
	"helm.sh/helm/v3/pkg/chart/loader"
)

// walkChartFiles flattens the embedded chart FS into helm's BufferedFile
// representation. Paths are relative to the chart root (the layout helm
// expects from `loader.LoadFiles`).
func walkChartFiles(cfs *chartfs.ChartFS) ([]*loader.BufferedFile, error) {
	root := cfs.FS()
	var out []*loader.BufferedFile
	err := fs.WalkDir(root, ".", func(p string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if d.IsDir() || p == "." {
			return nil
		}
		data, err := fs.ReadFile(root, p)
		if err != nil {
			return err
		}
		out = append(out, &loader.BufferedFile{Name: p, Data: data})
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}
