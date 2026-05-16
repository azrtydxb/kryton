package controller

import (
	"strings"
	"testing"
)

func TestBuildSnapshotCronJob(t *testing.T) {
	cj := BuildSnapshotCronJob(SnapshotParams{
		Name:                    "kryton-a",
		Namespace:               "kryton-ns",
		Schedule:                "0 4 * * *",
		Retention:               "7d",
		PVCName:                 "kryton-a-data",
		VolumeSnapshotClassName: "csi-hostpath-snapclass",
	})
	if cj.Name != "kryton-a-snapshot" {
		t.Fatalf("name: %s", cj.Name)
	}
	script := cj.Spec.JobTemplate.Spec.Template.Spec.Containers[0].Command[2]
	for _, want := range []string{
		"VolumeSnapshot",
		"kryton-a-data",
		"csi-hostpath-snapclass",
		"kubectl delete volumesnapshot",
	} {
		if !strings.Contains(script, want) {
			t.Fatalf("script missing %q:\n%s", want, script)
		}
	}
}
