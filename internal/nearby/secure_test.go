package nearby

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"net"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func waitStatus(t *testing.T, hub *Hub, wanted string) Status {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		status := hub.Status()
		if status.State == wanted {
			return status
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("wanted state %s, got %s", wanted, hub.Status().State)
	return Status{}
}
func testHubs(t *testing.T) (*Hub, *Hub, Document) {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0") // Protocol test only. Production Listen/Dial use AF_BTH exclusively.
	if err != nil {
		t.Fatal(err)
	}
	host, client := NewHub(), NewHub()
	host.listen = func() (net.Listener, error) { return listener, nil }
	client.dial = func(ctx context.Context, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "tcp", listener.Addr().String())
	}
	t.Cleanup(func() { client.Stop(); host.Stop() })
	doc := Document{ID: "97a562f0-0751-4ee1-8634-78b80914077d", Name: "Protocol test document"}
	if err := host.Host(doc); err != nil {
		t.Fatal(err)
	}
	return host, client, doc
}
func TestAuthenticatedChannelCarriesOnlyTheChosenDocument(t *testing.T) {
	host, client, doc := testHubs(t)
	if err := client.Connect("test-only", host.Status().Invitation); err != nil {
		t.Fatal(err)
	}
	waitStatus(t, host, "connected")
	waitStatus(t, client, "connected")
	data := json.RawMessage(`{"fileId":"` + doc.ID + `","kind":"vector","data":"AA=="}`)
	if err := client.Send(data); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	var cursor uint64
	for {
		batch := host.Events(ctx, cursor)
		cursor = batch.Cursor
		for _, event := range batch.Events {
			if len(event.Message) > 0 {
				if !bytes.Equal(event.Message, data) {
					t.Fatal("message was altered")
				}
				if host.Status().ReceivedBytes == 0 {
					t.Fatal("no bytes recorded")
				}
				return
			}
		}
		if ctx.Err() != nil {
			t.Fatal("no message received")
		}
	}
}
func TestWrongCertificatePinCannotConnect(t *testing.T) {
	host, client, _ := testHubs(t)
	encoded := strings.TrimPrefix(host.Status().Invitation, "DBT1-")
	data, _ := base64.RawURLEncoding.DecodeString(encoded)
	data[0] ^= 0xff
	if err := client.Connect("test-only", "DBT1-"+base64.RawURLEncoding.EncodeToString(data)); err != nil {
		t.Fatal(err)
	}
	waitStatus(t, client, "error")
	if host.Status().State == "connected" || host.Status().ReceivedBytes != 0 {
		t.Fatal("unauthenticated peer was accepted")
	}
}
func TestWrongSecretCannotReadDocumentOffer(t *testing.T) {
	host, client, _ := testHubs(t)
	data, _ := base64.RawURLEncoding.DecodeString(strings.TrimPrefix(host.Status().Invitation, "DBT1-"))
	data[40] ^= 0xff
	if err := client.Connect("test-only", "DBT1-"+base64.RawURLEncoding.EncodeToString(data)); err != nil {
		t.Fatal(err)
	}
	waitStatus(t, client, "error")
	if client.Status().Document != nil || host.Status().State == "connected" {
		t.Fatal("secret mismatch exposed a document")
	}
}
func TestFramingRejectsTruncationAndOversize(t *testing.T) {
	var header [4]byte
	binary.BigEndian.PutUint32(header[:], MaxFrame+1)
	for _, data := range [][]byte{nil, {0, 0}, header[:], {0, 0, 0, 4, '{', '}'}} {
		if _, err := readPacket(bytes.NewReader(data)); err == nil {
			t.Fatal("invalid frame accepted")
		}
	}
	var wire bytes.Buffer
	if err := writePacket(&wire, packet{Type: "ping"}); err != nil {
		t.Fatal(err)
	}
	if message, err := readPacket(&wire); err != nil || message.Type != "ping" {
		t.Fatal("valid frame failed")
	}
}
func TestHTTPBridgeRejectsCrossOriginAndMissingToken(t *testing.T) {
	hub := NewHub()
	defer hub.Stop()
	for _, tc := range []struct {
		path, origin, token, host string
		want                      int
	}{
		{"bootstrap", "https://attacker.example", "", "127.0.0.1:8765", 403},
		{"bootstrap", "", "", "attacker.example:8765", 403},
		{"status", "http://127.0.0.1:8765", "", "127.0.0.1:8765", 403},
		{"bootstrap", "http://127.0.0.1:8765", "", "127.0.0.1:8765", 200},
	} {
		r := httptest.NewRequest("GET", "http://"+tc.host+"/_nearby/"+tc.path, nil)
		r.Host = tc.host
		r.Header.Set("Origin", tc.origin)
		r.Header.Set("X-LocalFirst-Native-Token", tc.token)
		w := httptest.NewRecorder()
		hub.Handler().ServeHTTP(w, r)
		if w.Code != tc.want {
			t.Fatalf("%s: status %d, want %d", tc.path, w.Code, tc.want)
		}
	}
}
func TestIdentityRequiresTLS13AndCertificatePin(t *testing.T) {
	_, _, invitation, err := makeIdentity()
	if err != nil {
		t.Fatal(err)
	}
	config, secret, err := clientIdentity(invitation)
	if err != nil || config.MinVersion != tls.VersionTLS13 || config.VerifyConnection == nil || len(secret) != 43 {
		t.Fatal("incomplete client authentication")
	}
	for _, bad := range []string{"", "DBT1-invalid", "DBT1-" + strings.Repeat("a", 200)} {
		if _, _, err := clientIdentity(bad); err == nil {
			t.Fatal("invalid invitation accepted")
		}
	}
}

func TestStopClosesPendingHostAuthentication(t *testing.T) {
	host, _, _ := testHubs(t)
	config, _, err := clientIdentity(host.Status().Invitation)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := net.Dial("tcp", host.listener.Addr().String()) // Protocol test only.
	if err != nil {
		t.Fatal(err)
	}
	conn := tls.Client(raw, config)
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(2 * time.Second))
	if err := conn.Handshake(); err != nil {
		t.Fatal(err)
	}
	// The peer deliberately withholds the invitation secret after finishing TLS.
	host.Stop()
	var data [1]byte
	_, err = conn.Read(data[:])
	var timeout net.Error
	if err == nil || (errors.As(err, &timeout) && timeout.Timeout()) {
		t.Fatalf("Stop left pending authentication open: %v", err)
	}
	if status := host.Status(); status.State != "idle" || status.Document != nil {
		t.Fatalf("stopped handshake changed status: %+v", status)
	}
}

func TestCancelledGenerationCannotPublishConnection(t *testing.T) {
	hub := NewHub()
	defer hub.Stop()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	left, right := net.Pipe() // Protocol test only.
	defer right.Close()
	conn := tls.Client(left, &tls.Config{MinVersion: tls.VersionTLS13})
	if hub.prepareConnection(ctx, 0, conn) {
		t.Fatal("cancelled handshake was adopted")
	}
	hub.serve(ctx, 0, conn, Document{ID: "97a562f0-0751-4ee1-8634-78b80914077d", Name: "Cancelled"}, "unused")
	if hub.Status().State != "idle" {
		t.Fatal("cancelled generation became connected")
	}
}
