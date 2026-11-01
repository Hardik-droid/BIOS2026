package config

import (
	"os"
	"testing"
)

// config_test.go — collab.rendezvous_url plumbing (VULOS_RENDEZVOUS_URL /
// LOCALFIRST_RENDEZVOUS_URL). Default() must leave it empty (unchanged current
// behaviour — the browser stays on host-box /api/peering/* or local-only), and
// the env override must win over whatever config.yaml set, mirroring the
// existing persistence.updatelog override.

func TestDefault_RendezvousURLEmpty(t *testing.T) {
	cfg := Default()
	if cfg.Collab.RendezvousURL != "" {
		t.Fatalf("expected empty RendezvousURL by default, got %q", cfg.Collab.RendezvousURL)
	}
}

func TestApplyEnvOverrides_RendezvousURL_FromPrimaryVar(t *testing.T) {
	t.Setenv("VULOS_RENDEZVOUS_URL", "https://relay.example.org")
	cfg := Default()
	applyEnvOverrides(cfg)
	if cfg.Collab.RendezvousURL != "https://relay.example.org" {
		t.Fatalf("expected VULOS_RENDEZVOUS_URL to set RendezvousURL, got %q", cfg.Collab.RendezvousURL)
	}
}

func TestApplyEnvOverrides_RendezvousURL_FromAltVar(t *testing.T) {
	t.Setenv("LOCALFIRST_RENDEZVOUS_URL", "https://relay.alt.example.org")
	cfg := Default()
	applyEnvOverrides(cfg)
	if cfg.Collab.RendezvousURL != "https://relay.alt.example.org" {
		t.Fatalf("expected LOCALFIRST_RENDEZVOUS_URL to set RendezvousURL, got %q", cfg.Collab.RendezvousURL)
	}
}

func TestApplyEnvOverridesExistingDeploymentSurvivesNewProductName(t *testing.T) {
	for _, key := range []string{"VULOS_RENDEZVOUS_URL", "LOCALFIRST_RENDEZVOUS_URL"} {
		t.Setenv(key, "temporary-test-value")
		if err := os.Unsetenv(key); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("DIWAN_RENDEZVOUS_URL", "https://installed-relay.example.org")
	cfg := Default()
	applyEnvOverrides(cfg)
	if cfg.Collab.RendezvousURL != "https://installed-relay.example.org" {
		t.Fatal("existing deployment URL was ignored")
	}
	t.Setenv("LOCALFIRST_RENDEZVOUS_URL", "https://current-relay.example.org")
	applyEnvOverrides(cfg)
	if cfg.Collab.RendezvousURL != "https://current-relay.example.org" {
		t.Fatal("current deployment setting did not override the legacy alias")
	}
}

func TestApplyEnvOverrides_RendezvousURL_TrimsWhitespace(t *testing.T) {
	t.Setenv("VULOS_RENDEZVOUS_URL", "  https://relay.example.org  ")
	cfg := Default()
	applyEnvOverrides(cfg)
	if cfg.Collab.RendezvousURL != "https://relay.example.org" {
		t.Fatalf("expected trimmed RendezvousURL, got %q", cfg.Collab.RendezvousURL)
	}
}

func TestApplyEnvOverrides_RendezvousURL_UnsetLeavesConfigValue(t *testing.T) {
	cfg := &Config{Collab: CollabConfig{RendezvousURL: "https://from-yaml.example.org"}}
	applyEnvOverrides(cfg)
	if cfg.Collab.RendezvousURL != "https://from-yaml.example.org" {
		t.Fatalf("expected config.yaml value to survive when no env var is set, got %q", cfg.Collab.RendezvousURL)
	}
}
