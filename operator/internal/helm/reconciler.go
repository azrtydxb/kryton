// Package helm wires a controller-runtime reconciler against the Kryton
// CRD that installs or upgrades the embedded helm chart on each reconcile.
//
// Design choice: rather than depend on `helm-operator-plugins`, which pins
// to an older controller-runtime/k8s.io minor than the rest of the operator
// (v0.18 vs v0.19 at the time of writing), we drive helm directly via the
// `helm.sh/helm/v3/pkg/action` install/upgrade clients. This is the
// lower-level path and is fully stable across helm v3.x. The escape hatch
// noted in the operator README ("fall back to direct helm.sh/helm/v3
// action client") explicitly authorises this approach.
package helm

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/azrtydxb/kryton/operator/api/v1alpha1"
	"github.com/azrtydxb/kryton/operator/internal/chartfs"

	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/chart"
	"helm.sh/helm/v3/pkg/chart/loader"
	"helm.sh/helm/v3/pkg/cli"
	"helm.sh/helm/v3/pkg/storage/driver"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/cli-runtime/pkg/genericclioptions"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/log"
	"sigs.k8s.io/controller-runtime/pkg/reconcile"
)

// Reconciler reconciles a Kryton CR into a helm release.
type Reconciler struct {
	Client    client.Client
	ChartFS   *chartfs.ChartFS
	chart     *chart.Chart
	cfgGetter genericclioptions.RESTClientGetter
}

// SetupWithManager registers the helm reconciler against the given manager.
func SetupWithManager(mgr ctrl.Manager, cfs *chartfs.ChartFS) error {
	if cfs == nil || cfs.FileCount() == 0 {
		return fmt.Errorf("helm: chart filesystem is empty (run `make sync-chart`)")
	}
	chrt, err := loadChartFromFS(cfs)
	if err != nil {
		return fmt.Errorf("helm: load embedded chart: %w", err)
	}

	settings := cli.New()
	r := &Reconciler{
		Client:    mgr.GetClient(),
		ChartFS:   cfs,
		chart:     chrt,
		cfgGetter: settings.RESTClientGetter(),
	}
	return ctrl.NewControllerManagedBy(mgr).
		For(&v1alpha1.Kryton{}).
		Complete(r)
}

// Reconcile installs or upgrades the helm release for one Kryton CR.
func (r *Reconciler) Reconcile(ctx context.Context, req ctrl.Request) (ctrl.Result, error) {
	logger := log.FromContext(ctx).WithValues("kryton", req.NamespacedName)

	var kr v1alpha1.Kryton
	if err := r.Client.Get(ctx, req.NamespacedName, &kr); err != nil {
		return ctrl.Result{}, client.IgnoreNotFound(err)
	}

	values, err := BuildValues(&kr)
	if err != nil {
		return ctrl.Result{}, fmt.Errorf("build values: %w", err)
	}

	cfg := new(action.Configuration)
	if err := cfg.Init(r.cfgGetter, kr.Namespace, "", func(format string, v ...interface{}) {
		logger.V(1).Info(fmt.Sprintf(format, v...))
	}); err != nil {
		return ctrl.Result{}, fmt.Errorf("init helm action config: %w", err)
	}

	releaseName := kr.Name
	_, err = action.NewGet(cfg).Run(releaseName)
	switch {
	case err == driver.ErrReleaseNotFound:
		install := action.NewInstall(cfg)
		install.ReleaseName = releaseName
		install.Namespace = kr.Namespace
		install.CreateNamespace = false
		if _, ierr := install.RunWithContext(ctx, r.chart, values); ierr != nil {
			return ctrl.Result{}, fmt.Errorf("helm install: %w", ierr)
		}
		logger.Info("helm release installed", "release", releaseName)
	case err != nil:
		return ctrl.Result{}, fmt.Errorf("helm get: %w", err)
	default:
		upgrade := action.NewUpgrade(cfg)
		upgrade.Namespace = kr.Namespace
		upgrade.MaxHistory = 5
		if _, uerr := upgrade.RunWithContext(ctx, releaseName, r.chart, values); uerr != nil {
			return ctrl.Result{}, fmt.Errorf("helm upgrade: %w", uerr)
		}
		logger.Info("helm release upgraded", "release", releaseName)
	}

	// Best-effort status update; do not fail reconcile on conflict.
	kr.Status.ObservedVersion = kr.Spec.Version
	if rel, gerr := action.NewGet(cfg).Run(releaseName); gerr == nil && rel != nil {
		kr.Status.HelmRevision = rel.Version
	}
	if uerr := r.Client.Status().Update(ctx, &kr); uerr != nil && !apierrors.IsConflict(uerr) {
		logger.V(1).Info("status update failed", "err", uerr.Error())
	}

	return reconcile.Result{}, nil
}

// loadChartFromFS reads every file from the embedded FS and feeds it to
// helm's chart loader.
func loadChartFromFS(cfs *chartfs.ChartFS) (*chart.Chart, error) {
	files, err := walkChartFiles(cfs)
	if err != nil {
		return nil, err
	}
	return loader.LoadFiles(files)
}

// BuildValues composes the helm values map for a Kryton CR. It merges
// `spec.values` (pass-through) with operator-injected defaults that are
// required for correct multi-instance behaviour:
//
//   - fullnameOverride          = <cr-name>
//   - postgresql.fullnameOverride = <cr-name>-postgresql
//   - image.tag                 = spec.version (when set)
//
// Operator-injected keys take precedence over user-supplied values: the
// invariants they encode (per-CR name scoping) are not negotiable. The
// postgres subchart key is `postgresql` (bitnami's chart name), not
// `postgres`.
func BuildValues(kr *v1alpha1.Kryton) (map[string]interface{}, error) {
	values := map[string]interface{}{}
	if kr.Spec.Values != nil && len(kr.Spec.Values.Raw) > 0 {
		if err := json.Unmarshal(kr.Spec.Values.Raw, &values); err != nil {
			return nil, fmt.Errorf("decode spec.values: %w", err)
		}
	}

	// Multi-instance isolation: each helm release owns objects named after
	// the CR, so two CRs in the same namespace never collide.
	values["fullnameOverride"] = kr.Name

	pg, _ := values["postgresql"].(map[string]interface{})
	if pg == nil {
		pg = map[string]interface{}{}
	}
	pg["fullnameOverride"] = kr.Name + "-postgresql"
	values["postgresql"] = pg

	if kr.Spec.Version != "" {
		img, _ := values["image"].(map[string]interface{})
		if img == nil {
			img = map[string]interface{}{}
		}
		img["tag"] = kr.Spec.Version
		values["image"] = img
	}

	return values, nil
}
