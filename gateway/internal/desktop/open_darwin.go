//go:build darwin

package desktop

func openURL(target string) error {
	return startCommand("open", target)
}
