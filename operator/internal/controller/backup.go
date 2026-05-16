package controller

import (
	"fmt"

	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// BackupParams is the projection of Kryton.spec.backup needed to render
// the backup CronJob. Kept as a plain struct so this package can be
// unit-tested without dragging in the generated CRD types.
//
// Target storage is any S3-compatible object store (MinIO, Garage,
// SeaweedFS, etc.). No AWS-specific behaviour or hostnames; the
// endpoint is always explicit.
type BackupParams struct {
	Name      string
	Namespace string
	Schedule  string
	Retention string
	// Object-store target. Bucket is required; Endpoint is the URL of
	// the S3-compatible service; Region is optional (some
	// implementations ignore it but mc still wants the field set).
	Bucket            string
	Endpoint          string
	Region            string
	Prefix            string
	CredsSecretName   string
	// PostgresSecretName provides PGHOST/PGUSER/PGPASSWORD/PGDATABASE keys.
	PostgresSecretName string
}

// BuildBackupCronJob renders the pg_dump → object-store CronJob for a
// Kryton CR.
//
// The script: dumps the configured database with `pg_dump --format=custom`,
// installs `mc` (MinIO client — works against any S3-compatible service),
// configures it for the given endpoint+creds, uploads the dump keyed by
// timestamp under <prefix>, then sweeps objects older than retention.
// Runs in a plain `postgres:16` image so no separate backup image needs
// to be built or published.
func BuildBackupCronJob(p BackupParams) *batchv1.CronJob {
	if p.Prefix == "" {
		p.Prefix = p.Name + "/"
	}
	script := `set -euo pipefail
# Install mc once per pod. Static binary, ~30MB; postgres:16 has curl.
if ! command -v mc >/dev/null 2>&1; then
  curl -fsSL "https://dl.min.io/client/mc/release/linux-amd64/mc" -o /usr/local/bin/mc
  chmod +x /usr/local/bin/mc
fi
mc alias set store "$OBJECT_STORE_ENDPOINT" "$OBJECT_STORE_ACCESS_KEY" "$OBJECT_STORE_SECRET_KEY"

ts=$(date -u +%Y%m%dT%H%M%SZ)
out="/tmp/${PGDATABASE}-${ts}.dump"
pg_dump --format=custom --no-owner --no-acl \
  --host="$PGHOST" --port="${PGPORT:-5432}" \
  --username="$PGUSER" --dbname="$PGDATABASE" \
  --file="$out"

mc cp "$out" "store/${OBJECT_STORE_BUCKET}/${OBJECT_STORE_PREFIX}${PGDATABASE}-${ts}.dump"

# Sweep: mc's --older-than understands durations like 30d, 12h.
mc rm --recursive --force --older-than "$RETENTION" \
  "store/${OBJECT_STORE_BUCKET}/${OBJECT_STORE_PREFIX}" || true
`

	// Credentials secret must provide OBJECT_STORE_ACCESS_KEY and
	// OBJECT_STORE_SECRET_KEY keys. Postgres secret provides PG* keys.
	envFrom := []corev1.EnvFromSource{
		{SecretRef: &corev1.SecretEnvSource{LocalObjectReference: corev1.LocalObjectReference{Name: p.PostgresSecretName}}},
		{SecretRef: &corev1.SecretEnvSource{LocalObjectReference: corev1.LocalObjectReference{Name: p.CredsSecretName}}},
	}

	env := []corev1.EnvVar{
		{Name: "OBJECT_STORE_BUCKET", Value: p.Bucket},
		{Name: "OBJECT_STORE_ENDPOINT", Value: p.Endpoint},
		{Name: "OBJECT_STORE_REGION", Value: p.Region},
		{Name: "OBJECT_STORE_PREFIX", Value: p.Prefix},
		{Name: "RETENTION", Value: p.Retention},
	}

	return &batchv1.CronJob{
		ObjectMeta: metav1.ObjectMeta{
			Name:      fmt.Sprintf("%s-backup", p.Name),
			Namespace: p.Namespace,
			Labels: map[string]string{
				"app.kubernetes.io/name":       "kryton",
				"app.kubernetes.io/instance":   p.Name,
				"app.kubernetes.io/component":  "backup",
				"app.kubernetes.io/managed-by": "kryton-operator",
			},
		},
		Spec: batchv1.CronJobSpec{
			Schedule:                   p.Schedule,
			ConcurrencyPolicy:          batchv1.ForbidConcurrent,
			SuccessfulJobsHistoryLimit: int32Ptr(3),
			FailedJobsHistoryLimit:     int32Ptr(3),
			JobTemplate: batchv1.JobTemplateSpec{
				Spec: batchv1.JobSpec{
					BackoffLimit: int32Ptr(2),
					Template: corev1.PodTemplateSpec{
						Spec: corev1.PodSpec{
							RestartPolicy: corev1.RestartPolicyOnFailure,
							Containers: []corev1.Container{{
								Name:    "pgdump",
								Image:   "postgres:16",
								Command: []string{"/bin/sh", "-c", script},
								EnvFrom: envFrom,
								Env:     env,
							}},
						},
					},
				},
			},
		},
	}
}

func int32Ptr(i int32) *int32 { return &i }
