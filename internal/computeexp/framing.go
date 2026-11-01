//go:build compute_experiment

package computeexp

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"net"
	"sync"
)

// MaxFrameBytes bounds the encoded JSON payload, excluding its four-byte prefix.
const MaxFrameBytes = 64 * 1024

type Frame struct {
	Type string          `json:"type"`
	Body json.RawMessage `json:"body"`
}

// Channel serializes complete frame writes and reads on an existing connection.
// It does not start goroutines, own deadlines, or close the caller's connection.
// The caller should close a connection after any protocol error.
type Channel struct {
	conn net.Conn
	send sync.Mutex
	read sync.Mutex
}

func NewChannel(conn net.Conn) *Channel { return &Channel{conn: conn} }

func validComputeFrameType(kind string) bool {
	if len(kind) == 0 || len(kind) > 32 {
		return false
	}
	for _, character := range kind {
		if (character < 'a' || character > 'z') && character != '/' && character != '_' && character != '-' {
			return false
		}
	}
	return true
}

func writeComputeBytes(writer io.Writer, data []byte) error {
	for len(data) > 0 {
		written, err := writer.Write(data)
		if written < 0 || written > len(data) {
			return io.ErrShortWrite
		}
		if err != nil {
			return err
		}
		if written == 0 {
			return io.ErrShortWrite
		}
		data = data[written:]
	}
	return nil
}

func decodeComputeJSON(data []byte, destination any) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return errors.New("Invalid compute message body.")
	}
	if err := decoder.Decode(new(any)); !errors.Is(err, io.EOF) {
		return errors.New("Invalid compute message body.")
	}
	return nil
}

func decodeComputeFrame(data []byte) (Frame, error) {
	invalid := errors.New("Invalid compute frame.")
	decoder := json.NewDecoder(bytes.NewReader(data))
	start, err := decoder.Token()
	if err != nil || start != json.Delim('{') {
		return Frame{}, invalid
	}
	var frame Frame
	seenType, seenBody := false, false
	for decoder.More() {
		key, err := decoder.Token()
		if err != nil {
			return Frame{}, invalid
		}
		switch key {
		case "type":
			if seenType || decoder.Decode(&frame.Type) != nil {
				return Frame{}, invalid
			}
			seenType = true
		case "body":
			if seenBody || decoder.Decode(&frame.Body) != nil {
				return Frame{}, invalid
			}
			seenBody = true
		default:
			return Frame{}, invalid
		}
	}
	end, err := decoder.Token()
	if err != nil || end != json.Delim('}') || !seenType || !seenBody || !validComputeFrameType(frame.Type) {
		return Frame{}, invalid
	}
	if err := decoder.Decode(new(any)); !errors.Is(err, io.EOF) {
		return Frame{}, invalid
	}
	return frame, nil
}

// Send validates and serializes a message without including its contents in
// validation errors. Concurrent sends cannot interleave headers and payloads.
func (channel *Channel) Send(kind string, body any) error {
	if channel == nil || channel.conn == nil {
		return errors.New("Compute transport is unavailable.")
	}
	if !validComputeFrameType(kind) {
		return errors.New("Invalid compute frame type.")
	}
	encodedBody, err := json.Marshal(body)
	if err != nil {
		return errors.New("Could not encode compute message.")
	}
	if len(encodedBody) > MaxFrameBytes {
		return errors.New("Compute frame exceeds the size limit.")
	}
	data, err := json.Marshal(Frame{Type: kind, Body: encodedBody})
	if err != nil {
		return errors.New("Could not encode compute message.")
	}
	if len(data) == 0 || len(data) > MaxFrameBytes {
		return errors.New("Compute frame exceeds the size limit.")
	}
	var header [4]byte
	binary.BigEndian.PutUint32(header[:], uint32(len(data)))
	channel.send.Lock()
	defer channel.send.Unlock()
	if err := writeComputeBytes(channel.conn, header[:]); err != nil {
		return err
	}
	return writeComputeBytes(channel.conn, data)
}

func (channel *Channel) Read() (Frame, error) {
	if channel == nil || channel.conn == nil {
		return Frame{}, errors.New("Compute transport is unavailable.")
	}
	channel.read.Lock()
	defer channel.read.Unlock()
	var header [4]byte
	if _, err := io.ReadFull(channel.conn, header[:]); err != nil {
		return Frame{}, err
	}
	length := binary.BigEndian.Uint32(header[:])
	if length == 0 || length > MaxFrameBytes {
		return Frame{}, errors.New("Invalid compute frame length.")
	}
	// The length is checked before allocating or reading any payload bytes.
	data := make([]byte, int(length))
	if _, err := io.ReadFull(channel.conn, data); err != nil {
		return Frame{}, err
	}
	return decodeComputeFrame(data)
}

// Decode requires the expected message type and rejects unknown body fields or
// trailing JSON values. Domain-specific value validation remains with the caller.
func Decode(frame Frame, want string, destination any) error {
	if !validComputeFrameType(want) || frame.Type != want || len(frame.Body) == 0 || len(frame.Body) > MaxFrameBytes {
		return errors.New("Unexpected compute message.")
	}
	return decodeComputeJSON(frame.Body, destination)
}
