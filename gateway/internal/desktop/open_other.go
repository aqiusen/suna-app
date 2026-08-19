//go:build !windows && !darwin

package desktop

import "fmt"

func openURL(target string) error {
	if _, err := lookPath("xdg-open"); err != nil {
		return fmt.Errorf("xdg-open is not available")
	}
	return startCommand("xdg-open", target)
}
