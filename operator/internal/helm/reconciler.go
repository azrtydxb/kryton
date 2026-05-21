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
	"reflect"
	"time"

	"github.com/azrtydxb/kryton/operator/api/v1alpha1"
	"github.com/azrtydxb/kryton/operator/internal/chartfs"

	"github.com/go-logr/logr"
	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/chart"
	"helm.sh/helm/v3/pkg/chart/loader"
	"helm.sh/helm/v3/pkg/release"
	"helm.sh/helm/v3/pkg/storage/driver"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/cli-runtime/pkg/genericclioptions"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/log"
	"sigs.k8s.io/controller-runtime/pkg/reconcile"
)

// helmActionTimeout is the upper bound we give helm to apply an install/upgrade
// and wait for the resulting Deployment to roll out. Tuned for the longest
// realistic startup time (postgresql init + kryton image pull + first request).
const helmActionTimeout = 5 * time.Minute

// Reconciler reconciles a Kryton CR into a helm release.
type Reconciler struct {
	Client  client.Client
	ChartFS *chartfs.ChartFS
	chart   *chart.Chart
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

	r := &Reconciler{
		Client:  mgr.GetClient(),
		ChartFS: cfs,
		chart:   chrt,
	}
	return ctrl.NewControllerManagedBy(mgr).
		For(&v1alpha1.Kryton{}).
		Complete(r)
}

// newGetterForCR returns a REST client getter scoped to the CR's namespace.
// helm's `cli.New().RESTClientGetter()` reads its default namespace from the
// pod's in-cluster config (== the operator's own namespace), and several
// helm action paths — most importantly the post-apply wait — fall back to
// that default instead of using the action.Configuration.KubeClient.Namespace
// we override via cfg.Init. The symptom is helm trying to LIST replicasets
// in the operator's namespace, where the operator's ServiceAccount has no
// list-RBAC for that resource. Building a fresh ConfigFlags per reconcile
// with `*flags.Namespace = kr.Namespace` forces every helm code path that
// asks the getter for a namespace to get the right one.
func newGetterForCR(namespace string) genericclioptions.RESTClientGetter {
	flags := genericclioptions.NewConfigFlags(true)
	ns := namespace
	flags.Namespace = &ns
	return flags
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
	if err := cfg.Init(newGetterForCR(kr.Namespace), kr.Namespace, "", func(format string, v ...interface{}) {
		logger.V(1).Info(fmt.Sprintf(format, v...))
	}); err != nil {
		return ctrl.Result{}, fmt.Errorf("init helm action config: %w", err)
	}

	releaseName := kr.Name
	current, err := action.NewGet(cfg).Run(releaseName)
	switch {
	case err == driver.ErrReleaseNotFound:
		install := action.NewInstall(cfg)
		install.ReleaseName = releaseName
		install.Namespace = kr.Namespace
		install.CreateNamespace = false
		install.Wait = true
		install.Timeout = helmActionTimeout
		install.Atomic = true
		if _, ierr := install.RunWithContext(ctx, r.chart, values); ierr != nil {
			return ctrl.Result{}, fmt.Errorf("helm install: %w", ierr)
		}
		logger.Info("helm release installed", "release", releaseName)
	case err != nil:
		return ctrl.Result{}, fmt.Errorf("helm get: %w", err)
	default:
		// Resolve a stuck pending-* state from a prior interrupted reconcile
		// before attempting another upgrade. Without this, helm refuses any
		// upgrade for the rest of the release's life with "another operation
		// (install/upgrade/rollback) is in progress" and the operator
		// retry-loops on the same error forever.
		if isPending(current) {
			if rerr := r.recoverPendingRelease(ctx, cfg, current, logger); rerr != nil {
				return ctrl.Result{}, fmt.Errorf("recover pending release: %w", rerr)
			}
		}

		// Idempotency guard: skip the upgrade if both the values and the
		// chart content are identical to what's already deployed. The
		// operator runs a reconcile per CR status write, and each status
		// write itself triggers another reconcile — without this guard we
		// burn through helm history (MaxHistory caps prevent disk growth
		// but the churn obscures real changes and rate-limits the API
		// server). Compare structurally on values; compare by metadata
		// version on chart (the chart is embedded in the operator binary,
		// so chart-only changes are tied to operator version).
		if releaseMatches(current, r.chart, values) {
			logger.V(1).Info("helm release already in sync; skipping upgrade", "release", releaseName, "revision", current.Version)
		} else {
			upgrade := action.NewUpgrade(cfg)
			upgrade.Namespace = kr.Namespace
			upgrade.MaxHistory = 5
			upgrade.Wait = true
			upgrade.Timeout = helmActionTimeout
			// Atomic rolls back on failure (e.g. timeout, bad image pull),
			// preventing the release from being parked in
			// pending-upgrade/failed state and blocking subsequent
			// reconciles.
			upgrade.Atomic = true
			if _, uerr := upgrade.RunWithContext(ctx, releaseName, r.chart, values); uerr != nil {
				return ctrl.Result{}, fmt.Errorf("helm upgrade: %w", uerr)
			}
			logger.Info("helm release upgraded", "release", releaseName)
		}
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

// isPending returns true when the release is stuck in one of the transient
// "operation in progress" states that block subsequent helm upgrades.
// Helm storages these states verbatim — we have to clear them ourselves
// (typically via rollback) before the next upgrade can proceed.
func isPending(rel *release.Release) bool {
	if rel == nil || rel.Info == nil {
		return false
	}
	switch rel.Info.Status {
	case release.StatusPendingInstall,
		release.StatusPendingUpgrade,
		release.StatusPendingRollback:
		return true
	}
	return false
}

// recoverPendingRelease unblocks a release stuck in pending-* by rolling
// back to the previous deployed revision. If there is no previous deployed
// revision the pending release is uninstalled — the next reconcile will
// re-install cleanly. Either path leaves helm in a state where a fresh
// upgrade can proceed.
func (r *Reconciler) recoverPendingRelease(
	_ context.Context,
	cfg *action.Configuration,
	stuck *release.Release,
	logger logr.Logger,
) error {
	hist := action.NewHistory(cfg)
	hist.Max = 0 // all revisions
	revisions, herr := hist.Run(stuck.Name)
	if herr != nil {
		return fmt.Errorf("get history: %w", herr)
	}

	// Find the most recent revision before the stuck one whose status is
	// deployed or superseded — that's the last known-good state.
	target := 0
	for _, rev := range revisions {
		if rev.Version >= stuck.Version {
			continue
		}
		if rev.Info != nil && (rev.Info.Status == release.StatusDeployed || rev.Info.Status == release.StatusSuperseded) {
			if rev.Version > target {
				target = rev.Version
			}
		}
	}

	if target == 0 {
		logger.Info("no prior deployed revision; uninstalling stuck release", "release", stuck.Name, "stuckRevision", stuck.Version, "stuckStatus", stuck.Info.Status)
		un := action.NewUninstall(cfg)
		un.KeepHistory = false
		if _, uerr := un.Run(stuck.Name); uerr != nil {
			return fmt.Errorf("uninstall stuck release: %w", uerr)
		}
		return nil
	}

	logger.Info("rolling back stuck release", "release", stuck.Name, "stuckRevision", stuck.Version, "stuckStatus", stuck.Info.Status, "rollbackTo", target)
	rb := action.NewRollback(cfg)
	rb.Version = target
	rb.Force = true
	rb.Wait = true
	rb.Timeout = helmActionTimeout
	if rerr := rb.Run(stuck.Name); rerr != nil {
		return fmt.Errorf("rollback to %d: %w", target, rerr)
	}
	return nil
}

// releaseMatches reports whether the currently-installed release was rendered
// from the same chart metadata and the same values map. Used as an
// idempotency guard so we don't fire a helm upgrade on every reconcile when
// nothing has actually changed.
//
// Comparison strategy:
//   - chart: name + version + AppVersion. The chart is embedded in the
//     operator binary, so chart-only changes are tied to operator releases;
//     metadata is enough to detect them.
//   - values: structural DeepEqual on the merged values map after JSON
//     round-tripping. JSON round-trip normalises types (e.g. all numbers
//     become float64) so we don't false-trigger when the only difference
//     is an int vs float that means the same thing.
func releaseMatches(rel *release.Release, chrt *chart.Chart, values map[string]interface{}) bool {
	if rel == nil || rel.Info == nil || chrt == nil {
		return false
	}
	if rel.Info.Status != release.StatusDeployed {
		return false
	}
	if rel.Chart == nil || rel.Chart.Metadata == nil || chrt.Metadata == nil {
		return false
	}
	if rel.Chart.Metadata.Name != chrt.Metadata.Name ||
		rel.Chart.Metadata.Version != chrt.Metadata.Version ||
		rel.Chart.Metadata.AppVersion != chrt.Metadata.AppVersion {
		return false
	}
	return deepEqualJSON(rel.Config, values)
}

// deepEqualJSON compares two values for equality after a JSON round-trip,
// which normalises numeric types and stripping of unexported fields. We use
// this for the helm-values comparison because helm itself stores values as
// `map[string]interface{}` with all numbers decoded as float64.
func deepEqualJSON(a, b interface{}) bool {
	aj, err := json.Marshal(a)
	if err != nil {
		return false
	}
	bj, err := json.Marshal(b)
	if err != nil {
		return false
	}
	var an, bn interface{}
	if err := json.Unmarshal(aj, &an); err != nil {
		return false
	}
	if err := json.Unmarshal(bj, &bn); err != nil {
		return false
	}
	return reflect.DeepEqual(an, bn)
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
