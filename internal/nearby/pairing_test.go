package nearby

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

const protocolHostAddress = "AABBCCDDEE01"
const protocolGuestAddress = "AABBCCDDEE02"

// This explicit package-private test capability stands in for OS-authenticated
// Bluetooth. Its loopback streams exercise protocol logic, never radio hardware
// or a claim that ordinary TCP qualifies as an authenticated Bluetooth stream.
type pairedProtocolConn struct {
	net.Conn
	peer    string
	revoked *atomic.Bool
}

func (c *pairedProtocolConn) authenticatedBluetoothPeer() string {
	if c.revoked != nil && c.revoked.Load() {
		return ""
	}
	return c.peer
}
func (c *pairedProtocolConn) RemoteAddr() net.Addr { return protocolBluetoothAddr(c.peer) }

type protocolBluetoothAddr string

func (a protocolBluetoothAddr) Network() string { return "protocol-test-only" }
func (a protocolBluetoothAddr) String() string  { return string(a) }

type pairedProtocolListener struct {
	net.Listener
	accepts atomic.Uint64
	revoked atomic.Bool
}

func (l *pairedProtocolListener) Accept() (net.Conn, error) {
	conn, err := l.Listener.Accept()
	if err != nil {
		return nil, err
	}
	peer := fmt.Sprintf("AABBCCDDEE%02X", l.accepts.Add(1)+1)
	return &pairedProtocolConn{Conn: conn, peer: peer, revoked: &l.revoked}, nil
}

func pairingHubs(t *testing.T) (*Hub, *Hub, *pairedProtocolListener, Document) {
	t.Helper()
	rawListener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	listener := &pairedProtocolListener{Listener: rawListener}
	host, client := NewHub(), NewHub()
	host.listen = func() (net.Listener, error) { return listener, nil }
	client.dial = func(ctx context.Context, _ string) (net.Conn, error) {
		conn, err := (&net.Dialer{}).DialContext(ctx, "tcp", listener.Addr().String())
		if err != nil {
			return nil, err
		}
		return &pairedProtocolConn{Conn: conn, peer: protocolHostAddress}, nil
	}
	t.Cleanup(func() { client.Stop(); host.Stop() })
	doc := Document{ID: "97a562f0-0751-4ee1-8634-78b80914077d", Name: "Private short-pairing document"}
	if err := host.Host(doc); err != nil {
		t.Fatal(err)
	}
	return host, client, listener, doc
}

func awaitPairingRequest(t *testing.T, host *Hub) *PairingRequest {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if request := host.Status().PairingRequest; request != nil {
			return request
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatalf("host did not publish pairing approval request: %+v", host.Status())
	return nil
}

func rawPairingRequest(t *testing.T, listener net.Listener, code string) net.Conn {
	t.Helper()
	raw, err := net.DialTimeout("tcp", listener.Addr().String(), time.Second)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { raw.Close() })
	_ = raw.SetDeadline(time.Now().Add(3 * time.Second))
	if _, err := io.WriteString(raw, pairingMagic); err != nil {
		t.Fatal(err)
	}
	if err := writePairingFrame(raw, pairingFrame{Code: code}); err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestShortPairingApprovesActualPeerThenPinsTLSAndSyncs(t *testing.T) {
	host, client, _, doc := pairingHubs(t)
	status := host.Status()
	if !isPairingCode(status.PairingCode) || !strings.HasPrefix(status.Invitation, "DBT1-") {
		t.Fatal("host did not retain both invitation methods")
	}
	expires, err := time.Parse(time.RFC3339Nano, status.PairingExpiresAt)
	if err != nil || time.Until(expires) < 119*time.Second || time.Until(expires) > 121*time.Second {
		t.Fatal("short code must expire in two minutes")
	}
	if err := client.Connect(protocolHostAddress, status.PairingCode); err != nil {
		t.Fatal(err)
	}
	request := awaitPairingRequest(t, host)
	if request.Address != protocolGuestAddress || len(request.ID) != 43 {
		t.Fatalf("approval is not bound to authenticated actual peer: %+v", request)
	}
	if client.Status().Document != nil || host.Status().State == "connected" {
		t.Fatal("document exposed before approval")
	}
	if err := host.ApprovePairing(request.ID); err != nil {
		t.Fatal(err)
	}
	waitStatus(t, host, "connected")
	waitStatus(t, client, "connected")
	if current := host.Status(); current.PairingCode != "" || current.PairingExpiresAt != "" || current.PairingRequest != nil {
		t.Fatal("approved code was not consumed")
	}
	if client.Status().Invitation != "" || client.Status().PairingCode != "" {
		t.Fatal("resolved invitation escaped reconnect memory")
	}
	client.mu.Lock()
	version := client.conn.ConnectionState().Version
	client.mu.Unlock()
	if version != tls.VersionTLS13 {
		t.Fatal("short code bypassed TLS 1.3")
	}
	message := json.RawMessage(`{"fileId":"` + doc.ID + `","kind":"vector","data":"AA=="}`)
	for _, direction := range [][2]*Hub{{client, host}, {host, client}} {
		if err := direction[0].Send(message); err != nil {
			t.Fatal(err)
		}
		deadline := time.Now().Add(time.Second)
		for direction[1].Status().ReceivedBytes == 0 && time.Now().Before(deadline) {
			time.Sleep(time.Millisecond)
		}
		if direction[1].Status().ReceivedBytes == 0 {
			t.Fatal("approved TLS connection did not carry document edits")
		}
	}
	if err := host.ApprovePairing(request.ID); err == nil {
		t.Fatal("approval ID could be replayed")
	}
}

func TestShortPairingReleasesNothingUntilApprovalAndRejectionReleasesNothing(t *testing.T) {
	host, _, listener, _ := pairingHubs(t)
	raw := rawPairingRequest(t, listener, host.Status().PairingCode)
	request := awaitPairingRequest(t, host)
	_ = raw.SetReadDeadline(time.Now().Add(40 * time.Millisecond))
	var probe [1]byte
	_, err := raw.Read(probe[:])
	if timeout, ok := err.(net.Error); !ok || !timeout.Timeout() {
		t.Fatalf("host sent data before approval: %v", err)
	}
	_ = raw.SetReadDeadline(time.Now().Add(time.Second))
	if err := host.RejectPairing(request.ID); err != nil {
		t.Fatal(err)
	}
	reply, err := readPairingFrame(raw)
	if err != nil || reply.Error == "" || reply.Invitation != "" {
		t.Fatalf("rejected peer received an invitation: %+v, %v", reply, err)
	}
	if host.Status().State != "listening" || host.Status().ReceivedBytes != 0 {
		t.Fatal("rejected pairing established document connection")
	}
	if err := host.ApprovePairing(request.ID); err == nil {
		t.Fatal("rejected approval ID remained valid")
	}
}

func TestShortPairingThreeAttemptsAreGlobalAcrossPeers(t *testing.T) {
	host, _, listener, _ := pairingHubs(t)
	code := host.Status().PairingCode
	wrong := "0000"
	if wrong == code {
		wrong = "0001"
	}
	for attempt := 1; attempt <= pairingAttemptLimit; attempt++ {
		raw := rawPairingRequest(t, listener, wrong)
		reply, err := readPairingFrame(raw)
		raw.Close()
		if err != nil || reply.Error == "" || reply.Invitation != "" {
			t.Fatalf("wrong attempt %d: %+v %v", attempt, reply, err)
		}
	}
	if status := host.Status(); status.PairingCode != "" || !strings.Contains(status.PairingError, "3-attempt") {
		t.Fatal("global budget did not disable code")
	}
	raw := rawPairingRequest(t, listener, code)
	reply, err := readPairingFrame(raw)
	if err != nil || reply.Invitation != "" || reply.Error == "" {
		t.Fatal("correct code was usable after global attempt limit")
	}
	if host.Status().PairingRequest != nil || listener.accepts.Load() != 4 {
		t.Fatal("attempt limit did not cover separate authenticated peer addresses")
	}
}

func TestShortPairingWrongCodeDoesNotAutoRetry(t *testing.T) {
	host, client, listener, _ := pairingHubs(t)
	wrong := "0000"
	if wrong == host.Status().PairingCode {
		wrong = "0001"
	}
	if err := client.Connect(protocolHostAddress, wrong); err != nil {
		t.Fatal(err)
	}
	waitStatus(t, client, "error")
	time.Sleep(4200 * time.Millisecond) // Existing full-invitation retry delay is four seconds.
	if listener.accepts.Load() != 1 || client.Status().Document != nil {
		t.Fatal("tiny-code failure retried automatically or revealed a document")
	}
}

func TestShortPairingExpiredCodeAndPendingRequestCannotBeApproved(t *testing.T) {
	host, client, _, _ := pairingHubs(t)
	if err := client.Connect(protocolHostAddress, host.Status().PairingCode); err != nil {
		t.Fatal(err)
	}
	request := awaitPairingRequest(t, host)
	host.mu.Lock()
	host.pairingExpires = time.Now().Add(-time.Second)
	generation := host.generation
	host.mu.Unlock()
	if err := host.ApprovePairing(request.ID); err == nil {
		t.Fatal("expired code accepted approval")
	}
	host.expirePairing(generation)
	waitStatus(t, client, "error")
	if status := host.Status(); status.PairingCode != "" || status.PairingRequest != nil || status.State == "connected" {
		t.Fatal("expired pairing leaked state")
	}
}

func TestShortPairingApprovalDeadlineIsCheckedWithoutTimerScheduling(t *testing.T) {
	host, client, _, _ := pairingHubs(t)
	if err := client.Connect(protocolHostAddress, host.Status().PairingCode); err != nil {
		t.Fatal(err)
	}
	request := awaitPairingRequest(t, host)
	host.mu.Lock()
	host.pairingRequestExpires = time.Now().Add(-time.Millisecond)
	host.mu.Unlock()
	if err := host.ApprovePairing(request.ID); err == nil {
		t.Fatal("request deadline could be bypassed by delayed timer scheduling")
	}
	if host.Status().PairingCode == "" {
		t.Fatal("stale approval consumed an otherwise live code")
	}
}

func TestShortPairingApprovalTimeoutRejectsAndClearsRequest(t *testing.T) {
	host, client, _, _ := pairingHubs(t)
	host.mu.Lock()
	host.pairingApprovalTimeout = 40 * time.Millisecond
	host.mu.Unlock()
	if err := client.Connect(protocolHostAddress, host.Status().PairingCode); err != nil {
		t.Fatal(err)
	}
	request := awaitPairingRequest(t, host)
	waitStatus(t, client, "error")
	if err := host.ApprovePairing(request.ID); err == nil {
		t.Fatal("timed-out request approved")
	}
	if host.Status().PairingRequest != nil || !strings.Contains(host.Status().PairingError, "timed out") {
		t.Fatal("timeout did not clear pending approval")
	}
}

func TestShortPairingStopInterruptsRawApprovalAndCannotAffectReplacement(t *testing.T) {
	host, client, _, doc := pairingHubs(t)
	if err := client.Connect(protocolHostAddress, host.Status().PairingCode); err != nil {
		t.Fatal(err)
	}
	request := awaitPairingRequest(t, host)
	host.mu.Lock()
	oldGeneration := host.generation
	host.mu.Unlock()
	host.Stop()
	waitStatus(t, client, "error")
	if err := host.ApprovePairing(request.ID); err == nil {
		t.Fatal("stopped request approved")
	}
	if status := host.Status(); status.State != "idle" || status.PairingRequest != nil || status.PairingCode != "" {
		t.Fatal("stopped raw approval changed status")
	}
	newListener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	paired := &pairedProtocolListener{Listener: newListener}
	host.listen = func() (net.Listener, error) { return paired, nil }
	if err := host.Host(doc); err != nil {
		t.Fatal(err)
	}
	newStatus := host.Status()
	raw := rawPairingRequest(t, paired, newStatus.PairingCode)
	newRequest := awaitPairingRequest(t, host)
	host.expirePairing(oldGeneration)
	if err := host.ApprovePairing(request.ID); err == nil {
		t.Fatal("old approval accepted for replacement session")
	}
	if got := host.Status(); got.PairingCode != newStatus.PairingCode || got.PairingRequest == nil || got.PairingRequest.ID != newRequest.ID {
		t.Fatal("old expiry or approval changed replacement session")
	}
	if err := host.RejectPairing(newRequest.ID); err != nil {
		t.Fatal(err)
	}
	if reply, err := readPairingFrame(raw); err != nil || reply.Invitation != "" || reply.Error == "" {
		t.Fatal("replacement rejection failed")
	}
}

func TestShortPairingSuccessfulCodeCannotBeReplayed(t *testing.T) {
	host, client, listener, _ := pairingHubs(t)
	code := host.Status().PairingCode
	if err := client.Connect(protocolHostAddress, code); err != nil {
		t.Fatal(err)
	}
	request := awaitPairingRequest(t, host)
	if err := host.ApprovePairing(request.ID); err != nil {
		t.Fatal(err)
	}
	waitStatus(t, client, "connected")
	client.Stop()
	waitStatus(t, host, "listening")
	raw := rawPairingRequest(t, listener, code)
	reply, err := readPairingFrame(raw)
	if err != nil || reply.Invitation != "" || reply.Error == "" {
		t.Fatalf("consumed code replay: %+v %v", reply, err)
	}
	if host.Status().PairingRequest != nil {
		t.Fatal("consumed code opened a new approval request")
	}
}

func TestLegacyInvitationConsumesUnusedShortCodeWithoutExpiryError(t *testing.T) {
	host, client, _ := testHubs(t)
	if err := client.Connect("test-only", host.Status().Invitation); err != nil {
		t.Fatal(err)
	}
	waitStatus(t, host, "connected")
	if status := host.Status(); status.PairingCode != "" || status.PairingExpiresAt != "" || status.PairingError != "" {
		t.Fatal("legacy connection left a short code active")
	}
	host.mu.Lock()
	generation := host.generation
	host.pairingExpires = time.Now().Add(-time.Second)
	host.mu.Unlock()
	host.expirePairing(generation)
	if status := host.Status(); status.State != "connected" || status.PairingError != "" {
		t.Fatal("unused code expiry disturbed legacy connection")
	}
}

func TestShortPairingRevokedNativeMembershipBlocksInvitationRelease(t *testing.T) {
	host, client, listener, _ := pairingHubs(t)
	if err := client.Connect(protocolHostAddress, host.Status().PairingCode); err != nil {
		t.Fatal(err)
	}
	request := awaitPairingRequest(t, host)
	listener.revoked.Store(true)
	if err := host.ApprovePairing(request.ID); err != nil {
		t.Fatal(err)
	}
	waitStatus(t, client, "error")
	if client.Status().Document != nil || host.Status().State == "connected" {
		t.Fatal("revoked native membership disclosed a document")
	}
}

func TestShortPairingRejectsUntrustedStreamsOnBothSides(t *testing.T) {
	// The pre-existing generic TCP protocol seam intentionally lacks the native
	// capability. A four-digit code may not turn it into a trusted channel.
	host, client, _ := testHubs(t)
	if err := client.Connect(protocolHostAddress, host.Status().PairingCode); err != nil {
		t.Fatal(err)
	}
	waitStatus(t, client, "error")
	if !strings.Contains(client.Status().Error, "directly paired") || client.Status().Document != nil {
		t.Fatal("generic client stream accepted short code")
	}
	raw, err := net.Dial("tcp", host.listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer raw.Close()
	_ = raw.SetDeadline(time.Now().Add(time.Second))
	_, _ = io.WriteString(raw, pairingMagic)
	var probe [1]byte
	if n, err := raw.Read(probe[:]); n != 0 || err == nil {
		t.Fatal("untrusted incoming stream received pairing data")
	}
	if host.Status().PairingRequest != nil {
		t.Fatal("untrusted incoming stream triggered host approval")
	}
}

func TestShortPairingClientStopInterruptsRawBootstrap(t *testing.T) {
	host, client, _, _ := pairingHubs(t)
	if err := client.Connect(protocolHostAddress, host.Status().PairingCode); err != nil {
		t.Fatal(err)
	}
	awaitPairingRequest(t, host)
	client.Stop()
	if status := client.Status(); status.State != "idle" || status.Document != nil {
		t.Fatal("client Stop left a raw bootstrap active")
	}
	// Host cannot know the remote user cancelled until its bounded wait ends,
	// but explicit rejection must never establish TLS or disclose a document.
	if err := host.RejectPairing(host.Status().PairingRequest.ID); err != nil {
		t.Fatal(err)
	}
	if host.Status().State == "connected" {
		t.Fatal("cancelled client established a document connection")
	}
}

func TestShortPairingFramesRejectOversizeTruncationAndUnknownFields(t *testing.T) {
	frameBytes := func(data string) []byte {
		var h [4]byte
		binary.BigEndian.PutUint32(h[:], uint32(len(data)))
		return append(h[:], data...)
	}
	var oversized [4]byte
	binary.BigEndian.PutUint32(oversized[:], pairingFrameLimit+1)
	for _, input := range [][]byte{nil, {0, 1}, oversized[:], frameBytes(`{"code":"1234","extra":true}`), frameBytes(`{"code":"1234"} {}`), {0, 0, 0, 9, '{'}} {
		if _, err := readPairingFrame(bytes.NewReader(input)); err == nil {
			t.Fatal("invalid pairing frame accepted")
		}
	}
	if err := writePairingFrame(io.Discard, pairingFrame{Invitation: strings.Repeat("x", pairingFrameLimit)}); err == nil {
		t.Fatal("oversize pairing response written")
	}
}

func TestShortPairingHTTPApprovalRequiresCurrentRequestAndBridgeProtection(t *testing.T) {
	host, client, _, _ := pairingHubs(t)
	if err := client.Connect(protocolHostAddress, host.Status().PairingCode); err != nil {
		t.Fatal(err)
	}
	request := awaitPairingRequest(t, host)
	for _, tc := range []struct {
		path, id, token, origin string
		want                    int
	}{
		{"approve-pairing", request.ID, "", "http://127.0.0.1:8765", 403},
		{"approve-pairing", request.ID, host.Token, "https://attacker.example", 403},
		{"approve-pairing", "stale", host.Token, "http://127.0.0.1:8765", 409},
		{"reject-pairing", request.ID, host.Token, "http://127.0.0.1:8765", 200},
		{"approve-pairing", request.ID, host.Token, "http://127.0.0.1:8765", 409},
	} {
		body, _ := json.Marshal(map[string]string{"requestId": tc.id})
		r := httptest.NewRequest("POST", "http://127.0.0.1:8765/_nearby/"+tc.path, bytes.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Origin", tc.origin)
		r.Header.Set("X-LocalFirst-Native-Token", tc.token)
		w := httptest.NewRecorder()
		host.Handler().ServeHTTP(w, r)
		if w.Code != tc.want {
			t.Fatalf("%s:status%d want%d", tc.path, w.Code, tc.want)
		}
	}
}

func TestShortPairingCodeSyntaxAndGeneration(t *testing.T) {
	for _, invalid := range []string{"123", "12345", "ABCD", "１２３４", " 1234", "1234\n"} {
		if isPairingCode(invalid) {
			t.Fatalf("invalid shortcode %q", invalid)
		}
	}
	for _, valid := range []string{"0000", "0001", "9999"} {
		if !isPairingCode(valid) {
			t.Fatalf("valid shortcode %q rejected", valid)
		}
	}
	for range 32 {
		code, err := makePairingCode()
		if err != nil || !isPairingCode(code) {
			t.Fatalf("bad generated code %q %v", code, err)
		}
	}
}
