// Package controller implements the operator-only reconcile logic for the
// Kryton CRD: backup CronJobs, plugin init-container injection, and
// VolumeSnapshot scheduling.
//
// The helm-based reconciler (see internal/helm) owns Deployment/Service/etc.;
// this controller layers operator-specific resources on top of that release.
package controller

import (
	"context"
	"fmt"

	"github.com/azrtydxb/kryton/operator/api/v1alpha1"

	appsv1 "k8s.io/api/apps/v1"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/controller/controllerutil"
)

// KrytonExtrasReconciler reconciles the operator-only fields of a Kryton CR.
type KrytonExtrasReconciler struct {
	client.Client
	Scheme *runtime.Scheme
}

// +kubebuilder:rbac:groups=kryton.azrtydxb.io,resources=krytons,verbs=get;list;watch
// +kubebuilder:rbac:groups=kryton.azrtydxb.io,resources=krytons/status,verbs=get;update;patch
// +kubebuilder:rbac:groups=batch,resources=cronjobs;jobs,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=core,resources=secrets;configmaps;persistentvolumeclaims,verbs=get;list;watch;create;update;patch
// +kubebuilder:rbac:groups=apps,resources=deployments,verbs=get;list;watch;update;patch
// +kubebuilder:rbac:groups=snapshot.storage.k8s.io,resources=volumesnapshots;volumesnapshotclasses,verbs=get;list;watch;create;update;patch;delete

// Reconcile dispatches to the three operator-only sub-reconcilers.
func (r *KrytonExtrasReconciler) Reconcile(ctx context.Context, req ctrl.Request) (ctrl.Result, error) {
	log := ctrl.LoggerFrom(ctx).WithValues("kryton", req.NamespacedName)
	log.V(1).Info("reconciling operator-only fields")

	var kr v1alpha1.Kryton
	if err := r.Get(ctx, req.NamespacedName, &kr); err != nil {
		return ctrl.Result{}, client.IgnoreNotFound(err)
	}

	if err := r.ReconcileBackup(ctx, &kr); err != nil {
		return ctrl.Result{}, fmt.Errorf("backup: %w", err)
	}
	if err := r.ReconcilePlugins(ctx, &kr); err != nil {
		return ctrl.Result{}, fmt.Errorf("plugins: %w", err)
	}
	if err := r.ReconcileSnapshot(ctx, &kr); err != nil {
		return ctrl.Result{}, fmt.Errorf("snapshot: %w", err)
	}

	return ctrl.Result{}, nil
}

// SetupWithManager wires the controller into the manager.
func (r *KrytonExtrasReconciler) SetupWithManager(mgr ctrl.Manager) error {
	return ctrl.NewControllerManagedBy(mgr).
		Named("kryton-extras").
		For(&v1alpha1.Kryton{}).
		Owns(&batchv1.CronJob{}).
		Complete(r)
}

// ReconcileBackup renders and applies the backup CronJob.
func (r *KrytonExtrasReconciler) ReconcileBackup(ctx context.Context, kr *v1alpha1.Kryton) error {
	if kr.Spec.Backup == nil {
		// Best-effort cleanup if the field was just cleared.
		return r.deleteIfExists(ctx, &batchv1.CronJob{}, types.NamespacedName{
			Namespace: kr.Namespace,
			Name:      fmt.Sprintf("%s-backup", kr.Name),
		})
	}

	params := BackupParams{
		Name:               kr.Name,
		Namespace:          kr.Namespace,
		Schedule:           kr.Spec.Backup.Schedule,
		Retention:          kr.Spec.Backup.Retention,
		PostgresSecretName: kr.Name + "-postgresql",
	}
	if os := kr.Spec.Backup.ObjectStore; os != nil {
		params.Bucket = os.Bucket
		params.Endpoint = os.Endpoint
		params.Region = os.Region
		params.Prefix = os.Prefix
		if os.CredentialsSecretRef != nil {
			params.CredsSecretName = os.CredentialsSecretRef.Name
		}
	}
	desired := BuildBackupCronJob(params)
	return r.createOrUpdateCronJob(ctx, kr, desired)
}

// ReconcilePlugins patches the helm-managed Deployment in place to add the
// plugin-installer init container. The Deployment name follows the chart's
// fullnameOverride convention (which the helm reconciler set to kr.Name).
func (r *KrytonExtrasReconciler) ReconcilePlugins(ctx context.Context, kr *v1alpha1.Kryton) error {
	if len(kr.Spec.Plugins) == 0 {
		return nil
	}
	specs := make([]PluginSpec, 0, len(kr.Spec.Plugins))
	for _, p := range kr.Spec.Plugins {
		specs = append(specs, PluginSpec{Name: p.Name, URL: p.URL, SHA256: p.SHA256})
	}
	const pluginsVolume = "plugins"
	init := PluginInitContainer(specs, pluginsVolume)
	if init == nil {
		return nil
	}

	var dep appsv1.Deployment
	if err := r.Get(ctx, types.NamespacedName{Namespace: kr.Namespace, Name: kr.Name}, &dep); err != nil {
		if apierrors.IsNotFound(err) {
			// Helm chart hasn't applied the Deployment yet; the controller
			// will be re-triggered on the next CR event.
			return nil
		}
		return err
	}
	// Replace any prior plugin-installer entry to remain idempotent.
	out := make([]corev1.Container, 0, len(dep.Spec.Template.Spec.InitContainers)+1)
	for _, c := range dep.Spec.Template.Spec.InitContainers {
		if c.Name != "plugin-installer" {
			out = append(out, c)
		}
	}
	out = append(out, *init)
	dep.Spec.Template.Spec.InitContainers = out

	return r.Update(ctx, &dep)
}

// ReconcileSnapshot renders and applies the VolumeSnapshot CronJob.
func (r *KrytonExtrasReconciler) ReconcileSnapshot(ctx context.Context, kr *v1alpha1.Kryton) error {
	if kr.Spec.Snapshot == nil {
		return r.deleteIfExists(ctx, &batchv1.CronJob{}, types.NamespacedName{
			Namespace: kr.Namespace,
			Name:      fmt.Sprintf("%s-snapshot", kr.Name),
		})
	}
	params := SnapshotParams{
		Name:                    kr.Name,
		Namespace:               kr.Namespace,
		Schedule:                kr.Spec.Snapshot.Schedule,
		Retention:               kr.Spec.Snapshot.Retention,
		PVCName:                 kr.Name,
		VolumeSnapshotClassName: kr.Spec.Snapshot.VolumeSnapshotClassName,
	}
	desired := BuildSnapshotCronJob(params)
	return r.createOrUpdateCronJob(ctx, kr, desired)
}

// createOrUpdateCronJob sets the owner reference (so the child is garbage
// collected with the CR) and applies the desired state idempotently.
func (r *KrytonExtrasReconciler) createOrUpdateCronJob(
	ctx context.Context,
	owner *v1alpha1.Kryton,
	desired *batchv1.CronJob,
) error {
	existing := &batchv1.CronJob{}
	existing.Name = desired.Name
	existing.Namespace = desired.Namespace

	_, err := controllerutil.CreateOrUpdate(ctx, r.Client, existing, func() error {
		existing.Spec = desired.Spec
		existing.Labels = desired.Labels
		return controllerutil.SetControllerReference(owner, existing, r.Scheme)
	})
	return err
}

// deleteIfExists removes a child resource when its spec field has been
// cleared on the parent. The 404 case is treated as success.
func (r *KrytonExtrasReconciler) deleteIfExists(ctx context.Context, obj client.Object, key types.NamespacedName) error {
	if err := r.Get(ctx, key, obj); err != nil {
		if apierrors.IsNotFound(err) {
			return nil
		}
		return err
	}
	if err := r.Delete(ctx, obj); err != nil && !apierrors.IsNotFound(err) {
		return err
	}
	return nil
}
