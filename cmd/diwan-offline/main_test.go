package main

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

func TestHealthReportsTheBundledVersion(t *testing.T) {
	handler := assetHandler(fstest.MapFS{".diwan-offline.json": {Data: []byte(`{"cacheVersion":"test-bundle-version","nativeVersion":"test-native-version"}`)}})
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest("GET", "http://127.0.0.1:8765/healthz", nil))
	var health map[string]string
	if err := json.Unmarshal(response.Body.Bytes(), &health); err != nil {
		t.Fatal(err)
	}
	if response.Code != 200 || health["cache_version"] != "test-bundle-version" || health["server"] != "diwan-offline" || health["native_version"] != "test-native-version" {
		t.Fatalf("wrong package health: %v", health)
	}
}

func TestLauncherEscapesTheOldOfflineCache(t *testing.T) {
	handler := assetHandler(fstest.MapFS{".diwan-offline.json": {Data: []byte(`{"cacheVersion":"current-build"}`)}})
	for _, tc := range []struct{ path, body string }{
		{"/api/offline-launch", "Opening the current version of Diwan"},
		{"/api/offline-launch.js", "SKIP_WAITING"},
		{"/api/offline-launch-health", `"cache_version":"current-build"`},
	} {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest("GET", "http://127.0.0.1:8765"+tc.path, nil))
		if response.Code != 200 || !strings.Contains(response.Body.String(), tc.body) || response.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("launcher route failed: %s: %d %s", tc.path, response.Code, response.Body.String())
		}
	}
}

func TestAssetsAndOfflineBoundaries(t *testing.T) {
	assets := fstest.MapFS{
		"index.html":          {Data: []byte("offline shell")},
		"assets/app.js":       {Data: []byte("application")},
		".diwan-offline.json": {Data: []byte("private build metadata")},
	}
	handler := assetHandler(assets)
	for _, tc := range []struct {
		path   string
		method string
		host   string
		status int
		body   string
	}{
		{"/", "GET", "127.0.0.1:8765", 200, "offline shell"},
		{"/docs/local-document", "GET", "127.0.0.1:8765", 200, "offline shell"},
		{"/assets/app.js", "GET", "localhost:8765", 200, "application"},
		{"/api/files", "GET", "127.0.0.1:8765", 404, ""},
		{"/v1/documents", "GET", "127.0.0.1:8765", 404, ""},
		{"/.diwan-offline.json", "GET", "127.0.0.1:8765", 404, ""},
		{"/assets/missing.js", "GET", "127.0.0.1:8765", 404, ""},
		{"/", "POST", "127.0.0.1:8765", 405, ""},
		{"/", "GET", "attacker.example:8765", 403, ""},
	} {
		t.Run(tc.method+tc.path+tc.host, func(t *testing.T) {
			request := httptest.NewRequest(tc.method, "http://127.0.0.1:8765"+tc.path, nil)
			request.Host = tc.host
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != tc.status {
				t.Fatalf("status %d, want %d", response.Code, tc.status)
			}
			if tc.body != "" && response.Body.String() != tc.body {
				t.Fatalf("unexpected body %q", response.Body.String())
			}
			if tc.status == 200 && response.Header().Get("Content-Security-Policy") != "frame-ancestors 'none'" {
				t.Fatal("missing frame protection")
			}
		})
	}
}

func TestListenAddressCannotExposeWorkspace(t *testing.T) {
	for _, addr := range []string{"0.0.0.0:8765", ":8765", "192.168.1.5:8765", "example.com:8765"} {
		if loopbackAddress(addr) {
			t.Fatalf("public address accepted: %s", addr)
		}
	}
	for _, addr := range []string{"127.0.0.1:8765", "[::1]:8765"} {
		if !loopbackAddress(addr) {
			t.Fatalf("loopback address refused: %s", addr)
		}
	}
}
