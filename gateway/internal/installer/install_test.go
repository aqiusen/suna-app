package installer

import (
	"archive/zip"
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

func TestDefaultDirUsesLocalAppData(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("LOCALAPPDATA", dir)
	got := DefaultDir()
	want := filepath.Join(dir, "Programs", "Suna")
	if got != want {
		t.Fatalf("DefaultDir() = %q, want %q", got, want)
	}
}

func TestUnpackExtractsAppAndRuntime(t *testing.T) {
	payload := mustZip(t, map[string]string{
		"suna-app.exe":     "app",
		"runtime/suna.exe": "agent",
	})
	dest := t.TempDir()
	if err := Unpack(payload, dest); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dest, "suna-app.exe")); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dest, "runtime", "suna.exe")); err != nil {
		t.Fatal(err)
	}
}

func TestUnpackRejectsEmptyPayload(t *testing.T) {
	if err := Unpack(nil, t.TempDir()); err == nil {
		t.Fatal("Unpack(empty) = nil, want error")
	}
}

func TestUnpackRejectsZipWithoutRuntime(t *testing.T) {
	payload := mustZip(t, map[string]string{"suna-app.exe": "app"})
	if err := Unpack(payload, t.TempDir()); err == nil {
		t.Fatal("Unpack(missing runtime) = nil, want error")
	}
}

func mustZip(t *testing.T, files map[string]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	writer := zip.NewWriter(&buf)
	for name, content := range files {
		file, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := file.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}
