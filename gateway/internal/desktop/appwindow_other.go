//go:build !windows && !darwin

package desktop

func findAppBrowser() (string, error) {
	candidates := []string{}
	if path, err := lookPath("microsoft-edge"); err == nil {
		candidates = append(candidates, path)
	}
	if path, err := lookPath("google-chrome"); err == nil {
		candidates = append(candidates, path)
	}
	if path, err := lookPath("chromium"); err == nil {
		candidates = append(candidates, path)
	}
	return pickAppBrowser(candidates)
}
