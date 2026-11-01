package main

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

func TestHealthReportsTheBundledVersion(t *testing.T) {
	handler := assetHandler(fstest.MapFS{".localfirst-offline.json": {Data: []byte(`{"cacheVersion":"test-bundle-version","nativeVersion":"test-native-version"}`)}})
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest("GET", "http://127.0.0.1:8765/healthz", nil))
	var health map[string]string
	if err := json.Unmarshal(response.Body.Bytes(), &health); err != nil {
		t.Fatal(err)
	}
	if response.Code != 200 || health["cache_version"] != "test-bundle-version" || health["server"] != "localfirst-offline" || health["native_version"] != "test-native-version" {
		t.Fatalf("wrong package health: %v", health)
	}
}

func TestLauncherEscapesTheOldOfflineCache(t *testing.T) {
	handler := assetHandler(fstest.MapFS{".localfirst-offline.json": {Data: []byte(`{"cacheVersion":"current-build"}`)}})
	for _, tc := range []struct{ path, body string }{
		{"/api/offline-launch", "Opening the current version of LocalFirst"},
		{"/api/offline-launch.js", "SKIP_WAITING"},
		{"/api/offline-launch.css", "prefers-reduced-motion"},
		{"/api/offline-launch-health", `"cache_version":"current-build"`},
	} {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest("GET", "http://127.0.0.1:8765"+tc.path, nil))
		if response.Code != 200 || !strings.Contains(response.Body.String(), tc.body) || response.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("launcher route failed: %s: %d %s", tc.path, response.Code, response.Body.String())
		}
	}
}

func TestLauncherStylesAreEmbeddedAndSelfHostedUnderItsContentPolicy(t *testing.T) {
	handler := assetHandler(fstest.MapFS{})
	page := httptest.NewRecorder()
	handler.ServeHTTP(page, httptest.NewRequest("GET", "http://127.0.0.1:8765/api/offline-launch", nil))
	if !strings.Contains(page.Body.String(), `href="/api/offline-launch.css"`) || strings.Contains(page.Body.String(), "<style") {
		t.Fatal("launcher styles must load from the embedded same-origin route")
	}
	styles := httptest.NewRecorder()
	handler.ServeHTTP(styles, httptest.NewRequest("GET", "http://127.0.0.1:8765/api/offline-launch.css", nil))
	if styles.Code != 200 || !strings.HasPrefix(styles.Header().Get("Content-Type"), "text/css") || styles.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("embedded launcher CSS was not served as an uncached stylesheet")
	}
	if !strings.Contains(page.Header().Get("Content-Security-Policy"), "default-src 'self'") || strings.Contains(styles.Body.String(), "https://") {
		t.Fatal("launcher stylesheet escaped the same-origin content policy")
	}
}

func TestHealthReadsInstalledBundleMarkerAfterRebrand(t *testing.T) {
	assets := fstest.MapFS{".diwan-offline.json": {Data: []byte(`{"cacheVersion":"installed-cache","nativeVersion":"installed-native"}`)}}
	handler := assetHandler(assets)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest("GET", "http://127.0.0.1:8765/healthz", nil))
	var health map[string]string
	if err := json.Unmarshal(response.Body.Bytes(), &health); err != nil {
		t.Fatal(err)
	}
	if response.Code != 200 || health["cache_version"] != "installed-cache" || health["native_version"] != "installed-native" || health["server"] != "localfirst-offline" {
		t.Fatal("installed bundle metadata or new product identity was lost")
	}
	for _, name := range []string{"/.diwan-offline.json", "/.localfirst-offline.json"} {
		result := httptest.NewRecorder()
		handler.ServeHTTP(result, httptest.NewRequest("GET", "http://127.0.0.1:8765"+name, nil))
		if result.Code != 404 {
			t.Fatal("private build marker became public")
		}
	}
}

func TestAssetsAndOfflineBoundaries(t *testing.T) {
	assets := fstest.MapFS{
		"index.html":               {Data: []byte("offline shell")},
		"assets/app.js":            {Data: []byte("application")},
		".localfirst-offline.json": {Data: []byte("private build metadata")},
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
		{"/.localfirst-offline.json", "GET", "127.0.0.1:8765", 404, ""},
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
