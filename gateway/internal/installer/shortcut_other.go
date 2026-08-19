//go:build !windows

package installer

func CreateShortcuts(string) error { return nil }
