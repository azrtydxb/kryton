package controller

import (
	"context"
	"testing"

	"github.com/azrtydxb/kryton/operator/api/v1alpha1"
	batchv1 "k8s.io/api/batch/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	clientgoscheme "k8s.io/client-go/kubernetes/scheme"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"
)

func newScheme(t *testing.T) *runtime.Scheme {
	t.Helper()
	s := runtime.NewScheme()
	if err := clientgoscheme.AddToScheme(s); err != nil {
		t.Fatal(err)
	}
	if err := v1alpha1.AddToScheme(s); err != nil {
		t.Fatal(err)
	}
	return s
}

func TestKrytonExtrasReconciler_CreatesCronJobsWithOwnerRef(t *testing.T) {
	scheme := newScheme(t)
	kr := &v1alpha1.Kryton{
		ObjectMeta: metav1.ObjectMeta{Name: "kryton-a", Namespace: "default", UID: "uid-a"},
		Spec: v1alpha1.KrytonSpec{
			Version: "4.5.0",
			Backup: &v1alpha1.BackupSpec{
				Schedule:  "0 3 * * *",
				Retention: "30d",
				ObjectStore: &v1alpha1.ObjectStore{
					Bucket:               "backups",
					Endpoint:             "https://minio.kw.local",
					CredentialsSecretRef: &v1alpha1.SecretRef{Name: "backup-creds"},
				},
			},
			Snapshot: &v1alpha1.SnapshotSpec{
				Schedule:                "0 4 * * *",
				Retention:               "7d",
				VolumeSnapshotClassName: "csi-snap",
			},
		},
	}
	cli := fake.NewClientBuilder().WithScheme(scheme).WithObjects(kr).Build()
	r := &KrytonExtrasReconciler{Client: cli, Scheme: scheme}

	if _, err := r.Reconcile(context.Background(), ctrl.Request{NamespacedName: types.NamespacedName{Name: "kryton-a", Namespace: "default"}}); err != nil {
		t.Fatalf("Reconcile: %v", err)
	}

	// Backup CronJob created with owner reference to the Kryton CR.
	var backup batchv1.CronJob
	if err := cli.Get(context.Background(), types.NamespacedName{Name: "kryton-a-backup", Namespace: "default"}, &backup); err != nil {
		t.Fatalf("get backup cronjob: %v", err)
	}
	if len(backup.OwnerReferences) != 1 || backup.OwnerReferences[0].UID != "uid-a" {
		t.Fatalf("backup owner refs: %#v", backup.OwnerReferences)
	}
	if backup.Spec.Schedule != "0 3 * * *" {
		t.Fatalf("backup schedule: %s", backup.Spec.Schedule)
	}

	var snap batchv1.CronJob
	if err := cli.Get(context.Background(), types.NamespacedName{Name: "kryton-a-snapshot", Namespace: "default"}, &snap); err != nil {
		t.Fatalf("get snapshot cronjob: %v", err)
	}
	if len(snap.OwnerReferences) != 1 || snap.OwnerReferences[0].UID != "uid-a" {
		t.Fatalf("snapshot owner refs: %#v", snap.OwnerReferences)
	}
}

func TestKrytonExtrasReconciler_UpdatesExistingCronJob(t *testing.T) {
	scheme := newScheme(t)
	kr := &v1alpha1.Kryton{
		ObjectMeta: metav1.ObjectMeta{Name: "kryton-a", Namespace: "default", UID: "uid-a"},
		Spec: v1alpha1.KrytonSpec{
			Version: "4.5.0",
			Backup: &v1alpha1.BackupSpec{
				Schedule: "@hourly",
				ObjectStore: &v1alpha1.ObjectStore{
					Bucket: "b", Endpoint: "https://e",
					CredentialsSecretRef: &v1alpha1.SecretRef{Name: "c"},
				},
			},
		},
	}
	cli := fake.NewClientBuilder().WithScheme(scheme).WithObjects(kr).Build()
	r := &KrytonExtrasReconciler{Client: cli, Scheme: scheme}

	req := ctrl.Request{NamespacedName: types.NamespacedName{Name: "kryton-a", Namespace: "default"}}
	if _, err := r.Reconcile(context.Background(), req); err != nil {
		t.Fatalf("first reconcile: %v", err)
	}
	// Mutate the spec and reconcile again — same name, new schedule.
	if err := cli.Get(context.Background(), types.NamespacedName{Name: "kryton-a", Namespace: "default"}, kr); err != nil {
		t.Fatal(err)
	}
	kr.Spec.Backup.Schedule = "0 5 * * *"
	if err := cli.Update(context.Background(), kr); err != nil {
		t.Fatal(err)
	}
	if _, err := r.Reconcile(context.Background(), req); err != nil {
		t.Fatalf("second reconcile: %v", err)
	}
	var backup batchv1.CronJob
	if err := cli.Get(context.Background(), types.NamespacedName{Name: "kryton-a-backup", Namespace: "default"}, &backup); err != nil {
		t.Fatal(err)
	}
	if backup.Spec.Schedule != "0 5 * * *" {
		t.Fatalf("schedule not updated: %s", backup.Spec.Schedule)
	}
}

func TestKrytonExtrasReconciler_DeletesWhenSpecCleared(t *testing.T) {
	scheme := newScheme(t)
	kr := &v1alpha1.Kryton{
		ObjectMeta: metav1.ObjectMeta{Name: "kryton-a", Namespace: "default", UID: "uid-a"},
		Spec: v1alpha1.KrytonSpec{
			Version: "4.5.0",
			Backup: &v1alpha1.BackupSpec{
				Schedule: "@daily",
				ObjectStore: &v1alpha1.ObjectStore{
					Bucket: "b", Endpoint: "https://e",
					CredentialsSecretRef: &v1alpha1.SecretRef{Name: "c"},
				},
			},
		},
	}
	cli := fake.NewClientBuilder().WithScheme(scheme).WithObjects(kr).Build()
	r := &KrytonExtrasReconciler{Client: cli, Scheme: scheme}
	req := ctrl.Request{NamespacedName: types.NamespacedName{Name: "kryton-a", Namespace: "default"}}
	if _, err := r.Reconcile(context.Background(), req); err != nil {
		t.Fatal(err)
	}
	// Now clear the backup field — the child CronJob must be removed.
	if err := cli.Get(context.Background(), req.NamespacedName, kr); err != nil {
		t.Fatal(err)
	}
	kr.Spec.Backup = nil
	if err := cli.Update(context.Background(), kr); err != nil {
		t.Fatal(err)
	}
	if _, err := r.Reconcile(context.Background(), req); err != nil {
		t.Fatal(err)
	}
	var backup batchv1.CronJob
	err := cli.Get(context.Background(), types.NamespacedName{Name: "kryton-a-backup", Namespace: "default"}, &backup)
	if err == nil {
		t.Fatalf("expected backup CronJob to be deleted, but it still exists: %#v", backup)
	}
}
