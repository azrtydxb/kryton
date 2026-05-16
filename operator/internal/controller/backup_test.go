package controller

import (
	"strings"
	"testing"
)

func TestBuildBackupCronJob_BasicShape(t *testing.T) {
	cj := BuildBackupCronJob(BackupParams{
		Name:               "kryton-a",
		Namespace:          "default",
		Schedule:           "0 3 * * *",
		Retention:          "30d",
		Bucket:             "backups",
		Endpoint:           "https://minio.kw.local",
		Prefix:             "kryton-a/",
		CredsSecretName:    "kryton-backup-creds",
		PostgresSecretName: "kryton-a-postgres",
	})
	if cj.Name != "kryton-a-backup" {
		t.Fatalf("name: %s", cj.Name)
	}
	if cj.Spec.Schedule != "0 3 * * *" {
		t.Fatalf("schedule: %s", cj.Spec.Schedule)
	}
	containers := cj.Spec.JobTemplate.Spec.Template.Spec.Containers
	if len(containers) != 1 {
		t.Fatalf("containers: %d", len(containers))
	}
	script := containers[0].Command[2]
	if !strings.Contains(script, "pg_dump") {
		t.Fatalf("script missing pg_dump:\n%s", script)
	}
	if !strings.Contains(script, "mc cp") {
		t.Fatalf("script missing mc upload:\n%s", script)
	}
	if strings.Contains(script, "aws ") {
		t.Fatalf("script unexpectedly references aws CLI:\n%s", script)
	}
	if containers[0].Image != "postgres:16" {
		t.Fatalf("expected postgres:16 image, got %s", containers[0].Image)
	}
}

func TestBuildBackupCronJob_DefaultsPrefixToName(t *testing.T) {
	cj := BuildBackupCronJob(BackupParams{
		Name: "kryton-b", Namespace: "default",
		Schedule: "@daily", Retention: "7d",
		Bucket: "b", CredsSecretName: "s", PostgresSecretName: "p",
	})
	env := cj.Spec.JobTemplate.Spec.Template.Spec.Containers[0].Env
	var prefix string
	for _, e := range env {
		if e.Name == "OBJECT_STORE_PREFIX" {
			prefix = e.Value
		}
	}
	if prefix != "kryton-b/" {
		t.Fatalf("expected default prefix kryton-b/, got %q", prefix)
	}
}
