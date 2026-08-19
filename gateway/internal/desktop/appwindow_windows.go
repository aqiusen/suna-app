//go:build windows

package desktop

import (
	"os"
	"path/filepath"
)

func findAppBrowser() (string, error) {
	local := os.Getenv("LOCALAPPDATA")
	programFiles := os.Getenv("ProgramFiles")
	programFilesX86 := os.Getenv("ProgramFiles(x86)")
	candidates := []string{}
	for _, root := range []string{programFiles, programFilesX86, local} {
		if root == "" {
			continue
		}
		candidates = append(candidates,
			filepath.Join(root, "Microsoft", "Edge", "Application", "msedge.exe"),
			filepath.Join(root, "Google", "Chrome", "Application", "chrome.exe"),
		)
	}
	if path, err := lookPath("msedge"); err == nil {
		candidates = append(candidates, path)
	}
	if path, err := lookPath("chrome"); err == nil {
		candidates = append(candidates, path)
	}
	return pickAppBrowser(candidates)
}
