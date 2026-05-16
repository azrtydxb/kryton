package controller

import (
	"fmt"

	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// SnapshotParams projects Kryton.spec.snapshot.
type SnapshotParams struct {
	Name                    string
	Namespace               string
	Schedule                string
	Retention               string
	PVCName                 string
	VolumeSnapshotClassName string
}

// BuildSnapshotCronJob emits a CronJob that uses kubectl to create a
// VolumeSnapshot of the kryton PVC at each tick, and sweeps older snapshots
// past retention. A standalone CronJob avoids requiring snapshot-controller
// scheduling primitives in older clusters.
func BuildSnapshotCronJob(p SnapshotParams) *batchv1.CronJob {
	script := fmt.Sprintf(`set -euo pipefail
ts=$(date -u +%%Y%%m%%dT%%H%%M%%SZ)
cat <<EOF | kubectl apply -f -
apiVersion: snapshot.storage.k8s.io/v1
kind: VolumeSnapshot
metadata:
  name: %[1]s-${ts}
  namespace: %[2]s
  labels:
    app.kubernetes.io/instance: %[1]s
    app.kubernetes.io/component: snapshot
spec:
  volumeSnapshotClassName: %[3]q
  source:
    persistentVolumeClaimName: %[4]s
EOF
# Sweep older-than-retention snapshots.
kubectl get volumesnapshots -n %[2]s \
  -l app.kubernetes.io/instance=%[1]s,app.kubernetes.io/component=snapshot \
  -o jsonpath='{range .items[?(@.metadata.creationTimestamp)]}{.metadata.name}{"\t"}{.metadata.creationTimestamp}{"\n"}{end}' \
  | while read -r name created; do
      [ -z "$name" ] && continue
      cutoff=$(date -u -d "-${RETENTION}" +%%s 2>/dev/null || date -u -v"-${RETENTION}" +%%s)
      cts=$(date -u -d "$created" +%%s 2>/dev/null || date -u -j -f '%%Y-%%m-%%dT%%H:%%M:%%SZ' "$created" +%%s)
      if [ "$cts" -lt "$cutoff" ]; then
        kubectl delete volumesnapshot -n %[2]s "$name"
      fi
    done
`, p.Name, p.Namespace, p.VolumeSnapshotClassName, p.PVCName)

	return &batchv1.CronJob{
		ObjectMeta: metav1.ObjectMeta{
			Name:      fmt.Sprintf("%s-snapshot", p.Name),
			Namespace: p.Namespace,
			Labels: map[string]string{
				"app.kubernetes.io/name":       "kryton",
				"app.kubernetes.io/instance":   p.Name,
				"app.kubernetes.io/component":  "snapshot",
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
					Template: corev1.PodTemplateSpec{
						Spec: corev1.PodSpec{
							RestartPolicy:      corev1.RestartPolicyOnFailure,
							ServiceAccountName: p.Name + "-snapshot",
							Containers: []corev1.Container{{
								Name:    "snapshotter",
								Image:   "bitnami/kubectl:1.31",
								Command: []string{"/bin/bash", "-c", script},
								Env: []corev1.EnvVar{
									{Name: "RETENTION", Value: p.Retention},
								},
							}},
						},
					},
				},
			},
		},
	}
}
