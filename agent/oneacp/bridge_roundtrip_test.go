package oneacp

import (
	"context"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core"
	"github.com/gorilla/websocket"
)

// fakeBridge speaks the bridge-server.js wire protocol over a real WebSocket
// so the full handshake → prompt → events → permission round trip is covered.
func TestBridgeSessionRoundTrip(t *testing.T) {
	upgrader := websocket.Upgrader{}
	serverGot := make(chan wireMsg, 16)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			t.Errorf("upgrade failed: %v", err)
			return
		}
		defer conn.Close()
		for {
			var msg wireMsg
			if err := conn.ReadJSON(&msg); err != nil {
				return
			}
			serverGot <- msg
			switch msg.Action {
			case "ensure_session":
				_ = conn.WriteJSON(wireMsg{Event: "session_ready", SessionID: msg.SessionID, AgentSessionID: "acp-uuid-1"})
			case "prompt":
				_ = conn.WriteJSON(wireMsg{Event: "text_delta", SessionID: msg.SessionID, Text: "hi there", Type: "output"})
				_ = conn.WriteJSON(wireMsg{Event: "permission_request", SessionID: msg.SessionID, RequestID: "perm_9", ToolName: "Write"})
			case "respond_permission":
				_ = conn.WriteJSON(wireMsg{Event: "done", SessionID: msg.SessionID, Summary: "ok"})
			}
		}
	}))
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	sess, err := newBridgeSession(ctx, wsURL, t.TempDir(), "claude", "resume-me", "extra system context")
	if err != nil {
		t.Fatalf("newBridgeSession failed: %v", err)
	}
	defer sess.Close()

	ensure := <-serverGot
	if ensure.Action != "ensure_session" || ensure.AgentType != "claude" || ensure.ResumeSessionID != "resume-me" {
		t.Fatalf("unexpected ensure_session: %+v", ensure)
	}
	if ensure.SystemContext != "extra system context" {
		t.Fatalf("systemContext not forwarded: %q", ensure.SystemContext)
	}
	if got := sess.CurrentSessionID(); got != "acp-uuid-1" {
		t.Fatalf("CurrentSessionID = %q, want acp-uuid-1", got)
	}

	img := core.ImageAttachment{MimeType: "image/jpeg", Data: []byte{0xFF, 0xD8, 0xFF}, FileName: "p.jpg"}
	if err := sess.Send("look at this", []core.ImageAttachment{img}, nil); err != nil {
		t.Fatalf("Send failed: %v", err)
	}

	prompt := <-serverGot
	if prompt.Action != "prompt" || prompt.Text != "look at this" {
		t.Fatalf("unexpected prompt: %+v", prompt)
	}
	if len(prompt.Attachments) != 1 || prompt.Attachments[0].MediaType != "image/jpeg" {
		t.Fatalf("attachments not forwarded: %+v", prompt.Attachments)
	}
	if decoded, err := base64.StdEncoding.DecodeString(prompt.Attachments[0].Data); err != nil || len(decoded) != 3 {
		t.Fatalf("attachment data not valid base64 of original bytes: %v", err)
	}

	waitEvent := func(want core.EventType) core.Event {
		t.Helper()
		for {
			select {
			case ev, ok := <-sess.Events():
				if !ok {
					t.Fatalf("events channel closed while waiting for %s", want)
				}
				if ev.Type == want {
					return ev
				}
			case <-time.After(5 * time.Second):
				t.Fatalf("timed out waiting for event %s", want)
			}
		}
	}

	if ev := waitEvent(core.EventText); ev.Content != "hi there" {
		t.Fatalf("EventText content = %q", ev.Content)
	}
	perm := waitEvent(core.EventPermissionRequest)
	if perm.RequestID != "perm_9" || perm.ToolName != "Write" {
		t.Fatalf("unexpected permission event: %+v", perm)
	}

	if err := sess.RespondPermission(perm.RequestID, core.PermissionResult{Behavior: "allow"}); err != nil {
		t.Fatalf("RespondPermission failed: %v", err)
	}
	resp := <-serverGot
	if resp.Action != "respond_permission" || resp.Behavior != "allow" || resp.RequestID != "perm_9" {
		t.Fatalf("unexpected respond_permission: %+v", resp)
	}

	done := waitEvent(core.EventResult)
	if !done.Done {
		t.Fatalf("EventResult.Done = false")
	}
	if done.SessionID != "acp-uuid-1" {
		t.Fatalf("EventResult.SessionID = %q, want acp-uuid-1", done.SessionID)
	}
}

func TestBridgeSessionHandshakeError(t *testing.T) {
	upgrader := websocket.Upgrader{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		var msg wireMsg
		if err := conn.ReadJSON(&msg); err != nil {
			return
		}
		_ = conn.WriteJSON(wireMsg{Event: "error", SessionID: msg.SessionID, Code: "INITIALIZATION_FAILED", Message: "agent spawn failed"})
	}))
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if _, err := newBridgeSession(ctx, wsURL, t.TempDir(), "claude", "", ""); err == nil {
		t.Fatal("expected handshake error, got nil")
	} else if !strings.Contains(err.Error(), "INITIALIZATION_FAILED") {
		t.Fatalf("error should carry bridge code: %v", err)
	}
}
