package desktop

import "os/exec"

var lookPath = exec.LookPath
var startCommand = func(name string, args ...string) error {
	return exec.Command(name, args...).Start()
}

// OpenURL 用系统默认浏览器打开 http(s) URL。失败时返回错误，调用方只记日志。
func OpenURL(target string) error {
	if err := validateOpenURL(target); err != nil {
		return err
	}
	return openURL(target)
}
