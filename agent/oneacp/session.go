package oneacp

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"

	"github.com/chenhg5/cc-connect/core"
	"github.com/gorilla/websocket"
)

// sessionReadyTimeout bounds the ensure_session handshake. First-time agent
// startup may download the ACP adapter via npx, so this is generous.
const sessionReadyTimeout = 180 * time.Second

// wireAttachment mirrors the 1acp runtime AcpRuntimeTurnAttachment shape:
// base64 data plus a media type. The bridge-server forwards it to
// runtime.startTurn, which maps image/* and audio/* to ACP content blocks.
type wireAttachment struct {
	MediaType string `json:"mediaType"`
	Data      string `json:"data"`
}

// wireMsg is the JSON envelope spoken by bridge-server.js in both directions.
type wireMsg struct {
	Action          string           `json:"action,omitempty"`
	Event           string           `json:"event,omitempty"`
	SessionID       string           `json:"sessionId,omitempty"`
	WorkspacePath   string           `json:"workspacePath,omitempty"`
	AgentType       string           `json:"agentType,omitempty"`
	ResumeSessionID string           `json:"resumeSessionId,omitempty"`
	SystemContext   string           `json:"systemContext,omitempty"`
	Text            string           `json:"text,omitempty"`
	Attachments     []wireAttachment `json:"attachments,omitempty"`
	RequestID       string           `json:"requestId,omitempty"`
	Behavior        string           `json:"behavior,omitempty"`
	AgentSessionID  string           `json:"agentSessionId,omitempty"`
	Type            string           `json:"type,omitempty"`
	ToolName        string           `json:"toolName,omitempty"`
	ToolCallID      string           `json:"toolCallId,omitempty"`
	Arguments       json.RawMessage  `json:"arguments,omitempty"`
	IsError         bool             `json:"isError,omitempty"`
	Summary         string           `json:"summary,omitempty"`
	Code            string           `json:"code,omitempty"`
	Message         string           `json:"message,omitempty"`
}

type bridgeSession struct {
	conn     *websocket.Conn
	events   chan core.Event
	clientID string // bridge-side activeSessions key for this connection
	workDir  string

	writeMu   sync.Mutex
	alive     atomic.Bool
	closeOnce sync.Once

	sidMu          sync.RWMutex
	agentSessionID string // agent-side session UUID reported by session_ready
}

func newBridgeSession(ctx context.Context, bridgeURL, workDir, agentType, resumeID, systemContext string) (*bridgeSession, error) {
	dialer := websocket.Dialer{HandshakeTimeout: 10 * time.Second}
	conn, _, err := dialer.DialContext(ctx, bridgeURL, nil)
	if err != nil {
		return nil, fmt.Errorf("1acp_claude: dial bridge %s failed: %w", bridgeURL, err)
	}

	s := &bridgeSession{
		conn:     conn,
		events:   make(chan core.Event, 128),
		clientID: fmt.Sprintf("ccx-%d", time.Now().UnixNano()),
		workDir:  workDir,
	}
	s.alive.Store(true)
	s.setAgentSessionID(resumeID)

	if err := s.writeJSON(wireMsg{
		Action:          "ensure_session",
		SessionID:       s.clientID,
		WorkspacePath:   workDir,
		AgentType:       agentType,
		ResumeSessionID: resumeID,
		SystemContext:   systemContext,
	}); err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("1acp_claude: send ensure_session failed: %w", err)
	}

	ready := make(chan error, 1)
	go s.readLoop(ready)

	select {
	case err := <-ready:
		if err != nil {
			_ = s.Close()
			return nil, err
		}
		return s, nil
	case <-ctx.Done():
		_ = s.Close()
		return nil, ctx.Err()
	case <-time.After(sessionReadyTimeout):
		_ = s.Close()
		return nil, fmt.Errorf("1acp_claude: timed out waiting for session_ready")
	}
}

// readLoop is the single producer for s.events; it closes the channel on exit
// so the engine sees the session end when the WebSocket drops.
func (s *bridgeSession) readLoop(ready chan<- error) {
	defer func() {
		s.alive.Store(false)
		close(s.events)
	}()

	readySignaled := false
	for {
		var msg wireMsg
		if err := s.conn.ReadJSON(&msg); err != nil {
			if !readySignaled {
				ready <- fmt.Errorf("1acp_claude: bridge connection lost during handshake: %w", err)
			}
			return
		}

		switch msg.Event {
		case "session_ready":
			if msg.AgentSessionID != "" {
				s.setAgentSessionID(msg.AgentSessionID)
			}
			if !readySignaled {
				readySignaled = true
				ready <- nil
			}
		case "error":
			if !readySignaled {
				readySignaled = true
				ready <- fmt.Errorf("1acp_claude: bridge error %s: %s", msg.Code, msg.Message)
				return
			}
			s.events <- core.Event{
				Type:      core.EventError,
				SessionID: s.CurrentSessionID(),
				Error:     fmt.Errorf("%s", msg.Message),
			}
		default:
			if ev, ok := mapBridgeEvent(msg); ok {
				ev.SessionID = s.CurrentSessionID()
				s.events <- ev
			}
		}
	}
}

// mapBridgeEvent converts a bridge-server event into a core.Event.
// Returns false for events the engine has no use for (queue acks, history).
func mapBridgeEvent(msg wireMsg) (core.Event, bool) {
	switch msg.Event {
	case "text_delta":
		if msg.Text == "" {
			return core.Event{}, false
		}
		if msg.Type == "thought" {
			return core.Event{Type: core.EventThinking, Content: msg.Text}, true
		}
		return core.Event{Type: core.EventText, Content: msg.Text}, true
	case "tool_call":
		return core.Event{
			Type:      core.EventToolUse,
			ToolName:  msg.ToolName,
			ToolInput: string(msg.Arguments),
		}, true
	case "tool_result":
		status := "completed"
		if msg.IsError {
			status = "failed"
		}
		return core.Event{
			Type:       core.EventToolResult,
			ToolName:   msg.ToolName,
			ToolResult: msg.Text,
			ToolStatus: status,
		}, true
	case "permission_request":
		var raw map[string]any
		if len(msg.Arguments) > 0 {
			_ = json.Unmarshal(msg.Arguments, &raw)
		}
		return core.Event{
			Type:         core.EventPermissionRequest,
			RequestID:    msg.RequestID,
			ToolName:     msg.ToolName,
			ToolInput:    string(msg.Arguments),
			ToolInputRaw: raw,
		}, true
	case "done":
		return core.Event{Type: core.EventResult, Done: true}, true
	}
	return core.Event{}, false
}

// Send forwards a user message to the bridge. Images travel inline as base64
// attachments (mapped to ACP image content blocks by the 1acp runtime);
// files are saved to disk and referenced by path, since the ACP prompt only
// accepts image/* and audio/* attachments.
func (s *bridgeSession) Send(prompt string, images []core.ImageAttachment, files []core.FileAttachment) error {
	if !s.alive.Load() {
		return fmt.Errorf("1acp_claude: session closed")
	}

	if len(files) > 0 {
		paths := core.SaveFilesToDisk(s.workDir, files)
		prompt = core.AppendFileRefs(prompt, paths)
	}

	var atts []wireAttachment
	for _, img := range images {
		mt := img.MimeType
		if mt == "" {
			mt = "image/png"
		}
		atts = append(atts, wireAttachment{
			MediaType: mt,
			Data:      base64.StdEncoding.EncodeToString(img.Data),
		})
	}
	if prompt == "" && len(atts) > 0 {
		prompt = "User sent image(s)."
	}

	return s.writeJSON(wireMsg{
		Action:      "prompt",
		SessionID:   s.clientID,
		Text:        prompt,
		Attachments: atts,
	})
}

// RespondPermission relays the user's decision. The bridge-server accepts
// the legacy "allow"/"deny" shorthand and normalizes it to the ACP outcome.
func (s *bridgeSession) RespondPermission(requestID string, result core.PermissionResult) error {
	if !s.alive.Load() {
		return fmt.Errorf("1acp_claude: session closed")
	}
	return s.writeJSON(wireMsg{
		Action:    "respond_permission",
		SessionID: s.clientID,
		RequestID: requestID,
		Behavior:  result.Behavior,
	})
}

func (s *bridgeSession) Events() <-chan core.Event { return s.events }

func (s *bridgeSession) CurrentSessionID() string {
	s.sidMu.RLock()
	defer s.sidMu.RUnlock()
	return s.agentSessionID
}

func (s *bridgeSession) setAgentSessionID(id string) {
	s.sidMu.Lock()
	s.agentSessionID = id
	s.sidMu.Unlock()
}

func (s *bridgeSession) Alive() bool { return s.alive.Load() }

func (s *bridgeSession) Close() error {
	s.closeOnce.Do(func() {
		if err := s.writeJSON(wireMsg{Action: "close_session", SessionID: s.clientID}); err != nil {
			slog.Debug("1acp_claude: close_session send failed", "error", err)
		}
		_ = s.conn.Close()
	})
	return nil
}

func (s *bridgeSession) writeJSON(msg wireMsg) error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	return s.conn.WriteJSON(msg)
}
