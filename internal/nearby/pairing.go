package nearby

// The four-digit code is an invitation convenience, not an encryption key.
// Its bootstrap runs ONLY over an already authenticated and encrypted native
// Windows Bluetooth connection. The host must approve that actual paired peer
// before the full random invitation is released. TLS 1.3 then pins the existing
// endpoint identity exactly as with the invitation-file path. Never enable this
// bootstrap on a relayed connection: pairing authenticates only the next hop.

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net"
	"strings"
	"time"
)

const pairingCodeLifetime = 2 * time.Minute
const pairingFrameLimit = 1024
const pairingAttemptLimit = 3
const pairingMagic = "DBP1"

type PairingRequest struct {
	ID      string `json:"id"`
	Address string `json:"address"`
}

type pairingFrame struct {
	Code       string `json:"code,omitempty"`
	Invitation string `json:"invitation,omitempty"`
	Error      string `json:"error,omitempty"`
}

// This unexported capability can only be implemented inside this package.
// Native Conn grants it only for successful AF_BTH authenticated/encrypted
// sockets, never for a generic stream or the TCP native-wrapper tests.
type authenticatedBluetoothStream interface {
	authenticatedBluetoothPeer() string
}

func authenticatedPeer(conn net.Conn) string {
	transport, ok := conn.(authenticatedBluetoothStream)
	if !ok {
		return ""
	}
	peer := transport.authenticatedBluetoothPeer()
	if len(peer) != 12 || !strings.EqualFold(peer, conn.RemoteAddr().String()) {
		return ""
	}
	for _, ch := range peer {
		if !((ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F')) {
			return ""
		}
	}
	return strings.ToUpper(peer)
}

func isPairingCode(code string) bool {
	if len(code) != 4 {
		return false
	}
	for _, ch := range code {
		if ch < '0' || ch > '9' {
			return false
		}
	}
	return true
}

func makePairingCode() (string, error) {
	value, err := rand.Int(rand.Reader, big.NewInt(10000))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%04d", value.Int64()), nil
}

func writePairingFrame(writer io.Writer, frame pairingFrame) error {
	data, err := json.Marshal(frame)
	if err != nil {
		return err
	}
	if len(data) == 0 || len(data) > pairingFrameLimit {
		return errors.New("Invalid short-pairing frame.")
	}
	var header [4]byte
	binary.BigEndian.PutUint32(header[:], uint32(len(data)))
	_, err = io.Copy(writer, io.MultiReader(bytes.NewReader(header[:]), bytes.NewReader(data)))
	return err
}

func readPairingFrame(reader io.Reader) (pairingFrame, error) {
	var header [4]byte
	if _, err := io.ReadFull(reader, header[:]); err != nil {
		return pairingFrame{}, err
	}
	size := binary.BigEndian.Uint32(header[:])
	if size == 0 || size > pairingFrameLimit {
		return pairingFrame{}, errors.New("Invalid short-pairing frame length.")
	}
	data := make([]byte, size)
	if _, err := io.ReadFull(reader, data); err != nil {
		return pairingFrame{}, err
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	var frame pairingFrame
	if err := decoder.Decode(&frame); err != nil {
		return pairingFrame{}, errors.New("Invalid short-pairing frame.")
	}
	if decoder.Decode(new(any)) != io.EOF {
		return pairingFrame{}, errors.New("Invalid short-pairing frame.")
	}
	return frame, nil
}

type prefixedBluetoothConn struct {
	net.Conn
	reader io.Reader
}

func (c *prefixedBluetoothConn) Read(buffer []byte) (int, error) { return c.reader.Read(buffer) }

func (h *Hub) expirePairing(generation uint64) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.generation != generation || h.status.PairingCode == "" || time.Now().Before(h.pairingExpires) {
		return
	}
	h.status.PairingCode, h.status.PairingExpiresAt = "", ""
	h.status.PairingError = "The 4-digit code expired. Choose Share this document again for a fresh code."
	h.status.PairingRequest = nil
	h.pairingRequestExpires = time.Time{}
	if decision := h.pairingDecision; decision != nil {
		h.pairingDecision = nil
		decision <- false
	}
	h.signalLocked(nil)
}

func (h *Hub) ApprovePairing(requestID string) error { return h.decidePairing(requestID, true) }
func (h *Hub) RejectPairing(requestID string) error  { return h.decidePairing(requestID, false) }

func (h *Hub) decidePairing(requestID string, approve bool) error {
	h.command.Lock()
	defer h.command.Unlock()
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.status.PairingRequest == nil || h.status.PairingRequest.ID != requestID || h.pairingDecision == nil {
		return errors.New("This pairing request has ended. Ask the other laptop to connect again.")
	}
	if !h.allowShortPairing || h.status.PairingCode == "" || !time.Now().Before(h.pairingExpires) {
		return errors.New("This pairing code expired. Choose Share this document again for a fresh code.")
	}
	if !time.Now().Before(h.pairingRequestExpires) {
		return errors.New("This pairing request timed out. Ask the other laptop to connect again.")
	}
	decision := h.pairingDecision
	h.pairingDecision, h.status.PairingRequest = nil, nil
	h.pairingRequestExpires = time.Time{}
	if approve {
		h.status.PairingCode, h.status.PairingExpiresAt, h.status.PairingError = "", "", ""
	} else {
		h.status.PairingError = "Pairing request rejected. No invitation or document was shared."
		if h.pairingAttempts >= pairingAttemptLimit {
			h.disablePairingLocked()
		}
	}
	decision <- approve
	h.signalLocked(nil)
	return nil
}

func (h *Hub) disablePairingLocked() {
	h.status.PairingCode, h.status.PairingExpiresAt = "", ""
	h.status.PairingError = "The 4-digit code reached its 3-attempt limit. Choose Share this document again for a fresh code."
}

func (h *Hub) acceptPairingOrTLS(ctx context.Context, generation uint64, raw net.Conn, invitation string) (net.Conn, error) {
	var prefix [4]byte
	if _, err := io.ReadFull(raw, prefix[:]); err != nil {
		return nil, err
	}
	if string(prefix[:]) != pairingMagic {
		return &prefixedBluetoothConn{Conn: raw, reader: io.MultiReader(bytes.NewReader(prefix[:]), raw)}, nil
	}
	peer := authenticatedPeer(raw)
	if !h.allowShortPairing || peer == "" {
		return nil, errors.New("Short codes require a directly paired, authenticated Windows Bluetooth connection.")
	}
	request, err := readPairingFrame(raw)
	if err != nil {
		return nil, err
	}
	h.mu.Lock()
	if h.generation != generation || ctx.Err() != nil {
		h.mu.Unlock()
		return nil, errors.New("Bluetooth sharing session ended.")
	}
	if h.status.PairingCode == "" || !time.Now().Before(h.pairingExpires) || h.pairingAttempts >= pairingAttemptLimit {
		h.mu.Unlock()
		_ = writePairingFrame(raw, pairingFrame{Error: "Pairing code expired or unavailable. Ask the host for a fresh code."})
		return nil, errors.New("Pairing code expired or unavailable.")
	}
	h.pairingAttempts++ // One global budget across every peer; addresses cannot reset it.
	if !isPairingCode(request.Code) || request.Invitation != "" || request.Error != "" || subtle.ConstantTimeCompare([]byte(request.Code), []byte(h.status.PairingCode)) != 1 {
		h.status.PairingError = "Incorrect 4-digit code. Check the code shown on this laptop."
		if h.pairingAttempts >= pairingAttemptLimit {
			h.disablePairingLocked()
		}
		h.signalLocked(nil)
		h.mu.Unlock()
		_ = writePairingFrame(raw, pairingFrame{Error: "Incorrect or expired pairing code. Check the host laptop."})
		return nil, errors.New("Incorrect pairing code.")
	}
	requestID := randomToken()
	decision := make(chan bool, 1)
	requestExpires := time.Now().Add(h.pairingApprovalTimeout)
	if h.pairingExpires.Before(requestExpires) {
		requestExpires = h.pairingExpires
	}
	h.status.PairingRequest = &PairingRequest{ID: requestID, Address: peer}
	h.pairingDecision = decision
	h.pairingRequestExpires = requestExpires
	h.status.PairingError = ""
	h.signalLocked(nil)
	h.mu.Unlock()
	defer func() {
		h.mu.Lock()
		defer h.mu.Unlock()
		if h.generation == generation && h.status.PairingRequest != nil && h.status.PairingRequest.ID == requestID {
			h.status.PairingRequest, h.pairingDecision = nil, nil
			h.pairingRequestExpires = time.Time{}
			h.status.PairingError = "Pairing approval timed out. No invitation or document was shared."
			if h.pairingAttempts >= pairingAttemptLimit {
				h.disablePairingLocked()
			}
			h.signalLocked(nil)
		}
	}()
	_ = raw.SetDeadline(time.Now().Add(h.pairingApprovalTimeout + 12*time.Second))
	timer := time.NewTimer(h.pairingApprovalTimeout)
	defer timer.Stop()
	approved := false
	select {
	case approved = <-decision:
	case <-timer.C:
	case <-ctx.Done():
	}
	if !approved || ctx.Err() != nil || !time.Now().Before(requestExpires) {
		_ = writePairingFrame(raw, pairingFrame{Error: "The host did not approve pairing. Ask the host to approve a new request."})
		return nil, errors.New("Bluetooth pairing was not approved.")
	}
	// Recheck native membership immediately before releasing the capability.
	// An expired generation or changed peer can never receive a fresh invitation.
	if authenticatedPeer(raw) != peer {
		return nil, errors.New("The paired Bluetooth device is no longer authenticated.")
	}
	h.mu.Lock()
	current := h.generation == generation && ctx.Err() == nil && h.status.Invitation == invitation
	h.mu.Unlock()
	if !current {
		return nil, errors.New("Bluetooth sharing session ended.")
	}
	if err := writePairingFrame(raw, pairingFrame{Invitation: invitation}); err != nil {
		return nil, err
	}
	return raw, nil
}

func (h *Hub) resolvePairing(ctx context.Context, raw net.Conn, address, code string) (string, error) {
	peer := authenticatedPeer(raw)
	if !h.allowShortPairing || peer == "" || !strings.EqualFold(peer, address) {
		return "", errors.New("Short codes require a directly paired Windows laptop. Select its paired Bluetooth device or use the complete invitation.")
	}
	deadline := time.Now().Add(45 * time.Second)
	if limit, ok := ctx.Deadline(); ok && limit.Before(deadline) {
		deadline = limit
	}
	_ = raw.SetDeadline(deadline)
	if _, err := io.Copy(raw, strings.NewReader(pairingMagic)); err != nil {
		return "", errors.New("The host could not be reached for pairing.")
	}
	if err := writePairingFrame(raw, pairingFrame{Code: code}); err != nil {
		return "", errors.New("The pairing request could not be sent.")
	}
	reply, err := readPairingFrame(raw)
	if err != nil {
		return "", errors.New("Pairing did not finish. Use the same updated package on both laptops and ask the host to approve the request.")
	}
	if reply.Error != "" {
		return "", errors.New(reply.Error)
	}
	if reply.Code != "" || reply.Invitation == "" {
		return "", errors.New("The host returned an invalid pairing response.")
	}
	if _, _, err := clientIdentity(reply.Invitation); err != nil {
		return "", errors.New("The host returned an invalid invitation.")
	}
	if authenticatedPeer(raw) != peer {
		return "", errors.New("The paired Bluetooth device is no longer authenticated.")
	}
	return reply.Invitation, nil
}
