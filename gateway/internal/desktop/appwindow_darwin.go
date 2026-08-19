//go:build darwin

package desktop

import "path/filepath"

func findAppBrowser() (string, error) {
	return pickAppBrowser([]string{
		"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
		"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
		filepath.Join("/Applications", "Chromium.app", "Contents", "MacOS", "Chromium"),
	})
}
