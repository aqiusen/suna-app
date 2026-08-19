package desktop

import "os/exec"

var lookPath = exec.LookPath
var startCommand = func(name string, args ...string) error {
	return exec.Command(name, args...).Start()
}
