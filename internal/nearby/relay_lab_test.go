package nearby

// Phase-one feasibility lab only. This file is excluded from application builds.
// net.Pipe links are not Bluetooth radios and hops do not represent metres.
import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net"
	"strings"
	"sync"
	"testing"
	"time"
)

type labAddress struct{}

func (labAddress) Network() string { return "memory-relay-lab" }
func (labAddress) String() string  { return "no-physical-radio" }

type labListener struct {
	connections chan net.Conn
	closed      chan struct{}
	once        sync.Once
}

func (l *labListener) Accept() (net.Conn, error) {
	select {
	case conn := <-l.connections:
		return conn, nil
	case <-l.closed:
		return nil, net.ErrClosed
	}
}
func (l *labListener) Close() error   { l.once.Do(func() { close(l.closed) }); return nil }
func (l *labListener) Addr() net.Addr { return labAddress{} }

// Captures exist only in the lab and are bounded. Live relays must not log bytes.
type labCapture struct {
	mu       sync.Mutex
	data     [2]bytes.Buffer
	overflow bool
}

func (c *labCapture) record(direction int, data []byte) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.data[direction].Len()+len(data) > 4*1024*1024 {
		c.overflow = true
		return
	}
	_, _ = c.data[direction].Write(data)
}
func (c *labCapture) snapshot(t *testing.T, direction int) []byte {
	t.Helper()
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.overflow {
		t.Fatal("lab capture overflow would invalidate the observation")
	}
	return bytes.Clone(c.data[direction].Bytes())
}

type labRoute struct {
	host, client *Hub
	document     Document
	captures     []*labCapture
	connections  []net.Conn
	mu           sync.Mutex
	workers      sync.WaitGroup
	closed       bool
	// Called on opaque bytes at the first relay. No endpoint keys are supplied.
	transform func(direction int, data []byte) []byte
	maxChunk  int
	byteLimit int
	disabled  bool
}

func newLabRoute(t *testing.T, hops int) *labRoute {
	t.Helper()
	if hops < 1 || hops > 32 {
		t.Fatal("lab route must have 1..32 relays")
	}
	route := &labRoute{host: NewHub(), client: NewHub(), document: Document{ID: "97a562f0-0751-4ee1-8634-78b80914077d", Name: "PRIVATE-DOCUMENT-TITLE-DO-NOT-FORWARD"}}
	listener := &labListener{connections: make(chan net.Conn), closed: make(chan struct{})}
	route.host.listen = func() (net.Listener, error) { return listener, nil }
	for i := 0; i < hops; i++ {
		route.captures = append(route.captures, &labCapture{})
	}
	route.client.dial = func(ctx context.Context, _ string) (net.Conn, error) {
		links := make([][2]net.Conn, hops+1)
		route.mu.Lock()
		if route.closed || ctx.Err() != nil {
			route.mu.Unlock()
			return nil, net.ErrClosed
		}
		for i := range links {
			links[i][0], links[i][1] = net.Pipe()
			route.connections = append(route.connections, links[i][0], links[i][1])
		}
		for i := 0; i < hops; i++ {
			left, right := links[i][1], links[i+1][0]
			if route.disabled {
				_ = left.Close()
				_ = right.Close()
				continue
			}
			for direction := 0; direction < 2; direction++ {
				source, destination := left, right
				if direction == 1 {
					source, destination = right, left
				}
				route.workers.Add(1)
				go func(index, direction int, source, destination net.Conn) {
					defer route.workers.Done()
					defer source.Close()
					defer destination.Close()
					buffer := make([]byte, 4096)
					forwarded := 0
					for {
						n, err := source.Read(buffer)
						if n > 0 {
							data := bytes.Clone(buffer[:n])
							route.captures[index].record(direction, data)
							if index == 0 && route.transform != nil {
								data = route.transform(direction, data)
							}
							if route.byteLimit > 0 && forwarded+len(data) > route.byteLimit {
								return
							}
							for len(data) > 0 {
								size := len(data)
								if route.maxChunk > 0 && size > route.maxChunk {
									size = route.maxChunk
								}
								written, writeErr := destination.Write(data[:size])
								forwarded += written
								if writeErr != nil || written == 0 {
									return
								}
								data = data[written:]
							}
						}
						if err != nil {
							return
						}
					}
				}(i, direction, source, destination)
			}
		}
		route.mu.Unlock()
		select {
		case listener.connections <- links[hops][1]:
			return links[0][0], nil
		case <-ctx.Done():
			route.closeLinks()
			return nil, ctx.Err()
		case <-listener.closed:
			route.closeLinks()
			return nil, net.ErrClosed
		}
	}
	t.Cleanup(func() {
		route.client.Stop()
		route.host.Stop()
		route.closeLinks()
		done := make(chan struct{})
		go func() { route.workers.Wait(); close(done) }()
		select {
		case <-done:
		case <-time.After(2 * time.Second):
			t.Error("relay goroutines did not stop")
		}
	})
	if err := route.host.Host(route.document); err != nil {
		t.Fatal(err)
	}
	return route
}
func (r *labRoute) closeLinks() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.closed = true
	for _, conn := range r.connections {
		_ = conn.Close()
	}
}
func (r *labRoute) connect(t *testing.T, invitation string) {
	t.Helper()
	if err := r.client.Connect("memory-relay-route", invitation); err != nil {
		t.Fatal(err)
	}
}
func labMessage(id, payload string) json.RawMessage {
	data, _ := json.Marshal(map[string]string{"fileId": id, "kind": "update", "data": base64.StdEncoding.EncodeToString([]byte(payload))})
	return data
}
func waitLabMessage(t *testing.T, hub *Hub, wanted json.RawMessage) {
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
	t.Fatal("destination did not receive the exact authenticated message")
}

func TestRelayLabEndToEndAcrossMultipleHops(t *testing.T) {
	for _, hops := range []int{1, 2, 4, 8, 16, 32} {
		t.Run(fmt.Sprintf("relays-%d", hops), func(t *testing.T) {
			route := newLabRoute(t, hops)
			invitation := route.host.Status().Invitation
			route.connect(t, invitation)
			waitStatus(t, route.client, "connected")
			waitStatus(t, route.host, "connected")
			payload := "PRIVATE-BODY-0123456789-abcdefghijklmnopqrstuvwxyz"
			message := labMessage(route.document.ID, payload)
			if err := route.client.Send(message); err != nil {
				t.Fatal(err)
			}
			waitLabMessage(t, route.host, message)
			reply := labMessage(route.document.ID, "PRIVATE-REPLY-zyxwvutsrqponmlkjihgfedcba")
			if err := route.host.Send(reply); err != nil {
				t.Fatal(err)
			}
			waitLabMessage(t, route.client, reply)
			_, secret, err := clientIdentity(invitation)
			if err != nil {
				t.Fatal(err)
			}
			for index, capture := range route.captures {
				for direction := 0; direction < 2; direction++ {
					wire := capture.snapshot(t, direction)
					if len(wire) == 0 {
						t.Fatalf("relay %d carried no traffic", index)
					}
					for _, forbidden := range []string{route.document.Name, route.document.ID, invitation, secret, payload, base64.StdEncoding.EncodeToString([]byte(payload)), string(message), string(reply)} {
						if bytes.Contains(wire, []byte(forbidden)) {
							t.Fatalf("sensitive marker visible at relay %d", index)
						}
					}
				}
			}
		})
	}
}

func TestRelayLabFragmentationPreservesAuthenticatedStream(t *testing.T) {
	for _, chunk := range []int{1, 7, 127, 1024} {
		t.Run(fmt.Sprintf("bytes-%d", chunk), func(t *testing.T) {
			route := newLabRoute(t, 3)
			route.maxChunk = chunk
			route.connect(t, route.host.Status().Invitation)
			waitStatus(t, route.client, "connected")
			message := labMessage(route.document.ID, strings.Repeat("Unicode-नमस्ते-", 256))
			if err := route.client.Send(message); err != nil {
				t.Fatal(err)
			}
			waitLabMessage(t, route.host, message)
		})
	}
}

func TestRelayLabEndpointAuthenticationRejectsWrongCredentials(t *testing.T) {
	for _, position := range []int{0, 40} {
		t.Run(fmt.Sprintf("changed-invitation-byte-%d", position), func(t *testing.T) {
			route := newLabRoute(t, 3)
			data, _ := base64.RawURLEncoding.DecodeString(strings.TrimPrefix(route.host.Status().Invitation, "DBT1-"))
			data[position] ^= 0xff
			route.connect(t, "DBT1-"+base64.RawURLEncoding.EncodeToString(data))
			waitStatus(t, route.client, "error")
			if route.client.Status().Document != nil || route.host.Status().State == "connected" || route.host.Status().ReceivedBytes != 0 {
				t.Fatal("unauthorized endpoint received access")
			}
		})
	}
}

func TestRelayLabOpaqueStreamAttacksFailClosed(t *testing.T) {
	for _, attack := range []string{"tamper", "duplicate", "truncate", "replay-previous-session"} {
		t.Run(attack, func(t *testing.T) {
			route := newLabRoute(t, 2)
			var attackMu sync.Mutex
			armed := false
			changed := false
			var previous []byte
			applied := make(chan struct{})
			if attack == "replay-previous-session" {
				old := newLabRoute(t, 1)
				old.connect(t, old.host.Status().Invitation)
				waitStatus(t, old.client, "connected")
				start := len(old.captures[0].snapshot(t, 0))
				message := labMessage(old.document.ID, "PRIOR-SESSION-CIPHERTEXT")
				if err := old.client.Send(message); err != nil {
					t.Fatal(err)
				}
				waitLabMessage(t, old.host, message)
				previous = old.captures[0].snapshot(t, 0)[start:]
				if len(previous) == 0 {
					t.Fatal("prior session produced no replayable ciphertext")
				}
			}
			route.transform = func(direction int, data []byte) []byte {
				attackMu.Lock()
				defer attackMu.Unlock()
				if !armed || changed || direction != 0 {
					return data
				}
				changed = true
				close(applied)
				switch attack {
				case "tamper":
					data[len(data)-1] ^= 1
					return data
				case "duplicate":
					return append(bytes.Clone(data), data...)
				case "truncate":
					return data[:len(data)-1]
				default:
					return previous
				}
			}
			route.connect(t, route.host.Status().Invitation)
			waitStatus(t, route.client, "connected")
			waitStatus(t, route.host, "connected")
			attackMu.Lock()
			armed = true
			attackMu.Unlock()
			message := labMessage(route.document.ID, "PAYLOAD-UNDER-ATTACK")
			_ = route.client.Send(message)
			select {
			case <-applied:
			case <-time.After(time.Second):
				t.Fatal("attack was not exercised")
			}
			if attack == "duplicate" {
				// The authentic first record can be accepted once; its repeated
				// ciphertext must not deliver a second application message.
				waitLabMessage(t, route.host, message)
			} else if attack == "truncate" {
				// A truncated record can wait for more bytes until the path closes.
				route.closeLinks()
			}
			waitStatus(t, route.host, "listening")
			ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
			defer cancel()
			batch := route.host.Events(ctx, 0)
			count := 0
			for _, event := range batch.Events {
				if len(event.Message) > 0 {
					count++
				}
			}
			wanted := 0
			if attack == "duplicate" {
				wanted = 1
			}
			if count != wanted {
				t.Fatalf("attack delivered %d application messages; expected %d", count, wanted)
			}
			attackMu.Lock()
			wasChanged := changed
			attackMu.Unlock()
			if !wasChanged {
				t.Fatal("attack was not exercised")
			}
		})
	}
}

func TestRelayLabPathLossAndConsentDoNotAcknowledgeDelivery(t *testing.T) {
	for _, scenario := range []string{"relay-disabled", "byte-budget", "path-loss", "cancel-handshake"} {
		t.Run(scenario, func(t *testing.T) {
			route := newLabRoute(t, 3)
			handshakeSeen := make(chan struct{}, 1)
			switch scenario {
			case "relay-disabled":
				route.disabled = true
			case "byte-budget":
				route.byteLimit = 1
			case "cancel-handshake":
				route.transform = func(direction int, data []byte) []byte {
					if direction == 0 {
						select {
						case handshakeSeen <- struct{}{}:
						default:
						}
						return nil
					}
					return data
				}
			}
			route.connect(t, route.host.Status().Invitation)
			if scenario == "path-loss" {
				waitStatus(t, route.client, "connected")
				waitStatus(t, route.host, "connected")
				route.closeLinks()
				waitStatus(t, route.client, "error")
			} else if scenario == "cancel-handshake" {
				select {
				case <-handshakeSeen:
				case <-time.After(time.Second):
					t.Fatal("withheld handshake was not exercised")
				}
				route.client.Stop()
				if route.client.Status().State != "idle" {
					t.Fatal("cancelled route published connection")
				}
			} else {
				waitStatus(t, route.client, "error")
			}
			if route.host.Status().ReceivedBytes != 0 {
				t.Fatal("path failure was reported as payload delivery")
			}
		})
	}
}

func TestRelayLabWrongDocumentCannotCrossCircuit(t *testing.T) {
	route := newLabRoute(t, 2)
	route.connect(t, route.host.Status().Invitation)
	waitStatus(t, route.client, "connected")
	if err := route.client.Send(labMessage("22a562f0-0751-4ee1-8634-78b80914077d", "other document")); err == nil {
		t.Fatal("another document was accepted")
	}
	if route.host.Status().ReceivedBytes != 0 {
		t.Fatal("another document reached the receiver")
	}
}

func TestRelayLabFreshSessionDoesNotTrustOldInvitation(t *testing.T) {
	route := newLabRoute(t, 2)
	oldInvitation := route.host.Status().Invitation
	route.host.Stop()
	// Separate route = independently generated host certificate and secret.
	replacement := newLabRoute(t, 2)
	replacement.connect(t, oldInvitation)
	waitStatus(t, replacement.client, "error")
	if replacement.client.Status().Document != nil {
		t.Fatal("old invitation exposed a new session")
	}
}

func TestRelayLabTLSLayerCannotBeTerminatedByRelay(t *testing.T) {
	_, _, invitation, err := makeIdentity()
	if err != nil {
		t.Fatal(err)
	}
	attackerCert, _, _, err := makeIdentity()
	if err != nil {
		t.Fatal(err)
	}
	config, _, err := clientIdentity(invitation)
	if err != nil {
		t.Fatal(err)
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0") // Buffered protocol simulation, not a radio.
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	done := make(chan error, 1)
	go func() {
		right, err := listener.Accept()
		if err != nil {
			done <- err
			return
		}
		defer right.Close()
		attacker := tls.Server(right, &tls.Config{MinVersion: tls.VersionTLS13, Certificates: []tls.Certificate{attackerCert}})
		done <- attacker.HandshakeContext(ctx)
	}()
	left, err := net.Dial("tcp", listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer left.Close()
	client := tls.Client(left, config)
	if err := client.HandshakeContext(ctx); err == nil || !strings.Contains(err.Error(), "identity does not match") {
		t.Fatalf("endpoint pin was not the cause of rejection: %v", err)
	}
	_ = left.Close()
	select {
	case <-done:
	case <-ctx.Done():
		t.Fatal("attacker handshake did not stop")
	}
}
