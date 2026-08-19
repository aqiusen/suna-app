//go:build windows

package desktop

func openURL(target string) error {
	return startCommand("rundll32", "url.dll,FileProtocolHandler", target)
}
