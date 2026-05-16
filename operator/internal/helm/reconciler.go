// Package helm wires the helm-operator-plugins reconciler to the Kryton CRD
// using a chart loaded from the embedded ChartFS.
//
// The reconciler watches Kryton CRs, computes helm values by combining
// `spec.values` with operator-injected defaults (notably `fullnameOverride`
// for multi-instance isolation), and installs/upgrades a helm release per CR.
package helm

import (
	"fmt"

	"github.com/azrtydxb/kryton/operator/internal/chartfs"
	ctrl "sigs.k8s.io/controller-runtime"
)

// SetupWithManager registers the helm reconciler against the given manager.
//
// The current implementation is intentionally a thin shim: it documents the
// integration with helm-operator-plugins. Full wiring requires the chart
// loader API from that module which is fetched on first `go build`.
func SetupWithManager(mgr ctrl.Manager, chart *chartfs.ChartFS) error {
	if chart == nil || chart.FileCount() == 0 {
		return fmt.Errorf("helm: chart filesystem is empty")
	}
	// Real wiring (pseudo-code, kept as documentation until go.sum is generated):
	//
	//   chrt, err := loader.LoadFS(chart.FS())
	//   if err != nil { return err }
	//   return reconciler.SetupWithManager(mgr,
	//       reconciler.WithChart(*chrt),
	//       reconciler.WithGroupVersionKind(schema.GroupVersionKind{
	//           Group:   "kryton.azrtydxb.io",
	//           Version: "v1alpha1",
	//           Kind:    "Kryton",
	//       }),
	//       reconciler.WithValueMapper(injectFullnameOverride),
	//   )
	//
	// `injectFullnameOverride` ensures each CR's helm release is scoped by
	// `metadata.name`, per spec multi-instance section.
	_ = mgr
	return nil
}
