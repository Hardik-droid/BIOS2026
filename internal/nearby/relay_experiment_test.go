//go:build relay_experiment

package nearby

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"io"
	"net"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestExperimentalRelayCodeIsSeparateFromDocumentInvitation(t *testing.T) {
	token := bytes.Repeat([]byte{0x42}, 32)
	code := "DRL1-" + base64.RawURLEncoding.EncodeToString(token)
	parsed, err := parseRelayCode(code)
	if err != nil || !bytes.Equal(parsed, token) {
		t.Fatal("valid relay code rejected")
	}
	for _, invalid := range []string{"", "DBT1-" + strings.Repeat("A", 86), code + "=", "DRL1-" + strings.Repeat("!", 43), "DRL1-" + strings.Repeat("B", 43)} {
		if _, err := NewRelayedHub(invalid); err == nil {
			t.Fatal("invalid or noncanonical relay code accepted")
		}
	}
}

func TestExperimentalRelayRejectsShortPairingForBothRoles(t *testing.T) {
	hub, err := NewRelayedHub("DRL1-" + base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{0x42}, 32)))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(hub.Stop)
	hub.dial = func(context.Context, string) (net.Conn, error) {
		t.Error("short-code relay attempt reached transport")
		return nil, net.ErrClosed
	}
	if err := hub.Connect(protocolHostAddress, "1234"); err == nil {
		t.Fatal("relayed hub accepted a four-digit code")
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	paired := &pairedProtocolListener{Listener: listener}
	hub.listen = func() (net.Listener, error) { return paired, nil }
	if err := hub.Host(Document{ID: "97a562f0-0751-4ee1-8634-78b80914077d", Name: "Relay endpoint"}); err != nil {
		t.Fatal(err)
	}
	if hub.Status().PairingCode != "" {
		t.Fatal("relayed hub generated short-code authority")
	}
	raw, err := net.Dial("tcp", listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer raw.Close()
	_ = raw.SetDeadline(time.Now().Add(time.Second))
	if _, err := io.WriteString(raw, pairingMagic); err != nil {
		t.Fatal(err)
	}
	var probe [1]byte
	if n, err := raw.Read(probe[:]); n != 0 || err == nil {
		t.Fatal("relay server disclosed short-pairing data")
	}
	if hub.Status().PairingRequest != nil {
		t.Fatal("relay server generated a short-pairing approval request")
	}
}

// Synthetic TCP relay for testing the DRL1 admission followed by the existing
// end-to-end document TLS session. This is not a Bluetooth hardware test.
type experimentalSyntheticRelay struct {
	listener    net.Listener
	mu          sync.Mutex
	connections []net.Conn
	wire        [2]bytes.Buffer
	workers     sync.WaitGroup
	dialed      atomic.Bool
	admitted    chan bool
}

func newExperimentalSyntheticRelay(t *testing.T, backend string, token []byte) *experimentalSyntheticRelay {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	relay := &experimentalSyntheticRelay{listener: listener, admitted: make(chan bool, 1)}
	relay.workers.Add(1)
	go func() {
		defer relay.workers.Done()
		incoming, err := listener.Accept()
		if err != nil {
			return
		}
		relay.mu.Lock()
		relay.connections = append(relay.connections, incoming)
		relay.mu.Unlock()
		defer incoming.Close()
		_ = incoming.SetDeadline(time.Now().Add(2 * time.Second))
		var header [36]byte
		if _, err := io.ReadFull(incoming, header[:]); err != nil {
			relay.admitted <- false
			return
		}
		if !bytes.Equal(header[:4], []byte("DRL1")) || subtle.ConstantTimeCompare(header[4:], token) != 1 {
			relay.admitted <- false
			return
		}
		clear(header[:])
		outgoing, err := net.DialTimeout("tcp", backend, time.Second)
		if err != nil {
			relay.admitted <- false
			return
		}
		relay.mu.Lock()
		relay.connections = append(relay.connections, outgoing)
		relay.mu.Unlock()
		defer outgoing.Close()
		relay.dialed.Store(true)
		if _, err := incoming.Write([]byte{1}); err != nil {
			relay.admitted <- false
			return
		}
		relay.admitted <- true
		_ = incoming.SetDeadline(time.Time{})
		// Each copy has a bounded buffer. Captures contain synthetic TLS bytes
		// only, after the separate relay admission header has been consumed.
		relay.workers.Add(1)
		go func() {
			defer relay.workers.Done()
			relay.copy(outgoing, incoming, 1)
			incoming.Close()
			outgoing.Close()
		}()
		relay.copy(incoming, outgoing, 0)
	}()
	t.Cleanup(func() {
		_ = relay.listener.Close()
		relay.mu.Lock()
		for _, conn := range relay.connections {
			_ = conn.Close()
		}
		relay.mu.Unlock()
		done := make(chan struct{})
		go func() { relay.workers.Wait(); close(done) }()
		select {
		case <-done:
		case <-time.After(2 * time.Second):
			t.Error("synthetic relay workers did not stop")
		}
	})
	return relay
}

func (relay *experimentalSyntheticRelay) copy(source, destination net.Conn, direction int) {
	buffer := make([]byte, 4096)
	for {
		n, readErr := source.Read(buffer)
		if n > 0 {
			relay.mu.Lock()
			_, _ = relay.wire[direction].Write(buffer[:n])
			relay.mu.Unlock()
			data := buffer[:n]
			for len(data) > 0 {
				written, err := destination.Write(data)
				if err != nil || written == 0 {
					return
				}
				data = data[written:]
			}
		}
		if readErr != nil {
			return
		}
	}
}

func (relay *experimentalSyntheticRelay) client(t *testing.T, token []byte) *Hub {
	t.Helper()
	hub, err := newRelayedHub("DRL1-"+base64.RawURLEncoding.EncodeToString(token), func(ctx context.Context, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "tcp", relay.listener.Addr().String())
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(hub.Stop)
	return hub
}

func waitExperimentalMessage(t *testing.T, hub *Hub, wanted json.RawMessage) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	var cursor uint64
	for ctx.Err() == nil {
		batch := hub.Events(ctx, cursor)
		cursor = batch.Cursor
		for _, event := range batch.Events {
			if bytes.Equal(event.Message, wanted) {
				return
			}
		}
	}
	t.Fatal("synthetic relayed destination did not receive the exact message")
}

func TestExperimentalRelaySyntheticDocumentTLSExchange(t *testing.T) {
	host, _, doc := testHubs(t)
	token := bytes.Repeat([]byte{0x42}, 32)
	relay := newExperimentalSyntheticRelay(t, host.listener.Addr().String(), token)
	client := relay.client(t, token)
	invitation := host.Status().Invitation
	if err := client.Connect("synthetic-relay-only", invitation); err != nil {
		t.Fatal(err)
	}
	waitStatus(t, host, "connected")
	waitStatus(t, client, "connected")
	if client.Status().Document == nil || *client.Status().Document != doc {
		t.Fatal("endpoint document identity changed across relay")
	}
	message := json.RawMessage(`{"fileId":"` + doc.ID + `","kind":"update","data":"c3ludGhldGljLXByaXZhdGUtY29udGVudA=="}`)
	if err := client.Send(message); err != nil {
		t.Fatal(err)
	}
	waitExperimentalMessage(t, host, message)
	reply := json.RawMessage(`{"fileId":"` + doc.ID + `","kind":"vector","data":"AA=="}`)
	if err := host.Send(reply); err != nil {
		t.Fatal(err)
	}
	waitExperimentalMessage(t, client, reply)
	_, secret, err := clientIdentity(invitation)
	if err != nil {
		t.Fatal(err)
	}
	if !relay.dialed.Load() {
		t.Fatal("synthetic relay never connected its outgoing stream")
	}
	relay.mu.Lock()
	defer relay.mu.Unlock()
	for direction := range relay.wire {
		wire := relay.wire[direction].Bytes()
		if len(wire) == 0 {
			t.Fatal("synthetic relay carried no TLS traffic in one direction")
		}
		for _, marker := range []string{doc.ID, doc.Name, invitation, secret, string(message), string(reply), "c3ludGhldGljLXByaXZhdGUtY29udGVudA=="} {
			if bytes.Contains(wire, []byte(marker)) {
				t.Fatal("synthetic relay observed a sensitive plaintext marker")
			}
		}
	}
}

func TestExperimentalRelaySyntheticWrongTokenNeverReachesEndpoint(t *testing.T) {
	host, _, _ := testHubs(t)
	relay := newExperimentalSyntheticRelay(t, host.listener.Addr().String(), bytes.Repeat([]byte{0x42}, 32))
	client := relay.client(t, bytes.Repeat([]byte{0x43}, 32))
	if err := client.Connect("synthetic-relay-only", host.Status().Invitation); err != nil {
		t.Fatal(err)
	}
	status := waitStatus(t, client, "error")
	select {
	case admitted := <-relay.admitted:
		if admitted {
			t.Fatal("wrong relay token admitted")
		}
	case <-time.After(time.Second):
		t.Fatal("relay admission not exercised")
	}
	if !strings.Contains(status.Error, "relay did not establish") {
		t.Fatalf("wrong rejection cause: %s", status.Error)
	}
	if relay.dialed.Load() || host.Status().State == "connected" || client.Status().Document != nil || host.Status().ReceivedBytes != 0 {
		t.Fatal("rejected relay token reached document endpoint")
	}
}

func TestExperimentalRelaySyntheticDocumentIdentityStillPinned(t *testing.T) {
	for _, scenario := range []struct {
		name        string
		byteIndex   int
		errorMarker string
	}{
		{"wrong-pin", 0, "identity does not match"},
		{"wrong-document-secret", 40, ""},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			host, _, _ := testHubs(t)
			token := bytes.Repeat([]byte{0x42}, 32)
			relay := newExperimentalSyntheticRelay(t, host.listener.Addr().String(), token)
			client := relay.client(t, token)
			invitation, _ := base64.RawURLEncoding.DecodeString(strings.TrimPrefix(host.Status().Invitation, "DBT1-"))
			invitation[scenario.byteIndex] ^= 0xff
			if err := client.Connect("synthetic-relay-only", "DBT1-"+base64.RawURLEncoding.EncodeToString(invitation)); err != nil {
				t.Fatal(err)
			}
			status := waitStatus(t, client, "error")
			select {
			case admitted := <-relay.admitted:
				if !admitted {
					t.Fatal("test failed before document authentication")
				}
			case <-time.After(time.Second):
				t.Fatal("relay admission not exercised")
			}
			if !relay.dialed.Load() {
				t.Fatal("document handshake never reached intended endpoint")
			}
			if scenario.errorMarker != "" && !strings.Contains(status.Error, scenario.errorMarker) {
				t.Fatalf("certificate pin was not rejection cause: %s", status.Error)
			}
			if client.Status().Document != nil || host.Status().State == "connected" || host.Status().ReceivedBytes != 0 {
				t.Fatal("relaying bypassed document endpoint authentication")
			}
		})
	}
}

func TestExperimentalRelayAdmissionSendsOnlyItsOwnToken(t *testing.T) {
	left, right := net.Pipe()
	defer left.Close()
	defer right.Close()
	token := bytes.Repeat([]byte{0x42}, 32)
	done := make(chan error, 1)
	go func() {
		var header [36]byte
		_, err := io.ReadFull(right, header[:])
		if err == nil && (!bytes.Equal(header[:4], []byte("DRL1")) || !bytes.Equal(header[4:], token)) {
			err = io.ErrUnexpectedEOF
		}
		if err == nil {
			_, err = right.Write([]byte{1})
		}
		done <- err
	}()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := admitRelay(ctx, left, token); err != nil {
		t.Fatal(err)
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}

func TestExperimentalRelayAdmissionFailsClosed(t *testing.T) {
	for _, scenario := range []string{"wrong-ready", "closed", "cancelled"} {
		t.Run(scenario, func(t *testing.T) {
			left, right := net.Pipe()
			defer left.Close()
			defer right.Close()
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			done := make(chan struct{})
			go func() {
				defer close(done)
				var header [36]byte
				if _, err := io.ReadFull(right, header[:]); err != nil {
					return
				}
				switch scenario {
				case "wrong-ready":
					_, _ = right.Write([]byte{0})
				case "closed":
					_ = right.Close()
				case "cancelled":
					cancel()
				}
			}()
			if err := admitRelay(ctx, left, bytes.Repeat([]byte{1}, 32)); err == nil {
				t.Fatal("failed relay admission reported success")
			}
			_ = left.Close()
			_ = right.Close()
			select {
			case <-done:
			case <-time.After(time.Second):
				t.Fatal("admission goroutine remained blocked")
			}
		})
	}
}
