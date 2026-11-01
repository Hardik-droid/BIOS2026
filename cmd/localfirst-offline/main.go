// localfirst-offline serves bundled application assets on loopback. It has no cloud API.
package main

import (
	"bytes"
	"embed"
	"encoding/json"
	"flag"
	"fmt"
	"io/fs"
	appbrand "localfirst/internal/brand"
	"localfirst/internal/nearby"
	"log"
	"mime"
	"net"
	"net/http"
	"os"
	"path"
	"strings"
	"time"
)

//go:embed launch.html launch.js launch.css
var launcherFiles embed.FS

func loopbackAddress(addr string) bool {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return false
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func assetHandler(assets fs.FS) http.Handler {
	var build struct {
		CacheVersion  string `json:"cacheVersion"`
		NativeVersion string `json:"nativeVersion"`
	}
	if marker, err := appbrand.ReadOfflineMetadata(assets); err == nil {
		_ = json.Unmarshal(marker, &build)
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host := r.Host
		if parsed, _, err := net.SplitHostPort(host); err == nil {
			host = parsed
		}
		ip := net.ParseIP(host)
		if host != "localhost" && (ip == nil || !ip.IsLoopback()) {
			http.Error(w, "Loopback host required", http.StatusForbidden)
			return
		}
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Content-Security-Policy", "frame-ancestors 'none'")
		w.Header().Set("Referrer-Policy", "no-referrer")
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, "Read-only asset server", http.StatusMethodNotAllowed)
			return
		}
		if r.URL.Path == "/healthz" || r.URL.Path == "/api/offline-launch-health" {
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Cache-Control", "no-store")
			if r.Method != http.MethodHead {
				_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok", "server": "localfirst-offline", "mode": "offline-only", "cache_version": build.CacheVersion, "native_version": build.NativeVersion, "nearby_protocol": "windows-rfcomm-v1"})
			}
			return
		}
		// All released offline workers bypass /api/. Keep the launcher
		// here so a cached shell cannot hide a newly installed application.
		if r.URL.Path == "/api/offline-launch" || r.URL.Path == "/api/offline-launch.js" || r.URL.Path == "/api/offline-launch.css" {
			name := "launch.html"
			if strings.HasSuffix(r.URL.Path, ".js") {
				name = "launch.js"
			} else if strings.HasSuffix(r.URL.Path, ".css") {
				name = "launch.css"
			}
			data, _ := launcherFiles.ReadFile(name)
			w.Header().Set("Cache-Control", "no-store")
			w.Header().Set("Content-Type", mime.TypeByExtension(path.Ext(name)))
			w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
			http.ServeContent(w, r, name, time.Time{}, bytes.NewReader(data))
			return
		}
		name := strings.TrimPrefix(r.URL.Path, "/")
		if name == "" {
			name = "index.html"
		}
		if !fs.ValidPath(name) {
			http.NotFound(w, r)
			return
		}
		for _, component := range strings.Split(name, "/") {
			if strings.HasPrefix(component, ".") {
				http.NotFound(w, r)
				return
			}
		}
		if name == "api" || strings.HasPrefix(name, "api/") || name == "v1" || strings.HasPrefix(name, "v1/") {
			http.NotFound(w, r)
			return
		}
		data, err := fs.ReadFile(assets, name)
		if err != nil {
			first, _, _ := strings.Cut(name, "/")
			switch first {
			case "docs", "sheets", "slides", "whiteboards", "pdf", "settings":
				name = "index.html"
				data, err = fs.ReadFile(assets, name)
			}
		}
		if err != nil {
			http.NotFound(w, r)
			return
		}
		if contentType := mime.TypeByExtension(path.Ext(name)); contentType != "" {
			w.Header().Set("Content-Type", contentType)
		}
		if strings.HasPrefix(name, "assets/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		} else {
			w.Header().Set("Cache-Control", "no-cache")
		}
		http.ServeContent(w, r, name, time.Time{}, bytes.NewReader(data))
	})
}

func main() {
	addr := flag.String("addr", "127.0.0.1:8765", "loopback listen address")
	assetsPath := flag.String("assets", "web", "offline application asset directory")
	flag.Parse()
	if !loopbackAddress(*addr) {
		log.Fatal("Only a loopback IP address is allowed")
	}
	assets := os.DirFS(*assetsPath)
	marker, err := appbrand.ReadOfflineMetadata(assets)
	if err != nil {
		log.Fatal("Build the offline application before starting: ", err)
	}
	var info struct {
		Mode string `json:"mode"`
	}
	if json.Unmarshal(marker, &info) != nil || info.Mode != "offline-only" {
		log.Fatal("The asset directory is not an offline build")
	}
	if _, err := fs.Stat(assets, "index.html"); err != nil {
		log.Fatal(err)
	}
	hub := nearby.NewHub()
	defer hub.Stop()
	mux := http.NewServeMux()
	mux.Handle("/_nearby/", hub.Handler())
	mux.Handle("/", assetHandler(assets))
	server := &http.Server{Addr: *addr, Handler: mux, ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 60 * time.Second, WriteTimeout: 30 * time.Second}
	fmt.Printf("LocalFirst offline workspace: http://%s\n", *addr)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}
