package oneacp

import (
	"encoding/json"
	"testing"

	"github.com/chenhg5/cc-connect/core"
)

func TestMapBridgeEventTextOutput(t *testing.T) {
	ev, ok := mapBridgeEvent(wireMsg{Event: "text_delta", Text: "hello", Type: "output"})
	if !ok || ev.Type != core.EventText || ev.Content != "hello" {
		t.Fatalf("got %+v ok=%v, want EventText hello", ev, ok)
	}
}

func TestMapBridgeEventThought(t *testing.T) {
	ev, ok := mapBridgeEvent(wireMsg{Event: "text_delta", Text: "thinking...", Type: "thought"})
	if !ok || ev.Type != core.EventThinking {
		t.Fatalf("got %+v ok=%v, want EventThinking", ev, ok)
	}
}

func TestMapBridgeEventEmptyTextDropped(t *testing.T) {
	if _, ok := mapBridgeEvent(wireMsg{Event: "text_delta", Text: ""}); ok {
		t.Fatal("empty text_delta should be dropped")
	}
}

func TestMapBridgeEventToolCall(t *testing.T) {
	args := json.RawMessage(`{"command":"ls"}`)
	ev, ok := mapBridgeEvent(wireMsg{Event: "tool_call", ToolName: "Bash", Arguments: args})
	if !ok || ev.Type != core.EventToolUse || ev.ToolName != "Bash" || ev.ToolInput != `{"command":"ls"}` {
		t.Fatalf("got %+v ok=%v", ev, ok)
	}
}

func TestMapBridgeEventToolResultFailed(t *testing.T) {
	ev, ok := mapBridgeEvent(wireMsg{Event: "tool_result", ToolName: "Bash", Text: "boom", IsError: true})
	if !ok || ev.Type != core.EventToolResult || ev.ToolStatus != "failed" || ev.ToolResult != "boom" {
		t.Fatalf("got %+v ok=%v", ev, ok)
	}
}

func TestMapBridgeEventPermissionRequest(t *testing.T) {
	args := json.RawMessage(`{"file_path":"/tmp/x"}`)
	ev, ok := mapBridgeEvent(wireMsg{
		Event:     "permission_request",
		RequestID: "perm_1",
		ToolName:  "Write",
		Arguments: args,
	})
	if !ok || ev.Type != core.EventPermissionRequest || ev.RequestID != "perm_1" {
		t.Fatalf("got %+v ok=%v", ev, ok)
	}
	if ev.ToolInputRaw["file_path"] != "/tmp/x" {
		t.Fatalf("ToolInputRaw not parsed: %+v", ev.ToolInputRaw)
	}
}

func TestMapBridgeEventDone(t *testing.T) {
	ev, ok := mapBridgeEvent(wireMsg{Event: "done", Summary: "all good"})
	if !ok || ev.Type != core.EventResult || !ev.Done {
		t.Fatalf("got %+v ok=%v", ev, ok)
	}
}

func TestMapBridgeEventIgnoresQueueAcks(t *testing.T) {
	for _, e := range []string{"prompt_queued", "prompt_cancelled", "permission_mode_changed", "history_response", "permission_timeout"} {
		if _, ok := mapBridgeEvent(wireMsg{Event: e}); ok {
			t.Fatalf("event %s should be ignored", e)
		}
	}
}
