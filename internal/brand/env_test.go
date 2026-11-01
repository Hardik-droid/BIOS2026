package brand

import "testing"

func TestExistingDeploymentSettingSurvivesRebrand(t *testing.T) {
	t.Setenv("DIWAN_BRAND_TEST", "existing-value")
	if Getenv("LOCALFIRST_BRAND_TEST") != "existing-value" {
		t.Fatal("legacy setting lost")
	}
	t.Setenv("LOCALFIRST_BRAND_TEST", "new-value")
	if Getenv("LOCALFIRST_BRAND_TEST") != "new-value" {
		t.Fatal("new setting did not take precedence")
	}
	t.Setenv("LOCALFIRST_BRAND_TEST", "")
	if value, ok := LookupEnv("LOCALFIRST_BRAND_TEST"); !ok || value != "" {
		t.Fatal("explicit empty setting ignored")
	}
}
