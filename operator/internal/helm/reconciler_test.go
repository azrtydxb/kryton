package helm

import (
	"testing"

	"github.com/azrtydxb/kryton/operator/api/v1alpha1"
	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func TestBuildValues_InjectsFullnameOverride(t *testing.T) {
	kr := &v1alpha1.Kryton{
		ObjectMeta: metav1.ObjectMeta{Name: "kryton-a", Namespace: "default"},
		Spec:       v1alpha1.KrytonSpec{Version: "4.5.0"},
	}
	vals, err := BuildValues(kr)
	if err != nil {
		t.Fatalf("BuildValues: %v", err)
	}
	if got := vals["fullnameOverride"]; got != "kryton-a" {
		t.Fatalf("fullnameOverride = %v, want kryton-a", got)
	}
	pg, ok := vals["postgresql"].(map[string]interface{})
	if !ok {
		t.Fatalf("postgresql key missing or wrong type: %#v", vals["postgresql"])
	}
	if got := pg["fullnameOverride"]; got != "kryton-a-postgresql" {
		t.Fatalf("postgresql.fullnameOverride = %v, want kryton-a-postgresql", got)
	}
	if _, hasPostgres := vals["postgres"]; hasPostgres {
		t.Fatalf("unexpected `postgres` top-level key; subchart name is `postgresql`")
	}
	img, ok := vals["image"].(map[string]interface{})
	if !ok {
		t.Fatalf("image key missing: %#v", vals["image"])
	}
	if img["tag"] != "4.5.0" {
		t.Fatalf("image.tag = %v, want 4.5.0", img["tag"])
	}
}

func TestBuildValues_PassthroughAndOverride(t *testing.T) {
	// User supplies their own image.repository and a custom key; operator
	// must not stomp the user's repository but MUST override
	// fullnameOverride and image.tag.
	raw := []byte(`{"image":{"repository":"ghcr.io/me/kryton","tag":"user-set"},"foo":"bar","fullnameOverride":"will-be-overridden","postgresql":{"auth":{"username":"k"}}}`)
	kr := &v1alpha1.Kryton{
		ObjectMeta: metav1.ObjectMeta{Name: "kryton-b"},
		Spec: v1alpha1.KrytonSpec{
			Version: "5.0.0",
			Values:  &apiextensionsv1.JSON{Raw: raw},
		},
	}
	vals, err := BuildValues(kr)
	if err != nil {
		t.Fatalf("BuildValues: %v", err)
	}
	if vals["foo"] != "bar" {
		t.Fatalf("user passthrough lost: %v", vals["foo"])
	}
	if vals["fullnameOverride"] != "kryton-b" {
		t.Fatalf("fullnameOverride not enforced: %v", vals["fullnameOverride"])
	}
	img := vals["image"].(map[string]interface{})
	if img["repository"] != "ghcr.io/me/kryton" {
		t.Fatalf("user image.repository clobbered: %v", img["repository"])
	}
	if img["tag"] != "5.0.0" {
		t.Fatalf("image.tag should reflect spec.version, got %v", img["tag"])
	}
	pg := vals["postgresql"].(map[string]interface{})
	if pg["fullnameOverride"] != "kryton-b-postgresql" {
		t.Fatalf("postgresql.fullnameOverride: %v", pg["fullnameOverride"])
	}
	auth, ok := pg["auth"].(map[string]interface{})
	if !ok || auth["username"] != "k" {
		t.Fatalf("nested postgresql.auth lost: %#v", pg["auth"])
	}
}

func TestBuildValues_NoVersionLeavesImageAlone(t *testing.T) {
	kr := &v1alpha1.Kryton{ObjectMeta: metav1.ObjectMeta{Name: "k"}}
	vals, err := BuildValues(kr)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := vals["image"]; ok {
		t.Fatalf("image key should not be injected without spec.version: %v", vals["image"])
	}
}
