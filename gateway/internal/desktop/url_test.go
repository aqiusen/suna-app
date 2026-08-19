package desktop

import "testing"

func TestPublicOpenURLRewritesUnspecifiedAndLoopback(t *testing.T) {
	t.Parallel()

	cases := []struct {
		listen string
		want   string
	}{
		{listen: "127.0.0.1:7633", want: "http://127.0.0.1:7633/"},
		{listen: "0.0.0.0:7633", want: "http://127.0.0.1:7633/"},
		{listen: "[::]:7633", want: "http://127.0.0.1:7633/"},
		{listen: "[::1]:7633", want: "http://127.0.0.1:7633/"},
		{listen: "localhost:7633", want: "http://127.0.0.1:7633/"},
		{listen: "192.168.1.10:7633", want: "http://192.168.1.10:7633/"},
	}
	for _, tc := range cases {
		if got := PublicOpenURL(tc.listen); got != tc.want {
			t.Fatalf("PublicOpenURL(%q) = %q, want %q", tc.listen, got, tc.want)
		}
	}
}

func TestDesktopOpenURLMarksDesktopShell(t *testing.T) {
	got := DesktopOpenURL("127.0.0.1:7633")
	if got != "http://127.0.0.1:7633/?desktop=1" {
		t.Fatalf("DesktopOpenURL() = %q", got)
	}
}

func TestValidateOpenURLRejectsNonHTTP(t *testing.T) {
	t.Parallel()

	if err := validateOpenURL("file:///etc/passwd"); err == nil {
		t.Fatal("validateOpenURL(file) = nil, want error")
	}
	if err := validateOpenURL("http://127.0.0.1:7633/"); err != nil {
		t.Fatalf("validateOpenURL(http) = %v", err)
	}
}
