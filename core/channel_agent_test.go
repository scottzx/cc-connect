package core

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"
)

// namedRecordingAgent is an Agent with a configurable Name() that records the
// per-session env injected by the engine (CC_SESSION_KEY etc.). It lets a
// routing test distinguish which agent a message was routed to and inspect the
// session-key namespacing.
type namedRecordingAgent struct {
	name    string
	session AgentSession
	mu      sync.Mutex
	env     []string
	started int
}

func (a *namedRecordingAgent) Name() string { return a.name }

func (a *namedRecordingAgent) StartSession(_ context.Context, _ string) (AgentSession, error) {
	a.mu.Lock()
	a.started++
	a.mu.Unlock()
	if a.session != nil {
		return a.session, nil
	}
	return &stubAgentSession{}, nil
}

func (a *namedRecordingAgent) ListSessions(_ context.Context) ([]AgentSessionInfo, error) {
	return nil, nil
}
func (a *namedRecordingAgent) Stop() error { return nil }

func (a *namedRecordingAgent) SetSessionEnv(env []string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.env = append([]string(nil), env...)
}

func (a *namedRecordingAgent) EnvValue(key string) string {
	a.mu.Lock()
	defer a.mu.Unlock()
	prefix := key + "="
	for _, entry := range a.env {
		if strings.HasPrefix(entry, prefix) {
			return strings.TrimPrefix(entry, prefix)
		}
	}
	return ""
}

func (a *namedRecordingAgent) startCount() int {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.started
}

func waitForEnv(t *testing.T, a *namedRecordingAgent, key string) string {
	t.Helper()
	deadline := time.After(2 * time.Second)
	for {
		if got := a.EnvValue(key); got != "" {
			return got
		}
		select {
		case <-deadline:
			t.Fatalf("timed out waiting for %s on agent %q", key, a.name)
			return ""
		default:
			time.Sleep(10 * time.Millisecond)
		}
	}
}

func TestSetChannelAgent_RegistersByPlatformInstance(t *testing.T) {
	def := &namedRecordingAgent{name: "claudecode"}
	ch := &namedRecordingAgent{name: "codex"}
	feishu := &stubPlatformEngine{n: "feishu"}
	telegram := &stubPlatformEngine{n: "telegram"}
	e := NewEngine("test", def, []Platform{feishu, telegram}, "", LangEnglish)

	e.SetChannelAgent(feishu, ch)

	if got := e.channelAgentFor(feishu); got != Agent(ch) {
		t.Fatalf("channelAgentFor(feishu) = %v, want channel agent", got)
	}
	if got := e.channelAgentFor(telegram); got != nil {
		t.Fatalf("channelAgentFor(telegram) = %v, want nil (no binding)", got)
	}
}

// TestSetChannelAgent_SameTypeInstances is the two-Feishu-bots regression: two
// platforms of the SAME type (Name()=="feishu") must bind DIFFERENT agents.
// Keying by Name() would collapse them; keying by instance keeps them distinct.
func TestSetChannelAgent_SameTypeInstances(t *testing.T) {
	def := &namedRecordingAgent{name: "claudecode"}
	claude := &namedRecordingAgent{name: "claudecode"}
	codex := &namedRecordingAgent{name: "codex"}
	botA := &stubPlatformEngine{n: "feishu"}
	botB := &stubPlatformEngine{n: "feishu"}
	e := NewEngine("test", def, []Platform{botA, botB}, "", LangEnglish)

	e.SetChannelAgent(botA, claude)
	e.SetChannelAgent(botB, codex)

	if got := e.channelAgentFor(botA); got != Agent(claude) {
		t.Fatalf("channelAgentFor(botA) = %v, want claude", got)
	}
	if got := e.channelAgentFor(botB); got != Agent(codex) {
		t.Fatalf("channelAgentFor(botB) = %v, want codex", got)
	}
}

// TestHandleMessage_ChannelAgentRouting verifies that a message on a channel
// with a bound agent is routed to that agent (not the project default) and that
// the agent's session key is namespaced so the two agents do not collide on the
// same work_dir.
func TestHandleMessage_ChannelAgentRouting(t *testing.T) {
	def := &namedRecordingAgent{name: "claudecode", session: newResultAgentSession("ok")}
	ch := &namedRecordingAgent{name: "codex", session: newResultAgentSession("ok")}
	feishu := &stubPlatformEngine{n: "feishu"}
	telegram := &stubPlatformEngine{n: "telegram"}
	e := NewEngine("test", def, []Platform{feishu, telegram}, "", LangEnglish)
	e.SetChannelAgent(feishu, ch)

	// Message on the bound channel → routes to the channel agent.
	feishuKey := "feishu:C1:U1"
	e.handleMessage(feishu, &Message{
		SessionKey: feishuKey,
		Platform:   "feishu",
		UserID:     "U1",
		UserName:   "user",
		Content:    "hi from feishu",
		ReplyCtx:   "ctx",
	})
	gotCh := waitForEnv(t, ch, "CC_SESSION_KEY")
	wantCh := "agent:codex:" + feishuKey
	if gotCh != wantCh {
		t.Fatalf("channel agent CC_SESSION_KEY = %q, want %q", gotCh, wantCh)
	}

	// Message on an unbound channel → routes to the project default agent with
	// the plain session key (legacy behavior).
	tgKey := "telegram:C2:U2"
	e.handleMessage(telegram, &Message{
		SessionKey: tgKey,
		Platform:   "telegram",
		UserID:     "U2",
		UserName:   "user2",
		Content:    "hi from telegram",
		ReplyCtx:   "ctx",
	})
	gotDef := waitForEnv(t, def, "CC_SESSION_KEY")
	if gotDef != tgKey {
		t.Fatalf("default agent CC_SESSION_KEY = %q, want %q", gotDef, tgKey)
	}

	if ch.startCount() == 0 {
		t.Fatalf("channel agent StartSession was never called")
	}
	if def.startCount() == 0 {
		t.Fatalf("default agent StartSession was never called")
	}
}
