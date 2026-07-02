package feishu

import (
	"testing"
)

func TestSharedWSGroup_RegisterAndAllPlatforms(t *testing.T) {
	// Clean up global state for test isolation.
	cleanup := func() {
		sharedWSMu.Lock()
		defer sharedWSMu.Unlock()
		for k := range sharedWSGroups {
			delete(sharedWSGroups, k)
		}
	}
	cleanup()
	defer cleanup()

	p1 := &Platform{appID: "cli_test", domain: "feishu.cn"}
	p2 := &Platform{appID: "cli_test", domain: "feishu.cn"}

	// Register first platform — should be primary.
	g1, isPrimary1 := registerSharedWS(p1)
	if !isPrimary1 {
		t.Fatal("first platform should be primary")
	}
	if len(g1.allPlatforms()) != 1 {
		t.Fatalf("expected 1 platform, got %d", len(g1.allPlatforms()))
	}

	// Register second platform — should be secondary, same group.
	g2, isPrimary2 := registerSharedWS(p2)
	if isPrimary2 {
		t.Fatal("second platform should not be primary")
	}
	if g1 != g2 {
		t.Fatal("both platforms should share the same group")
	}
	if len(g1.allPlatforms()) != 2 {
		t.Fatalf("expected 2 platforms, got %d", len(g1.allPlatforms()))
	}
}

func TestSharedWSGroup_Unregister(t *testing.T) {
	cleanup := func() {
		sharedWSMu.Lock()
		defer sharedWSMu.Unlock()
		for k := range sharedWSGroups {
			delete(sharedWSGroups, k)
		}
	}
	cleanup()
	defer cleanup()

	p1 := &Platform{appID: "cli_test", domain: "feishu.cn"}
	p2 := &Platform{appID: "cli_test", domain: "feishu.cn"}

	g, _ := registerSharedWS(p1)
	registerSharedWS(p2)

	// Unregister first — one remains.
	remaining := unregisterSharedWS(p1)
	if remaining != 1 {
		t.Fatalf("expected 1 remaining, got %d", remaining)
	}
	platforms := g.allPlatforms()
	if len(platforms) != 1 || platforms[0] != p2 {
		t.Fatal("expected only p2 to remain")
	}

	// Unregister last — group deleted.
	remaining = unregisterSharedWS(p2)
	if remaining != 0 {
		t.Fatalf("expected 0 remaining, got %d", remaining)
	}
	sharedWSMu.Lock()
	_, exists := sharedWSGroups[sharedWSKey("cli_test", "feishu.cn")]
	sharedWSMu.Unlock()
	if exists {
		t.Fatal("group should be deleted when empty")
	}
}

func TestSharedWSGroup_OwnerFor_NewestExplicitWins(t *testing.T) {
	cleanup := func() {
		sharedWSMu.Lock()
		defer sharedWSMu.Unlock()
		for k := range sharedWSGroups {
			delete(sharedWSGroups, k)
		}
	}
	cleanup()
	defer cleanup()

	// Two projects on the same app_id both bind chat "oc_shared".
	p1 := &Platform{appID: "cli_test", domain: "feishu.cn", allowChat: "oc_shared"}
	p2 := &Platform{appID: "cli_test", domain: "feishu.cn", allowChat: "oc_shared"}
	registerSharedWS(p1)
	g, _ := registerSharedWS(p2)

	// Newest registration (p2) owns the contested chat; p1 must yield.
	if owner := g.ownerFor("oc_shared"); owner != p2 {
		t.Fatalf("expected p2 (newest) to own oc_shared, got %v", owner)
	}
	if p1.ownsChat("oc_shared") {
		t.Fatal("p1 should not own a chat claimed by a newer platform")
	}
	if !p2.ownsChat("oc_shared") {
		t.Fatal("p2 (newest) should own oc_shared")
	}

	// When p2 leaves, p1 reclaims ownership automatically.
	unregisterSharedWS(p2)
	if !p1.ownsChat("oc_shared") {
		t.Fatal("p1 should reclaim oc_shared after p2 unregisters")
	}
}

func TestSharedWSGroup_OwnerFor_ExplicitBeatsCatchAll(t *testing.T) {
	cleanup := func() {
		sharedWSMu.Lock()
		defer sharedWSMu.Unlock()
		for k := range sharedWSGroups {
			delete(sharedWSGroups, k)
		}
	}
	cleanup()
	defer cleanup()

	// p1 explicitly binds oc_a; p2 is a newer catch-all.
	p1 := &Platform{appID: "cli_test", domain: "feishu.cn", allowChat: "oc_a"}
	p2 := &Platform{appID: "cli_test", domain: "feishu.cn", allowChat: "*"}
	registerSharedWS(p1)
	g, _ := registerSharedWS(p2)

	// Explicit binding wins over a newer catch-all for the claimed chat.
	if owner := g.ownerFor("oc_a"); owner != p1 {
		t.Fatalf("expected explicit p1 to own oc_a over catch-all p2, got %v", owner)
	}
	// A chat nobody claims explicitly falls to the catch-all.
	if owner := g.ownerFor("oc_other"); owner != p2 {
		t.Fatalf("expected catch-all p2 to own oc_other, got %v", owner)
	}
}

func TestSharedWSGroup_DifferentAppIDs(t *testing.T) {
	cleanup := func() {
		sharedWSMu.Lock()
		defer sharedWSMu.Unlock()
		for k := range sharedWSGroups {
			delete(sharedWSGroups, k)
		}
	}
	cleanup()
	defer cleanup()

	p1 := &Platform{appID: "cli_aaa", domain: "feishu.cn"}
	p2 := &Platform{appID: "cli_bbb", domain: "feishu.cn"}

	g1, isPrimary1 := registerSharedWS(p1)
	g2, isPrimary2 := registerSharedWS(p2)

	if !isPrimary1 || !isPrimary2 {
		t.Fatal("different app_ids should each be primary")
	}
	if g1 == g2 {
		t.Fatal("different app_ids should have separate groups")
	}

	unregisterSharedWS(p1)
	unregisterSharedWS(p2)
}
