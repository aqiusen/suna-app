package desktop

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAppModeArgs(t *testing.T) {
	t.Parallel()
	args := AppModeArgs("http://127.0.0.1:7633/")
	if len(args) == 0 || args[0] != "--app=http://127.0.0.1:7633/" {
		t.Fatalf("AppModeArgs() = %#v, want --app= first", args)
	}
	joined := strings.Join(args, " ")
	if !strings.Contains(joined, "--no-first-run") {
		t.Fatalf("missing --no-first-run: %v", args)
	}
	if !strings.Contains(joined, "--disable-background-mode") {
		t.Fatalf("missing --disable-background-mode: %v", args)
	}
}

func TestPickAppBrowserReturnsFirstExisting(t *testing.T) {
	dir := t.TempDir()
	missing := filepath.Join(dir, "missing.exe")
	found := filepath.Join(dir, "msedge.exe")
	if err := os.WriteFile(found, []byte("fake"), 0o755); err != nil {
		t.Fatal(err)
	}
	got, err := pickAppBrowser([]string{missing, found})
	if err != nil {
		t.Fatal(err)
	}
	if got != found {
		t.Fatalf("pickAppBrowser() = %q, want %q", got, found)
	}
}

func TestPickAppBrowserErrorsWhenNoneExist(t *testing.T) {
	_, err := pickAppBrowser([]string{filepath.Join(t.TempDir(), "nope.exe")})
	if err == nil {
		t.Fatal("pickAppBrowser() = nil, want error")
	}
}

func TestAppUserDataDirIsUnderAppHome(t *testing.T) {
	home := t.TempDir()
	t.Setenv("SUNA_APP_HOME", home)
	got := AppUserDataDir()
	if !strings.HasPrefix(got, home) {
		t.Fatalf("AppUserDataDir() = %q, want under %q", got, home)
	}
}
