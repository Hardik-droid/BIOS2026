//go:build compute_experiment

package computeexp

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"errors"
	"io"
	"net"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

// Protocol tests use in-memory streams only. They do not verify Bluetooth
// hardware, link security, physical throughput, or remote training execution.
type secureTestConn struct {
	net.Conn
	mu        sync.Mutex
	deadlines []time.Time
	closed    bool
}

func (conn *secureTestConn) SetDeadline(deadline time.Time) error {
	conn.mu.Lock()
	conn.deadlines = append(conn.deadlines, deadline)
	conn.mu.Unlock()
	return conn.Conn.SetDeadline(deadline)
}

func (conn *secureTestConn) Close() error {
	conn.mu.Lock()
	conn.closed = true
	conn.mu.Unlock()
	return conn.Conn.Close()
}

func (conn *secureTestConn) snapshot() ([]time.Time, bool) {
	conn.mu.Lock()
	defer conn.mu.Unlock()
	return append([]time.Time(nil), conn.deadlines...), conn.closed
}

type secureTestResult struct {
	conn net.Conn
	err  error
}

func secureTestPipe(t *testing.T) (*secureTestConn, *secureTestConn) {
	t.Helper()
	left, right := net.Pipe()
	server, client := &secureTestConn{Conn: left}, &secureTestConn{Conn: right}
	t.Cleanup(func() { _ = server.Close(); _ = client.Close() })
	return server, client
}

func testComputeIdentity(t *testing.T) Identity {
	t.Helper()
	identity, err := NewIdentity()
	if err != nil {
		t.Fatal(err)
	}
	return identity
}

func awaitSecureTestResult(t *testing.T, results <-chan secureTestResult) secureTestResult {
	t.Helper()
	select {
	case result := <-results:
		return result
	case <-time.After(3 * time.Second):
		t.Fatal("secure stream operation did not finish")
		return secureTestResult{}
	}
}

func testSecurePair(t *testing.T, identity Identity, invitation string, ctx context.Context) (secureTestResult, secureTestResult, *secureTestConn, *secureTestConn) {
	t.Helper()
	server, client := secureTestPipe(t)
	results := make(chan secureTestResult, 1)
	go func() {
		conn, err := AcceptSecure(ctx, server, identity)
		results <- secureTestResult{conn, err}
	}()
	clientConn, clientErr := DialSecure(ctx, client, invitation)
	return awaitSecureTestResult(t, results), secureTestResult{clientConn, clientErr}, server, client
}

func alteredComputeInvitation(t *testing.T, invitation string, offset int) string {
	t.Helper()
	data, err := base64.RawURLEncoding.DecodeString(strings.TrimPrefix(invitation, computeInvitationPrefix))
	if err != nil || len(data) != 64 {
		t.Fatal("test invitation is malformed")
	}
	data[offset] ^= 0xff
	return computeInvitationPrefix + base64.RawURLEncoding.EncodeToString(data)
}

func TestComputeIdentityIsEphemeralAndCanonical(t *testing.T) {
	before := time.Now()
	identity := testComputeIdentity(t)
	other := testComputeIdentity(t)
	if len(identity.Secret) != 32 || len(identity.Certificate.Certificate) != 1 || identity.Certificate.PrivateKey == nil || identity.Invitation == other.Invitation {
		t.Fatal("identities do not contain independent certificate pins and 256-bit secrets")
	}
	if identity.Expires.Before(before.Add(9*time.Minute)) || identity.Expires.After(time.Now().Add(10*time.Minute)) {
		t.Fatal("identity has an unexpected validity period")
	}
	certificate, err := x509.ParseCertificate(identity.Certificate.Certificate[0])
	if err != nil || !certificate.NotAfter.Equal(identity.Expires) {
		t.Fatal("certificate validity does not match invitation expiry")
	}
	if _, ok := identity.Certificate.PrivateKey.(*ecdsa.PrivateKey); !ok {
		t.Fatal("identity does not use an ECDSA private key")
	}
	pin, secret, err := parseComputeInvitation(identity.Invitation)
	actual := sha256.Sum256(identity.Certificate.Certificate[0])
	if err != nil || pin != actual || !bytes.Equal(secret[:], identity.Secret) {
		t.Fatal("invitation does not contain the exact certificate pin and secret")
	}
}

func TestComputeInvitationRejectsLegacyAndNoncanonicalEncoding(t *testing.T) {
	identity := testComputeIdentity(t)
	encoded := strings.TrimPrefix(identity.Invitation, computeInvitationPrefix)
	alphabet := "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
	last := strings.IndexByte(alphabet, encoded[len(encoded)-1])
	noncanonical := encoded[:len(encoded)-1] + string(alphabet[last+1])
	for _, invitation := range []string{
		"", identity.Invitation + "=", " " + identity.Invitation, identity.Invitation + "\n",
		"DBT1-" + encoded, "DRL1-" + encoded, "lfc1-" + encoded,
		computeInvitationPrefix + noncanonical,
		computeInvitationPrefix + encoded[:len(encoded)-1] + "!",
		computeInvitationPrefix + base64.RawURLEncoding.EncodeToString(make([]byte, 63)),
	} {
		if _, _, err := parseComputeInvitation(invitation); err == nil {
			t.Fatal("invalid or foreign-protocol invitation was accepted")
		}
	}
	server, client := secureTestPipe(t)
	if conn, err := DialSecure(context.Background(), client, "DBT1-"+encoded); conn != nil || err == nil {
		t.Fatal("legacy invitation reached compute authentication")
	}
	_, closed := client.snapshot()
	if !closed {
		t.Fatal("invalid invitation did not close its raw stream")
	}
	if _, err := server.Read(make([]byte, 1)); !errors.Is(err, io.EOF) {
		t.Fatal("invalid invitation wrote protocol bytes")
	}
}

func TestComputeSecureChannelAuthenticatesAndClearsAbsoluteDeadlines(t *testing.T) {
	identity := testComputeIdentity(t)
	before := time.Now()
	server, client, serverRaw, clientRaw := testSecurePair(t, identity, identity.Invitation, context.Background())
	after := time.Now()
	if server.err != nil || client.err != nil || server.conn == nil || client.conn == nil {
		t.Fatalf("correct invitation failed: server %v, client %v", server.err, client.err)
	}
	for _, raw := range []*secureTestConn{serverRaw, clientRaw} {
		deadlines, closed := raw.snapshot()
		if closed || len(deadlines) < 2 || !deadlines[len(deadlines)-1].IsZero() {
			t.Fatal("successful authentication closed the stream or left an auth deadline active")
		}
		first := deadlines[0]
		if first.Before(before.Add(15*time.Second)) || first.After(after.Add(15*time.Second)) {
			t.Fatal("authentication did not start with a fifteen-second absolute deadline")
		}
		for _, deadline := range deadlines[:len(deadlines)-1] {
			if deadline.IsZero() || deadline.After(first) {
				t.Fatal("authentication deadline was reset or extended during the exchange")
			}
		}
	}
	for _, conn := range []net.Conn{server.conn, client.conn} {
		state := conn.(*tls.Conn).ConnectionState()
		if state.Version != tls.VersionTLS13 || state.NegotiatedProtocol != computeALPN {
			t.Fatal("session did not negotiate the compute-only TLS 1.3 protocol")
		}
	}
	message := []byte("authenticated test payload")
	written := make(chan error, 1)
	go func() { _, err := client.conn.Write(message); written <- err }()
	buffer := make([]byte, len(message))
	if _, err := io.ReadFull(server.conn, buffer); err != nil || !bytes.Equal(buffer, message) {
		t.Fatalf("authenticated stream did not carry payload: %v", err)
	}
	if err := <-written; err != nil {
		t.Fatal(err)
	}
}

func TestComputeSecureRejectsWrongPinAndSecret(t *testing.T) {
	identity := testComputeIdentity(t)
	for _, offset := range []int{0, 32} {
		t.Run(map[int]string{0: "pin", 32: "secret"}[offset], func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			server, client, serverRaw, clientRaw := testSecurePair(t, identity, alteredComputeInvitation(t, identity.Invitation, offset), ctx)
			if server.err == nil || client.err == nil || server.conn != nil || client.conn != nil {
				t.Fatal("invalid authentication established a secure session")
			}
			_, serverClosed := serverRaw.snapshot()
			_, clientClosed := clientRaw.snapshot()
			if !serverClosed || !clientClosed {
				t.Fatal("authentication failure left a raw stream open")
			}
		})
	}
}

func TestComputeSecureRejectsWrongALPNAndLegacyTLS(t *testing.T) {
	identity := testComputeIdentity(t)
	pin, _, _ := parseComputeInvitation(identity.Invitation)
	for _, name := range []string{"alpn", "missing-alpn", "legacy-tls"} {
		t.Run("server-rejects-"+name, func(t *testing.T) {
			server, client := secureTestPipe(t)
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			results := make(chan secureTestResult, 1)
			go func() { conn, err := AcceptSecure(ctx, server, identity); results <- secureTestResult{conn, err} }()
			config := computeClientTLSConfig(pin)
			if name == "alpn" {
				config.NextProtos = []string{"localfirst-documents-v1"}
			} else if name == "missing-alpn" {
				config.NextProtos = nil
			} else {
				config.MinVersion, config.MaxVersion = tls.VersionTLS12, tls.VersionTLS12
			}
			_ = tls.Client(client, config).HandshakeContext(ctx)
			_ = client.Close()
			result := awaitSecureTestResult(t, results)
			if result.err == nil || result.conn != nil {
				t.Fatal("server accepted a different protocol or legacy TLS")
			}
		})
		t.Run("client-rejects-"+name, func(t *testing.T) {
			server, client := secureTestPipe(t)
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			config := &tls.Config{Certificates: []tls.Certificate{identity.Certificate}, MinVersion: tls.VersionTLS13, MaxVersion: tls.VersionTLS13, NextProtos: []string{computeALPN}, SessionTicketsDisabled: true}
			if name == "alpn" {
				config.NextProtos = []string{"localfirst-documents-v1"}
			} else if name == "missing-alpn" {
				config.NextProtos = nil
			} else {
				config.MinVersion, config.MaxVersion = tls.VersionTLS12, tls.VersionTLS12
			}
			results := make(chan secureTestResult, 1)
			go func() {
				err := tls.Server(server, config).HandshakeContext(ctx)
				_ = server.Close()
				results <- secureTestResult{err: err}
			}()
			if conn, err := DialSecure(ctx, client, identity.Invitation); err == nil || conn != nil {
				t.Fatal("client accepted a different protocol or legacy TLS")
			}
			_ = awaitSecureTestResult(t, results)
		})
	}
}

func TestComputeSecureRejectsExpiredIdentityBeforeHandshake(t *testing.T) {
	identity := testComputeIdentity(t)
	identity.Expires = time.Now().Add(-time.Second)
	server, client := secureTestPipe(t)
	if conn, err := AcceptSecure(context.Background(), server, identity); conn != nil || err == nil {
		t.Fatal("expired invitation was accepted")
	}
	deadlines, closed := server.snapshot()
	if !closed || len(deadlines) != 0 {
		t.Fatal("expired invitation started a handshake or left its stream open")
	}
	if _, err := client.Read(make([]byte, 1)); !errors.Is(err, io.EOF) {
		t.Fatal("expired identity emitted handshake bytes")
	}
}

func TestComputeInvitationExpiryStillAppliesAfterTLSHandshake(t *testing.T) {
	identity := testComputeIdentity(t)
	identity.Expires = time.Now().Add(150 * time.Millisecond)
	server, client := secureTestPipe(t)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	results := make(chan secureTestResult, 1)
	go func() { conn, err := AcceptSecure(ctx, server, identity); results <- secureTestResult{conn, err} }()
	pin, _, _ := parseComputeInvitation(identity.Invitation)
	if err := tls.Client(client, computeClientTLSConfig(pin)).HandshakeContext(ctx); err != nil {
		t.Fatal(err)
	}
	// The peer completes TLS but withholds its bearer until the identity expires.
	result := awaitSecureTestResult(t, results)
	if result.err == nil || result.conn != nil {
		t.Fatal("TLS handshake bypassed invitation expiry")
	}
	deadlines, closed := server.snapshot()
	if !closed || len(deadlines) != 1 || deadlines[0].After(identity.Expires) {
		t.Fatal("bearer exchange was not bounded by invitation expiry")
	}
}

func TestComputeSecureRejectsExpiredPinnedCertificate(t *testing.T) {
	identity := testComputeIdentity(t)
	key := identity.Certificate.PrivateKey.(*ecdsa.PrivateKey)
	certificate := *identity.Certificate.Leaf
	certificate.NotBefore, certificate.NotAfter = time.Now().Add(-time.Hour), time.Now().Add(-time.Minute)
	der, err := x509.CreateCertificate(rand.Reader, &certificate, &certificate, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	identity.Certificate.Certificate = [][]byte{der}
	identity.Certificate.Leaf, _ = x509.ParseCertificate(der)
	var data [64]byte
	pin := sha256.Sum256(der)
	copy(data[:32], pin[:])
	copy(data[32:], identity.Secret)
	identity.Invitation = computeInvitationPrefix + base64.RawURLEncoding.EncodeToString(data[:])
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	server, client, _, _ := testSecurePair(t, identity, identity.Invitation, ctx)
	if server.err == nil || client.err == nil || server.conn != nil || client.conn != nil {
		t.Fatal("expired certificate was accepted merely because its pin matched")
	}
}

func TestComputeSecureDeadlineAndCancellationCloseRawStreams(t *testing.T) {
	identity := testComputeIdentity(t)
	for _, mode := range []string{"accept", "dial"} {
		t.Run(mode+"-deadline", func(t *testing.T) {
			server, client := secureTestPipe(t)
			ctx, cancel := context.WithTimeout(context.Background(), 80*time.Millisecond)
			defer cancel()
			limit, _ := ctx.Deadline()
			var raw *secureTestConn
			var err error
			if mode == "accept" {
				raw = server
				_, err = AcceptSecure(ctx, raw, identity)
			} else {
				raw = client
				_, err = DialSecure(ctx, raw, identity.Invitation)
			}
			if !errors.Is(err, context.DeadlineExceeded) && !errors.Is(err, os.ErrDeadlineExceeded) {
				t.Fatalf("stalled authentication did not time out: %v", err)
			}
			deadlines, closed := raw.snapshot()
			if !closed || len(deadlines) == 0 || deadlines[0].After(limit) {
				t.Fatal("authentication ignored the context deadline or leaked its raw stream")
			}
		})
		t.Run(mode+"-canceled", func(t *testing.T) {
			server, client := secureTestPipe(t)
			ctx, cancel := context.WithCancel(context.Background())
			cancel()
			raw := client
			var err error
			if mode == "accept" {
				raw = server
				_, err = AcceptSecure(ctx, raw, identity)
			} else {
				_, err = DialSecure(ctx, raw, identity.Invitation)
			}
			_, closed := raw.snapshot()
			if !closed || !errors.Is(err, context.Canceled) {
				t.Fatal("canceled authentication did not close its raw stream")
			}
		})
	}
}

func TestComputeClientRequiresBearerAcknowledgementWithinDeadline(t *testing.T) {
	identity := testComputeIdentity(t)
	for _, mode := range []string{"reject", "withhold"} {
		t.Run(mode, func(t *testing.T) {
			server, client := secureTestPipe(t)
			ctx, cancel := context.WithTimeout(context.Background(), 150*time.Millisecond)
			defer cancel()
			results := make(chan secureTestResult, 1)
			go func() {
				secured := tls.Server(server, &tls.Config{Certificates: []tls.Certificate{identity.Certificate}, MinVersion: tls.VersionTLS13, MaxVersion: tls.VersionTLS13, NextProtos: []string{computeALPN}, SessionTicketsDisabled: true})
				err := secured.HandshakeContext(ctx)
				if err == nil {
					var bearer [32]byte
					_, err = io.ReadFull(secured, bearer[:])
					if err == nil {
						if mode == "reject" {
							err = writeComputeBytes(secured, []byte{0})
						} else {
							_, err = secured.Read(make([]byte, 1))
						}
					}
				}
				_ = server.Close()
				results <- secureTestResult{err: err}
			}()
			if conn, err := DialSecure(ctx, client, identity.Invitation); conn != nil || err == nil {
				t.Fatal("client accepted an absent or negative authentication acknowledgement")
			}
			_, closed := client.snapshot()
			if !closed {
				t.Fatal("failed acknowledgement left the raw stream open")
			}
			_ = awaitSecureTestResult(t, results)
		})
	}
}
