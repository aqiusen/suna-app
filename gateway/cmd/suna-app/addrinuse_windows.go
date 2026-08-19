//go:build windows

package main

import (
	"errors"
	"syscall"
)

// windows WSAEADDRINUSE
const wsaEaddrInUse syscall.Errno = 10048

func isAddrInUse(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, syscall.EADDRINUSE) || errors.Is(err, wsaEaddrInUse) {
		return true
	}
	var errno syscall.Errno
	return errors.As(err, &errno) && errno == wsaEaddrInUse
}
