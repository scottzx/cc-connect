package config

import "testing"

// channelAgentTOML defines a project whose default agent is claudecode, with two
// channels: one inheriting the project agent and one overriding it with codex.
const channelAgentTOML = `
[[projects]]
name = "demo"

[projects.agent]
type = "claudecode"

[projects.agent.options]
work_dir = "/srv/demo"

[[projects.platforms]]
type = "telegram"

[projects.platforms.options]
token = "tg-token"

[[projects.platforms]]
type = "feishu"

[projects.platforms.options]
app_id = "cli_x"

[projects.platforms.agent]
type = "codex"

[projects.platforms.agent.options]
mode = "default"
`

func TestResolvePlatformAgent_OverrideAndInherit(t *testing.T) {
	path := writeConfigFixture(t, channelAgentTOML)
	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}
	if len(cfg.Projects) != 1 {
		t.Fatalf("got %d projects, want 1", len(cfg.Projects))
	}
	proj := cfg.Projects[0]
	if len(proj.Platforms) != 2 {
		t.Fatalf("got %d platforms, want 2", len(proj.Platforms))
	}

	// telegram channel inherits the project default agent.
	tg := proj.Platforms[0]
	if tg.Agent != nil {
		t.Fatalf("telegram channel should have no agent override, got %+v", tg.Agent)
	}
	if got := ResolvePlatformAgent(proj, tg); got.Type != "claudecode" {
		t.Fatalf("telegram resolved agent = %q, want claudecode", got.Type)
	}

	// feishu channel overrides with codex.
	fs := proj.Platforms[1]
	if fs.Agent == nil {
		t.Fatalf("feishu channel should carry an agent override")
	}
	if got := ResolvePlatformAgent(proj, fs); got.Type != "codex" {
		t.Fatalf("feishu resolved agent = %q, want codex", got.Type)
	}
	if got := stringMapValue(ResolvePlatformAgent(proj, fs).Options, "mode"); got != "default" {
		t.Fatalf("feishu resolved agent option mode = %q, want default", got)
	}
}

func TestLoad_LegacyConfigHasNoChannelAgent(t *testing.T) {
	// A config without any [projects.platforms.agent] must load unchanged and
	// every channel must inherit the project default.
	path := writeConfigFixture(t, baseConfigTOML)
	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}
	proj := cfg.Projects[0]
	for i, pc := range proj.Platforms {
		if pc.Agent != nil {
			t.Fatalf("platform[%d] unexpectedly has agent override", i)
		}
		if got := ResolvePlatformAgent(proj, pc); got.Type != proj.Agent.Type {
			t.Fatalf("platform[%d] resolved agent = %q, want project default %q", i, got.Type, proj.Agent.Type)
		}
	}
}

func TestValidate_ChannelAgentMissingType(t *testing.T) {
	const tomlBody = `
[[projects]]
name = "demo"

[projects.agent]
type = "claudecode"

[[projects.platforms]]
type = "telegram"

[projects.platforms.options]
token = "tg-token"

[projects.platforms.agent]
type = ""
`
	path := writeConfigFixture(t, tomlBody)
	if _, err := Load(path); err == nil {
		t.Fatalf("Load() expected error for empty channel agent.type, got nil")
	}
}

func TestResolveProviderRefs_ChannelAgentRefs(t *testing.T) {
	const tomlBody = `
[[providers]]
name = "codex-prov"
api_key = "k"
base_url = "https://example/v1"
model = "gpt-x"

[[projects]]
name = "demo"

[projects.agent]
type = "claudecode"

[[projects.platforms]]
type = "feishu"

[projects.platforms.options]
app_id = "cli_x"

[projects.platforms.agent]
type = "codex"
provider_refs = ["codex-prov"]
`
	path := writeConfigFixture(t, tomlBody)
	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}
	ch := cfg.Projects[0].Platforms[0].Agent
	if ch == nil {
		t.Fatalf("expected channel agent override")
	}
	if len(ch.Providers) != 1 {
		t.Fatalf("channel agent providers = %d, want 1 (resolved from global ref)", len(ch.Providers))
	}
	if ch.Providers[0].Name != "codex-prov" {
		t.Fatalf("resolved provider name = %q, want codex-prov", ch.Providers[0].Name)
	}
}
