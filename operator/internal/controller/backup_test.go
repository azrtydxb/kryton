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
		S3Bucket:           "backups",
		S3Endpoint:         "https://s3.example.com",
		S3Prefix:           "kryton-a/",
		S3CredsSecretName:  "kryton-backup-s3",
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
	if !strings.Contains(containers[0].Command[2], "pg_dump") {
		t.Fatalf("script missing pg_dump:\n%s", containers[0].Command[2])
	}
	if !strings.Contains(containers[0].Command[2], "aws s3 cp") {
		t.Fatalf("script missing s3 upload")
	}
}

func TestBuildBackupCronJob_DefaultsPrefixToName(t *testing.T) {
	cj := BuildBackupCronJob(BackupParams{
		Name: "kryton-b", Namespace: "default",
		Schedule: "@daily", Retention: "7d",
		S3Bucket: "b", S3CredsSecretName: "s", PostgresSecretName: "p",
	})
	env := cj.Spec.JobTemplate.Spec.Template.Spec.Containers[0].Env
	var prefix string
	for _, e := range env {
		if e.Name == "S3_PREFIX" {
			prefix = e.Value
		}
	}
	if prefix != "kryton-b/" {
		t.Fatalf("expected default prefix kryton-b/, got %q", prefix)
	}
}
