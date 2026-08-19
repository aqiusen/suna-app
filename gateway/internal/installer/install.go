package installer

import (
	"archive/zip"
	"bytes"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

const appDirName = "Suna"

// DefaultDir 是本机安装目录：%LOCALAPPDATA%\Programs\Suna，不需要管理员权限。
func DefaultDir() string {
	base := os.Getenv("LOCALAPPDATA")
	if strings.TrimSpace(base) == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return filepath.Join(".", appDirName)
		}
		base = filepath.Join(home, "AppData", "Local")
	}
	return filepath.Join(base, "Programs", appDirName)
}

// Unpack 把桌面 zip 解到 dest。zip 根目录应直接包含 suna-app.exe 和 runtime/。
func Unpack(payload []byte, dest string) error {
	if len(payload) == 0 {
		return fmt.Errorf("installer payload is empty")
	}
	reader, err := zip.NewReader(bytes.NewReader(payload), int64(len(payload)))
	if err != nil {
		return fmt.Errorf("read payload zip: %w", err)
	}
	if err := os.MkdirAll(dest, 0o755); err != nil {
		return err
	}
	for _, file := range reader.File {
		if err := extractZipFile(file, dest); err != nil {
			return err
		}
	}
	exe := filepath.Join(dest, "suna-app.exe")
	if _, err := os.Stat(exe); err != nil {
		return fmt.Errorf("payload missing suna-app.exe")
	}
	runtime := filepath.Join(dest, "runtime", "suna.exe")
	if _, err := os.Stat(runtime); err != nil {
		return fmt.Errorf("payload missing runtime/suna.exe")
	}
	return nil
}

func extractZipFile(file *zip.File, dest string) error {
	name := filepath.Clean(file.Name)
	if name == "." {
		return nil
	}
	if !filepath.IsLocal(name) {
		return fmt.Errorf("refusing zip path %q", file.Name)
	}
	target := filepath.Join(dest, name)
	if file.FileInfo().IsDir() {
		return os.MkdirAll(target, 0o755)
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return err
	}
	src, err := file.Open()
	if err != nil {
		return err
	}
	defer src.Close()
	out, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, src)
	return err
}

// AppExecutable 返回安装后的 suna-app 路径。
func AppExecutable(dest string) string {
	return filepath.Join(dest, "suna-app.exe")
}
