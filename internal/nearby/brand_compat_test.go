package nearby

import (
	"net/http/httptest"
	"testing"
)

func TestNativeTokenHeadersKeepCachedClientsWorkingWithoutWeakeningPrecedence(t *testing.T) {
	hub := NewHub()
	defer hub.Stop()
	for _, scenario := range []struct {
		name    string
		current *string
		legacy  string
		status  int
	}{
		{name: "new client", current: &hub.Token, status: 200},
		{name: "cached client", legacy: hub.Token, status: 200},
		{name: "new invalid overrides legacy", current: stringPointer("invalid"), legacy: hub.Token, status: 403},
		{name: "new empty overrides legacy", current: stringPointer(""), legacy: hub.Token, status: 403},
		{name: "invalid legacy", legacy: "invalid", status: 403},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			r := httptest.NewRequest("GET", "http://127.0.0.1:8765/_nearby/status", nil)
			if scenario.current != nil {
				r.Header.Set("X-LocalFirst-Native-Token", *scenario.current)
			}
			if scenario.legacy != "" {
				r.Header.Set("X-Diwan-Native-Token", scenario.legacy)
			}
			response := httptest.NewRecorder()
			hub.Handler().ServeHTTP(response, r)
			if response.Code != scenario.status {
				t.Fatalf("status %d, want %d", response.Code, scenario.status)
			}
		})
	}
}

func stringPointer(value string) *string { return &value }

func TestConnectedPeerAddressIsActualTransportAddressAndClearsOnDisconnect(t *testing.T) {
	host, client, _ := testHubs(t)
	if err := client.Connect("test-only", host.Status().Invitation); err != nil {
		t.Fatal(err)
	}
	waitStatus(t, host, "connected")
	waitStatus(t, client, "connected")
	host.mu.Lock()
	address := host.conn.RemoteAddr().String()
	host.mu.Unlock()
	if address == "" || host.Status().PeerAddress != address {
		t.Fatal("peer address did not come from the authenticated transport")
	}
	client.Stop()
	waitStatus(t, host, "listening")
	if host.Status().PeerAddress != "" {
		t.Fatal("disconnected peer address remained visible")
	}
}
