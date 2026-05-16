package controller

import (
	"strings"
	"testing"
)

func TestPluginInitContainer_NilWhenEmpty(t *testing.T) {
	if c := PluginInitContainer(nil, "plugins"); c != nil {
		t.Fatalf("expected nil for empty plugin list, got %#v", c)
	}
}

func TestPluginInitContainer_RendersDownloadAndVerify(t *testing.T) {
	c := PluginInitContainer([]PluginSpec{
		{Name: "p1", URL: "https://e.com/p1.tgz", SHA256: strings.Repeat("a", 64)},
		{Name: "p2", URL: "https://e.com/p2.tgz", SHA256: strings.Repeat("b", 64)},
	}, "plugins-vol")
	if c == nil {
		t.Fatal("nil container")
	}
	if len(c.VolumeMounts) != 1 || c.VolumeMounts[0].Name != "plugins-vol" {
		t.Fatalf("volume mount: %#v", c.VolumeMounts)
	}
	script := c.Command[2]
	for _, want := range []string{
		"https://e.com/p1.tgz",
		"https://e.com/p2.tgz",
		strings.Repeat("a", 64),
		strings.Repeat("b", 64),
		"sha256sum -c -",
	} {
		if !strings.Contains(script, want) {
			t.Fatalf("script missing %q:\n%s", want, script)
		}
	}
}
