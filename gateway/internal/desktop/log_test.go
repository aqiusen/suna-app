package desktop

import (
	"path/filepath"
	"testing"
)

func TestDataDirUsesSunaAppHome(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("SUNA_APP_HOME", dir)
	if got := DataDir(); got != dir {
		t.Fatalf("DataDir() = %q, want %q", got, dir)
	}
	if got := LogPath(); got != filepath.Join(dir, "logs", "app.log") {
		t.Fatalf("LogPath() = %q", got)
	}
}
