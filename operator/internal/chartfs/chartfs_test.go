package chartfs

import "testing"

func TestLoadEmbedded(t *testing.T) {
	c, err := LoadEmbedded()
	if err != nil {
		t.Fatalf("LoadEmbedded: %v", err)
	}
	if c.FileCount() == 0 {
		t.Fatal("expected at least one embedded file (the .keep placeholder)")
	}
	if c.FS() == nil {
		t.Fatal("FS() returned nil")
	}
}
