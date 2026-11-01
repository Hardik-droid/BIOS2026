package nearby

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"
)

func (h *Hub) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		fail := func(code int, message string) {
			w.WriteHeader(code)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": message})
		}
		host := r.Host
		if name, _, err := net.SplitHostPort(host); err == nil {
			host = name
		}
		ip := net.ParseIP(host)
		if host != "localhost" && (ip == nil || !ip.IsLoopback()) {
			fail(403, "Loopback host required.")
			return
		}
		if (r.Header.Get("Origin") != "" && r.Header.Get("Origin") != "http://"+r.Host) || (r.Header.Get("Sec-Fetch-Site") != "" && r.Header.Get("Sec-Fetch-Site") != "same-origin" && r.Header.Get("Sec-Fetch-Site") != "none") {
			fail(403, "Open Bluetooth sharing from the local LocalFirst app.")
			return
		}
		path := strings.TrimPrefix(r.URL.Path, "/_nearby/")
		if path == "bootstrap" && r.Method == "GET" {
			_ = json.NewEncoder(w).Encode(map[string]any{"token": h.Token, "transport": "windows-bluetooth-rfcomm", "version": 1})
			return
		}
		// Cached clients may retain the old header until their next app update.
		// A supplied new header is authoritative; an invalid value never falls back.
		nativeToken := r.Header.Get("X-LocalFirst-Native-Token")
		if len(r.Header.Values("X-LocalFirst-Native-Token")) == 0 {
			nativeToken = r.Header.Get("X-Diwan-Native-Token")
		}
		if subtle.ConstantTimeCompare([]byte(nativeToken), []byte(h.Token)) != 1 {
			fail(403, "Local bridge token required.")
			return
		}
		var value any
		if r.Method == "GET" {
			switch path {
			case "status":
				value = map[string]any{"status": h.Status(), "radio": RadioStatus()}
			case "devices":
				devices, err := PairedDevices()
				if err != nil {
					fail(503, err.Error())
					return
				}
				value = devices
			case "events":
				after, err := strconv.ParseUint(r.URL.Query().Get("after"), 10, 64)
				if err != nil {
					fail(400, "Invalid event cursor.")
					return
				}
				ctx, cancel := context.WithTimeout(r.Context(), 18*time.Second)
				defer cancel()
				value = h.Events(ctx, after)
			default:
				fail(404, "Unknown local Bluetooth operation.")
				return
			}
		} else if r.Method == "POST" {
			if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
				fail(415, "JSON required.")
				return
			}
			var body struct {
				Document   Document        `json:"document"`
				Address    string          `json:"address"`
				Invitation string          `json:"invitation"`
				RequestID  string          `json:"requestId"`
				Message    json.RawMessage `json:"message"`
			}
			decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, MaxFrame))
			decoder.DisallowUnknownFields()
			if decoder.Decode(&body) != nil {
				fail(400, "Invalid Bluetooth command.")
				return
			}
			if decoder.Decode(new(any)) != io.EOF {
				fail(400, "Only one command is allowed.")
				return
			}
			var err error
			switch path {
			case "host":
				err = h.Host(body.Document)
			case "connect":
				err = h.Connect(body.Address, body.Invitation)
			case "approve-pairing":
				err = h.ApprovePairing(body.RequestID)
			case "reject-pairing":
				err = h.RejectPairing(body.RequestID)
			case "stop":
				h.Stop()
			case "send":
				err = h.Send(body.Message)
			default:
				fail(404, "Unknown local Bluetooth operation.")
				return
			}
			if err != nil {
				fail(409, err.Error())
				return
			}
			value = h.Status()
		} else {
			fail(405, "Unsupported method.")
			return
		}
		_ = json.NewEncoder(w).Encode(value)
	})
}
