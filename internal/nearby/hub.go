package nearby

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net"
	"regexp"
	"strings"
	"sync"
	"time"
)

var uuidPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

type Status struct {
	State            string          `json:"state"`
	Role             string          `json:"role,omitempty"`
	Document         *Document       `json:"document,omitempty"`
	Session          string          `json:"session,omitempty"`
	Invitation       string          `json:"invitation,omitempty"`
	PairingCode      string          `json:"pairingCode,omitempty"`
	PairingExpiresAt string          `json:"pairingExpiresAt,omitempty"`
	PairingRequest   *PairingRequest `json:"pairingRequest,omitempty"`
	PairingError     string          `json:"pairingError,omitempty"`
	Error            string          `json:"error,omitempty"`
	SentBytes        uint64          `json:"sentBytes"`
	ReceivedBytes    uint64          `json:"receivedBytes"`
}
type Event struct {
	Seq     uint64          `json:"seq"`
	Session string          `json:"session"`
	Message json.RawMessage `json:"message,omitempty"`
}
type EventBatch struct {
	Status Status  `json:"status"`
	Events []Event `json:"events"`
	Cursor uint64  `json:"cursor"`
	Reset  bool    `json:"reset"`
}
type Hub struct {
	command                sync.Mutex
	mu                     sync.Mutex
	write                  sync.Mutex
	status                 Status
	generation             uint64
	cancel                 context.CancelFunc
	listener               net.Listener
	conn                   *tls.Conn
	pending                net.Conn
	allowShortPairing      bool
	pairingExpires         time.Time
	pairingAttempts        int
	pairingDecision        chan bool
	pairingRequestExpires  time.Time
	pairingApprovalTimeout time.Duration
	queue                  []Event
	queueBytes             int
	sequence               uint64
	notify                 chan struct{}
	Token                  string
	listen                 func() (net.Listener, error)
	dial                   func(context.Context, string) (net.Conn, error)
}

func randomToken() string {
	data := make([]byte, 32)
	if _, err := rand.Read(data); err != nil {
		panic("OS random source unavailable")
	}
	return base64.RawURLEncoding.EncodeToString(data)
}
func NewHub() *Hub {
	return &Hub{status: Status{State: "idle"}, notify: make(chan struct{}), Token: randomToken(), listen: func() (net.Listener, error) { return Listen() }, dial: Dial, allowShortPairing: true, pairingApprovalTimeout: 30 * time.Second}
}
func validDocument(doc Document) bool {
	return uuidPattern.MatchString(doc.ID) && strings.TrimSpace(doc.Name) != "" && len(doc.Name) <= 2048
}
func (h *Hub) signalLocked(message json.RawMessage) {
	h.sequence++
	h.queue = append(h.queue, Event{Seq: h.sequence, Session: h.status.Session, Message: append(json.RawMessage(nil), message...)})
	h.queueBytes += len(message)
	for len(h.queue) > 128 || h.queueBytes > 8*1024*1024 {
		h.queueBytes -= len(h.queue[0].Message)
		h.queue = h.queue[1:]
	}
	close(h.notify)
	h.notify = make(chan struct{})
}
func (h *Hub) Status() Status { h.mu.Lock(); defer h.mu.Unlock(); return h.status }
func (h *Hub) Events(ctx context.Context, after uint64) EventBatch {
	for {
		h.mu.Lock()
		if h.sequence > after || ctx.Err() != nil {
			batch := EventBatch{Status: h.status, Events: []Event{}, Cursor: h.sequence}
			if len(h.queue) > 0 && after != 0 && after < h.queue[0].Seq-1 {
				batch.Reset = true
			}
			for _, event := range h.queue {
				if event.Seq > after {
					batch.Events = append(batch.Events, event)
				}
			}
			h.mu.Unlock()
			return batch
		}
		notify := h.notify
		h.mu.Unlock()
		select {
		case <-notify:
		case <-ctx.Done():
		}
	}
}
func (h *Hub) reset() uint64 {
	h.mu.Lock()
	h.generation++
	generation := h.generation
	stop, listener, conn, pending := h.cancel, h.listener, h.conn, h.pending
	h.cancel, h.listener, h.conn, h.pending = nil, nil, nil, nil
	h.pairingExpires, h.pairingAttempts, h.pairingDecision = time.Time{}, 0, nil
	h.pairingRequestExpires = time.Time{}
	h.status = Status{State: "idle"}
	h.signalLocked(nil)
	h.mu.Unlock()
	if stop != nil {
		stop()
	}
	if listener != nil {
		listener.Close()
	}
	if conn != nil {
		closeConnection(conn)
	}
	if pending != nil {
		closeConnection(pending)
	}
	return generation
}
func (h *Hub) Stop() { h.command.Lock(); defer h.command.Unlock(); h.reset() }
func closeConnection(conn net.Conn) {
	_ = conn.SetDeadline(time.Now())
	_ = conn.Close()
}

// Own handshakes as well as established connections so Stop can interrupt auth
// and welcome reads after the TLS handshake has finished.
func (h *Hub) prepareConnection(ctx context.Context, generation uint64, conn net.Conn) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.generation != generation || ctx.Err() != nil {
		return false
	}
	h.pending = conn
	return true
}
func (h *Hub) clearPending(conn net.Conn) {
	h.mu.Lock()
	if h.pending == conn {
		h.pending = nil
	}
	h.mu.Unlock()
}
func (h *Hub) setError(generation uint64, err error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.generation == generation {
		h.status.Error = err.Error()
		h.status.State = "error"
		h.signalLocked(nil)
	}
}
func (h *Hub) Host(doc Document) error {
	if !validDocument(doc) {
		return errors.New("Choose a saved document to share.")
	}
	h.command.Lock()
	defer h.command.Unlock()
	generation := h.reset()
	cert, secret, invitation, err := makeIdentity()
	if err != nil {
		h.setError(generation, err)
		return err
	}
	code := ""
	if h.allowShortPairing {
		code, err = makePairingCode()
		if err != nil {
			h.setError(generation, err)
			return err
		}
	}
	listener, err := h.listen()
	if err != nil {
		h.setError(generation, err)
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	h.mu.Lock()
	h.cancel = cancel
	h.listener = listener
	h.status = Status{State: "listening", Role: "host", Document: &doc, Session: randomToken(), Invitation: invitation}
	if code != "" {
		h.pairingExpires = time.Now().Add(pairingCodeLifetime)
		h.status.PairingCode = code
		h.status.PairingExpiresAt = h.pairingExpires.UTC().Format(time.RFC3339Nano)
	}
	session := h.status.Session
	h.signalLocked(nil)
	h.mu.Unlock()
	if code != "" {
		go func() {
			timer := time.NewTimer(pairingCodeLifetime)
			defer timer.Stop()
			select {
			case <-timer.C:
				h.expirePairing(generation)
			case <-ctx.Done():
			}
		}()
	}
	go func() {
		<-ctx.Done()
		listener.Close()
		h.mu.Lock()
		var conn, pending net.Conn
		if h.generation == generation {
			conn, pending = h.conn, h.pending
			h.status.State = "error"
			h.status.Error = "Bluetooth session expired. Start sharing again to create a fresh invitation."
			h.status.PairingCode, h.status.PairingExpiresAt, h.status.PairingRequest = "", "", nil
			h.signalLocked(nil)
		}
		h.mu.Unlock()
		if conn != nil {
			closeConnection(conn)
		}
		if pending != nil {
			closeConnection(pending)
		}
	}()
	go func() {
		for ctx.Err() == nil {
			raw, err := listener.Accept()
			if err != nil {
				if ctx.Err() == nil {
					h.setError(generation, err)
				}
				return
			}
			if !h.prepareConnection(ctx, generation, raw) {
				closeConnection(raw)
				return
			}
			_ = raw.SetDeadline(time.Now().Add(12 * time.Second))
			transport, err := h.acceptPairingOrTLS(ctx, generation, raw, invitation)
			if err != nil {
				closeConnection(raw)
				h.clearPending(raw)
				continue
			}
			conn := tls.Server(transport, &tls.Config{Certificates: []tls.Certificate{cert}, MinVersion: tls.VersionTLS13})
			if !h.prepareConnection(ctx, generation, conn) {
				closeConnection(conn)
				return
			}
			_ = conn.SetDeadline(time.Now().Add(12 * time.Second))
			err = conn.HandshakeContext(ctx)
			if err == nil {
				var auth packet
				auth, err = readPacket(conn)
				expected := base64.RawURLEncoding.EncodeToString(secret)
				if err == nil && (auth.Type != "auth" || subtle.ConstantTimeCompare([]byte(auth.Secret), []byte(expected)) != 1) {
					err = errors.New("Bluetooth invitation was rejected.")
				}
			}
			if err == nil {
				err = writePacket(conn, packet{Type: "welcome", Document: &doc, Session: session})
			}
			if err == nil {
				h.serve(ctx, generation, conn, doc, session)
			} else {
				closeConnection(conn)
			}
			h.clearPending(conn)
			select {
			case <-time.After(time.Second):
			case <-ctx.Done():
			}
		}
	}()
	return nil
}
func (h *Hub) Connect(address, invitation string) error {
	invitation = strings.TrimSpace(invitation)
	short := isPairingCode(invitation)
	if short && !h.allowShortPairing {
		return errors.New("Short pairing codes work only between directly paired Windows laptops. Use the complete invitation for a relay connection.")
	}
	var config *tls.Config
	var secret string
	var err error
	if !short {
		config, secret, err = clientIdentity(invitation)
		if err != nil {
			return err
		}
	}
	h.command.Lock()
	defer h.command.Unlock()
	generation := h.reset()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	h.mu.Lock()
	h.cancel = cancel
	h.status = Status{State: "connecting", Role: "join"}
	h.signalLocked(nil)
	h.mu.Unlock()
	go func() {
		defer cancel()
		defer func() {
			if ctx.Err() != nil {
				h.setError(generation, errors.New("Bluetooth session ended. Connect again with a current invitation."))
			}
		}()
		for ctx.Err() == nil {
			attemptLimit := 25 * time.Second
			if short {
				attemptLimit = 60 * time.Second
			}
			attempt, stop := context.WithTimeout(ctx, attemptLimit)
			raw, err := h.dial(attempt, address)
			if short {
				if err == nil {
					if !h.prepareConnection(ctx, generation, raw) {
						closeConnection(raw)
						stop()
						return
					}
					var resolved string
					resolved, err = h.resolvePairing(attempt, raw, address, invitation)
					if err == nil {
						config, secret, err = clientIdentity(resolved)
					}
				}
				if err != nil {
					if raw != nil {
						closeConnection(raw)
						h.clearPending(raw)
					}
					stop()
					h.setError(generation, err)
					return // A tiny code gets one deliberate attempt, never an automatic guessing loop.
				}
				short = false // Only the full pinned invitation stays in this reconnect goroutine's memory.
			}
			if err == nil {
				conn := tls.Client(raw, config)
				if !h.prepareConnection(ctx, generation, conn) {
					closeConnection(conn)
					stop()
					return
				}
				_ = conn.SetDeadline(time.Now().Add(12 * time.Second))
				err = conn.HandshakeContext(attempt)
				if err == nil {
					err = writePacket(conn, packet{Type: "auth", Secret: secret})
				}
				var welcome packet
				if err == nil {
					welcome, err = readPacket(conn)
				}
				if err == nil && (welcome.Type != "welcome" || welcome.Document == nil || !validDocument(*welcome.Document) || len(welcome.Session) != 43) {
					err = errors.New("Invalid Bluetooth document offer.")
				}
				if err == nil {
					stop()
					h.serve(ctx, generation, conn, *welcome.Document, welcome.Session)
				} else {
					closeConnection(conn)
				}
				h.clearPending(conn)
			}
			stop()
			if ctx.Err() != nil {
				return
			}
			if err != nil {
				h.setError(generation, err)
			}
			select {
			case <-time.After(4 * time.Second):
			case <-ctx.Done():
				return
			}
			h.mu.Lock()
			if h.generation == generation {
				h.status.State = "connecting"
				h.signalLocked(nil)
			}
			h.mu.Unlock()
		}
	}()
	return nil
}
func validMessage(raw json.RawMessage, fileID string) bool {
	if len(raw) == 0 || len(raw) > MaxFrame-1024 {
		return false
	}
	var message struct {
		FileID string `json:"fileId"`
		Kind   string `json:"kind"`
		Data   string `json:"data"`
		ID     string `json:"id"`
	}
	if json.Unmarshal(raw, &message) != nil || message.FileID != fileID || len(message.Data) > 1500000 {
		return false
	}
	return (message.Kind == "vector" || message.Kind == "update" || message.Kind == "ack") && (message.ID == "" || uuidPattern.MatchString(message.ID))
}
func (h *Hub) writeTo(conn *tls.Conn, message packet) error {
	h.write.Lock()
	defer h.write.Unlock()
	_ = conn.SetWriteDeadline(time.Now().Add(12 * time.Second))
	return writePacket(conn, message)
}
func (h *Hub) serve(ctx context.Context, generation uint64, conn *tls.Conn, doc Document, session string) {
	defer closeConnection(conn)
	h.mu.Lock()
	if h.generation != generation || ctx.Err() != nil {
		h.mu.Unlock()
		return
	}
	h.conn = conn
	if h.pending == conn {
		h.pending = nil
	}
	h.status.State = "connected"
	// One peer owns this session. The unused convenience code should not later
	// expire into an alarming error while a legacy invitation is connected.
	h.status.PairingCode, h.status.PairingExpiresAt, h.status.PairingError = "", "", ""
	h.status.PairingRequest, h.pairingDecision = nil, nil
	h.pairingRequestExpires = time.Time{}
	h.status.Document = &doc
	h.status.Session = session
	h.status.Error = ""
	h.signalLocked(nil)
	h.mu.Unlock()
	done := make(chan struct{})
	defer close(done)
	go func() {
		ticker := time.NewTicker(8 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-done:
				return
			case <-ctx.Done():
				conn.Close()
				return
			case <-ticker.C:
				if h.writeTo(conn, packet{Type: "ping"}) != nil {
					conn.Close()
					return
				}
			}
		}
	}()
	for ctx.Err() == nil {
		_ = conn.SetReadDeadline(time.Now().Add(30 * time.Second))
		message, err := readPacket(conn)
		if err != nil {
			break
		}
		if message.Type == "ping" {
			continue
		}
		if message.Type != "message" || !validMessage(message.Message, doc.ID) {
			break
		}
		h.mu.Lock()
		if h.generation == generation {
			h.status.ReceivedBytes += uint64(len(message.Message))
			h.signalLocked(message.Message)
		}
		h.mu.Unlock()
	}
	h.mu.Lock()
	if h.generation == generation && h.conn == conn {
		h.conn = nil
		if ctx.Err() == nil {
			h.status.State = "error"
			if h.status.Role == "host" {
				h.status.State = "listening"
			}
			h.status.Error = "Bluetooth link disconnected. Local edits remain local until reconnection and synchronization."
		}
		h.signalLocked(nil)
	}
	h.mu.Unlock()
}
func (h *Hub) Send(message json.RawMessage) error {
	h.mu.Lock()
	conn := h.conn
	doc := h.status.Document
	generation := h.generation
	h.mu.Unlock()
	if conn == nil || doc == nil {
		return errors.New("Bluetooth is not connected.")
	}
	if !validMessage(message, doc.ID) {
		return errors.New("Invalid document-sync message.")
	}
	if err := h.writeTo(conn, packet{Type: "message", Message: message}); err != nil {
		conn.Close()
		return err
	}
	h.mu.Lock()
	if h.generation == generation {
		h.status.SentBytes += uint64(len(message))
	}
	h.mu.Unlock()
	return nil
}
