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
type BackupParams struct {
	Name              string
	Namespace         string
	Schedule          string
	Retention         string
	S3Bucket          string
	S3Endpoint        string
	S3Region          string
	S3Prefix          string
	S3CredsSecretName string
	// PostgresSecretName provides PGHOST/PGUSER/PGPASSWORD/PGDATABASE keys.
	PostgresSecretName string
}

// BuildBackupCronJob renders the pg_dump → S3 CronJob for a Kryton CR.
//
// The script: dumps the configured database with `pg_dump --format=custom`,
// uploads the result to S3 keyed by timestamp under <prefix>, then sweeps
// objects older than retention via the aws CLI.
func BuildBackupCronJob(p BackupParams) *batchv1.CronJob {
	if p.S3Prefix == "" {
		p.S3Prefix = p.Name + "/"
	}
	script := `set -euo pipefail
ts=$(date -u +%Y%m%dT%H%M%SZ)
out="/tmp/${PGDATABASE}-${ts}.dump"
pg_dump --format=custom --no-owner --no-acl \
  --host="$PGHOST" --port="${PGPORT:-5432}" \
  --username="$PGUSER" --dbname="$PGDATABASE" \
  --file="$out"
aws s3 cp "$out" "s3://${S3_BUCKET}/${S3_PREFIX}${PGDATABASE}-${ts}.dump" \
  ${S3_ENDPOINT:+--endpoint-url=$S3_ENDPOINT}
# Sweep: list, parse LastModified, delete anything older than retention.
aws s3api list-objects-v2 \
  --bucket "$S3_BUCKET" \
  --prefix "$S3_PREFIX" \
  ${S3_ENDPOINT:+--endpoint-url=$S3_ENDPOINT} \
  --query "Contents[?LastModified<='$(date -u -d "-${RETENTION}" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v"-${RETENTION_AMOUNT}${RETENTION_UNIT}" +%Y-%m-%dT%H:%M:%SZ)'].Key" \
  --output text | tr '\t' '\n' | while read -r key; do
    [ -n "$key" ] && aws s3 rm "s3://${S3_BUCKET}/${key}" ${S3_ENDPOINT:+--endpoint-url=$S3_ENDPOINT}
  done
`

	envFrom := []corev1.EnvFromSource{
		{SecretRef: &corev1.SecretEnvSource{LocalObjectReference: corev1.LocalObjectReference{Name: p.PostgresSecretName}}},
		{SecretRef: &corev1.SecretEnvSource{LocalObjectReference: corev1.LocalObjectReference{Name: p.S3CredsSecretName}}},
	}

	env := []corev1.EnvVar{
		{Name: "S3_BUCKET", Value: p.S3Bucket},
		{Name: "S3_ENDPOINT", Value: p.S3Endpoint},
		{Name: "S3_REGION", Value: p.S3Region},
		{Name: "S3_PREFIX", Value: p.S3Prefix},
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
								Image:   "ghcr.io/azrtydxb/kryton/pgdump-s3:pg16",
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
