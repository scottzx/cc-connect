package oneacp

import (
	"strings"
	"testing"
)

func TestBuildSendInstructions(t *testing.T) {
	got := buildSendInstructions("/opt/bin/cc-connect", "myproj", "feishu:chat:user", "/data/cc")
	for _, want := range []string{
		`/opt/bin/cc-connect send -p "myproj" -s "feishu:chat:user" --data-dir "/data/cc" --image`,
		"--file /absolute/path",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("instructions missing %q:\n%s", want, got)
		}
	}
}

func TestBuildSendInstructionsNoDataDir(t *testing.T) {
	got := buildSendInstructions("cc-connect", "p", "k", "")
	if strings.Contains(got, "--data-dir") {
		t.Fatalf("should omit --data-dir when unset:\n%s", got)
	}
}

func TestBuildSendInstructionsIncompleteContext(t *testing.T) {
	if got := buildSendInstructions("cc-connect", "", "key", ""); got != "" {
		t.Fatalf("missing project should yield empty instructions, got %q", got)
	}
	if got := buildSendInstructions("cc-connect", "proj", "", ""); got != "" {
		t.Fatalf("missing session key should yield empty instructions, got %q", got)
	}
}

func TestSetSessionEnvParsesRoutingContext(t *testing.T) {
	a, err := New(map[string]any{"work_dir": t.TempDir()})
	if err != nil {
		t.Fatalf("New failed: %v", err)
	}
	ag := a.(*Agent)
	ag.SetSessionEnv([]string{
		"CC_PROJECT=demo",
		"CC_SESSION_KEY=telegram:1:2",
		"CC_DATA_DIR=/tmp/ccdata",
		"PATH=/usr/bin",
		"malformed",
	})
	if ag.project != "demo" || ag.sessionKey != "telegram:1:2" || ag.dataDir != "/tmp/ccdata" {
		t.Fatalf("env not parsed: %+v", ag)
	}
}
