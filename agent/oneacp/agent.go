// Package oneacp implements a cc-connect agent adapter that delegates agent
// execution to the 1acp bridge-server (acpx) over WebSocket instead of
// spawning an agent subprocess itself. cc-connect stays a pure IM gateway;
// the agent process lifecycle is owned by 1acp.
package oneacp

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"

	"github.com/chenhg5/cc-connect/core"
)

func init() {
	core.RegisterAgent("1acp_claude", New)
}

// defaultBridgeURL is the 1acp bridge-server WebSocket endpoint
// (ACPX_PORT defaults to 38082, localhost only).
const defaultBridgeURL = "ws://127.0.0.1:38082"

// Agent connects to the 1acp bridge-server and drives an agent session there.
type Agent struct {
	mu        sync.RWMutex
	workDir   string
	bridgeURL string
	agentType string // 1acp registry name, e.g. "claude" (alias "claudecode")

	// Session routing context parsed from SetSessionEnv. The 1acp-spawned
	// agent process does not inherit cc-connect's env vars, so these values
	// are baked into the session's appended system prompt instead, telling
	// the agent how to call `cc-connect send -p ... -s ...` for attachments.
	project    string
	sessionKey string
	dataDir    string
}

// New builds a 1acp_claude agent from project options.
// Optional: options["work_dir"], options["bridge_url"], options["agent_type"].
func New(opts map[string]any) (core.Agent, error) {
	workDir, _ := opts["work_dir"].(string)
	if workDir == "" {
		workDir = "."
	}
	if abs, err := filepath.Abs(workDir); err == nil {
		workDir = abs
	}

	bridgeURL, _ := opts["bridge_url"].(string)
	bridgeURL = strings.TrimSpace(bridgeURL)
	if bridgeURL == "" {
		bridgeURL = defaultBridgeURL
	}

	agentType, _ := opts["agent_type"].(string)
	agentType = strings.TrimSpace(agentType)
	if agentType == "" {
		agentType = "claude"
	}

	project, _ := opts["cc_project"].(string)
	dataDir, _ := opts["cc_data_dir"].(string)

	return &Agent{
		workDir:   workDir,
		bridgeURL: bridgeURL,
		agentType: agentType,
		project:   strings.TrimSpace(project),
		dataDir:   strings.TrimSpace(dataDir),
	}, nil
}

func (a *Agent) Name() string { return "1acp_claude" }

// StartSession dials the 1acp bridge-server and ensures a session there.
// sessionID is the agent-side session UUID to resume ("" starts fresh).
func (a *Agent) StartSession(ctx context.Context, sessionID string) (core.AgentSession, error) {
	a.mu.RLock()
	bridgeURL, workDir, agentType := a.bridgeURL, a.workDir, a.agentType
	systemContext := buildSendInstructions(ccBinPath(), a.project, a.sessionKey, a.dataDir)
	a.mu.RUnlock()
	return newBridgeSession(ctx, bridgeURL, workDir, agentType, sessionID, systemContext)
}

// HasSystemPromptSupport implements core.SystemPromptSupporter: the send-back
// instructions are injected natively via ensure_session's systemContext, so
// the engine must not also write AgentSystemPrompt() to a memory file.
func (a *Agent) HasSystemPromptSupport() bool { return true }

// SetSessionEnv implements core.SessionEnvInjector. The engine calls it with
// CC_PROJECT / CC_SESSION_KEY / CC_DATA_DIR before each session start; since
// the agent process is spawned by 1acp (not by us), the values are parsed
// out here and delivered via the appended system prompt instead of env.
func (a *Agent) SetSessionEnv(env []string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	for _, kv := range env {
		k, v, ok := strings.Cut(kv, "=")
		if !ok {
			continue
		}
		switch k {
		case "CC_PROJECT":
			a.project = v
		case "CC_SESSION_KEY":
			a.sessionKey = v
		case "CC_DATA_DIR":
			a.dataDir = v
		}
	}
}

// ccBinPath locates the cc-connect CLI for the spawned agent to call back.
// Prefer a sibling of the current executable (covers both the standalone
// cc-connect daemon and the 1agents bundle, which ships them side by side),
// then $PATH, then the bare name as a last resort.
func ccBinPath() string {
	if exePath, err := os.Executable(); err == nil {
		sibling := filepath.Join(filepath.Dir(exePath), "cc-connect")
		if info, err := os.Stat(sibling); err == nil && !info.IsDir() {
			return sibling
		}
	}
	if p, err := exec.LookPath("cc-connect"); err == nil {
		return p
	}
	return "cc-connect"
}

// buildSendInstructions renders the attachment send-back instructions that
// are appended to the agent's system prompt. Returns "" when the routing
// context is incomplete (e.g. standalone tests without an engine).
func buildSendInstructions(ccBin, project, sessionKey, dataDir string) string {
	if project == "" || sessionKey == "" {
		return ""
	}
	cmd := fmt.Sprintf("%s send -p %q -s %q", ccBin, project, sessionKey)
	if dataDir != "" {
		cmd += fmt.Sprintf(" --data-dir %q", dataDir)
	}
	return `You are running inside cc-connect, a bridge that connects you to messaging platforms.
Your normal text responses are automatically delivered to the user — do NOT use the command below for ordinary text replies.

To deliver a generated image or file to the user, run:

  ` + cmd + ` --image /absolute/path/to/image.png
  ` + cmd + ` --file /absolute/path/to/report.pdf

You may repeat --image / --file / --audio / --video multiple times in one command.
Use this only for generated attachments that need to be delivered to the user.`
}

// ListSessions is not supported by the bridge protocol.
func (a *Agent) ListSessions(ctx context.Context) ([]core.AgentSessionInfo, error) {
	return nil, nil
}

func (a *Agent) Stop() error { return nil }

// SetWorkDir / GetWorkDir implement core.WorkDirSwitcher so the engine can
// rebind the agent to another workspace; takes effect on the next session.
func (a *Agent) SetWorkDir(dir string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if abs, err := filepath.Abs(dir); err == nil {
		dir = abs
	}
	a.workDir = dir
}

func (a *Agent) GetWorkDir() string {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.workDir
}
